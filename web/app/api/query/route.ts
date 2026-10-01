import { NextRequest, NextResponse } from "next/server";
import spawn from "cross-spawn";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { systemPrompt, type Mode } from "@/lib/prompts";

const AUTHOR = process.env.SECOND_BRAIN_AUTHOR ?? "เจ้าของคลังความรู้";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = "bge-m3"; // local ผ่าน Ollama (ollama pull bge-m3) — 1024 dims, ไม่เสีย API token

// embed คำถามด้วย Ollama ในเครื่อง
async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: [text] }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed error (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.embeddings[0];
}

// เรียก Claude Code CLI ในเครื่อง (ใช้ subscription ที่ล็อกอินไว้ผ่าน `claude`, ไม่ยิง Anthropic API ด้วย key แยก)
// system prompt ส่งผ่านไฟล์ชั่วคราว + prompt ส่งผ่าน stdin (ไม่ใช่ command-line argument)
// เพราะข้อความหลายบรรทัดที่ส่งเป็น argument ตรงๆ จะโดน cmd.exe (Windows) ตัดทิ้งที่ตัวขึ้นบรรทัดใหม่
async function askClaude(system: string, prompt: string): Promise<string> {
  const sysFile = join(tmpdir(), `second-brain-system-${randomUUID()}.txt`);
  await writeFile(sysFile, system, "utf8");
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "claude",
        [
          "-p",
          "--system-prompt-file", sysFile,
          "--output-format", "json",
          "--tools", "",
          "--permission-prompts", "none",
          "--no-session-persistence",
          "--model", "sonnet",
        ],
        { stdio: ["pipe", "pipe", "pipe"] }
      );

      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (d) => (stdout += d));
      child.stderr!.on("data", (d) => (stderr += d));
      child.on("error", (err) =>
        reject(new Error(`เรียก claude CLI ไม่ได้ (ติดตั้งหรือยัง? npm install -g @anthropic-ai/claude-code): ${err.message}`))
      );
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`claude CLI exit ${code}: ${stderr || stdout}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.is_error) reject(new Error(parsed.result || "claude CLI error"));
          else resolve(parsed.result ?? "");
        } catch {
          reject(new Error(`อ่านผลลัพธ์จาก claude CLI ไม่ได้: ${stdout}`));
        }
      });

      child.stdin!.write(prompt, "utf8");
      child.stdin!.end();
    });
  } finally {
    await unlink(sysFile).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  try {
    const { question, mode = "grounded", onlyTrusted = false, types = null, author = null } =
      (await req.json()) as {
        question: string;
        mode: Mode;
        onlyTrusted: boolean;
        types: string[] | null;
        author: string | null;
      };

    if (!question?.trim()) {
      return NextResponse.json({ error: "no question" }, { status: 400 });
    }

    // 1) embed + retrieve (กรองเฉพาะบุคคลที่เลือก ถ้ามี)
    // ดึงมาเผื่อเยอะกว่าที่ใช้จริง (24) แล้วค่อยจำกัดจำนวน chunk ต่อแหล่งข้อมูลทีหลัง
    // กันบทความเดียวที่ยาว/เนื้อหากว้างยึด context ทั้งหมดจนบทความเฉพาะเจาะจงอื่นหลุดไป
    const FINAL_COUNT = 8;
    const MAX_PER_SOURCE = 2;
    const qvec = await embedQuery(question);
    const { data: candidates, error } = await supabaseAdmin.rpc("match_chunks", {
      query_embedding: qvec,
      match_count: 24,
      min_credibility: onlyTrusted ? "high" : "medium",
      filter_types: types,
      filter_author: author,
    });
    if (error) throw error;

    const perSourceCount = new Map<string, number>();
    const matches = [];
    for (const m of candidates ?? []) {
      const count = perSourceCount.get(m.source_id) ?? 0;
      if (count >= MAX_PER_SOURCE) continue;
      perSourceCount.set(m.source_id, count + 1);
      matches.push(m);
      if (matches.length >= FINAL_COUNT) break;
    }

    // 2) เรียงข้อมูลใหม่สุดไว้บน เก่าสุดไว้ล่าง (ใช้ published_at ถ้ามี ไม่มีก็ใช้วันที่เพิ่มเข้าระบบแทน)
    const withDate = matches.map((m: any) => {
      const hasPublished = !!m.published_at;
      const date = m.published_at || (m.source_created_at ? m.source_created_at.slice(0, 10) : null);
      return { ...m, date, hasPublished };
    });
    withDate.sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));

    // 3) สร้าง context พร้อม tag ที่มา + วันที่ (บอกทุกครั้งว่าเป็นวันที่เผยแพร่จริงหรือวันที่เพิ่มเข้าระบบ)
    const context = withDate
      .map((m: any, i: number) => {
        const src = m.source_type === "news" ? m.publisher ?? "ข่าว" : m.title;
        const loc = m.page_or_timestamp ? `, ${m.page_or_timestamp}` : "";
        const dateTag = m.date ? `, ${m.hasPublished ? "เผยแพร่" : "เพิ่มเข้าระบบ"} ${m.date}` : "";
        return `[${i + 1}] (${src}${loc}${dateTag})\n${m.content}`;
      })
      .join("\n\n---\n\n");

    const citations = withDate.map((m: any, i: number) => ({
      n: i + 1,
      type: m.source_type,
      title: m.title,
      publisher: m.publisher,
      url: m.url,
      loc: m.page_or_timestamp,
      date: m.date,
      hasPublished: m.hasPublished,
      similarity: Number(m.similarity?.toFixed(3)),
    }));

    // 3) เรียก Claude Code CLI ในเครื่อง
    const answer = await askClaude(
      systemPrompt(mode, author || AUTHOR),
      `CONTEXT:\n${context || "(ไม่มีข้อมูลที่เกี่ยวข้อง)"}\n\nคำถาม: ${question}`
    );

    return NextResponse.json({ answer, citations });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message ?? "error" }, { status: 500 });
  }
}

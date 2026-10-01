import { NextRequest, NextResponse } from "next/server";
import spawn from "cross-spawn";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase";

const INGEST_DIR = path.join(process.cwd(), "..", "ingest");
const PYTHON = path.join(INGEST_DIR, ".venv", "Scripts", "python.exe");

function runIngestScript(script: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [path.join(INGEST_DIR, script), ...args], {
      cwd: INGEST_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", (e) => resolve({ code: 1, out: String(e) }));
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = (await req.json()) as { action: "approve" | "reject" };

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("pending_sources")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !row) return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });

  if (action === "reject") {
    const { error } = await supabaseAdmin
      .from("pending_sources")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "approve") {
    const script = row.type === "youtube" ? "ingest_youtube.py" : "ingest_news.py";
    const args = [row.url, "--author", row.author];
    if (row.found_date) args.push("--published", row.found_date);

    const result = await runIngestScript(script, args);
    if (result.code !== 0) {
      return NextResponse.json({ error: `ingest ล้มเหลว: ${result.out.slice(-800)}` }, { status: 500 });
    }

    const { error } = await supabaseAdmin
      .from("pending_sources")
      .update({ status: "ingested", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, log: result.out.slice(-500) });
  }

  return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
}

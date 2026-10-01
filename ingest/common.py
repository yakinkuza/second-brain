"""Shared helpers: env, clients, chunking, embedding, DB upsert."""
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from typing import Optional

import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# กัน crash ตอน print เนื้อหาที่ดึงมาจากเว็บ (title ข่าวบางเว็บมีอักขระที่ console
# ของ Windows (cp874) เข้ารหัสไม่ได้ เช่น non-breaking hyphen, smart quotes)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # service role (ingest only, server-side)
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

EMBED_MODEL = "bge-m3"            # local ผ่าน Ollama (ollama pull bge-m3) — 1024 dims, ไม่เสีย API token
CHUNK_TOKENS = 700                # ~ตัวอักษร/4
CHUNK_OVERLAP = 120


# ---------- chunking (ง่าย เสถียร รองรับไทย) ----------
def chunk_text(text: str, size: int = CHUNK_TOKENS, overlap: int = CHUNK_OVERLAP):
    """แบ่งด้วยจำนวน "คำโดยประมาณ" (นับ token คร่าว ๆ = ตัวอักษร/4)."""
    text = re.sub(r"\s+\n", "\n", text).strip()
    approx_char = size * 4
    approx_overlap = overlap * 4
    chunks, start = [], 0
    while start < len(text):
        end = start + approx_char
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - approx_overlap
        if start < 0:
            start = 0
    return chunks


# ---------- embedding (batch, local ผ่าน Ollama) ----------
def embed_batch(texts: list[str]):
    out = []
    B = 8  # เล็กไว้เพราะ bge-m3 รันบน CPU (ไม่มี GPU) ตัวใหญ่เกินไปจะ timeout
    for i in range(0, len(texts), B):
        batch = texts[i:i + B]
        res = requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": batch},
            timeout=300,
        )
        res.raise_for_status()
        out.extend(res.json()["embeddings"])
    return out


# ---------- DB ----------
def insert_source(
    type_: str,
    title: str,
    url: Optional[str] = None,
    author: Optional[str] = None,
    publisher: Optional[str] = None,
    published_at: Optional[str] = None,
    credibility: str = "high",
) -> str:
    row = {
        "type": type_, "title": title, "url": url, "author": author,
        "publisher": publisher, "published_at": published_at,
        "credibility": credibility,
    }
    res = sb.table("sources").insert(row).execute()
    return res.data[0]["id"]


# ---------- Claude Code CLI ในเครื่อง (subscription เดิม ไม่เสีย API token แยก) ----------
_claude_bin: Optional[str] = None


def resolve_claude_bin() -> str:
    """หา path ของ claude executable ตัวจริง (ไม่ใช่ .cmd shim บน Windows
    เพราะ subprocess เรียก .cmd ตรงๆ ไม่ได้ ต้องมี cmd.exe ครอบ ซึ่งจะตัดข้อความ
    หลายบรรทัดทิ้งที่ตัวขึ้นบรรทัดใหม่ — เรียก .exe จริงข้างในตรงๆ เลยปลอดภัยกว่า)"""
    global _claude_bin
    if _claude_bin:
        return _claude_bin
    direct = shutil.which("claude")
    if direct and direct.lower().endswith(".exe"):
        _claude_bin = direct
        return _claude_bin
    shim = shutil.which("claude.cmd") or shutil.which("claude")
    if not shim:
        raise RuntimeError("หา claude CLI ไม่เจอ — ติดตั้งด้วย npm install -g @anthropic-ai/claude-code")
    exe = os.path.join(
        os.path.dirname(shim), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"
    )
    _claude_bin = exe if os.path.exists(exe) else shim
    return _claude_bin


def ask_claude(prompt: str, tools: str = "", json_schema: Optional[dict] = None, timeout: int = 120) -> str:
    """ส่ง prompt ผ่าน stdin (กัน cmd.exe ตัดข้อความหลายบรรทัดทิ้ง)."""
    args = [
        resolve_claude_bin(), "-p",
        "--tools", tools,
        "--permission-mode" if tools else "--permission-prompts", "bypassPermissions" if tools else "none",
        "--output-format", "json",
        "--no-session-persistence",
        "--model", "sonnet",
    ]
    if json_schema:
        args += ["--json-schema", json.dumps(json_schema)]
    proc = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"claude CLI exit {proc.returncode}: {proc.stderr or proc.stdout}")
    parsed = json.loads(proc.stdout)
    if parsed.get("is_error"):
        raise RuntimeError(parsed.get("result") or "claude CLI error")
    return parsed["result"]


# ---------- ตรวจภาษา + สรุปไทย (ช่วยให้ embedding ค้นเจอตอนถามเป็นไทย) ----------
def is_mostly_thai(text: str) -> bool:
    sample = text[:500]
    thai_chars = sum(1 for c in sample if "฀" <= c <= "๿")
    letters = sum(1 for c in sample if c.isalpha())
    return letters == 0 or thai_chars / letters > 0.3


def thai_gloss(text: str) -> str:
    """สรุปเนื้อหา (ภาษาไหนก็ได้) เป็นไทย 1-2 ประโยคสั้นๆ เพื่อฝังไว้ในเนื้อหาก่อน embed
    ไม่งั้น chunk ภาษาอังกฤษล้วนจะไม่ค่อยติดอันดับตอนมีคนถามเป็นภาษาไทย (cross-lingual gap)."""
    try:
        return ask_claude(
            f"สรุปเนื้อหาต่อไปนี้เป็นภาษาไทย 1-2 ประโยคสั้นๆ ตอบเฉพาะประโยคสรุป ไม่ต้องมีคำนำ:\n\n{text[:2000]}",
            timeout=60,
        ).strip()
    except Exception:
        return ""


def insert_chunks(source_id: str, chunks: list[str], page_tags: Optional[list[str]] = None):
    """embed แล้ว insert เป็น batch."""
    vectors = embed_batch(chunks)
    rows = []
    for i, (content, vec) in enumerate(zip(chunks, vectors)):
        rows.append({
            "id": str(uuid.uuid4()),
            "source_id": source_id,
            "content": content,
            "chunk_index": i,
            "page_or_timestamp": page_tags[i] if page_tags else None,
            "embedding": vec,
        })
    B = 200
    for i in range(0, len(rows), B):
        sb.table("chunks").insert(rows[i:i + B]).execute()
    return len(rows)

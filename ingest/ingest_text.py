"""
Ingest ข้อความแบบ manual — ใช้ตอนไม่มี URL/ไฟล์ให้ดึงอัตโนมัติ
(เช่น ก็อปเนื้อข่าวมาวาง, พิมพ์ประวัติ/คำพูดเอง, เว็บบล็อกการดึงอัตโนมัติ)
Usage:
  python ingest_text.py "path/to/text.txt" --title "หัวข้อ" --author "ชื่อคน" \
      --type bio --published 2026-01-15 --url "https://..." --credibility medium
  (หรือส่งข้อความผ่าน stdin: python ingest_text.py - --title ... --author ...)
"""
import argparse
import sys

from common import chunk_text, insert_source, insert_chunks


def run(path: str, title: str, author: str, type_: str, published: str | None,
        url: str | None, publisher: str | None, credibility: str):
    text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    if not text.strip():
        raise RuntimeError("ไม่มีเนื้อหาให้ ingest")

    source_id = insert_source(
        type_=type_, title=title, url=url, author=author,
        publisher=publisher, published_at=published, credibility=credibility,
    )
    chunks = chunk_text(text)
    n = insert_chunks(source_id, chunks)
    print(f"[{type_}] '{title}' -> {n} chunks, published={published} (source_id={source_id})")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("path", help="path ไฟล์ .txt หรือ '-' เพื่ออ่านจาก stdin")
    p.add_argument("--title", required=True)
    p.add_argument("--author", required=True)
    p.add_argument("--type", default="bio", choices=["bio", "news", "youtube", "book"])
    p.add_argument("--published", default=None, help="วันที่ YYYY-MM-DD")
    p.add_argument("--url", default=None)
    p.add_argument("--publisher", default=None)
    p.add_argument("--credibility", default="medium", choices=["high", "medium"])
    a = p.parse_args()
    run(a.path, a.title, a.author, a.type, a.published, a.url, a.publisher, a.credibility)

"""
Ingest หนังสือ PDF — เก็บเลขหน้าไว้ทำ citation
Usage:
  python ingest_book.py "path/to/book.pdf" --title "ชื่อหนังสือ" --author "ชื่อผู้เขียน" [--published YYYY-MM-DD]
"""
import argparse
import re

import pdfplumber

from common import chunk_text, insert_source, insert_chunks


def parse_pdf_date(raw: str | None) -> str | None:
    """แปลง PDF date เช่น D:20230115120000 -> 2023-01-15 (best-effort)."""
    if not raw:
        return None
    m = re.search(r"(\d{4})(\d{2})(\d{2})", raw)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def run(pdf_path: str, title: str, author: str, published: str | None):
    all_chunks, page_tags = [], []
    with pdfplumber.open(pdf_path) as pdf:
        published = published or parse_pdf_date(pdf.metadata.get("CreationDate"))
        for pageno, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if not text.strip():
                continue
            for ch in chunk_text(text):
                all_chunks.append(ch)
                page_tags.append(f"หน้า {pageno}")

    source_id = insert_source(
        type_="book", title=title, author=author, credibility="high", published_at=published,
    )
    n = insert_chunks(source_id, all_chunks, page_tags)
    print(f"[book] '{title}' -> {n} chunks, published={published} (source_id={source_id})")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("pdf")
    p.add_argument("--title", required=True)
    p.add_argument("--author", required=True)
    p.add_argument("--published", default=None, help="วันที่พิมพ์ YYYY-MM-DD (ถ้าไม่ใส่จะลองอ่านจาก metadata ของ PDF)")
    a = p.parse_args()
    run(a.pdf, a.title, a.author, a.published)

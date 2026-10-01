"""
Auto-search ข่าว/บทสัมภาษณ์ใหม่ของแต่ละคนในคลังความรู้ (รันทุกวันผ่าน Task Scheduler)
ใช้ Claude Code CLI (subscription เดิม ไม่เสีย API token แยก) + WebSearch tool

- ไม่ ingest อัตโนมัติ — แค่หามาเก็บไว้ใน pending_sources ให้คนกด approve เองในเว็บ
- URL ที่เคยเจอแล้ว (ไม่ว่าจะ approve/reject/ingest ไปแล้ว) จะไม่ถูกเสนอซ้ำอีก
- เขียนสรุปความเคลื่อนไหวรายวันเก็บไว้ที่ daily_digests ด้วยในคราวเดียวกัน

Usage:
  python discover.py            # ทำทุกคนที่มีอยู่ในคลังความรู้
  python discover.py --author "โทฟุซัง (สุรนาม พานิชการ)"
"""
import argparse
import json
import re
import sys
from datetime import date

from common import sb, ask_claude

JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "title": {"type": "string"},
                    "type": {"type": "string", "enum": ["news", "youtube"]},
                    "date": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["url", "title", "type"],
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["items", "summary"],
}


def known_urls(author: str) -> set[str]:
    a = sb.table("sources").select("url").eq("author", author).execute().data
    b = sb.table("pending_sources").select("url").eq("author", author).execute().data
    return {r["url"] for r in a if r.get("url")} | {r["url"] for r in b}


def all_authors() -> list[str]:
    rows = sb.table("sources").select("author").execute().data
    return sorted({r["author"] for r in rows if r.get("author")})


def ask_claude_search(author: str, exclude: set[str]) -> dict:
    exclude_list = "\n".join(sorted(exclude)) or "(ยังไม่มี)"
    prompt = (
        f'ค้นหาข่าวหรือบทสัมภาษณ์ใหม่ๆ เกี่ยวกับ "{author}" ที่เผยแพร่ในช่วง 30 วันที่ผ่านมา\n'
        f"ห้ามแนะนำ URL ต่อไปนี้ที่มีอยู่แล้ว:\n{exclude_list}\n\n"
        'ตอบเป็น JSON: {"items": [รายการข่าว/คลิปใหม่ที่เจอ ไม่เกิน 10 รายการ], '
        '"summary": "สรุปสั้นๆ 2-4 ประโยคว่าวันนี้มีความเคลื่อนไหวอะไรเกี่ยวกับคนนี้บ้าง '
        'ถ้าไม่เจออะไรใหม่ให้บอกตรงๆ ว่าไม่มีความเคลื่อนไหวใหม่"}'
    )
    result = ask_claude(prompt, tools="WebSearch", json_schema=JSON_SCHEMA, timeout=300)
    return json.loads(result)


def parse_date(raw: str | None) -> str | None:
    if not raw:
        return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def run_for_author(author: str):
    exclude = known_urls(author)
    print(f"=== {author} ({len(exclude)} known URLs) ===")
    result = ask_claude_search(author, exclude)

    new_count = 0
    for item in result.get("items", []):
        url = (item.get("url") or "").strip()
        if not url or url in exclude:
            continue
        try:
            sb.table("pending_sources").insert({
                "type": item.get("type", "news"),
                "url": url,
                "title": item.get("title"),
                "author": author,
                "found_date": parse_date(item.get("date")),
                "reason": item.get("reason"),
                "status": "pending",
            }).execute()
            new_count += 1
            exclude.add(url)
        except Exception as e:
            # unique constraint กันซ้ำ ถ้าชนกันแค่ข้ามไป (เคยเจอจาก run ก่อนหน้าแบบ concurrent)
            print(f"  skip (duplicate?) {url}: {e}")

    today = date.today().isoformat()
    summary = result.get("summary", "").strip() or "ไม่มีความเคลื่อนไหวใหม่"
    sb.table("daily_digests").upsert(
        {"author": author, "digest_date": today, "summary": summary},
        on_conflict="author,digest_date",
    ).execute()

    print(f"  -> {new_count} candidate ใหม่, digest: {summary[:80]}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--author", default=None, help="ถ้าไม่ใส่จะทำทุกคนในคลังความรู้")
    a = p.parse_args()

    authors = [a.author] if a.author else all_authors()
    if not authors:
        print("ยังไม่มีบุคคลในคลังความรู้เลย")
        sys.exit(0)

    for author in authors:
        try:
            run_for_author(author)
        except Exception as e:
            print(f"  ERROR: {e}")

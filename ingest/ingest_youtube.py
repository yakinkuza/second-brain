"""
Ingest บทสัมภาษณ์ YouTube — ดึง transcript + เก็บ timestamp
Usage:
  python ingest_youtube.py "https://youtu.be/XXXX" --author "ชื่อผู้ให้สัมภาษณ์" --lang th
ต้องมี subtitle/CC บนคลิป ถ้าไม่มีให้ใช้ Whisper แยก (ดู README)
"""
import argparse
import re

import requests
from youtube_transcript_api import YouTubeTranscriptApi
from common import chunk_text, insert_source, insert_chunks


def video_id(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|embed/)([A-Za-z0-9_-]{11})", url)
    if not m:
        raise ValueError("แยก video id ไม่ได้")
    return m.group(1)


def fetch_published_date(vid: str) -> str | None:
    """ดึงวันที่เผยแพร่คลิปจากหน้า YouTube (best-effort เผื่อดึงไม่ได้)."""
    try:
        html = requests.get(
            f"https://www.youtube.com/watch?v={vid}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=15,
        ).text
        m = re.search(r'"publishDate":"(\d{4}-\d{2}-\d{2})', html)
        return m.group(1) if m else None
    except requests.RequestException:
        return None


def fmt_ts(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


def run(url: str, author: str, lang: str, title: str | None, published: str | None):
    vid = video_id(url)
    published = published or fetch_published_date(vid)
    tr = YouTubeTranscriptApi().fetch(vid, languages=[lang, "en"])

    # รวมเป็นบล็อกใหญ่แต่คงเวลาเริ่มของแต่ละบล็อก
    text = " ".join(seg.text.replace("\n", " ") for seg in tr)
    # map ตำแหน่งตัวอักษร -> timestamp คร่าว ๆ
    pos = 0
    char_start_map = []
    for seg in tr:
        char_start_map.append((pos, seg.start))
        pos += len(seg.text) + 1

    chunks = chunk_text(text)
    # หา timestamp ของแต่ละ chunk จากตำแหน่งเริ่ม
    tags, cursor = [], 0
    for ch in chunks:
        idx = text.find(ch[:30], cursor)
        cursor = idx if idx >= 0 else cursor
        ts = 0
        for cpos, cstart in char_start_map:
            if cpos <= cursor:
                ts = cstart
            else:
                break
        tags.append(fmt_ts(ts))

    source_id = insert_source(
        type_="youtube", title=title or f"YouTube {vid}",
        url=url, author=author, credibility="high", published_at=published,
    )
    n = insert_chunks(source_id, chunks, tags)
    print(f"[youtube] {vid} -> {n} chunks, published={published} (source_id={source_id})")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--author", required=True)
    p.add_argument("--lang", default="th")
    p.add_argument("--title", default=None)
    p.add_argument("--published", default=None, help="วันที่เผยแพร่ YYYY-MM-DD (ถ้าไม่ใส่จะพยายามดึงอัตโนมัติ)")
    a = p.parse_args()
    run(a.url, a.author, a.lang, a.title, a.published)

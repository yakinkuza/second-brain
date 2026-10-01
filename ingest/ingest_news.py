"""
Ingest ข่าว/บทความ จาก URL — ดึงเนื้อ + บันทึกค่ายข่าว/วันที่
รับเฉพาะแหล่งเชื่อถือ (กำหนด --publisher เอง เช่น ไทยรัฐ)
Usage:
  python ingest_news.py "https://www.thairath.co.th/..." --author "ชื่อบุคคล" --publisher "ไทยรัฐ"
"""
import argparse
import trafilatura

from common import chunk_text, insert_source, insert_chunks, is_mostly_thai, thai_gloss

# whitelist ค่ายใหญ่ที่นับเป็น credibility = high
TRUSTED = {
    "thairath.co.th": "ไทยรัฐ",
    "matichon.co.th": "มติชน",
    "bangkokpost.com": "Bangkok Post",
    "prachachat.net": "ประชาชาติธุรกิจ",
    "posttoday.com": "โพสต์ทูเดย์",
    "thansettakij.com": "ฐานเศรษฐกิจ",
}


def run(url: str, author: str, publisher: str | None, published: str | None):
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise RuntimeError("โหลด URL ไม่ได้")
    meta = trafilatura.extract_metadata(downloaded)
    text = trafilatura.extract(downloaded, include_comments=False) or ""
    if not text.strip():
        raise RuntimeError("สกัดเนื้อหาไม่ได้")

    domain = (meta.hostname or "").replace("www.", "") if meta else ""
    pub = publisher or TRUSTED.get(domain)
    credibility = "high" if (pub and any(d in url for d in TRUSTED)) else "medium"
    published = published or (meta.date if meta else None)
    title = (meta.title if meta else None) or url

    # เนื้อหาไม่ใช่ภาษาไทย -> เติมสรุปไทยสั้นๆ นำหน้า กัน embedding ค้นไม่เจอตอนถามเป็นไทย
    if not is_mostly_thai(text):
        gloss = thai_gloss(text)
        if gloss:
            text = f"{gloss}\n\n{text}"

    source_id = insert_source(
        type_="news", title=title, url=url, author=author,
        publisher=pub, published_at=published, credibility=credibility,
    )
    chunks = chunk_text(text)
    n = insert_chunks(source_id, chunks)
    print(f"[news] {pub or domain} | {title[:40]}... -> {n} chunks "
          f"(credibility={credibility}, source_id={source_id})")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--author", required=True)
    p.add_argument("--publisher", default=None)
    p.add_argument("--published", default=None, help="วันที่ข่าว YYYY-MM-DD (ถ้าไม่ใส่จะลองอ่านจากหน้าเว็บ)")
    a = p.parse_args()
    run(a.url, a.author, a.publisher, a.published)

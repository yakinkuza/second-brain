# 🧠 Second Brain — persona RAG (Supabase + Claude)

ระบบถามความคิดของบุคคล จากหนังสือ / สัมภาษณ์ YouTube / ข่าวค่ายใหญ่
ตอบได้ 2 โหมด: **อ้างอิงตรง** (grounded + citation) และ **จำลองสไตล์เขา** (persona)

## Stack
- **Supabase (pgvector)** — เก็บ chunk + embedding + metadata ที่มา
- **Ollama (bge-m3, local)** — embedding รองรับไทย รันในเครื่อง ไม่เสีย API token
- **Claude Code CLI (local, subscription)** — สร้างคำตอบ ใช้ Pro/Max subscription แทนการยิง Anthropic API ด้วย key แยก
- **Next.js 14** — หน้าเว็บถาม + toggle โหมด

> โปรเจกต์นี้ออกแบบให้รันบนเครื่องเดียวกับที่ล็อกอิน Claude Code ไว้ (personal/local tool) — ไม่เหมาะ deploy ขึ้น serverless (เช่น Vercel) เพราะต้อง spawn process `claude` และเรียก Ollama ในเครื่อง

---

## ขั้นตอนติดตั้ง

### 1) Supabase
1. สร้าง project ที่ supabase.com
2. เปิด SQL Editor → รัน `sql/schema.sql` ทั้งไฟล์
3. เก็บ `Project URL` และ `service_role key` (Settings → API)

### 2) เครื่องมือในเครื่อง (ไม่เสีย API token)
- **Ollama**: ติดตั้งจาก ollama.com แล้วรัน `ollama pull bge-m3` (embedding รองรับหลายภาษารวมไทย, 1024 มิติ)
- **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code` แล้วรัน `claude` ครั้งนึงเพื่อล็อกอินด้วย Claude subscription (Pro/Max) — ทดสอบว่าใช้ได้ด้วย `claude -p "ok"`

### 3) Ingestion (Python)
```bash
cd ingest
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env    # แล้วเติมค่าจริง

# หนังสือ
python ingest_book.py "book.pdf" --title "ชื่อหนังสือ" --author "ชื่อคน"

# YouTube สัมภาษณ์ (คลิปต้องมี CC/subtitle)
python ingest_youtube.py "https://youtu.be/xxxx" --author "ชื่อคน" --lang th

# ข่าว (เฉพาะค่ายใหญ่)
python ingest_news.py "https://www.thairath.co.th/..." --author "ชื่อคน" --publisher "ไทยรัฐ"

# เพิ่มแบบ manual (พิมพ์/วางข้อความเอง — ใช้เมื่อไม่มี URL หรือเว็บบล็อกการดึงอัตโนมัติ)
python ingest_text.py "note.txt" --title "หัวข้อ" --author "ชื่อคน" --type bio --published 2026-01-15
```

ทุกสคริปต์รับ `--published YYYY-MM-DD` เพื่อระบุวันที่เอง — ถ้าไม่ใส่:
- `ingest_youtube.py` จะพยายามดึงวันที่ลงคลิปอัตโนมัติจากหน้า YouTube
- `ingest_news.py` จะอ่านจาก metadata ของหน้าเว็บ
- `ingest_book.py` จะอ่านจาก metadata ของไฟล์ PDF (ถ้ามี)

หน้าเว็บจะ**เรียงคำตอบ/ที่มาใหม่สุดไว้บนเสมอ** และแนบวันที่ในทุกการอ้างอิง (ถ้าไม่มีวันที่จริงจะบอกว่า "เพิ่มเข้าระบบ" วันไหนแทน เพื่อไม่ให้เข้าใจผิดว่าเป็นวันที่เผยแพร่จริง)

### 4) Web app
```bash
cd web
npm install
cp ../.env.example .env.local   # ใส่ค่าเดียวกัน
npm run dev        # เปิด http://localhost:3000
```

### 5) Auto-search ข่าวใหม่รายวัน (ไม่บังคับ)
`ingest/discover.py` ให้ Claude Code CLI ค้นเว็บหาข่าว/บทสัมภาษณ์ใหม่ของแต่ละคนในคลังความรู้
(ใช้ WebSearch ผ่าน subscription เดิม ไม่เสีย API token แยก) — **ไม่ ingest อัตโนมัติ** แค่เก็บผลไว้
ให้กด approve เองที่หน้า `/updates` ในเว็บ URL ที่เคยเจอแล้ว (ไม่ว่า approve/reject/ingest ไปแล้ว)
จะไม่ถูกเสนอซ้ำอีกเลย และจะเขียนสรุปความเคลื่อนไหวรายวันเก็บไว้ดูย้อนหลังได้ที่แท็บ "สรุปรายวัน" ด้วย

รันเองครั้งเดียว:
```bash
cd ingest
python discover.py                              # ทำทุกคนในคลังความรู้
python discover.py --author "ชื่อคน"              # ทำเฉพาะคนเดียว
```

ตั้งให้รันอัตโนมัติทุกวันด้วย Windows Task Scheduler (ทำให้ไว้แล้วในเครื่องนี้ ชื่อ task
`SecondBrainDiscover` รันทุกวัน 08:00 — ถ้าย้ายเครื่อง/ตั้งใหม่ ใช้คำสั่งนี้):
```powershell
$py = "<path>\ingest\.venv\Scripts\python.exe"
$wd = "<path>\ingest"
$action = New-ScheduledTaskAction -Execute $py -Argument "discover.py" -WorkingDirectory $wd
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
Register-ScheduledTask -TaskName "SecondBrainDiscover" -Action $action -Trigger $trigger -Description "Second Brain daily discover"
```
**ข้อควรรู้:** ต้องมี Docker (Supabase local) และเครื่องเปิดอยู่ตอน 08:00 งานถึงจะรันสำเร็จ
ถ้าปิดเครื่องไว้ งานจะรันทันทีที่เปิดเครื่องครั้งถัดไปแทน (ตั้ง `StartWhenAvailable` ไว้ให้แล้ว)

---

## คุณภาพการค้นหา (retrieval)

`match_chunks` ใน `sql/schema.sql` ไม่ได้เรียงตาม similarity ล้วนๆ แต่บวก **recency boost**
เข้าไปด้วย (สูงสุด +0.05 สำหรับเนื้อหาวันนี้ ลดเชิงเส้นจนหมดใน 1 ปี) กันเนื้อหาเก่าที่เนื้อหา
กว้างๆ บังเนื้อหาใหม่ที่เฉพาะเจาะจงกว่าตอน similarity ก้ำกึ่งกัน

`web/app/api/query/route.ts` ดึงมาเผื่อ 24 รายการแล้วจำกัดไม่เกิน **2 chunk ต่อแหล่งข้อมูล**
ก่อนตัดเหลือ 8 — กันบทความเดียวที่ยาว/เนื้อหากว้างยึด context ทั้งหมดจนบทความอื่นหลุดไป

`ingest_news.py` เช็คว่าเนื้อหาที่ดึงมาเป็นภาษาไทยไหม ถ้าไม่ใช่ (เช่น ข่าวต่างประเทศ) จะให้
Claude สรุปเป็นไทย 1-2 ประโยคแปะไว้หน้าเนื้อหาก่อน embed — ไม่งั้น chunk ภาษาอังกฤษล้วนจะไม่ค่อย
ติดอันดับตอนมีคนถามเป็นภาษาไทย (cross-lingual gap ของ embedding model)

---

## เพิ่มเติม

**YouTube ไม่มี subtitle?** ใช้ Whisper ถอดเสียงก่อน:
```bash
pip install openai-whisper yt-dlp
yt-dlp -x --audio-format mp3 -o clip.mp3 "URL"
whisper clip.mp3 --language th --output_format txt
```
แล้ว ingest ไฟล์ .txt ผ่าน logic เดียวกับหนังสือ (ปรับเล็กน้อย)

**กรองเฉพาะแหล่งเชื่อถือ:** ติ๊ก checkbox บนหน้าเว็บ → ส่ง `min_credibility='high'`
ข่าวจะได้ credibility=high เฉพาะโดเมนใน whitelist (`ingest_news.py` → `TRUSTED`)

**ปรับ persona ให้เหมือนขึ้น:** แก้ `web/lib/prompts.ts` เพิ่มตัวอย่างสำนวน/คำติดปากของบุคคลนั้นใน system prompt

---

## ข้อควรระวัง
- ใช้ **service_role key เฉพาะฝั่ง server** (API route / script) เท่านั้น อย่า expose ฝั่ง browser
- เนื้อหาหนังสือมีลิขสิทธิ์ — ใช้เป็น internal tool ส่วนตัวได้ แต่อย่าเผยแพร่เนื้อหาต้นฉบับซ้ำ
- โหมด persona เป็น "การจำลอง" ไม่ใช่คำพูดจริงของบุคคล ควรกำกับให้ชัดเสมอ

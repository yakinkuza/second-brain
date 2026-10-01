-- ============================================================
-- Second Brain — Supabase schema (pgvector)
-- Run this in Supabase SQL Editor
-- ============================================================

create extension if not exists vector;

-- ---------- sources: 1 แถว = 1 เอกสารต้นทาง ----------
create table if not exists sources (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,          -- 'book' | 'youtube' | 'news' | 'bio'
  title        text not null,
  url          text,                   -- ลิงก์ต้นทาง (news / youtube)
  author       text,                   -- เจ้าของ second brain
  publisher    text,                   -- ค่ายข่าว เช่น 'ไทยรัฐ'
  published_at date,
  credibility  text default 'high',    -- 'high' | 'medium'
  created_at   timestamptz default now()
);

-- ---------- chunks: ชิ้นเนื้อหา + embedding ----------
create table if not exists chunks (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid references sources(id) on delete cascade,
  content          text not null,
  chunk_index      int,
  page_or_timestamp text,              -- หน้า (book) / timestamp (youtube)
  embedding        vector(1024),       -- voyage-3 = 1024 มิติ
  created_at       timestamptz default now()
);

create index if not exists chunks_embedding_idx
  on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists chunks_source_idx on chunks(source_id);

-- ---------- pending_sources: URL ที่ auto-search เจอ รอ approve ----------
-- url เป็น unique เพื่อกันเสนอซ้ำ (ทั้ง pending / approved / rejected / ingested ก็ยังจำไว้ตลอด ไม่มีวันถูกเสนออีก)
create table if not exists pending_sources (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,               -- 'news' | 'youtube'
  url           text not null unique,
  title         text,
  author        text not null,
  found_date    date,                        -- วันที่ของข่าว/คลิป (ถ้ารู้)
  reason        text,                        -- เหตุผลที่ auto-search เลือกมา
  status        text default 'pending',      -- 'pending' | 'approved' | 'rejected' | 'ingested'
  discovered_at timestamptz default now(),
  reviewed_at   timestamptz
);

create index if not exists pending_sources_status_idx on pending_sources(status);

-- ---------- daily_digests: สรุปความเคลื่อนไหวรายวันของแต่ละคน ----------
create table if not exists daily_digests (
  id          uuid primary key default gen_random_uuid(),
  author      text not null,
  digest_date date not null,
  summary     text not null,
  created_at  timestamptz default now(),
  unique (author, digest_date)
);

-- ============================================================
-- match_chunks: similarity search + กรอง credibility / type
-- ============================================================
create or replace function match_chunks (
  query_embedding   vector(1024),
  match_count       int   default 8,
  min_credibility   text  default 'medium',   -- 'high' = เฉพาะค่ายใหญ่
  filter_types      text[] default null,       -- e.g. array['news','book']
  filter_author     text  default null         -- กรองเฉพาะบุคคลที่เลือก
)
returns table (
  id                uuid,
  content           text,
  page_or_timestamp text,
  similarity        float,
  source_id         uuid,
  source_type       text,
  title             text,
  url               text,
  author            text,
  publisher         text,
  published_at      date,
  credibility       text,
  source_created_at timestamptz
)
language sql stable
as $$
  select
    c.id,
    c.content,
    c.page_or_timestamp,
    1 - (c.embedding <=> query_embedding) as similarity,
    s.id  as source_id,
    s.type as source_type,
    s.title,
    s.url,
    s.author,
    s.publisher,
    s.published_at,
    s.credibility,
    s.created_at as source_created_at
  from chunks c
  join sources s on s.id = c.source_id
  where
    (filter_types is null or s.type = any(filter_types))
    and (filter_author is null or s.author = filter_author)
    and (
      min_credibility = 'medium'
      or (min_credibility = 'high' and s.credibility = 'high')
    )
  order by
    -- similarity บวก recency boost เล็กน้อย (สูงสุด +0.05 สำหรับเนื้อหาวันนี้ ลดเชิงเส้นจนหมดที่ 1 ปี)
    -- กันเนื้อหาเก่าที่เนื้อหากว้าง/ทั่วไปบัง เนื้อหาใหม่ที่เฉพาะเจาะจงกว่าแต่ similarity ก้ำกึ่งกัน
    (1 - (c.embedding <=> query_embedding))
    + case
        when s.published_at is not null and s.published_at <= current_date
        then greatest(0.0, 0.05 * (1 - (current_date - s.published_at)::float / 365.0))
        else 0.0
      end
    desc
  limit match_count;
$$;

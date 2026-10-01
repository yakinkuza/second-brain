"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type Pending = {
  id: string; type: string; url: string; title: string; author: string;
  found_date: string | null; reason: string | null; discovered_at: string;
};
type Digest = { id: string; author: string; digest_date: string; summary: string };
type Source = {
  id: string; type: string; title: string; url: string | null; author: string;
  publisher: string | null; published_at: string | null; credibility: string; created_at: string;
};

function UpdatesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const author = params.get("author") ?? "";

  const [tab, setTab] = useState<"pending" | "timeline" | "library">("pending");
  const [pending, setPending] = useState<Pending[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    const qs = author ? `?author=${encodeURIComponent(author)}` : "";
    Promise.all([
      fetch(`/api/pending${qs}`).then((r) => r.json()),
      fetch(`/api/digests${qs}`).then((r) => r.json()),
      fetch(`/api/sources${qs}`).then((r) => r.json()),
    ])
      .then(([p, d, s]) => {
        setPending(p.pending ?? []);
        setDigests(d.digests ?? []);
        setSources(s.sources ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [author]);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      const res = await fetch(`/api/pending/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      setPending((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="wrap">
      <div className="brand">
        <span style={{ fontSize: 22 }}>🧠</span>
        <span className="brand-title">อัปเดตความเคลื่อนไหว</span>
      </div>
      <p className="subtitle">{author || "ทุกคน"} — ข่าว/บทสัมภาษณ์ใหม่ที่ระบบหาเจอ</p>

      <div className="tabs">
        <button onClick={() => setTab("pending")} className={`tab${tab === "pending" ? " active" : ""}`}>
          🔍 รอตรวจสอบ {pending.length > 0 ? `(${pending.length})` : ""}
        </button>
        <button onClick={() => setTab("timeline")} className={`tab${tab === "timeline" ? " active" : ""}`}>
          📅 สรุปรายวัน
        </button>
        <button onClick={() => setTab("library")} className={`tab${tab === "library" ? " active" : ""}`}>
          📚 คลังความรู้ {sources.length > 0 ? `(${sources.length})` : ""}
        </button>
        <button
          className="switch-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => router.push(author ? `/?author=${encodeURIComponent(author)}` : "/")}
        >
          กลับไปถาม
        </button>
      </div>

      {loading && <p className="subtitle">กำลังโหลด...</p>}

      {!loading && tab === "pending" && (
        pending.length === 0 ? (
          <p className="subtitle">ไม่มีรายการรอตรวจสอบ — รอ discover.py รันรอบถัดไป หรือรันเองด้วยมือได้</p>
        ) : (
          <div>
            {pending.map((p) => (
              <div key={p.id} className="answer-card" style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.title || p.url}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
                  {p.type} · {p.found_date ?? "ไม่ทราบวันที่"} ·{" "}
                  <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a>
                </div>
                {p.reason && <div style={{ fontSize: 13, marginBottom: 10, color: "var(--text-muted)" }}>{p.reason}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="ask-btn" disabled={busy === p.id} onClick={() => act(p.id, "approve")}>
                    {busy === p.id ? "กำลังเพิ่ม..." : "✅ Approve"}
                  </button>
                  <button className="switch-btn" disabled={busy === p.id} onClick={() => act(p.id, "reject")}>
                    ❌ ไม่เอา
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {!loading && tab === "timeline" && (
        digests.length === 0 ? (
          <p className="subtitle">ยังไม่มีสรุปรายวัน</p>
        ) : (
          <div>
            {digests.map((d) => (
              <div key={d.id} className="answer-card" style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{d.digest_date}{author ? "" : ` — ${d.author}`}</div>
                <div>{d.summary}</div>
              </div>
            ))}
          </div>
        )
      )}

      {!loading && tab === "library" && (
        sources.length === 0 ? (
          <p className="subtitle">ยังไม่มีข้อมูลในคลังความรู้ — ลอง ingest หรือ approve รายการที่หาเจอก่อน</p>
        ) : (
          <div>
            {sources.map((s) => (
              <div key={s.id} className="citation-item" style={{ padding: "12px 4px" }}>
                <span className="citation-badge">
                  {s.type === "youtube" ? "▶" : s.type === "book" ? "📖" : "📰"}
                </span>
                <span>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                  ) : (
                    s.title
                  )}
                  {" "}
                  <span style={{ opacity: 0.7 }}>
                    ({s.type}{s.publisher ? `, ${s.publisher}` : ""}, {s.published_at ?? `เพิ่มเข้าระบบ ${s.created_at.slice(0, 10)}`}
                    {s.credibility === "high" ? ", เชื่อถือสูง" : ""})
                  </span>
                  {!author && <span style={{ opacity: 0.7 }}> — {s.author}</span>}
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </main>
  );
}

export default function UpdatesPage() {
  return (
    <Suspense fallback={null}>
      <UpdatesInner />
    </Suspense>
  );
}

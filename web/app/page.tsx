"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

type Mode = "grounded" | "persona";
type Citation = {
  n: number; type: string; title: string;
  publisher?: string; url?: string; loc?: string; similarity: number;
  date?: string | null; hasPublished?: boolean;
};

const AVATAR_COLORS = [
  "#f97362", "#f7a24e", "#f6c445", "#7bc86c",
  "#4fb0c6", "#5b8def", "#8b7bff", "#e267c6",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function avatarColor(name: string): string {
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  // ตัด 2 ตัวอักษรแรก ไม่ใช่ตัวเดียว เพราะสระนำของไทย (โ, ใ, ไ, เ, แ)
  // ต้องอยู่คู่กับพยัญชนะถัดไปถึงจะดูมีความหมาย เดี่ยวๆ จะเหลือแค่เส้นตรง
  const clean = name.replace(/\(.*?\)/g, "").trim();
  return clean.slice(0, 2) || "?";
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <div className={`avatar${size === "sm" ? " sm" : ""}`} style={{ background: avatarColor(name) }}>
      {initials(name)}
    </div>
  );
}

function HomeInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [persons, setPersons] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("grounded");
  const [onlyTrusted, setOnlyTrusted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [cites, setCites] = useState<Citation[]>([]);

  useEffect(() => {
    fetch("/api/persons")
      .then((r) => r.json())
      .then((d) => {
        const list: string[] = d.persons ?? [];
        setPersons(list);
        const fromUrl = params.get("author");
        if (fromUrl && list.includes(fromUrl)) setSelected(fromUrl);
      })
      .catch(() => setPersons([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetch(`/api/pending?author=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d) => setPendingCount((d.pending ?? []).length))
      .catch(() => setPendingCount(0));
  }, [selected]);

  async function ask() {
    if (!q.trim() || !selected) return;
    setLoading(true); setAnswer(""); setCites([]);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, mode, onlyTrusted, author: selected }),
      });
      const data = await res.json();
      if (data.error) setAnswer("เกิดข้อผิดพลาด: " + data.error);
      else { setAnswer(data.answer); setCites(data.citations ?? []); }
    } finally { setLoading(false); }
  }

  function reset() {
    setSelected(null);
    setQ(""); setAnswer(""); setCites([]);
  }

  if (!selected) {
    return (
      <main className="wrap">
        <div className="brand">
          <span style={{ fontSize: 22 }}>🧠</span>
          <span className="brand-title">Second Brain</span>
        </div>
        <p className="subtitle">เลือกคนที่อยากถามความคิดด้วย</p>

        {persons.length === 0 ? (
          <p className="subtitle">ยังไม่มีข้อมูลในคลังความรู้ — ลอง ingest เนื้อหาก่อน</p>
        ) : (
          <div className="picker-grid">
            {persons.map((p) => (
              <div key={p} className="persona-card" onClick={() => setSelected(p)}>
                <Avatar name={p} />
                <span className="persona-name">{p}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="chat-header">
        <Avatar name={selected} size="sm" />
        <div>
          <div className="chat-header-name">{selected}</div>
          <div className="chat-header-sub">ถามความคิดจากคลังความรู้</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button className="switch-btn" onClick={() => router.push(`/updates?author=${encodeURIComponent(selected)}`)}>
            🔔 อัปเดต{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
          <button className="switch-btn" onClick={reset}>เปลี่ยนคน</button>
        </div>
      </div>

      <div className="tabs">
        <button onClick={() => setMode("grounded")} className={`tab${mode === "grounded" ? " active" : ""}`}>
          📚 อ้างอิงตรง
        </button>
        <button onClick={() => setMode("persona")} className={`tab${mode === "persona" ? " active" : ""}`}>
          🎭 จำลองสไตล์เขา
        </button>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={onlyTrusted} onChange={(e) => setOnlyTrusted(e.target.checked)} />
        เฉพาะแหล่งเชื่อถือสูง (ค่ายข่าวใหญ่ / หนังสือ / สัมภาษณ์)
      </label>

      <textarea
        className="q-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`พิมพ์คำถาม เช่น ${selected} คิดยังไงกับเรื่อง...?`}
        rows={3}
      />

      <button className="ask-btn" onClick={ask} disabled={loading}>
        {loading ? "กำลังคิด..." : "ถาม"}
      </button>

      {answer && (
        <div className="answer-card">
          <ReactMarkdown>{answer}</ReactMarkdown>
        </div>
      )}

      {cites.length > 0 && (
        <div className="citations">
          <p className="citations-title">ที่มา</p>
          {cites.map((c) => (
            <div key={c.n} className="citation-item">
              <span className="citation-badge">{c.n}</span>
              <span>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">{c.publisher || c.title}</a>
                ) : (
                  c.publisher || c.title
                )}
                {c.loc ? ` — ${c.loc}` : ""}
                {c.date ? ` · ${c.hasPublished ? "" : "เพิ่มเข้าระบบ "}${c.date}` : ""}{" "}
                <span style={{ opacity: 0.7 }}>({c.type}, sim {c.similarity})</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

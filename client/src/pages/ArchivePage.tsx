import { useEffect, useMemo, useState } from "react";
import { RecentFavoritesPanels } from "../components/RecentFavoritesPanels";
import { api } from "../api";
import { useAuth } from "../auth";
import { formatWonKorean } from "../util/format";

type Cat = "all" | "material" | "product" | "set" | "comparison";

type Item = {
  kind: "material" | "product" | "set" | "comparison";
  id: string;
  name: string;
  grandTotalWon: number;
  summary: string;
  updatedAt: string;
  stale: boolean;
};

const labels: Record<Cat, string> = {
  all: "전체",
  material: "자재",
  product: "단품",
  set: "세트",
  comparison: "비교하기",
};

export function ArchivePage() {
  const { token } = useAuth();
  const [cat, setCat] = useState<Cat>("all");
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!token) return;
    const c = cat === "all" ? "all" : cat;
    api<{ items: Item[] }>(`/archive/items?category=${c}`, { token }).then((r) => setItems(r.items));
  }, [token, cat]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return items.filter((x) => x.name.toLowerCase().includes(s));
  }, [items, q]);

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)", padding: "28px 24px" }}>
      <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text1)", margin: "0 0 24px" }}>보관함</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {/* Filter chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {(Object.keys(labels) as Cat[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCat(k)}
                style={{
                  borderRadius: "100px",
                  padding: "7px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  border: cat === k ? "none" : "1px solid var(--border2)",
                  background: cat === k ? "var(--blue)" : "var(--surface)",
                  color: cat === k ? "#fff" : "var(--text2)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  fontFamily: "inherit",
                }}
              >
                {labels[k]}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: "relative", maxWidth: "360px" }}>
            <input
              className="tds-input"
              style={{ paddingLeft: "38px" }}
              placeholder="검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <svg
              width="16" height="16" viewBox="0 0 16 16" fill="none"
              style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            >
              <circle cx="6.5" cy="6.5" r="4" stroke="var(--text3)" strokeWidth="1.5" />
              <path d="M10 10l3 3" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>

          {/* Grid / aside layout */}
          <div style={{ display: "flex", gap: "32px", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                {filtered.map((it) => (
                  <div key={`${it.kind}-${it.id}`} className="tds-card" style={{ padding: "18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "var(--text3)",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: "100px",
                          padding: "2px 8px",
                        }}
                      >
                        {it.kind === "material" ? "자재" : it.kind === "product" ? "단품" : it.kind === "set" ? "세트" : "비교"}
                      </span>
                      {it.stale && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            color: "var(--orange)",
                            background: "rgba(245,158,11,0.1)",
                            borderRadius: "100px",
                            padding: "2px 8px",
                          }}
                        >
                          단가 업데이트
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text1)", marginBottom: "4px" }}>
                      {it.name}
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--blue)", marginBottom: "8px" }}>
                      {it.kind === "comparison" ? "—" : formatWonKorean(it.grandTotalWon)}
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text3)", margin: "0 0 6px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {it.summary}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--text3)", margin: 0 }}>
                      저장 {new Date(it.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                ))}
              </div>
              {filtered.length === 0 && (
                <p style={{ fontSize: "13px", color: "var(--text3)", margin: "24px 0" }}>저장된 항목이 없습니다.</p>
              )}
            </div>

            <aside style={{ width: "min(100%, 360px)", flexShrink: 0, borderLeft: "1px solid var(--border)", paddingLeft: "28px" }}>
              <RecentFavoritesPanels />
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

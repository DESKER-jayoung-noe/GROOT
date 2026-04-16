import { useEffect, useMemo, useState } from "react";
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
    <div className="min-h-full bg-[#f8f9fa] p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-[#111]">보관함</h1>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(labels) as Cat[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCat(k)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                cat === k ? "bg-[#1e6fff] text-white" : "bg-white text-slate-600 border border-[#e0e0e0]"
              }`}
            >
              {labels[k]}
            </button>
          ))}
        </div>
        <div className="relative max-w-md">
          <input
            className="w-full rounded-xl border border-[#e0e0e0] bg-white pl-3 pr-10 py-2.5 text-sm"
            placeholder="검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((it) => (
            <div
              key={`${it.kind}-${it.id}`}
              className="rounded-2xl border border-[#e8e8e8] bg-white p-4 shadow-sm"
            >
              <div className="flex justify-between gap-2 items-start">
                <span className="text-xs font-semibold text-slate-500">
                  {it.kind === "material" ? "자재" : it.kind === "product" ? "단품" : it.kind === "set" ? "세트" : "비교"}
                </span>
                {it.stale && (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">단가 업데이트</span>
                )}
              </div>
              <div className="font-bold text-[#111] mt-1">{it.name}</div>
              <div className="text-[#1e6fff] font-bold text-lg tabular-nums mt-1">
                {it.kind === "comparison" ? "—" : formatWonKorean(it.grandTotalWon)}
              </div>
              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{it.summary}</p>
              <p className="text-[11px] text-slate-400 mt-2">
                저장 {new Date(it.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          ))}
        </div>
        {filtered.length === 0 && <p className="text-sm text-slate-400">저장된 항목이 없습니다.</p>}
      </div>
    </div>
  );
}

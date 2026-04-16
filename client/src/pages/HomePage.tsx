import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { formatWonKorean } from "../util/format";

type Row = {
  kind: "material" | "product" | "set" | "comparison";
  id: string;
  name: string;
  grandTotalWon: number;
  summary: string;
  stale?: boolean;
  visitedAt?: string;
  workSource?: "add" | "compare";
};

export function HomePage() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [recentWork, setRecentWork] = useState<Row[]>([]);
  const [favorites, setFavorites] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await api<{ recentWork: Row[]; favorites: Row[] }>("/me/home", { token });
    setRecentWork(r.recentWork);
    setFavorites(r.favorites);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleStar(kind: Row["kind"], id: string) {
    if (!token) return;
    try {
      await api("/me/favorites/toggle", {
        method: "POST",
        body: JSON.stringify({ targetType: kind, targetId: id }),
        token,
      });
      void load();
    } catch (e) {
      console.error(e instanceof ApiError ? e.message : e);
    }
  }

  function badge(k: Row["kind"]) {
    return k === "material" ? "자재" : k === "product" ? "단품" : k === "set" ? "세트" : "비교";
  }

  function tabBadge(r: Row) {
    const tab = r.workSource === "compare" ? "비교하기" : "추가하기";
    return (
      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{tab}</span>
    );
  }

  return (
    <div className="min-h-full bg-[#f8f9fa] p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <h1 className="text-2xl font-bold text-[#111]">홈</h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="rounded-2xl border border-[#e0e0e0] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#111] mb-4">최근 작업</h2>
            <div className="space-y-2 max-h-[420px] overflow-auto">
              {recentWork.map((r) => (
                <div
                  key={`${r.kind}-${r.id}`}
                  className="flex gap-3 items-start rounded-xl border border-[#f0f0f0] p-3 hover:bg-slate-50"
                >
                  <button
                    type="button"
                    className="text-lg text-slate-300 hover:text-amber-500 leading-none shrink-0"
                    title="즐겨찾기"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleStar(r.kind, r.id);
                    }}
                  >
                    ☆
                  </button>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => {
                      if (r.kind === "comparison") nav("/compare");
                      else nav("/add");
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {tabBadge(r)}
                      <span className="text-[10px] font-bold text-[#1e6fff] bg-[#1e6fff]/10 px-1.5 py-0.5 rounded">{badge(r.kind)}</span>
                      {r.stale && (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">업데이트</span>
                      )}
                    </div>
                    <div className="font-semibold text-[#111] text-sm mt-1 line-clamp-1">{r.name}</div>
                    <div className="text-[#1e6fff] font-bold text-sm tabular-nums">
                      {r.kind === "comparison" ? "—" : formatWonKorean(r.grandTotalWon)}
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">{r.summary}</p>
                  </div>
                </div>
              ))}
              {recentWork.length === 0 && <p className="text-sm text-slate-400">최근 작업 내역이 없습니다.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-[#e0e0e0] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#111] mb-4">즐겨찾기</h2>
            <div className="space-y-2 max-h-[420px] overflow-auto">
              {favorites.map((r) => (
                <div key={`${r.kind}-${r.id}`} className="flex gap-2 items-start rounded-xl border border-[#f0f0f0] p-3">
                  <button
                    type="button"
                    className="text-lg leading-none text-amber-500 hover:text-amber-600"
                    title="즐겨찾기 해제"
                    onClick={() => void toggleStar(r.kind, r.id)}
                  >
                    ★
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-slate-500">{badge(r.kind)}</span>
                    <div className="font-semibold text-[#111] text-sm line-clamp-1">{r.name}</div>
                    <div className="text-[#1e6fff] font-bold text-sm tabular-nums">
                      {r.kind === "comparison" ? "—" : formatWonKorean(r.grandTotalWon)}
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">{r.summary}</p>
                  </div>
                </div>
              ))}
              {favorites.length === 0 && <p className="text-sm text-slate-400">즐겨찾기가 없습니다. 카드에서 ☆를 눌러 추가하세요.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

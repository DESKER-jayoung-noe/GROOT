import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { formatWonKorean } from "../util/format";
import { postRecent } from "../visit";

type Slot = { kind: "material" | "product" | "set"; id: string } | null;

type Column = {
  kind: "material" | "product" | "set";
  id: string;
  name: string;
  grandTotalWon: number;
  rawMaterialWon: number;
  processingWon: number;
  rawDetail: { label: string; value: string }[];
  procDetail: { label: string; value: string }[];
};

type Highlights = { raw: boolean; proc: boolean; total: boolean };

type PickerRow = { kind: "material" | "product" | "set"; id: string; name: string; grandTotalWon: number; summary: string };

export function ComparePage() {
  const { token } = useAuth();
  const [name, setName] = useState("새 비교");
  const [slots, setSlots] = useState<[Slot, Slot, Slot, Slot]>([null, null, null, null]);
  const [activeSlot, setActiveSlot] = useState(0);
  const [columns, setColumns] = useState<(Column | null)[]>([]);
  const [highlights, setHighlights] = useState<Highlights>({ raw: false, proc: false, total: false });
  const [picker, setPicker] = useState<PickerRow[]>([]);
  const [pickTab, setPickTab] = useState<"material" | "product" | "set">("material");
  const [search, setSearch] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editingComparisonId, setEditingComparisonId] = useState<string | null>(null);

  const nameRef = useRef(name);
  nameRef.current = name;

  /** 슬롯만 바뀔 때 미리보기 (비교 이름만 수정할 때는 API 호출 안 함) */
  const slotsKey = useMemo(() => JSON.stringify(slots), [slots]);

  const comparisonBody = useMemo(() => ({ name, slots }), [name, slots]);

  const refreshPicker = useCallback(async () => {
    if (!token) return;
    const [m, p, s] = await Promise.all([
      api<PickerRow[]>("/materials/list?status=SAVED", { token }).then((rows) =>
        rows.map((r) => ({ kind: "material" as const, id: r.id, name: r.name, grandTotalWon: r.grandTotalWon, summary: r.summary }))
      ),
      api<PickerRow[]>("/products/list?status=SAVED", { token }).then((rows) =>
        rows.map((r) => ({ kind: "product" as const, id: r.id, name: r.name, grandTotalWon: r.grandTotalWon, summary: r.summary }))
      ),
      api<PickerRow[]>("/sets/list?status=SAVED", { token }).then((rows) =>
        rows.map((r) => ({ kind: "set" as const, id: r.id, name: r.name, grandTotalWon: r.grandTotalWon, summary: r.summary }))
      ),
    ]);
    setPicker([...m, ...p, ...s]);
  }, [token]);

  useEffect(() => {
    void refreshPicker();
  }, [refreshPicker]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const payload = { name: nameRef.current || "비교", slots };
      api<{ computed: { columns: (Column | null)[] }; highlights: Highlights }>("/comparisons/preview", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      })
        .then((r) => {
          if (!cancelled) {
            setColumns(r.computed.columns);
            setHighlights(r.highlights);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setColumns([]);
            setHighlights({ raw: false, proc: false, total: false });
          }
        });
    }, 380);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [token, slotsKey]);

  const filteredPicker = useMemo(() => {
    const q = search.toLowerCase();
    return picker.filter((x) => x.kind === pickTab && x.name.toLowerCase().includes(q));
  }, [picker, pickTab, search]);

  function assignSlot(row: PickerRow) {
    setSlots((prev) => {
      const next = [...prev] as [Slot, Slot, Slot, Slot];
      next[activeSlot] = { kind: row.kind, id: row.id };
      return next;
    });
  }

  async function save(draft: boolean) {
    setMsg(null);
    if (!token) return;
    try {
      if (editingComparisonId) {
        await api(`/comparisons/${editingComparisonId}`, {
          method: "PUT",
          body: JSON.stringify({ ...comparisonBody, finalize: !draft }),
          token,
        });
        setMsg(draft ? "임시저장되었습니다." : "보관함에 저장되었습니다.");
        void postRecent(token, "comparison", editingComparisonId);
      } else {
        const path = draft ? "/comparisons/draft" : "/comparisons/save";
        const res = await api<{ id: string }>(path, {
          method: "POST",
          body: JSON.stringify(comparisonBody),
          token,
        });
        if (res.id) setEditingComparisonId(res.id);
        setMsg(draft ? "임시저장되었습니다." : "보관함에 저장되었습니다.");
        if (res.id) void postRecent(token, "comparison", res.id);
      }
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "저장에 실패했습니다.");
    }
  }

  const hl = (key: "raw" | "proc" | "total", base: string) =>
    `${base} ${highlights[key] ? "text-[#1e6fff] font-extrabold" : "text-[#111] font-bold"}`;

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0 bg-[#f8f9fa]">
      <div className="flex-1 min-w-0 overflow-auto px-5 py-6 lg:px-8">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-2xl font-bold text-[#111]">비교하기</h1>
            <div className="flex flex-wrap items-center gap-3 flex-1 justify-end">
              <input
                className="max-w-md flex-1 min-w-[200px] rounded-xl border border-[#e0e0e0] px-4 py-2 text-sm font-semibold"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="비교 이름"
              />
              <button
                type="button"
                className="rounded-xl border-2 border-[#1e6fff] bg-white px-4 py-2 text-sm font-semibold text-[#1e6fff]"
                onClick={() => void save(true)}
              >
                임시저장
              </button>
              <button
                type="button"
                className="rounded-xl bg-[#1e6fff] px-4 py-2 text-sm font-semibold text-white"
                onClick={() => void save(false)}
              >
                저장하기
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500">열을 선택한 뒤 오른쪽 목록에서 항목을 추가하세요. (최대 4열)</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => {
              const col = columns[i] ?? null;
              return (
                <div key={i} className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveSlot(i)}
                    className={`text-left text-xs font-semibold px-2 py-1 rounded-lg w-fit ${
                      activeSlot === i ? "bg-[#1e6fff] text-white" : "bg-white text-slate-600 border border-[#e0e0e0]"
                    }`}
                  >
                    열 {i + 1}
                  </button>
                  <div className="rounded-2xl border border-[#e8e8e8] bg-white p-4 min-h-[320px] flex flex-col">
                    {!col ? (
                      <div className="flex-1 flex items-center justify-center text-sm text-slate-400 border border-dashed border-[#e0e0e0] rounded-xl">
                        비어 있음
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between gap-2 items-start mb-3">
                          <span className="font-bold text-[#111] text-sm leading-tight line-clamp-2">{col.name}</span>
                          <span className={hl("total", "text-sm tabular-nums shrink-0")}>예상: {formatWonKorean(col.grandTotalWon)}</span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-[#111]">원자재</span>
                          <span className={hl("raw", "text-xs tabular-nums")}>{formatWonKorean(col.rawMaterialWon)}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 space-y-0.5 mb-3">
                          {col.rawDetail.map((d, j) => (
                            <div key={j} className="flex justify-between gap-2">
                              <span className="text-slate-500">{d.label}</span>
                              <span className="text-right line-clamp-2">{d.value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-[#111]">가공비</span>
                          <span className={hl("proc", "text-xs tabular-nums")}>{formatWonKorean(col.processingWon)}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 space-y-0.5 flex-1">
                          {col.procDetail.map((d, j) => (
                            <div key={j} className="flex justify-between gap-2">
                              <span className="text-slate-500">{d.label}</span>
                              <span className="text-right line-clamp-2">{d.value}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
      </div>

      <aside className="w-full lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#e0e0e0] bg-white flex flex-col max-h-[60vh] lg:max-h-none">
        <div className="p-4 border-b border-[#f0f0f0]">
          <h2 className="text-base font-bold text-[#111] mb-3">목록</h2>
          <div className="flex rounded-full bg-[#f0f2f5] p-1 gap-1 mb-3">
            {(["material", "product", "set"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPickTab(k)}
                className={`flex-1 py-1.5 rounded-full text-xs font-semibold ${
                  pickTab === k ? "bg-white text-[#1e6fff] shadow-sm" : "text-slate-600"
                }`}
              >
                {k === "material" ? "자재" : k === "product" ? "단품" : "세트"}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              className="w-full rounded-xl border border-[#e0e0e0] bg-[#f8f9fa] pl-3 pr-10 py-2.5 text-sm"
              placeholder="검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-2">
            <span>열 {activeSlot + 1}에 추가</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {filteredPicker.map((row) => (
            <button
              key={`${row.kind}-${row.id}`}
              type="button"
              onClick={() => assignSlot(row)}
              className="w-full text-left rounded-xl border border-[#e0e0e0] p-3 hover:border-[#1e6fff]/50"
            >
              <div className="flex justify-between gap-2">
                <span className="text-sm font-semibold text-[#111] line-clamp-1">{row.name}</span>
                <span className="text-[#1e6fff] font-bold text-sm shrink-0 tabular-nums">{formatWonKorean(row.grandTotalWon)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{row.summary}</p>
            </button>
          ))}
          {filteredPicker.length === 0 && <p className="text-sm text-slate-400 text-center py-8">항목이 없습니다</p>}
        </div>
        <div className="p-4 border-t border-[#f0f0f0] space-y-2">
          <p className="text-xs font-bold text-[#111]">저장된 비교</p>
          <input
            className="w-full rounded-lg border border-[#e0e0e0] px-2 py-1.5 text-xs"
            placeholder="검색"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
          />
          <SavedCompareList
            token={token}
            q={listSearch}
            onPick={async (id) => {
              if (!token) return;
              const row = await api<{ name: string; form: { name: string; slots: Slot[] } }>(`/comparisons/${id}`, { token });
              setEditingComparisonId(id);
              setName(row.name);
              const sl = [...(row.form.slots ?? [])] as Slot[];
              while (sl.length < 4) sl.push(null);
              setSlots(sl.slice(0, 4) as [Slot, Slot, Slot, Slot]);
            }}
          />
        </div>
      </aside>
    </div>
  );
}

function SavedCompareList({
  token,
  q,
  onPick,
}: {
  token: string | null;
  q: string;
  onPick: (id: string) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<{ id: string; name: string; updatedAt: string }[]>([]);
  useEffect(() => {
    if (!token) return;
    api<{ id: string; name: string; updatedAt: string }[]>("/comparisons/list?status=SAVED", { token }).then(setRows);
  }, [token]);
  const filtered = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  return (
    <div className="space-y-2 max-h-40 overflow-auto">
      {filtered.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => void onPick(r.id)}
          className="w-full text-left rounded-lg border border-[#e8e8e8] px-2 py-1.5 text-xs hover:bg-slate-50"
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}

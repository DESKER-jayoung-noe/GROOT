import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { formatWonKorean } from "../util/format";
import { postRecent } from "../visit";

type Slot = { kind: "material" | "product" | "set"; id: string } | null;

/** API 비교 열 (서버 compute 결과) */
type ApiColumn = {
  kind: "material" | "product" | "set";
  id: string;
  name: string;
  grandTotalWon: number;
  rawMaterialWon: number;
  processingWon: number;
  rawDetail: { label: string; value: string }[];
  procDetail: { label: string; value: string }[];
};

type PickerRow = { kind: "material" | "product" | "set"; id: string; name: string; grandTotalWon: number; summary: string };

/** UI용 열 (스펙) — columns 배열에서 파생 */
export type CompareColumn = {
  id: string;
  name: string;
  price: number;
  matCost: number;
  procCost: number;
  size: string;
  edge: string;
  material: string;
  color: string;
  origin: string;
  kind: "material" | "product" | "set";
};

const DND_MIME = "application/x-groot-compare-row";

const BLUE = "var(--blue)";
const BORDER = "var(--border)";
const CARD_RADIUS = "12px";
const CELL_RADIUS = "8px";

function rawValue(col: ApiColumn | null, label: string): string {
  if (!col) return "—";
  return col.rawDetail.find((d) => d.label === label)?.value ?? "—";
}

function toViewColumn(col: ApiColumn): CompareColumn {
  return {
    id: col.id,
    name: col.name,
    price: col.grandTotalWon,
    matCost: col.rawMaterialWon,
    procCost: col.processingWon,
    size: rawValue(col, "사이즈").replace(/T$/i, "").replace(/mm$/i, "") || "—",
    edge: rawValue(col, "엣지") || "—",
    material: rawValue(col, "소재") || "—",
    color: rawValue(col, "색상") || "—",
    origin: rawValue(col, "원장") || "—",
    kind: col.kind,
  };
}

function minMax(nums: number[]): { min: number; max: number; diff: boolean } | null {
  const v = nums.filter((n) => Number.isFinite(n));
  if (v.length < 2) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  return { min, max, diff: Math.round(min) !== Math.round(max) };
}

function MoneyCell({
  value,
  mm,
  larger,
}: {
  value: number;
  mm: { min: number; max: number; diff: boolean } | null;
  larger?: boolean;
}) {
  const text = formatWonKorean(value);
  const fs = larger ? "13px" : "12px";
  if (!mm || !mm.diff) return <span style={{ fontVariantNumeric: "tabular-nums", fontSize: fs }}>{text}</span>;
  const r = Math.round(value);
  if (r === Math.round(mm.min)) {
    return (
      <span
        style={{
          display: "inline-block",
          borderRadius: "6px",
          padding: larger ? "4px 10px" : "3px 8px",
          fontSize: fs,
          fontWeight: 700,
          color: "var(--green)",
          background: "var(--green-bg)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {text}
      </span>
    );
  }
  if (r === Math.round(mm.max)) {
    return (
      <span
        style={{
          display: "inline-block",
          borderRadius: "6px",
          padding: larger ? "4px 10px" : "3px 8px",
          fontSize: fs,
          fontWeight: 600,
          color: "var(--red)",
          background: "var(--red-bg)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {text}
      </span>
    );
  }
  return <span style={{ fontVariantNumeric: "tabular-nums", fontSize: fs }}>{text}</span>;
}

export function ComparePage() {
  const { token } = useAuth();
  const [name, setName] = useState("새 비교");
  const [slots, setSlots] = useState<[Slot, Slot, Slot, Slot]>([null, null, null, null]);
  const [visibleCount, setVisibleCount] = useState(2);
  const [activeSlot, setActiveSlot] = useState(0);
  const [columns, setColumns] = useState<(ApiColumn | null)[]>([]);
  const [picker, setPicker] = useState<PickerRow[]>([]);
  const [pickTab, setPickTab] = useState<"material" | "product" | "set">("material");
  const [search, setSearch] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [editingComparisonId, setEditingComparisonId] = useState<string | null>(null);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const [hoverListId, setHoverListId] = useState<string | null>(null);

  const nameRef = useRef(name);
  nameRef.current = name;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const editingIdRef = useRef(editingComparisonId);
  editingIdRef.current = editingComparisonId;
  const postedRecentRef = useRef<string | null>(null);

  const slotsKey = useMemo(() => JSON.stringify(slots), [slots]);

  const shouldPersist = useMemo(() => {
    if (editingComparisonId) return true;
    if (name.trim() !== "" && name.trim() !== "새 비교") return true;
    return slots.some((s) => s !== null);
  }, [editingComparisonId, name, slots]);

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
    const end = () => setDragOverCol(null);
    window.addEventListener("dragend", end);
    return () => window.removeEventListener("dragend", end);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const payload = { name: nameRef.current || "비교", slots };
      api<{ computed: { columns: (ApiColumn | null)[] } }>("/comparisons/preview", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      })
        .then((r) => {
          if (!cancelled) setColumns(r.computed.columns);
        })
        .catch(() => {
          if (!cancelled) setColumns([]);
        });
    }, 380);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [token, slotsKey]);

  useEffect(() => {
    setActiveSlot((a) => Math.min(a, Math.max(0, visibleCount - 1)));
  }, [visibleCount]);

  useEffect(() => {
    if (!token || !shouldPersist) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const run = async () => {
        const nm = nameRef.current || "비교";
        const sl = slotsRef.current;
        const id = editingIdRef.current;
        const body = JSON.stringify({ name: nm, slots: sl });
        try {
          if (id) {
            await api(`/comparisons/${id}`, { method: "PUT", body, token });
            if (!cancelled) {
              setPersistNote("저장됨");
              window.setTimeout(() => setPersistNote((x) => (x === "저장됨" ? null : x)), 2000);
            }
          } else {
            const res = await api<{ id: string }>("/comparisons/draft", { method: "POST", body, token });
            if (!cancelled && res.id) {
              setEditingComparisonId(res.id);
              if (postedRecentRef.current !== res.id) {
                postedRecentRef.current = res.id;
                void postRecent(token, "comparison", res.id);
              }
              setPersistNote("저장됨");
              window.setTimeout(() => setPersistNote((x) => (x === "저장됨" ? null : x)), 2000);
            }
          }
        } catch (e) {
          if (!cancelled) setPersistNote(e instanceof ApiError ? e.message : "저장 실패");
        }
      };
      void run();
    }, 650);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [token, shouldPersist, name, slotsKey, editingComparisonId]);

  const visibleCols = useMemo(
    () => Array.from({ length: visibleCount }, (_, i) => columns[i] ?? null),
    [columns, visibleCount]
  );

  const views = useMemo(
    () => visibleCols.map((c) => (c ? toViewColumn(c) : null)),
    [visibleCols]
  );

  const filledMaterialCount = useMemo(
    () => visibleCols.filter((c): c is ApiColumn => c !== null && c.kind === "material").length,
    [visibleCols]
  );

  const rawRecommend = useMemo(() => {
    const pairs = visibleCols
      .map((c, i) => (c ? { c, i } : null))
      .filter((x): x is { c: ApiColumn; i: number } => x !== null);
    if (pairs.length < 2) return null;
    const matOnly = pairs.filter((p) => p.c.kind === "material");
    if (matOnly.length < 2) return null;
    const sorted = [...matOnly].sort((a, b) => a.c.rawMaterialWon - b.c.rawMaterialWon);
    const low = sorted[0]!;
    const high = sorted[sorted.length - 1]!;
    const diff = Math.round(high.c.rawMaterialWon) - Math.round(low.c.rawMaterialWon);
    if (diff <= 0) return null;
    return { name: low.c.name, diff };
  }, [visibleCols]);

  const filteredPicker = useMemo(() => {
    const q = search.toLowerCase();
    return picker.filter((x) => x.kind === pickTab && x.name.toLowerCase().includes(q));
  }, [picker, pickTab, search]);

  const mmRaw = useMemo(() => minMax(visibleCols.filter(Boolean).map((c) => c!.rawMaterialWon)), [visibleCols]);
  const mmProc = useMemo(() => minMax(visibleCols.filter(Boolean).map((c) => c!.processingWon)), [visibleCols]);
  const mmTotal = useMemo(() => minMax(visibleCols.filter(Boolean).map((c) => c!.grandTotalWon)), [visibleCols]);

  const totals = useMemo(() => visibleCols.map((c) => (c ? c.grandTotalWon : null)), [visibleCols]);
  const maxTotal = useMemo(() => {
    const nums = totals.filter((n): n is number => n != null);
    return nums.length ? Math.max(...nums) : 0;
  }, [totals]);

  function assignSlot(row: PickerRow, index?: number) {
    let idx = index;
    if (idx == null) {
      const firstEmpty = slots.findIndex((s, i) => i < visibleCount && s === null);
      idx = firstEmpty >= 0 ? firstEmpty : activeSlot;
    }
    setSlots((prev) => {
      const next = [...prev] as [Slot, Slot, Slot, Slot];
      next[idx] = { kind: row.kind, id: row.id };
      return next;
    });
  }

  function clearSlot(i: number) {
    setSlots((prev) => {
      const next = [...prev] as [Slot, Slot, Slot, Slot];
      next[i] = null;
      return next;
    });
  }

  function onDragStartRow(e: React.DragEvent, row: PickerRow) {
    e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: row.kind, id: row.id }));
    e.dataTransfer.effectAllowed = "copy";
  }

  function onDropCol(e: React.DragEvent, colIndex: number) {
    e.preventDefault();
    setDragOverCol(null);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    try {
      const o = JSON.parse(raw) as { kind: PickerRow["kind"]; id: string };
      if (!o?.kind || !o?.id) return;
      const row = picker.find((p) => p.kind === o.kind && p.id === o.id);
      if (row) assignSlot(row, colIndex);
      else {
        setSlots((prev) => {
          const next = [...prev] as [Slot, Slot, Slot, Slot];
          next[colIndex] = { kind: o.kind, id: o.id };
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  }

  function isRowInCompare(row: PickerRow): boolean {
    return slots.slice(0, visibleCount).some((s) => s && s.kind === row.kind && s.id === row.id);
  }

  const rowLabelStyle: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--text3)",
    background: "var(--surface2)",
    borderRight: `0.5px solid ${BORDER}`,
    borderBottom: `0.5px solid ${BORDER}`,
    padding: "11px 16px",
    textAlign: "left",
    width: "130px",
    minWidth: "130px",
  };

  const cellStyle = (even: boolean): React.CSSProperties => ({
    textAlign: "left",
    padding: "11px 16px",
    fontSize: "13px",
    color: "var(--text1)",
    borderBottom: `0.5px solid ${BORDER}`,
    background: even ? "var(--surface)" : "var(--surface2)",
    verticalAlign: "middle",
  });

  return (
    <div
      className="min-h-0 w-full flex-1 overflow-auto"
      style={{
        background: "var(--bg)",
        padding: "20px 24px",
        fontFamily: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          gap: "24px",
          maxWidth: "1600px",
        }}
      >
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px", textAlign: "left" }}>
        {/* 1. 헤더 */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", textAlign: "left" }}>
          <div>
            <h1 style={{ fontSize: "17px", fontWeight: 700, color: "var(--text1)", margin: 0 }}>비교하기</h1>
            <p style={{ fontSize: "12px", color: "var(--text3)", margin: "4px 0 0" }}>자재를 선택하고 항목별로 비교해보세요</p>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="비교 이름 (저장용)"
                style={{
                  height: "32px",
                  maxWidth: "240px",
                  padding: "0 10px",
                  border: `0.5px solid ${BORDER}`,
                  borderRadius: CELL_RADIUS,
                  fontSize: "12px",
                  background: "var(--surface)",
                  color: "var(--text1)",
                  fontFamily: "inherit",
                }}
              />
              {persistNote && <span style={{ fontSize: "11px", color: "var(--text3)" }}>{persistNote}</span>}
            </div>
          </div>
          <button
            type="button"
            disabled={visibleCount >= 4}
            onClick={() => setVisibleCount((n) => Math.min(4, n + 1))}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "8px 14px",
              border: `1px solid var(--border2)`,
              borderRadius: CELL_RADIUS,
              background: "var(--surface)",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text2)",
              cursor: visibleCount >= 4 ? "not-allowed" : "pointer",
              opacity: visibleCount >= 4 ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            <span style={{ fontWeight: 700, marginRight: "2px" }}>+</span>
            열 추가
          </button>
        </div>

        {/* 2. 추천 배너 — 자재 2개 이상 & 원자재비 차이 */}
        {rawRecommend && filledMaterialCount >= 2 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 18px",
              background: "var(--blue-bg)",
              border: "1px solid var(--blue-light)",
              borderRadius: "10px",
            }}
          >
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: BLUE,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 2l1.5 3 3.5.5-2.5 2.5.6 3.5L8 10l-3.1 1.5.6-3.5L3 5.5l3.5-.5L8 2z" fill="white" />
              </svg>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text2)", flex: 1 }}>
              <strong style={{ fontWeight: 700 }}>「{rawRecommend.name}」</strong>이(가) 원자재비 기준{" "}
              <strong>{formatWonKorean(rawRecommend.diff)}</strong>원 더 저렴합니다.
            </p>
          </div>
        )}

        {/* 3. 비교 테이블 */}
        <div
          style={{
            background: "var(--surface)",
            border: `0.5px solid ${BORDER}`,
            borderRadius: CARD_RADIUS,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: "520px" }}>
              <thead>
                <tr style={{ background: "var(--surface2)", borderBottom: `0.5px solid ${BORDER}` }}>
                  <th style={{ width: "130px", minWidth: "130px", padding: "12px 16px", borderBottom: `0.5px solid ${BORDER}` }} />
                  {Array.from({ length: visibleCount }, (__, i) => {
                    const col = visibleCols[i];
                    const v = views[i];
                    const isDrop = dragOverCol === i;
                    return (
                      <th
                        key={i}
                        style={{
                          padding: "14px 16px",
                          textAlign: "left",
                          verticalAlign: "top",
                          background: isDrop ? "var(--blue-bg)" : "var(--surface)",
                          borderBottom: `0.5px solid ${BORDER}`,
                          outline: isDrop ? `2px solid ${BLUE}` : undefined,
                          outlineOffset: "-2px",
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverCol(i);
                        }}
                        onDragLeave={() => setDragOverCol((c) => (c === i ? null : c))}
                        onDrop={(e) => onDropCol(e, i)}
                      >
                        {col && v ? (
                          <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "6px", marginBottom: "3px" }}>
                              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text1)", lineHeight: 1.3, wordBreak: "break-word" }}>{v.name}</span>
                              <button
                                type="button"
                                aria-label="열 제거"
                                onClick={() => clearSlot(i)}
                                style={{
                                  width: "18px",
                                  height: "18px",
                                  borderRadius: "50%",
                                  border: "none",
                                  background: "var(--surface2)",
                                  color: "var(--text3)",
                                  cursor: "pointer",
                                  fontSize: "11px",
                                  lineHeight: 1,
                                  flexShrink: 0,
                                }}
                              >
                                ✕
                              </button>
                            </div>
                            <div style={{ fontSize: "18px", fontWeight: 700, color: BLUE, fontVariantNumeric: "tabular-nums", textAlign: "left" }}>{formatWonKorean(v.price)}</div>
                            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "2px" }}>{v.size}</div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSlot(i);
                              document.getElementById("compare-picker-search")?.focus();
                            }}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                              padding: "24px 16px",
                              margin: "8px",
                              width: "calc(100% - 16px)",
                              border: "1.5px dashed var(--border2)",
                              borderRadius: CELL_RADIUS,
                              background: "transparent",
                              color: "var(--text3)",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              transition: "border-color 0.15s, color 0.15s, background 0.15s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = BLUE;
                              e.currentTarget.style.color = BLUE;
                              e.currentTarget.style.background = "var(--blue-bg)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = "";
                              e.currentTarget.style.color = "";
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                            <span style={{ fontSize: "12px", fontWeight: 600 }}>자재 추가</span>
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    { key: "size", label: "사이즈", get: (v: CompareColumn) => v.size },
                    { key: "edge", label: "엣지", get: (v: CompareColumn) => v.edge },
                    { key: "mat", label: "소재", get: (v: CompareColumn) => v.material },
                    { key: "color", label: "색상", get: (v: CompareColumn) => v.color },
                    { key: "origin", label: "원장", get: (v: CompareColumn) => v.origin },
                  ] as const
                ).map((row, ri) => (
                  <tr key={row.key}>
                    <td style={rowLabelStyle}>{row.label}</td>
                    {views.map((v, ci) => (
                      <td key={ci} style={cellStyle(ri % 2 === 0)} onDragOver={(e) => { e.preventDefault(); setDragOverCol(ci); }} onDrop={(e) => onDropCol(e, ci)}>
                        {!v ? (
                          <span style={{ color: "var(--text3)" }}>—</span>
                        ) : row.key === "edge" && v.edge !== "—" ? (
                          <span style={{ display: "inline-block", borderRadius: "6px", padding: "3px 8px", fontSize: "11px", fontWeight: 600, background: "var(--blue-bg)", color: "var(--blue)" }}>
                            {row.get(v)}
                          </span>
                        ) : (
                          row.get(v)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td style={rowLabelStyle}>원자재비</td>
                  {visibleCols.map((c, ci) => (
                    <td key={ci} style={cellStyle(false)} onDragOver={(e) => { e.preventDefault(); setDragOverCol(ci); }} onDrop={(e) => onDropCol(e, ci)}>
                      {c ? <MoneyCell value={c.rawMaterialWon} mm={mmRaw} /> : <span style={{ color: "var(--text3)" }}>—</span>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={rowLabelStyle}>가공비</td>
                  {visibleCols.map((c, ci) => (
                    <td key={ci} style={cellStyle(true)} onDragOver={(e) => { e.preventDefault(); setDragOverCol(ci); }} onDrop={(e) => onDropCol(e, ci)}>
                      {c ? <MoneyCell value={c.processingWon} mm={mmProc} /> : <span style={{ color: "var(--text3)" }}>—</span>}
                    </td>
                  ))}
                </tr>
                <tr style={{ background: "var(--surface2)", borderTop: "2px solid var(--border2)" }}>
                  <td style={{ ...rowLabelStyle, fontWeight: 700, color: "var(--text2)", borderTop: "2px solid var(--border2)" }}>합계</td>
                  {visibleCols.map((c, ci) => {
                    const val = c?.grandTotalWon ?? null;
                    const cheaper =
                      mmTotal?.diff && val != null && maxTotal > 0 && Math.round(val) < Math.round(maxTotal)
                        ? maxTotal - val
                        : null;
                    return (
                      <td
                        key={ci}
                        style={{
                          ...cellStyle(false),
                          fontWeight: 700,
                          color: "var(--text1)",
                          borderTop: "2px solid var(--border2)",
                          background: "var(--surface2)",
                        }}
                        onDragOver={(e) => { e.preventDefault(); setDragOverCol(ci); }}
                        onDrop={(e) => onDropCol(e, ci)}
                      >
                        {c ? (
                          <div>
                            <MoneyCell value={c.grandTotalWon} mm={mmTotal} larger />
                            {cheaper != null && cheaper > 0 && (
                              <div style={{ fontSize: "10px", fontWeight: 500, color: "var(--green)", marginTop: "2px" }}>
                                {formatWonKorean(cheaper)}원 저렴
                              </div>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. 하단 목록 */}
        <div style={{ background: "var(--surface)", border: `0.5px solid ${BORDER}`, borderRadius: CARD_RADIUS, padding: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text1)", marginBottom: "10px" }}>비교할 자재 선택</div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
            <input
              id="compare-picker-search"
              type="search"
              placeholder="검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: "1 1 160px",
                minWidth: "120px",
                height: "34px",
                border: `0.5px solid var(--border2)`,
                borderRadius: CELL_RADIUS,
                fontSize: "12px",
                padding: "0 10px",
                background: "var(--surface2)",
                color: "var(--text1)",
                fontFamily: "inherit",
              }}
            />
            {(["material", "product", "set"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPickTab(k)}
                style={{
                  padding: "0 14px",
                  height: "34px",
                  border: `0.5px solid var(--border2)`,
                  borderRadius: CELL_RADIUS,
                  background: pickTab === k ? "var(--blue-bg)" : "var(--surface)",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: pickTab === k ? BLUE : "var(--text2)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  borderColor: pickTab === k ? BLUE : undefined,
                }}
              >
                {k === "material" ? "자재" : k === "product" ? "단품" : "세트"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {filteredPicker.map((row) => {
              const inCompare = isRowInCompare(row);
              const hover = hoverListId === `${row.kind}-${row.id}`;
              return (
                <div
                  key={`${row.kind}-${row.id}`}
                  draggable
                  onDragStart={(e) => onDragStartRow(e, row)}
                  onClick={() => assignSlot(row)}
                  onMouseEnter={() => setHoverListId(`${row.kind}-${row.id}`)}
                  onMouseLeave={() => setHoverListId(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "10px 12px",
                    border: `0.5px solid ${BORDER}`,
                    borderRadius: CELL_RADIUS,
                    cursor: "pointer",
                    background: hover ? "var(--blue-bg)" : "var(--surface)",
                    transition: "background 0.1s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    {inCompare && (
                      <span style={{ color: BLUE, fontSize: "14px", flexShrink: 0 }} aria-label="추가됨">
                        ✓
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text1)" }}>{row.name}</div>
                      <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "1px" }}>{row.summary}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: BLUE, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{formatWonKorean(row.grandTotalWon)}</div>
                </div>
              );
            })}
            {filteredPicker.length === 0 && <p style={{ fontSize: "12px", color: "var(--text3)", textAlign: "center", padding: "16px" }}>항목이 없습니다.</p>}
          </div>
          <p style={{ fontSize: "11px", color: "var(--text3)", margin: "12px 0 0" }}>드래그하여 열에 놓을 수 있습니다.</p>
        </div>

        </div>

        {/* 저장된 비교 — 우측 고정 폭 리스트 */}
        <aside
          style={{
            width: "300px",
            flexShrink: 0,
            position: "sticky",
            top: "12px",
            alignSelf: "flex-start",
            border: `0.5px solid ${BORDER}`,
            borderRadius: CARD_RADIUS,
            background: "var(--surface)",
            padding: "14px 14px 12px",
            textAlign: "left",
            maxHeight: "calc(100vh - 80px)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text1)" }}>저장된 비교</div>
          <input
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="저장된 비교 검색"
            style={{
              height: "34px",
              padding: "0 10px",
              border: `0.5px solid ${BORDER}`,
              borderRadius: CELL_RADIUS,
              fontSize: "12px",
              fontFamily: "inherit",
              background: "var(--surface2)",
              color: "var(--text1)",
              width: "100%",
            }}
          />
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <SavedCompareList
              token={token}
              q={listSearch}
              onPick={async (id) => {
                if (!token) return;
                const row = await api<{ name: string; form?: { slots?: Slot[] } }>(`/comparisons/${id}`, { token });
                setEditingComparisonId(id);
                setName(row.name);
                const sl = [...(row.form?.slots ?? [])] as Slot[];
                while (sl.length < 4) sl.push(null);
                setSlots(sl.slice(0, 4) as [Slot, Slot, Slot, Slot]);
                const used = sl.slice(0, 4).filter(Boolean).length;
                setVisibleCount(Math.max(2, Math.min(4, Math.max(used, 2))));
              }}
            />
          </div>
        </aside>
      </div>
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
  const [rows, setRows] = useState<{ id: string; name: string; updatedAt: string; status?: string }[]>([]);
  useEffect(() => {
    if (!token) return;
    api<{ id: string; name: string; updatedAt: string; status?: string }[]>("/comparisons/list", { token }).then(setRows);
  }, [token]);
  const filtered = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  return (
    <div style={{ maxHeight: "min(420px, 55vh)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
      {filtered.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => void onPick(r.id)}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            borderRadius: CELL_RADIUS,
            border: `0.5px solid ${BORDER}`,
            padding: "8px 10px",
            textAlign: "left",
            fontSize: "12px",
            color: "var(--text1)",
            background: "var(--surface)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          {r.status === "DRAFT" && (
            <span style={{ flexShrink: 0, fontSize: "10px", color: "var(--text3)" }}>임시</span>
          )}
        </button>
      ))}
    </div>
  );
}

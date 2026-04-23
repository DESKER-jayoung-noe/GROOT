import { useEffect, useMemo, useState } from "react";

export type ExtraProcType = "forming" | "router" | "curvedge" | "custom";
export type ExtraProc = { type: ExtraProcType; label?: string; mm: number; _id: number };

export type ParsedReviewRow = {
  id: string;
  checked: boolean;
  name: string;
  file: string;
  source: "stp" | "pdf" | "dwg" | "zip";
  W: number;
  D: number;
  T: number;
  edge: "4면" | "2면" | "1면" | "없음";
  edgeT: number;
  hole1: number;
  hole2: number;
  extraProcs: ExtraProc[];
  confidence: number;
  warn?: string | null;
};

type Props = {
  open: boolean;
  sourceLabel: string;
  rows: ParsedReviewRow[];
  onClose: () => void;
  onBack: () => void;
  onRegister: (rows: ParsedReviewRow[]) => void;
};

type EditField = "W" | "D" | "T" | "edgeT";

const PROC_TYPES = [
  { key: "forming" as const,  label: "포밍",           rate: 1 },
  { key: "router" as const,   label: "루타",           rate: 2 },
  { key: "curvedge" as const, label: "곡면엣지 머시닝", rate: 3 },
];

const PROC_COLORS: Record<string, string> = {
  forming:  "bg-[#fdf4ff] text-[#9333ea]",
  router:   "bg-[#f0fdf4] text-[#16a34a]",
  curvedge: "bg-[#fff7ed] text-[#ea580c]",
  custom:   "bg-[#eff6ff] text-[#2563eb]",
};

const SOURCE_CLASS: Record<ParsedReviewRow["source"], string> = {
  stp: "bg-[#f0fdf4] text-[#16a34a]",
  pdf: "bg-[#fff7ed] text-[#ea580c]",
  dwg: "bg-[#faf5ff] text-[#7c3aed]",
  zip: "bg-[#eff6ff] text-[#3b82f6]",
};

function confidenceDot(conf: number): string {
  if (conf >= 0.85) return "bg-[#16a34a]";
  if (conf >= 0.65) return "bg-[#f59e0b]";
  return "bg-[#ef4444]";
}

function confidenceLabel(conf: number): string {
  if (conf >= 0.85) return "높음";
  if (conf >= 0.65) return "보통";
  return "낮음";
}

export function ReviewModal({ open, sourceLabel, rows, onClose, onBack, onRegister }: Props) {
  const [items, setItems] = useState<ParsedReviewRow[]>(rows);
  const [editing, setEditing] = useState<{ id: string; field: EditField } | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const original = useMemo(() => {
    const map = new Map<string, ParsedReviewRow>();
    rows.forEach((r) => map.set(r.id, { ...r }));
    return map;
  }, [rows]);

  useEffect(() => { setItems(rows); }, [rows]);

  useEffect(() => {
    if (!openDropdownId) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".proc-dd-wrap")) setOpenDropdownId(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openDropdownId]);

  if (!open) return null;

  const selectedCount = items.filter((r) => r.checked).length;
  const autoCount = items.filter((r) => !r.warn && r.confidence >= 0.65).length;
  const warnCount = items.length - autoCount;

  const addPresetProc = (rowId: string, type: ExtraProcType) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId ? { ...it, extraProcs: [...it.extraProcs, { type, mm: 0, _id: Date.now() }] } : it
      )
    );
    setOpenDropdownId(null);
  };

  const addCustomProc = (rowId: string) => {
    const name = customNames[rowId]?.trim();
    if (!name) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId
          ? { ...it, extraProcs: [...it.extraProcs, { type: "custom", label: name, mm: 0, _id: Date.now() }] }
          : it
      )
    );
    setCustomNames((prev) => ({ ...prev, [rowId]: "" }));
    setOpenDropdownId(null);
  };

  const delProc = (rowId: string, procId: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId ? { ...it, extraProcs: it.extraProcs.filter((ep) => ep._id !== procId) } : it
      )
    );
  };

  const updateProcMm = (rowId: string, procId: number, val: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId
          ? { ...it, extraProcs: it.extraProcs.map((ep) => (ep._id === procId ? { ...ep, mm: val } : ep)) }
          : it
      )
    );
  };

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/35 p-4 font-['Pretendard',system-ui]"
      role="dialog"
      aria-modal
    >
      <div
        className="flex max-h-[88vh] flex-col overflow-hidden rounded-[12px] bg-[#fff] shadow-[0_8px_40px_rgba(0,0,0,.13)]"
        style={{ width: "min(1160px, 96vw)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#f0f0f0] px-[22px] py-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[#1a1a1a]">
              자재 파싱 결과 검토 <span className="text-[11px] font-normal text-[#bbb]">{sourceLabel}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-[#aaa]">
              더블클릭으로 수치 수정 · 보링·루터는 직접 입력 · 체크박스로 등록할 자재 선택
            </div>
          </div>
          <div className="flex gap-[5px]">
            <span className="rounded-[4px] bg-[#f0fdf4] px-2 py-[3px] text-[10px] font-semibold text-[#16a34a]">
              ✓ 자동 {autoCount}개
            </span>
            <span className="rounded-[4px] bg-[#fffbeb] px-2 py-[3px] text-[10px] font-semibold text-[#d97706]">
              ⚠ 확인 {warnCount}개
            </span>
          </div>
          <button
            type="button"
            className="h-7 w-7 rounded-[4px] text-[20px] leading-none text-[#bbb] hover:bg-[#f5f5f5] hover:text-[#444]"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
            <thead>
              <tr className="sticky top-0 z-[1] bg-[#fafafa]">
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-left text-[10px] font-semibold text-[#aaa]" style={{ width: "30px" }}>
                  <input
                    type="checkbox"
                    className="h-[14px] w-[14px] cursor-pointer accent-[#1a1a1a]"
                    checked={selectedCount === items.length && items.length > 0}
                    onChange={(e) => setItems((prev) => prev.map((r) => ({ ...r, checked: e.target.checked })))}
                  />
                </th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-left text-[10px] font-semibold text-[#aaa]" style={{ minWidth: "140px" }}>
                  자재명 <span className="font-normal text-[#ddd]">✎</span>
                </th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "36px" }}>소스</th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "90px" }}>W (mm) <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "90px" }}>D (mm) <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "70px" }}>T (mm) <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "80px" }}>엣지 <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "68px" }}>엣지 T <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "68px" }}>일반 보링</th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "68px" }}>2단 보링</th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "120px" }}>추가 가공</th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "60px" }}>신뢰도</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const orig = original.get(row.id) ?? row;
                const isErr = row.confidence < 0.5;
                const isWarn = !isErr && (row.confidence < 0.65 || row.edge === "없음" || Boolean(row.warn));
                const changed = (k: keyof ParsedReviewRow) => row[k] !== orig[k];
                const nameChanged = row.name !== orig.name;
                return (
                  <tr key={row.id} className="border-b border-[#f5f5f5] text-[11px] hover:bg-[#fafafa]">
                    {/* Checkbox */}
                    <td className={`px-[10px] py-[7px] ${isErr ? "border-l-[3px] border-[#ef4444]" : isWarn ? "border-l-[3px] border-[#f59e0b]" : ""}`}>
                      <input
                        type="checkbox"
                        className="h-[14px] w-[14px] cursor-pointer accent-[#1a1a1a]"
                        checked={row.checked}
                        onChange={(e) =>
                          setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, checked: e.target.checked } : it)))
                        }
                      />
                    </td>
                    {/* Name */}
                    <td className="px-[10px] py-[7px]">
                      <input
                        className={`name-inp${nameChanged ? " changed" : ""}`}
                        value={row.name}
                        onChange={(e) =>
                          setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, name: e.target.value } : it)))
                        }
                      />
                      {row.warn ? (
                        <div className="mt-[2px] inline-block rounded-[3px] border border-[#fde68a] bg-[#fffbeb] px-[5px] py-[1px] text-[9px] text-[#d97706]">
                          {row.warn}
                        </div>
                      ) : null}
                      <div className="mt-[1px] text-[9px] text-[#bbb]">{row.file}</div>
                    </td>
                    {/* Source */}
                    <td className="px-[10px] py-[7px] text-center">
                      <span className={`rounded-[3px] px-[5px] py-[1px] text-[9px] font-bold ${SOURCE_CLASS[row.source]}`}>
                        {row.source.toUpperCase()}
                      </span>
                    </td>
                    {/* W / D / T — dbl-click edit */}
                    {(["W", "D", "T"] as const).map((field) => (
                      <td key={field} className="px-[10px] py-[7px] text-center font-mono text-[11px]">
                        {editing?.id === row.id && editing.field === field ? (
                          <input
                            autoFocus
                            type="number"
                            step={field === "T" ? 0.5 : 1}
                            defaultValue={row[field]}
                            className="h-[22px] w-[56px] rounded-[3px] border-[1.5px] border-[#1a1a1a] bg-[#fff] text-center text-[11px] outline-none"
                            onBlur={(e) => {
                              const v = Number.parseFloat(e.target.value) || 0;
                              setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, [field]: v } : it)));
                              setEditing(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                            }}
                          />
                        ) : (
                          <span
                            title="더블클릭으로 수정"
                            onDoubleClick={() => setEditing({ id: row.id, field })}
                            className={`inline-block min-w-[44px] cursor-text rounded-[3px] px-1 py-[2px] text-right ${
                              changed(field) ? "bg-[#fffbeb] font-semibold text-[#d97706]" : "hover:bg-[#f0f0f0]"
                            }`}
                          >
                            {row[field].toFixed(1)}
                          </span>
                        )}
                      </td>
                    ))}
                    {/* Edge */}
                    <td className="px-[10px] py-[7px] text-center">
                      <select
                        className="h-[22px] rounded-[3px] border border-[#e0e0e0] bg-[#fff] px-1 text-[10px] outline-none focus:border-[#1a1a1a]"
                        value={row.edge}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it) =>
                              it.id === row.id ? { ...it, edge: e.target.value as ParsedReviewRow["edge"] } : it
                            )
                          )
                        }
                      >
                        <option>4면</option>
                        <option>2면</option>
                        <option>1면</option>
                        <option>없음</option>
                      </select>
                    </td>
                    {/* EdgeT */}
                    <td className="px-[10px] py-[7px] text-center font-mono text-[11px]">
                      {editing?.id === row.id && editing.field === "edgeT" ? (
                        <input
                          autoFocus
                          type="number"
                          step={0.5}
                          defaultValue={row.edgeT}
                          className="h-[22px] w-[56px] rounded-[3px] border-[1.5px] border-[#1a1a1a] bg-[#fff] text-center text-[11px] outline-none"
                          onBlur={(e) => {
                            const v = Number.parseFloat(e.target.value) || 0;
                            setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, edgeT: v } : it)));
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      ) : (
                        <span
                          title="더블클릭으로 수정"
                          onDoubleClick={() => setEditing({ id: row.id, field: "edgeT" })}
                          className={`inline-block min-w-[28px] cursor-text rounded-[3px] px-1 py-[2px] ${
                            changed("edgeT") ? "bg-[#fffbeb] font-semibold text-[#d97706]" : "hover:bg-[#f0f0f0]"
                          }`}
                        >
                          {row.edgeT > 0 ? `${row.edgeT}T` : "—"}
                        </span>
                      )}
                    </td>
                    {/* hole1 / hole2 */}
                    {(["hole1", "hole2"] as const).map((field) => (
                      <td key={field} className="px-[10px] py-[7px] text-center">
                        <input
                          type="number"
                          min={0}
                          value={row[field]}
                          className={`h-[22px] w-[44px] rounded-[3px] border text-center font-mono text-[11px] outline-none focus:border-[#1a1a1a] ${
                            changed(field)
                              ? "border-[#f59e0b] bg-[#fffbeb] text-[#d97706]"
                              : "border-[#e0e0e0] bg-[#fff]"
                          }`}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it) =>
                                it.id === row.id ? { ...it, [field]: Number(e.target.value) || 0 } : it
                              )
                            )
                          }
                        />
                      </td>
                    ))}
                    {/* Extra procs */}
                    <td className="px-[8px] py-[6px]">
                      <div className="flex flex-wrap items-center gap-[2px]">
                        {row.extraProcs.map((ep) => (
                          <span
                            key={ep._id}
                            className={`inline-flex items-center gap-1 rounded-[3px] px-[7px] py-[2px] text-[10px] font-medium ${PROC_COLORS[ep.type] ?? PROC_COLORS.custom}`}
                          >
                            {ep.label ?? PROC_TYPES.find((p) => p.key === ep.type)?.label ?? ep.type}
                            <input
                              type="number"
                              min={0}
                              value={ep.mm}
                              style={{
                                width: "38px", height: "16px", border: "none", borderBottom: "1px solid #ccc",
                                background: "transparent", fontSize: "9px", textAlign: "center",
                                outline: "none", fontFamily: "monospace", margin: "0 2px",
                              }}
                              onChange={(e) => updateProcMm(row.id, ep._id, parseFloat(e.target.value) || 0)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span style={{ fontSize: "9px", color: "#aaa" }}>mm</span>
                            <button
                              type="button"
                              className="flex h-[14px] w-[14px] items-center justify-center border-0 bg-transparent p-0 text-[12px] leading-none text-[#bbb] hover:text-[#ef4444]"
                              onClick={() => delProc(row.id, ep._id)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <div className="proc-dd-wrap relative inline-block">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-[4px] border border-dashed border-[#e0e0e0] bg-transparent px-2 py-[3px] text-[10px] text-[#aaa] transition-all hover:border-[#aaa] hover:bg-[#fafafa] hover:text-[#555]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId((id) => (id === row.id ? null : row.id));
                            }}
                          >
                            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            가공 추가
                          </button>
                          {openDropdownId === row.id && (
                            <div
                              className="absolute z-50 mt-1 min-w-[240px] overflow-hidden rounded-[8px] border border-[#e0e0e0] bg-[#fff] shadow-[0_6px_20px_rgba(0,0,0,.12)]"
                              style={{ left: 0, top: "100%" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="border-b border-[#f0f0f0] px-[12px] py-[8px] text-[10px] font-bold uppercase tracking-[.06em] text-[#aaa]">
                                가공 종류 선택
                              </div>
                              {PROC_TYPES.map((pt) => (
                                <div
                                  key={pt.key}
                                  className="flex cursor-pointer items-center justify-between px-[14px] py-[8px] text-[11px] text-[#333] hover:bg-[#f5f5f5]"
                                  onClick={() => addPresetProc(row.id, pt.key)}
                                >
                                  <span className="font-medium">{pt.label}</span>
                                  <span className="text-[10px] text-[#aaa]">{pt.rate},000원/m · mm 입력</span>
                                </div>
                              ))}
                              <div className="my-1 h-[1px] bg-[#f0f0f0]" />
                              <div className="flex items-center gap-[6px] px-[14px] py-[8px]">
                                <input
                                  placeholder="직접 입력 (가공명)"
                                  className="h-[26px] flex-1 rounded-[4px] border border-[#e0e0e0] px-2 text-[11px] outline-none focus:border-[#1a1a1a]"
                                  value={customNames[row.id] ?? ""}
                                  onChange={(e) =>
                                    setCustomNames((prev) => ({ ...prev, [row.id]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") addCustomProc(row.id);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="rounded-[4px] border border-[#1a1a1a] bg-[#1a1a1a] px-[10px] py-1 text-[11px] text-[#fff] hover:bg-[#333]"
                                  onClick={() => addCustomProc(row.id)}
                                >
                                  추가
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* Confidence */}
                    <td className="px-[10px] py-[7px] text-center">
                      <span className={`mr-1 inline-block h-[7px] w-[7px] rounded-full align-middle ${confidenceDot(row.confidence)}`} />
                      <span className="align-middle text-[10px] text-[#888]">{confidenceLabel(row.confidence)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-[10px] border-t border-[#f0f0f0] bg-[#fff] px-[22px] py-3 flex-shrink-0">
          <div className="mr-auto text-[10px] text-[#bbb]">
            ✎ 자재명 클릭 · W/D/T/엣지T 더블클릭 수정 · 보링 직접 입력 · + 가공 추가
          </div>
          <button
            type="button"
            className="bg-transparent p-0 text-[11px] text-[#aaa] underline hover:text-[#333]"
            onClick={() => setItems((prev) => prev.map((r) => ({ ...r, checked: true })))}
          >
            전체 선택
          </button>
          <span className="text-[#e0e0e0]">·</span>
          <button
            type="button"
            className="bg-transparent p-0 text-[11px] text-[#aaa] underline hover:text-[#333]"
            onClick={() => setItems((prev) => prev.map((r) => ({ ...r, checked: false })))}
          >
            전체 해제
          </button>
          <span className="text-[11px] font-semibold text-[#555]">{selectedCount}개 선택</span>
          <button
            type="button"
            className="rounded-[5px] border border-[#e0e0e0] bg-[#fff] px-4 py-2 text-[12px] font-medium text-[#666] hover:border-[#aaa] hover:text-[#333]"
            onClick={onBack}
          >
            이전
          </button>
          <button
            type="button"
            className="rounded-[5px] border border-[#1a1a1a] bg-[#1a1a1a] px-4 py-2 text-[12px] font-medium text-[#fff] hover:bg-[#333]"
            onClick={() => onRegister(items.filter((r) => r.checked))}
          >
            선택 항목 등록하기 →
          </button>
        </div>
      </div>
    </div>
  );
}

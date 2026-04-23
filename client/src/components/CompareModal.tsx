import { Fragment, useEffect, useRef, useState } from "react";

/** 다른 화면에서 비교 모달을 열 때 사용 */
export const OPEN_COMPARE_MODAL_EVENT = "groot:open-compare-modal";

export function openCompareModal(): void {
  window.dispatchEvent(new CustomEvent(OPEN_COMPARE_MODAL_EVENT));
}

type CompareKind = "mat" | "item" | "set";

type CompareEntry = {
  id: string;
  name: string;
  sub: string;
  rows: Record<string, string | number>;
  parts?: string[];
  items?: string[];
};

const DATA: Record<CompareKind, CompareEntry[]> = {
  mat: [
    {
      id: "m1",
      name: "뒷판 A",
      sub: "1169×550×15T · PB",
      rows: {
        spec: "1169×550×15",
        material: "PB",
        surface: "LPM/O",
        color: "WW",
        edge: "4면 2T",
        mat_cost: 6830,
        edge_cost: 492,
        hotmelt: 292,
        cut: 800,
        edge_bond: 784,
        boring: "0/4",
        total: 9240,
      },
    },
    {
      id: "m2",
      name: "뒷판 A (MDF)",
      sub: "1169×550×15T · MDF",
      rows: {
        spec: "1169×550×15",
        material: "MDF",
        surface: "LPM/O",
        color: "WW",
        edge: "4면 1T",
        mat_cost: 7640,
        edge_cost: 320,
        hotmelt: 292,
        cut: 800,
        edge_bond: 650,
        boring: "0/4",
        total: 9820,
      },
    },
    {
      id: "m3",
      name: "뒷판 B",
      sub: "1000×500×15T · PB",
      rows: {
        spec: "1000×500×15",
        material: "PB",
        surface: "PET",
        color: "WN",
        edge: "2면 1T",
        mat_cost: 5900,
        edge_cost: 210,
        hotmelt: 220,
        cut: 700,
        edge_bond: 420,
        boring: "0/0",
        total: 7690,
      },
    },
    {
      id: "m4",
      name: "측판 L",
      sub: "550×720×18T · PB",
      rows: {
        spec: "550×720×18",
        material: "PB",
        surface: "LPM/O",
        color: "WW",
        edge: "2면 1T",
        mat_cost: 7200,
        edge_cost: 340,
        hotmelt: 310,
        cut: 900,
        edge_bond: 820,
        boring: "6/2",
        total: 9832,
      },
    },
    {
      id: "m5",
      name: "상판",
      sub: "1200×600×18T · PB",
      rows: {
        spec: "1200×600×18",
        material: "PB",
        surface: "LPM/O",
        color: "WW",
        edge: "4면 2T",
        mat_cost: 9600,
        edge_cost: 680,
        hotmelt: 380,
        cut: 1100,
        edge_bond: 900,
        boring: "0/0",
        total: 12980,
      },
    },
  ],
  item: [
    {
      id: "i1",
      name: "DD13R 1200폭 책상",
      sub: "5자재",
      parts: ["뒷판 A", "측판 L", "측판 R", "상판", "하판"],
      rows: { parts: 5, wash: 1560, hw_pack: 252, bag: 1000, nk: 1000, tape: 43, sticker: 6, overhead: 2500, factory: 52401 },
    },
    {
      id: "i2",
      name: "DD11R 900폭 책상",
      sub: "4자재",
      parts: ["뒷판 B", "측판 L", "측판 R", "상판"],
      rows: { parts: 4, wash: 1120, hw_pack: 0, bag: 0, nk: 500, tape: 43, sticker: 6, overhead: 1800, factory: 38200 },
    },
    {
      id: "i3",
      name: "DD15R 1400폭 책상",
      sub: "6자재",
      parts: ["뒷판 C", "측판 L", "측판 R", "상판", "하판", "중간선반"],
      rows: { parts: 6, wash: 1820, hw_pack: 252, bag: 1000, nk: 1000, tape: 43, sticker: 6, overhead: 3200, factory: 68400 },
    },
  ],
  set: [
    {
      id: "s1",
      name: "DD13R 1200 멀티책상세트",
      sub: "3단품",
      items: ["DD13R 1200폭 책상", "서랍 유닛", "파티션"],
      rows: { items: 3, wood_sub: 48040, pack_sub: 3861, overhead: 2500, extra: 0, total: 54401 },
    },
    {
      id: "s2",
      name: "DD11R 900 기본책상세트",
      sub: "2단품",
      items: ["DD11R 900폭 책상", "서랍 유닛"],
      rows: { items: 2, wood_sub: 35200, pack_sub: 2800, overhead: 1900, extra: 0, total: 39900 },
    },
    {
      id: "s3",
      name: "DD15R 1400 대형세트",
      sub: "4단품",
      items: ["DD15R 1400폭 책상", "서랍 유닛", "파티션", "사이드 테이블"],
      rows: { items: 4, wood_sub: 72300, pack_sub: 5100, overhead: 3900, extra: 8000, total: 89300 },
    },
  ],
};

type RowDef = {
  key: string;
  label: string;
  fmt?: "won";
  tip?: string;
  expand?: "parts" | "items";
};

type SecDef = { sec: string; rows: RowDef[] };

const CMP_ROWS: Record<CompareKind, SecDef[]> = {
  mat: [
    {
      sec: "규격",
      rows: [
        { key: "spec", label: "W × D × T (mm)" },
        { key: "material", label: "소재" },
        { key: "surface", label: "표면재" },
        { key: "color", label: "색상" },
        { key: "edge", label: "엣지" },
      ],
    },
    {
      sec: "원자재비",
      rows: [
        { key: "mat_cost", fmt: "won", label: "목재 자재비", tip: "(원장가 × 점유율) ÷ 자재수" },
        { key: "edge_cost", fmt: "won", label: "엣지 자재비", tip: "엣지 단가 × 둘레 길이 (mm)" },
        { key: "hotmelt", fmt: "won", label: "핫멜트", tip: "T별 단가 × 엣지 둘레 (mm)" },
      ],
    },
    {
      sec: "가공비",
      rows: [
        { key: "cut", fmt: "won", label: "재단", tip: "재단 횟수 × 200원" },
        { key: "edge_bond", fmt: "won", label: "엣지 접착", tip: "번딩 단가 × 구간 수" },
        { key: "boring", label: "보링류", tip: "일반 보링 / 2단 보링 개수" },
      ],
    },
  ],
  item: [
    {
      sec: "포장비",
      rows: [
        { key: "parts", label: "자재 수", expand: "parts" },
        { key: "wash", fmt: "won", label: "세척비", tip: "((W×D)/1,000,000)×2×250원" },
        { key: "hw_pack", fmt: "won", label: "철물 포장비", tip: "철물 개수 × 21원" },
        { key: "bag", fmt: "won", label: "비닐 묶음", tip: "묶음 수 × 1,000원" },
        { key: "nk", fmt: "won", label: "넉다운 포장", tip: "1~2개:500 / 3~5개:1,000 / 6~8개:1,500 / 9개↑:2,000" },
        { key: "tape", fmt: "won", label: "테이프", tip: "((W+100)+(D+100)×2)/1000×15.42원" },
        { key: "sticker", fmt: "won", label: "스티커", tip: "박스 1개당 6원" },
      ],
    },
    {
      sec: "관리비",
      rows: [{ key: "overhead", fmt: "won", label: "일반관리비", tip: "ROUNDUP((자재+가공+포장)×5%, -2)" }],
    },
  ],
  set: [
    {
      sec: "구성",
      rows: [{ key: "items", label: "단품 수", expand: "items" }],
    },
    {
      sec: "비용",
      rows: [
        { key: "wood_sub", fmt: "won", label: "목재 단품 소계", tip: "자재별 (원자재비+가공비) 합산" },
        { key: "pack_sub", fmt: "won", label: "포장비 소계", tip: "세척비+철물+박스포장 합산" },
        { key: "overhead", fmt: "won", label: "관리비", tip: "ROUNDUP(전체합계×5%, -2)" },
        { key: "extra", fmt: "won", label: "기타 품목", tip: "멀티탭·경첩 등 수기 입력 품목 합계" },
      ],
    },
  ],
};

const CMP_TK: Record<CompareKind, string> = { mat: "total", item: "factory", set: "total" };
const CMP_TL: Record<CompareKind, string> = { mat: "자재 합계", item: "공장판매가", set: "세트 합계" };
const CMP_LL: Record<CompareKind, string> = { mat: "저장된 자재", item: "저장된 단품", set: "저장된 세트" };

const MAX_S = 4;

/** 앱 루트에 한 번만 두세요. `openCompareModal()` 또는 `OPEN_COMPARE_MODAL_EVENT` 로 엽니다. */
export function CompareModalRoot() {
  const [open, setOpen] = useState(false);
  const [cmpType, setCmpType] = useState<CompareKind>("mat");
  const [slots, setSlots] = useState<(CompareEntry | null)[]>([null, null]);
  const [activeSlot, setActiveSlot] = useState(0);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_COMPARE_MODAL_EVENT, handler);
    return () => window.removeEventListener(OPEN_COMPARE_MODAL_EVENT, handler);
  }, []);

  // Close export menu on outside click
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && exportWrapRef.current?.contains(t)) return;
      setExportMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [exportMenuOpen]);

  // Escape key to close modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const resetSlots = () => {
    setSlots([null, null]);
    setActiveSlot(0);
  };

  const addSlot = () => {
    if (slots.length >= MAX_S) return;
    setSlots((s) => [...s, null]);
    setActiveSlot(slots.length);
  };

  const clearSlot = (i: number) => {
    setSlots((s) => {
      const n = [...s];
      n[i] = null;
      // trim trailing nulls but keep minimum 2
      while (n.length > 2 && n[n.length - 1] === null) n.pop();
      return n;
    });
  };

  const pickItem = (d: CompareEntry) => {
    setSlots((s) => {
      const n = [...s];
      n[activeSlot] = d;
      return n;
    });
    // advance to next empty slot
    const nextEmpty = slots.findIndex((s, i) => i !== activeSlot && !s);
    if (nextEmpty >= 0) setActiveSlot(nextEmpty);
  };

  const renderTable = () => {
    const filled = slots.filter(Boolean) as CompareEntry[];
    if (filled.length < 2)
      return (
        <div className="cmp-empty" style={{ height: "100%" }}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect x="4" y="4" width="12" height="12" rx="2.5" stroke="#ddd" strokeWidth="2" />
            <rect x="20" y="4" width="12" height="12" rx="2.5" stroke="#ddd" strokeWidth="2" />
            <rect x="4" y="20" width="12" height="12" rx="2.5" stroke="#ddd" strokeWidth="2" />
            <path d="M20 26h12M26 20v12" stroke="#ddd" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>2개 이상 선택하면 비교표가 나타납니다</span>
        </div>
      );

    const tots = filled.map((d) => (d.rows[CMP_TK[cmpType]] as number) || 0);
    const minT = Math.min(...tots);
    const maxT = Math.max(...tots);
    const rowDefs = CMP_ROWS[cmpType];

    return (
      <table className="cmp-table">
        <thead>
          <tr>
            <th style={{ minWidth: "140px" }}>항목</th>
            {filled.map((d) => (
              <th key={d.id} className="vc">
                {d.name}
                <br />
                <span style={{ fontSize: "9px", fontWeight: 400, color: "#bbb" }}>{d.sub}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowDefs?.map((sec) => (
            <Fragment key={sec.sec}>
              <tr className="sec-row">
                <td colSpan={1 + filled.length}>
                  <span className="sec-lbl">{sec.sec}</span>
                </td>
              </tr>
              {sec.rows.map((row) => {
                const vals = filled.map((d) => d.rows[row.key]);
                const nums = vals
                  .map((v) => (typeof v === "number" ? v : null))
                  .filter((v): v is number => v !== null);
                const minV = nums.length ? Math.min(...nums) : null;
                const maxV = nums.length ? Math.max(...nums) : null;
                return (
                  <tr key={row.key}>
                    <td>
                      <div className="row-lbl">
                        {row.label}
                        {row.tip && (
                          <span className="tip-icon">
                            ?<span className="tip-box">{row.tip}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    {vals.map((v, ci) => {
                      const isMin = typeof v === "number" && v === minV && minV !== maxV;
                      const isMax = typeof v === "number" && v === maxV && minV !== maxV;
                      const cls = row.fmt === "won" ? (isMin ? " hi" : isMax ? " lo" : "") : "";
                      const disp =
                        row.fmt === "won"
                          ? typeof v === "number"
                            ? v.toLocaleString() + "원"
                            : v ?? "—"
                          : v ?? "—";
                      const diff =
                        row.fmt === "won" &&
                        typeof v === "number" &&
                        minV !== null &&
                        v !== minV ? (
                          <div className="diff-tag diff-up">+{(v - minV).toLocaleString()}원</div>
                        ) : null;
                      return (
                        <td key={ci} className={`val-cell${cls}`}>
                          {disp}
                          {diff}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </Fragment>
          ))}
          <tr className="cmp-total-row">
            <td>
              <div className="total-lbl">{CMP_TL[cmpType]}</div>
            </td>
            {filled.map((d) => {
              const t = (d.rows[CMP_TK[cmpType]] as number) || 0;
              const isBest = t === minT && minT !== maxT;
              const isWorst = t === maxT && minT !== maxT;
              const diff = t - minT;
              return (
                <td key={d.id}>
                  <div className={`total-val${isBest ? " best" : isWorst ? " worst" : ""}`}>
                    {t.toLocaleString()}원
                    {isBest && <span className="best-tag">최선</span>}
                  </div>
                  {diff > 0 && (
                    <div
                      className="diff-tag diff-up"
                      style={{ display: "table", margin: "4px auto" }}
                    >
                      +{diff.toLocaleString()}원
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    );
  };

  const exportCsv = () => {
    setExportMenuOpen(false);
    const filled = slots.filter(Boolean) as CompareEntry[];
    if (filled.length < 2) return;
    const rowDefs = CMP_ROWS[cmpType];
    let csv = `항목,${filled.map((d) => d.name).join(",")}\n`;
    rowDefs?.forEach((sec) => {
      csv += `[${sec.sec}]\n`;
      sec.rows.forEach((row) => {
        csv += `${row.label},${filled
          .map((d) => {
            const v = d.rows[row.key];
            return row.fmt === "won" && typeof v === "number" ? v : v ?? "—";
          })
          .join(",")}\n`;
      });
    });
    csv += `${CMP_TL[cmpType]},${filled.map((d) => d.rows[CMP_TK[cmpType]] || 0).join(",")}\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
    );
    a.download = `DESKER_비교_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const copyHtml = () => {
    setExportMenuOpen(false);
    const filled = slots.filter(Boolean) as CompareEntry[];
    if (filled.length < 2) return;
    const rowDefs = CMP_ROWS[cmpType];
    let h = `<table><thead><tr><th>항목</th>${filled.map((d) => `<th>${d.name}</th>`).join("")}</tr></thead><tbody>`;
    rowDefs?.forEach((sec) => {
      h += `<tr><td colspan="${1 + filled.length}"><b>${sec.sec}</b></td></tr>`;
      sec.rows.forEach((row) => {
        h += `<tr><td>${row.label}</td>${filled
          .map((d) => {
            const v = d.rows[row.key];
            return `<td>${
              row.fmt === "won" && typeof v === "number"
                ? v.toLocaleString() + "원"
                : v ?? "—"
            }</td>`;
          })
          .join("")}</tr>`;
      });
    });
    h += `<tr><td><b>${CMP_TL[cmpType]}</b></td>${filled
      .map(
        (d) =>
          `<td><b>${((d.rows[CMP_TK[cmpType]] as number) || 0).toLocaleString()}원</b></td>`
      )
      .join("")}</tr></tbody></table>`;
    navigator.clipboard
      .write([
        new ClipboardItem({
          "text/html": new Blob([h], { type: "text/html" }),
          "text/plain": new Blob([h], { type: "text/plain" }),
        }),
      ])
      .then(() => alert("복사됐습니다!"))
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = h;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        alert("복사됐습니다!");
      });
  };

  if (!open) return null;

  return (
    <div
      className="cmp-modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="cmp-modal">
        <div className="cmp-modal-head">
          <div className="cmp-modal-title">비교하기</div>
          <button className="cmp-modal-close" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {/* Left panel */}
          <div className="cmp-left">
            <div className="cmp-left-head">
              <div className="cmp-left-title">비교 대상 선택</div>
              <div className="seg" style={{ marginTop: "10px" }}>
                <button
                  className={`seg-btn${cmpType === "mat" ? " on" : ""}`}
                  onClick={() => {
                    setCmpType("mat");
                    resetSlots();
                  }}
                >
                  자재
                </button>
                <button
                  className={`seg-btn${cmpType === "item" ? " on" : ""}`}
                  onClick={() => {
                    setCmpType("item");
                    resetSlots();
                  }}
                >
                  단품
                </button>
                <button
                  className={`seg-btn${cmpType === "set" ? " on" : ""}`}
                  onClick={() => {
                    setCmpType("set");
                    resetSlots();
                  }}
                >
                  세트
                </button>
              </div>
            </div>

            <div className="cmp-slots-wrap">
              {slots.map((d, i) => (
                <div
                  key={i}
                  className={`cmp-slot${d ? " filled" : ""}${!d && i === activeSlot ? " active-slot" : ""}`}
                  onClick={() => !d && setActiveSlot(i)}
                >
                  <div className="cmp-slot-num">{i + 1}</div>
                  {d ? (
                    <>
                      <div className="cmp-slot-info">
                        <div className="cmp-slot-name">{d.name}</div>
                        <div className="cmp-slot-sub">{d.sub}</div>
                      </div>
                      <button
                        className="cmp-slot-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearSlot(i);
                        }}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <div className="cmp-slot-empty">클릭해서 선택</div>
                  )}
                </div>
              ))}
              {slots.length < MAX_S && (
                <button className="add-slot-btn" onClick={addSlot}>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                  >
                    <path
                      d="M6 1v10M1 6h10"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                  비교 항목 추가 (최대 {MAX_S}개)
                </button>
              )}
            </div>

            <div className="cmp-list-label">{CMP_LL[cmpType]}</div>
            <div className="cmp-list">
              {DATA[cmpType].map((d) => (
                <div
                  key={d.id}
                  className={`cmp-li${slots.some((s) => s?.id === d.id) ? " selected" : ""}`}
                  onClick={() => pickItem(d)}
                >
                  <div className="cmp-li-info">
                    <div className="cmp-li-name">{d.name}</div>
                    <div className="cmp-li-sub">{d.sub}</div>
                  </div>
                  <div className="cmp-li-price">
                    {((d.rows[CMP_TK[cmpType]] as number) || 0).toLocaleString()}원
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="cmp-right">
            <div className="cmp-right-head">
              <div className="cmp-right-title">비교 결과</div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button className="btn-ghost" onClick={resetSlots}>
                  초기화
                </button>
                <div className="export-wrap" ref={exportWrapRef}>
                  <button
                    className="btn-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExportMenuOpen((o) => !o);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M6 1v7M3 5l3 3 3-3M1 9v1.5a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V9"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    내보내기
                  </button>
                  <div className={`export-menu${exportMenuOpen ? " open" : ""}`}>
                    <div className="export-item" onClick={exportCsv}>
                      <svg viewBox="0 0 14 14" fill="none">
                        <rect
                          x="1"
                          y="1"
                          width="12"
                          height="12"
                          rx="2"
                          stroke="#16a34a"
                          strokeWidth="1.3"
                        />
                      </svg>
                      엑셀 다운로드 (.csv)
                    </div>
                    <div className="export-item" onClick={copyHtml}>
                      <svg viewBox="0 0 14 14" fill="none">
                        <rect
                          x="1"
                          y="3"
                          width="9"
                          height="10"
                          rx="1.5"
                          stroke="#555"
                          strokeWidth="1.3"
                        />
                        <path
                          d="M4 3V2a1 1 0 011-1h6a1 1 0 011 1v8a1 1 0 01-1 1h-1"
                          stroke="#555"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                        />
                      </svg>
                      표 복사 (Confluence·Notion)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="cmp-table-wrap">{renderTable()}</div>

            <div className="cmp-footer">
              <button className="btn-ghost" onClick={resetSlots}>
                초기화
              </button>
              <button className="btn-ghost" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

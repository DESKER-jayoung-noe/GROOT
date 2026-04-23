import { useEffect, useMemo } from "react";

// ── Constants ──────────────────────────────────────────────────────────────

const LOSS = 4;          // mm margin per side
const PIECE_PX = 42;     // scale anchor: piece width renders as 42 px
const MAX_RECTS = 200;

const SHEETS = [
  { id: "4x6", label: "4×6", widthMm: 1220, heightMm: 1830 },
  { id: "4x8", label: "4×8", widthMm: 1220, heightMm: 2440 },
  { id: "6x8", label: "6×8", widthMm: 1830, heightMm: 2440 },
] as const;

const MODES = ["default", "rotated", "mixed"] as const;
type Mode = (typeof MODES)[number];

const ROW_LABEL: Record<Mode, string> = {
  default: "정방향",
  rotated: "90° 회전",
  mixed: "혼합",
};

const COL_MAIN  = "#2A2A2A";
const COL_EXTRA = "#666666";

// ── Calculation ────────────────────────────────────────────────────────────

interface CellData {
  sheetId: string;
  mode: Mode;
  sheetW: number;
  sheetH: number;
  count: number;
  yieldPct: number;
  sheetPrice: number;
  unitPrice: number;
  nx: number; ny: number;
  effW: number; effD: number;
  rightCols: number; rightRows: number;
  bottomCols: number; bottomRows: number;
}

function computeCell(
  sheetW: number, sheetH: number,
  wMm: number, dMm: number,
  mode: Mode, sheetPrice: number
): CellData {
  const effW = wMm + LOSS;
  const effD = dMm + LOSS;
  let count = 0, nx = 0, ny = 0;
  let rightCols = 0, rightRows = 0, bottomCols = 0, bottomRows = 0;

  if (effW > 0 && effD > 0) {
    if (mode === "default") {
      nx = Math.floor(sheetW / effW); ny = Math.floor(sheetH / effD);
      count = nx * ny;
    } else if (mode === "rotated") {
      nx = Math.floor(sheetW / effD); ny = Math.floor(sheetH / effW);
      count = nx * ny;
    } else {
      nx = Math.floor(sheetW / effW); ny = Math.floor(sheetH / effD);
      const remW = sheetW - nx * effW;
      const remH = sheetH - ny * effD;
      rightCols  = remW > 0 ? Math.floor(remW / effD) : 0;
      rightRows  = remW > 0 ? Math.floor(sheetH / effW) : 0;
      bottomCols = nx;
      bottomRows = remH > 0 ? Math.floor(remH / effD) : 0;
      count = nx * ny + rightCols * rightRows + bottomCols * bottomRows;
    }
  }

  const yieldPct = count > 0 && sheetW > 0 && sheetH > 0
    ? (count * effW * effD) / (sheetW * sheetH) * 100 : 0;
  const unitPrice = count > 0 && sheetPrice > 0
    ? Math.ceil(sheetPrice / count) : 0;

  return {
    sheetId: SHEETS.find(s => s.widthMm === sheetW && s.heightMm === sheetH)?.id ?? "4x6",
    mode, sheetW, sheetH, count, yieldPct, sheetPrice, unitPrice,
    nx, ny, effW, effD, rightCols, rightRows, bottomCols, bottomRows,
  };
}

// ── SVG Diagram ────────────────────────────────────────────────────────────

function PlacementSvg({ cell }: { cell: CellData }) {
  const { sheetW, sheetH, nx, ny, effW, effD, mode, rightCols, rightRows, bottomCols, bottomRows } = cell;
  if (effW <= 0 || effD <= 0) return null;

  // scale: piece renders as PIECE_PX px wide
  const scale = PIECE_PX / effW;
  const svgW  = sheetW * scale;
  const svgH  = sheetH * scale;

  const pw = effW * scale; // = PIECE_PX
  const ph = effD * scale;
  const rw = effD * scale;
  const rh = effW * scale;

  const rects: React.SVGProps<SVGRectElement>[] = [];
  const add = (x: number, y: number, w: number, h: number, fill: string, key: string) =>
    rects.push({ x: x + 0.5, y: y + 0.5, width: Math.max(0, w - 1), height: Math.max(0, h - 1), fill, key });

  if (mode === "default") {
    if (nx * ny > MAX_RECTS) add(0, 0, nx * pw, ny * ph, COL_MAIN, "blk");
    else for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) add(c * pw, r * ph, pw, ph, COL_MAIN, `${r}-${c}`);
  } else if (mode === "rotated") {
    if (nx * ny > MAX_RECTS) add(0, 0, nx * rw, ny * rh, COL_EXTRA, "blk");
    else for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) add(c * rw, r * rh, rw, rh, COL_EXTRA, `${r}-${c}`);
  } else {
    const mainWpx = nx * pw, mainHpx = ny * ph;
    if (nx * ny > MAX_RECTS) add(0, 0, mainWpx, mainHpx, COL_MAIN, "main");
    else for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) add(c * pw, r * ph, pw, ph, COL_MAIN, `m-${r}-${c}`);
    if (rightCols > 0 && rightRows > 0) {
      if (rightCols * rightRows > MAX_RECTS) add(mainWpx, 0, rightCols * rw, rightRows * rh, COL_EXTRA, "rblk");
      else for (let r = 0; r < rightRows; r++) for (let c = 0; c < rightCols; c++) add(mainWpx + c * rw, r * rh, rw, rh, COL_EXTRA, `rt-${r}-${c}`);
    }
    if (bottomCols > 0 && bottomRows > 0) {
      if (bottomCols * bottomRows > MAX_RECTS) add(0, mainHpx, bottomCols * pw, bottomRows * ph, COL_EXTRA, "bblk");
      else for (let r = 0; r < bottomRows; r++) for (let c = 0; c < bottomCols; c++) add(c * pw, mainHpx + r * ph, pw, ph, COL_EXTRA, `bt-${r}-${c}`);
    }
  }

  return (
    <svg
      width={svgW} height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden
    >
      <rect x={0} y={0} width={svgW} height={svgH} fill="#ffffff" stroke="#C0C0C0" strokeWidth={1.2} />
      {rects.map(({ key, ...props }) => <rect key={key} {...props} />)}
    </svg>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface Props {
  wMm: number;
  dMm: number;
  boardMaterial: string;
  sheetPriceBySheetId: Record<string, number>;
  selectedKey: string | null;
  onSelect: (sheetId: string, mode: Mode) => void;
}

export function YieldBoardGrid({ wMm, dMm, boardMaterial, sheetPriceBySheetId, selectedKey, onSelect }: Props) {
  const cells = useMemo<CellData[]>(() => {
    if (wMm <= 0 || dMm <= 0) return [];
    return SHEETS.flatMap(sheet =>
      MODES.map(mode =>
        computeCell(sheet.widthMm, sheet.heightMm, wMm, dMm, mode, sheetPriceBySheetId[sheet.id] ?? 0)
      )
    );
  }, [wMm, dMm, sheetPriceBySheetId]);

  const { bestYieldPct, bestUnitPrice } = useMemo(() => {
    const valid  = cells.filter(c => c.count > 0);
    const priced = valid.filter(c => c.unitPrice > 0);
    return {
      bestYieldPct:  valid.length  ? Math.max(...valid.map(c => c.yieldPct))   : 0,
      bestUnitPrice: priced.length ? Math.min(...priced.map(c => c.unitPrice)) : 0,
    };
  }, [cells]);

  const isTopYield = (c: CellData) => c.count > 0 && bestYieldPct > 0 && Math.abs(c.yieldPct - bestYieldPct) < 0.001;
  const isCheapest = (c: CellData) => c.count > 0 && c.unitPrice > 0 && bestUnitPrice > 0 && c.unitPrice === bestUnitPrice;

  // Auto-select best card on entry or when data changes
  useEffect(() => {
    if (cells.length === 0) return;
    const valid = cells.filter(c => c.count > 0);
    if (!valid.length) return;
    if (selectedKey) {
      const [sid, mode] = selectedKey.split("|");
      if (cells.find(c => c.sheetId === sid && c.mode === mode && c.count > 0)) return;
    }
    const bothBest = valid.find(c => isTopYield(c) && isCheapest(c));
    const pick     = bothBest ?? valid.find(c => isTopYield(c)) ?? valid.find(c => isCheapest(c)) ?? valid[0];
    if (pick) onSelect(pick.sheetId, pick.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wMm, dMm, sheetPriceBySheetId]);

  if (wMm <= 0 || dMm <= 0) {
    return (
      <div className="yb-empty">
        자재 규격(W, D)을 입력하면 원장 배치가 표시됩니다
      </div>
    );
  }

  const selKey = selectedKey ?? "";

  return (
    <div className="yb-grid-wrap">
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="yb-header-row">
        <div className="yb-row-label-spacer" />
        {SHEETS.map(sheet => (
          <div key={sheet.id} className="yb-col-header">
            <div className="yb-col-size">{sheet.label}</div>
            <div className="yb-col-price">
              {(sheetPriceBySheetId[sheet.id] ?? 0) > 0
                ? `${(sheetPriceBySheetId[sheet.id]!).toLocaleString("ko-KR")}원/장`
                : "—"}
            </div>
            <div className="yb-col-code">
              {boardMaterial || "—"}
            </div>
          </div>
        ))}
      </div>

      {/* ── Data rows ──────────────────────────────────────────────────── */}
      {MODES.map(mode => (
        <div key={mode} className="yb-data-row">
          {/* Row label */}
          <div className="yb-row-label">
            <span className="yb-row-label-text">{ROW_LABEL[mode]}</span>
          </div>

          {/* 3 cards */}
          {SHEETS.map(sheet => {
            const cell = cells.find(c => c.sheetId === sheet.id && c.mode === mode);
            const key  = `${sheet.id}|${mode}`;
            const selected  = selKey === key;
            const topYield  = cell ? isTopYield(cell) : false;
            const cheapest  = cell ? isCheapest(cell) : false;
            const recommended = topYield || cheapest;

            if (!cell || cell.count === 0) {
              return (
                <div key={key} className="yb-card yb-card--empty">
                  <span className="yb-card-empty-dash">—</span>
                </div>
              );
            }

            return (
              <button
                key={key}
                type="button"
                className={[
                  "yb-card",
                  selected     ? "yb-card--selected"  : "",
                  recommended  ? "yb-card--rec"        : "",
                ].filter(Boolean).join(" ")}
                onClick={() => onSelect(sheet.id, mode)}
              >
                {/* SVG diagram */}
                <div className="yb-svg-wrap">
                  <PlacementSvg cell={cell} />
                </div>

                {/* Info */}
                <div className="yb-info">
                  {/* Tags */}
                  {recommended && (
                    <div className="yb-tags">
                      <span className="yb-tag yb-tag--rec">추천</span>
                      {topYield && <span className="yb-tag yb-tag--yield">수율 최고</span>}
                      {cheapest && <span className="yb-tag yb-tag--price">최저가</span>}
                    </div>
                  )}

                  {/* Unit price */}
                  <div className={`yb-unit-price${recommended ? " yb-unit-price--rec" : ""}`}>
                    {cell.unitPrice > 0 ? `${cell.unitPrice.toLocaleString("ko-KR")}원` : "—"}
                  </div>

                  {/* EA */}
                  <div className="yb-ea">{cell.count} EA</div>

                  {/* Yield */}
                  <div className={`yb-yield${recommended ? " yb-yield--rec" : ""}`}>
                    {cell.yieldPct.toFixed(1)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

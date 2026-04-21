import { memo, useCallback, useMemo } from "react";
import {
  SHEET_SPECS,
  costPerPiece,
  effectiveSize,
  piecesPerSheet,
  placementLayoutGrid,
  yieldPercent,
  type PlacementMode,
} from "../../lib/yield";

type SheetRow = {
  sheetId: string;
  label: string;
  pieces: number;
  layoutCols: number;
  layoutRows: number;
  layoutExtraCols?: number;
  layoutExtraRows?: number;
  yieldPct: number;
  costPerPiece: number;
  sheetPriceWon: number;
  sheetW: number;
  sheetH: number;
};

function buildRow(
  spec: (typeof SHEET_SPECS)[number],
  mode: PlacementMode,
  wMm: number,
  dMm: number,
  sheetPriceWon: number
): SheetRow {
  const pieces = piecesPerSheet(spec.widthMm, spec.heightMm, wMm, dMm, mode);
  const grid = placementLayoutGrid(spec.widthMm, spec.heightMm, wMm, dMm, mode);
  const yieldPct = yieldPercent(pieces, spec.widthMm, spec.heightMm, wMm, dMm);
  const cost = costPerPiece(sheetPriceWon, pieces);
  return {
    sheetId: spec.id,
    label: spec.label,
    pieces,
    layoutCols: grid.cols,
    layoutRows: grid.rows,
    layoutExtraCols: grid.extraCols,
    layoutExtraRows: grid.extraRows,
    yieldPct,
    costPerPiece: cost,
    sheetPriceWon,
    sheetW: spec.widthMm,
    sheetH: spec.heightMm,
  };
}

function priceLine(s: SheetRow, showPrice: boolean): string {
  if (!showPrice) return "—";
  if (s.sheetPriceWon <= 0) return "—";
  if (s.pieces <= 0) return "—";
  return `${Math.round(s.costPerPiece).toLocaleString("ko-KR")}원`;
}

function layoutLabel(cols: number, rows: number, extraCols?: number, extraRows?: number): string {
  if (cols <= 0 || rows <= 0) return "—";
  if (extraCols && extraRows) return `${cols}×${rows} + ${extraCols}×${extraRows}`;
  return `${cols}×${rows}`;
}

/** 원장(mm) 대비 자재 배치 — viewBox=실제 mm 비율 */
function SheetMmPreview({
  sheetW,
  sheetH,
  pieceWMm,
  pieceDMm,
  mode,
}: {
  sheetW: number;
  sheetH: number;
  pieceWMm: number;
  pieceDMm: number;
  mode: PlacementMode;
}) {
  const { effW, effD } = effectiveSize(pieceWMm, pieceDMm);
  if (effW <= 0 || effD <= 0 || sheetW <= 0 || sheetH <= 0) {
    return (
      <div className="flex h-[88px] w-full items-center justify-center rounded-lg bg-[#eef2f7] text-[11px] text-[#8b95a1]">
        배치 없음
      </div>
    );
  }
  const grid = placementLayoutGrid(sheetW, sheetH, pieceWMm, pieceDMm, mode);
  const cols = grid.cols;
  const rows = grid.rows;
  let pw = effW;
  let ph = effD;
  if (mode === "rotated") {
    pw = effD;
    ph = effW;
  }
  const mainCells = cols > 0 && rows > 0 ? cols * rows : 0;
  const pieces = piecesPerSheet(sheetW, sheetH, pieceWMm, pieceDMm, mode);
  const filledMain = Math.min(pieces, mainCells);

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg bg-[#eef2f7] p-2">
      <svg
        viewBox={`0 0 ${sheetW} ${sheetH}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full max-h-[96px] rounded-md border border-[#c9e0fd]"
        style={{ background: "#f7faff" }}
        aria-hidden
      >
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="#e8eef8" stroke="#b8c9df" strokeWidth={Math.max(2, sheetW * 0.0015)} />
        {cols > 0 && rows > 0
          ? Array.from({ length: rows }, (_, r) =>
              Array.from({ length: cols }, (_, c) => {
                const idx = r * cols + c;
                const on = idx < filledMain;
                return (
                  <rect
                    key={`${c}-${r}`}
                    x={c * pw}
                    y={r * ph}
                    width={pw}
                    height={ph}
                    fill={on ? "#93bdf9" : "#dce8f7"}
                    stroke="#3182f6"
                    strokeWidth={Math.max(1, sheetW * 0.001)}
                    rx={Math.max(2, sheetW * 0.002)}
                  />
                );
              })
            ).flat()
          : null}
      </svg>
      <div className="text-center text-[10px] font-semibold tabular-nums text-[#6f7a87]">
        원장 {sheetW}×{sheetH} mm · 자재(손실포함) {Math.round(pw)}×{Math.round(ph)} mm
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 text-[12px] leading-tight">
      <span className="shrink-0 text-[#8b95a1]">{label}</span>
      <span
        className="min-w-[6px] flex-1 self-end"
        style={{
          marginBottom: "4px",
          borderBottom: "1px dotted #dde2ea",
        }}
        aria-hidden
      />
      <span className="shrink-0 font-semibold tabular-nums text-[#0a7a4a]">{value}</span>
    </div>
  );
}

const MODE_SEGMENTS: { mode: PlacementMode; label: string }[] = [
  { mode: "default", label: "기본" },
  { mode: "rotated", label: "90°" },
  { mode: "mixed", label: "혼합" },
];

type Props = {
  pieceWMm: number;
  pieceDMm: number;
  placementMode: PlacementMode;
  onPlacementModeChange: (mode: PlacementMode) => void;
  selectedSheetId: string | null;
  computedSelectedId: string | null;
  recommendedSheetId: string | null;
  onSelectSheetOriented: (sheetId: string, orientation: "default" | "rotated") => void;
  onSelectSheet?: (sheetId: string) => void;
  unavailableSheetIds: string[];
  unitPriceBySheetId: Record<string, number>;
  erpCodeBySheetId?: Record<string, string>;
  showPrice: boolean;
};

/** 원장 선택: 배치모드 토글 + 3열 가로 그리드 + SVG 배치 시각화 */
export const MaterialSheetQuoteStrip = memo(function MaterialSheetQuoteStrip({
  pieceWMm,
  pieceDMm,
  placementMode,
  onPlacementModeChange,
  selectedSheetId,
  computedSelectedId,
  recommendedSheetId,
  onSelectSheetOriented,
  onSelectSheet,
  unavailableSheetIds = [],
  unitPriceBySheetId = {},
  erpCodeBySheetId = {},
  showPrice = false,
}: Props) {
  const effSel = selectedSheetId ?? computedSelectedId;

  const onPick = useCallback(
    (specId: string) => {
      if (placementMode === "mixed") {
        onSelectSheet?.(specId);
        return;
      }
      onSelectSheetOriented(specId, placementMode === "rotated" ? "rotated" : "default");
    },
    [placementMode, onSelectSheet, onSelectSheetOriented]
  );

  const gridStyle = useMemo(
    () =>
      ({
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "12px",
      }) as const,
    []
  );

  return (
    <div className="flex min-h-0 w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-[var(--quote-fg)]">배치모드</span>
        <div className="inline-flex gap-1 rounded-[10px] bg-[#f0f2f5] p-1" role="tablist" aria-label="배치모드">
          {MODE_SEGMENTS.map(({ mode, label }) => {
            const active = placementMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onPlacementModeChange(mode)}
                className="rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors"
                style={
                  active
                    ? {
                        background: "#ffffff",
                        border: "1px solid #e8ecf2",
                        color: "#3182f6",
                      }
                    : {
                        background: "#e8ecf2",
                        border: "1px solid transparent",
                        color: "#6f7a87",
                      }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 w-full" style={gridStyle}>
        {SHEET_SPECS.map((spec) => {
          const unavailable = unavailableSheetIds.includes(spec.id);
          const price = unitPriceBySheetId[spec.id] ?? 0;
          const s = buildRow(spec, placementMode, pieceWMm, pieceDMm, price);
          const sel = !unavailable && spec.id === effSel;
          const rec = !unavailable && recommendedSheetId != null && spec.id === recommendedSheetId;
          const cols = s.layoutCols ?? 0;
          const rows = s.layoutRows ?? 0;
          const erpRaw = erpCodeBySheetId[spec.id];
          const erpDisplay = erpRaw ? erpRaw.replace(/-[^-]*$/, "") : "";

          const cardBorder = unavailable ? "1px solid #e8ecf2" : sel ? "2px solid #3182f6" : "1px solid #e8ecf2";
          const cardBg = unavailable ? "#f5f6f8" : sel ? "#ebf3fe" : "#ffffff";

          return (
            <div
              key={spec.id}
              className="relative flex min-h-0 min-w-0 flex-col rounded-[10px] transition-colors"
              style={{
                border: cardBorder,
                background: cardBg,
                opacity: unavailable ? 0.55 : 1,
              }}
            >
              {unavailable ? (
                <div className="flex flex-col gap-2 p-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <span className="text-[13px] font-bold text-[#8b95a1]">{s.label}</span>
                  </div>
                  <SheetMmPreview
                    sheetW={spec.widthMm}
                    sheetH={spec.heightMm}
                    pieceWMm={pieceWMm}
                    pieceDMm={pieceDMm}
                    mode={placementMode}
                  />
                  <span className="text-[11px] font-semibold text-[#aeb5bc]">선택 불가</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onPick(spec.id)}
                  className="flex w-full flex-col gap-2 rounded-[8px] p-3 text-left"
                  style={{ background: "transparent" }}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <span className="text-[13px] font-bold leading-tight text-[#191f28]">{s.label}</span>
                    {rec ? (
                      <span className="rounded bg-[#3182f6] px-1.5 py-0.5 text-[9px] font-bold text-white">추천</span>
                    ) : null}
                  </div>
                  <SheetMmPreview
                    sheetW={spec.widthMm}
                    sheetH={spec.heightMm}
                    pieceWMm={pieceWMm}
                    pieceDMm={pieceDMm}
                    mode={placementMode}
                  />

                  {/* 중단: 가격 + 통계 */}
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[14px] font-bold leading-none text-[#3182f6] tabular-nums">{priceLine(s, showPrice)}</div>
                    <StatRow label="수율" value={s.pieces > 0 ? `${s.yieldPct.toFixed(1)}%` : "—"} />
                    <StatRow label="배치수량" value={s.pieces > 0 ? `${s.pieces} EA` : "—"} />
                    <StatRow
                      label="가로×세로"
                      value={s.pieces > 0 ? layoutLabel(cols, rows, s.layoutExtraCols, s.layoutExtraRows) : "—"}
                    />
                  </div>

                  {/* 하단 */}
                  {price > 0 ? (
                    <div className="mt-0.5 border-t border-[#e8ecf2] pt-1.5 text-[10px] leading-snug text-[#8b95a1]">
                      <span className="tabular-nums">{price.toLocaleString("ko-KR")}원/장</span>
                      {erpDisplay ? <span className="ml-1">{erpDisplay}</span> : null}
                    </div>
                  ) : null}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

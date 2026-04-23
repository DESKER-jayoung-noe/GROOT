import { memo, useCallback, useMemo, type ReactNode } from "react";
import {
  SHEET_SPECS,
  costPerPiece,
  effectiveSize,
  mixedLayoutParts,
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

function layoutLabelLines(
  cols: number,
  rows: number,
  extraCols?: number,
  extraRows?: number
): { line1: string; line2?: string } | null {
  if (cols <= 0 || rows <= 0) return null;
  if (extraCols && extraRows) return { line1: `${cols}×${rows}`, line2: `+ ${extraCols}×${extraRows}` };
  return { line1: `${cols}×${rows}` };
}

const LEDGER_PREVIEW_BG = "#F0F0F0";
const PREVIEW_MAX_H = 80;

/** 가로 풀너비 원장색 띠 + 그 안에서만 비율 고정 → SVG 레터박스(투명 틈) 제거 */
function LedgerPreviewBounds({ sheetW, sheetH, children }: { sheetW: number; sheetH: number; children: ReactNode }) {
  const wAtMaxH = PREVIEW_MAX_H * (sheetW / sheetH);
  return (
    <div className="w-full bg-[#F0F0F0]" style={{ lineHeight: 0 }}>
      <div
        className="mx-auto"
        style={{
          width: `min(100%, ${wAtMaxH}px)`,
          maxWidth: "100%",
          aspectRatio: `${sheetW} / ${sheetH}`,
          maxHeight: PREVIEW_MAX_H,
          background: LEDGER_PREVIEW_BG,
          lineHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 원장(mm) 대비 자재 배치 — viewBox=실제 mm 비율 */
function SheetMmPreview({
  sheetW,
  sheetH,
  pieceWMm,
  pieceDMm,
  mode,
  squareChrome = false,
}: {
  sheetW: number;
  sheetH: number;
  pieceWMm: number;
  pieceDMm: number;
  mode: PlacementMode;
  squareChrome?: boolean;
}) {
  const { effW, effD } = effectiveSize(pieceWMm, pieceDMm);
  const prevR = squareChrome ? "rounded-none" : "rounded-lg";
  if (effW <= 0 || effD <= 0 || sheetW <= 0 || sheetH <= 0) {
    return (
      <div className="w-full bg-[#F0F0F0]">
        <div className={`flex h-[88px] w-full items-center justify-center ${prevR} text-[11px] text-[#8a8a8a]`}>
          배치 없음
        </div>
      </div>
    );
  }
  const pieces = piecesPerSheet(sheetW, sheetH, pieceWMm, pieceDMm, mode);

  if (mode === "mixed") {
    const m = mixedLayoutParts(sheetW, sheetH, effW, effD);
    type Cell = { x: number; y: number; w: number; h: number };
    const cells: Cell[] = [];
    for (let r = 0; r < m.ny; r++) {
      for (let c = 0; c < m.nx; c++) {
        cells.push({ x: c * effW, y: r * effD, w: effW, h: effD });
      }
    }
    if (m.extraR > 0 && m.rightCols > 0 && m.rightRows > 0) {
      const x0 = m.nx * effW;
      for (let r = 0; r < m.rightRows; r++) {
        for (let c = 0; c < m.rightCols; c++) {
          cells.push({ x: x0 + c * effD, y: r * effW, w: effD, h: effW });
        }
      }
    }
    if (m.extraB > 0 && m.bottomRows > 0) {
      const y0 = m.ny * effD;
      for (let r = 0; r < m.bottomRows; r++) {
        for (let c = 0; c < m.nx; c++) {
          cells.push({ x: c * effW, y: y0 + r * effD, w: effW, h: effD });
        }
      }
    }
    let fillOrder = 0;
    const ledgerFill = LEDGER_PREVIEW_BG;
    const filledFill = "#515151";
    const emptyFill = "#d8d8d8";
    /** 자재 사이는 원장색으로 ‘띠’처럼 보이게 (참고 UI의 백색 간격) */
    const gapStroke = ledgerFill;
    const sw = Math.max(8, sheetW * 0.008);
    return (
      <LedgerPreviewBounds sheetW={sheetW} sheetH={sheetH}>
        <svg
          viewBox={`0 0 ${sheetW} ${sheetH}`}
          preserveAspectRatio="xMidYMid meet"
          overflow="hidden"
          className="block h-full w-full rounded-none"
          style={{ display: "block", outline: "none" }}
          aria-hidden
        >
          <rect x={0} y={0} width={sheetW} height={sheetH} fill={ledgerFill} />
          {cells.map((cell, i) => {
            const on = fillOrder < pieces;
            fillOrder++;
            return (
              <rect
                key={`mix-${i}`}
                x={cell.x}
                y={cell.y}
                width={cell.w}
                height={cell.h}
                fill={on ? filledFill : emptyFill}
                stroke={gapStroke}
                strokeWidth={sw}
                rx={0}
              />
            );
          })}
        </svg>
      </LedgerPreviewBounds>
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
  const filledMain = Math.min(pieces, mainCells);

  const ledgerFill = LEDGER_PREVIEW_BG;
  const pieceOn = "#515151";
  const pieceOff = "#d8d8d8";
  const gapStroke = ledgerFill;
  const pieceStrokeW = Math.max(8, sheetW * 0.008);

  return (
    <LedgerPreviewBounds sheetW={sheetW} sheetH={sheetH}>
      <svg
        viewBox={`0 0 ${sheetW} ${sheetH}`}
        preserveAspectRatio="xMidYMid meet"
        overflow="hidden"
        className="block h-full w-full rounded-none"
        style={{ display: "block", outline: "none" }}
        aria-hidden
      >
        <rect x={0} y={0} width={sheetW} height={sheetH} fill={ledgerFill} />
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
                    fill={on ? pieceOn : pieceOff}
                    stroke={gapStroke}
                    strokeWidth={pieceStrokeW}
                    rx={0}
                  />
                );
              })
            ).flat()
          : null}
      </svg>
    </LedgerPreviewBounds>
  );
}

function StatRow({ label, value, valueLine2 }: { label: string; value: string; valueLine2?: string }) {
  return (
    <div className="flex w-full min-w-0 items-start justify-between gap-2 text-[12px] leading-tight">
      <span className="min-w-0 shrink-0 text-[#8b95a1]">{label}</span>
      <div className="flex min-w-0 max-w-[min(100%,11rem)] flex-col items-end text-right">
        <span className="font-semibold tabular-nums text-[var(--green)]">{value}</span>
        {valueLine2 ? <span className="font-semibold tabular-nums text-[var(--green)]">{valueLine2}</span> : null}
      </div>
    </div>
  );
}

type Props = {
  pieceWMm: number;
  pieceDMm: number;
  placementMode: PlacementMode;
  /** 현재 선택된 절단 방향 */
  cutOrientation: "default" | "rotated";
  /** 기본 행 표시 여부 (기본 true) */
  showDefault: boolean;
  /** 90° 행 표시 여부 (기본 true) */
  showRotated: boolean;
  /** 혼합만 전달됨 */
  onPlacementModeChange: (mode: PlacementMode) => void;
  /** 기본/90°: 행 표시 토글(비혼합). 혼합 중이면 혼합 해제 후 두 행 모두 표시 */
  onToggleRow?: (row: "default" | "rotated") => void;
  /** 자재 편집: 박스·모드바 라운드 제거 */
  squareChrome?: boolean;
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
  cutOrientation,
  showDefault = true,
  showRotated = true,
  onPlacementModeChange,
  onToggleRow,
  selectedSheetId,
  computedSelectedId,
  recommendedSheetId,
  onSelectSheetOriented,
  onSelectSheet,
  unavailableSheetIds = [],
  unitPriceBySheetId = {},
  erpCodeBySheetId = {},
  showPrice = false,
  squareChrome = false,
}: Props) {
  const effSel = selectedSheetId ?? computedSelectedId;

  const onPick = useCallback(
    (specId: string, orient: "default" | "rotated") => {
      if (placementMode === "mixed") {
        onSelectSheet?.(specId);
        return;
      }
      onSelectSheetOriented(specId, orient);
    },
    [placementMode, onSelectSheet, onSelectSheetOriented]
  );

  const grid3 = useMemo(
    () => ({ display: "grid" as const, gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }),
    []
  );
  const gridDual = useMemo(
    () => ({ display: "grid" as const, gridTemplateColumns: "40px repeat(3, minmax(0,1fr))", gap: "8px" }),
    []
  );

  const isMixed = placementMode === "mixed";
  const showDualRows = !isMixed;

  return (
    <div className="flex min-h-0 w-full flex-col gap-3">
      {/* 배치모드: 기본·90° 다중 토글 + 혼합 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--quote-fg)]">배치모드</span>
          <div className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label="배치모드">
            <button
              type="button"
              aria-pressed={showDualRows && showDefault}
              onClick={() => onToggleRow?.("default")}
              className={`quote-qt-kind cursor-pointer font-inherit ${
                showDualRows && showDefault ? "quote-qt-kind--placement-on" : "quote-qt-kind--material"
              }`}
            >
              기본
            </button>
            <button
              type="button"
              aria-pressed={showDualRows && showRotated}
              onClick={() => onToggleRow?.("rotated")}
              className={`quote-qt-kind cursor-pointer font-inherit ${
                showDualRows && showRotated ? "quote-qt-kind--placement-on" : "quote-qt-kind--material"
              }`}
            >
              90°
            </button>
            <button
              type="button"
              aria-pressed={isMixed}
              onClick={() => onPlacementModeChange("mixed")}
              className={`quote-qt-kind cursor-pointer font-inherit ${isMixed ? "quote-qt-kind--placement-on" : "quote-qt-kind--material"}`}
            >
              혼합
            </button>
          </div>
        </div>
      </div>

      {/* 그리드 — 혼합 모드는 단일 행, 그 외엔 기본/90° 두 행 토글 */}
      {isMixed ? (
        <>
          <div className="min-h-0 w-full" style={grid3}>
            {SHEET_SPECS.map((spec) => (
              <OneSheetCell
                key={spec.id}
                spec={spec}
                buildMode="mixed"
                pieceWMm={pieceWMm}
                pieceDMm={pieceDMm}
                showPrice={showPrice}
                price={unitPriceBySheetId[spec.id] ?? 0}
                erpCodeBySheetId={erpCodeBySheetId}
                unavailable={unavailableSheetIds.includes(spec.id)}
                sel={!unavailableSheetIds.includes(spec.id) && spec.id === effSel}
                rec={!unavailableSheetIds.includes(spec.id) && recommendedSheetId != null && spec.id === recommendedSheetId}
                onPick={() => onPick(spec.id, "default")}
                squareChrome={squareChrome}
              />
            ))}
          </div>
          {showPrice ? (
            <div className="min-h-0 w-full" style={grid3}>
              {SHEET_SPECS.map((spec) => {
                const price = unitPriceBySheetId[spec.id] ?? 0;
                const erpRaw = erpCodeBySheetId[spec.id];
                const erpDisplay = erpRaw ? erpRaw.replace(/-[^-]*$/, "") : "";
                const pieces = piecesPerSheet(spec.widthMm, spec.heightMm, pieceWMm, pieceDMm, "mixed");
                const costPer = price > 0 && pieces > 0 ? Math.ceil(costPerPiece(price, pieces)) : 0;
                return (
                  <div key={`mix-p-${spec.id}`} className="text-[10px] leading-snug text-[#8b95a1]">
                    {price > 0 ? (
                      <div className="tabular-nums">
                        {price.toLocaleString("ko-KR")}원/장
                        {costPer > 0 ? (
                          <span className="block text-[9px] text-[#9aa0a6]">자재비 {costPer.toLocaleString("ko-KR")}원/개</span>
                        ) : null}
                      </div>
                    ) : null}
                    {erpDisplay ? <div className="break-all">{erpDisplay}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : (showDefault || showRotated) ? (
        <div className="min-h-0 w-full overflow-x-auto">
          <div className="min-w-[min(100%,320px)]" style={gridDual}>
            {/* 헤더 */}
            <div />
            {SHEET_SPECS.map((spec) => (
              <div key={`h-${spec.id}`} className="px-0.5 text-center text-[11px] font-bold text-[#191f28]">
                {spec.label}
              </div>
            ))}

            {/* 기본 행 */}
            {showDefault ? (
              <>
                <div className="flex items-center pt-1 text-[10px] font-semibold text-[#6f7a87]">기본</div>
                {SHEET_SPECS.map((spec) => (
                  <OneSheetCell
                    key={`d-${spec.id}`}
                    spec={spec}
                    buildMode="default"
                    pieceWMm={pieceWMm}
                    pieceDMm={pieceDMm}
                    showPrice={false}
                    price={unitPriceBySheetId[spec.id] ?? 0}
                    erpCodeBySheetId={erpCodeBySheetId}
                    unavailable={unavailableSheetIds.includes(spec.id)}
                    sel={!unavailableSheetIds.includes(spec.id) && spec.id === effSel && cutOrientation === "default"}
                    rec={
                      !unavailableSheetIds.includes(spec.id) &&
                      recommendedSheetId != null &&
                      spec.id === recommendedSheetId &&
                      cutOrientation === "default"
                    }
                    onPick={() => onPick(spec.id, "default")}
                    squareChrome={squareChrome}
                  />
                ))}
              </>
            ) : null}

            {/* 90° 행 */}
            {showRotated ? (
              <>
                <div className="flex items-center pt-1 text-[10px] font-semibold text-[#6f7a87]">90°</div>
                {SHEET_SPECS.map((spec) => (
                  <OneSheetCell
                    key={`r-${spec.id}`}
                    spec={spec}
                    buildMode="rotated"
                    pieceWMm={pieceWMm}
                    pieceDMm={pieceDMm}
                    showPrice={false}
                    price={unitPriceBySheetId[spec.id] ?? 0}
                    erpCodeBySheetId={erpCodeBySheetId}
                    unavailable={unavailableSheetIds.includes(spec.id)}
                    sel={!unavailableSheetIds.includes(spec.id) && spec.id === effSel && cutOrientation === "rotated"}
                    rec={
                      !unavailableSheetIds.includes(spec.id) &&
                      recommendedSheetId != null &&
                      spec.id === recommendedSheetId &&
                      cutOrientation === "rotated"
                    }
                    onPick={() => onPick(spec.id, "rotated")}
                    squareChrome={squareChrome}
                  />
                ))}
              </>
            ) : null}

            {/* 하단: 가격 + ERP 코드 — 열 단위로 표시 */}
            {showPrice ? (
              <>
                <div />
                {SHEET_SPECS.map((spec) => {
                  const price = unitPriceBySheetId[spec.id] ?? 0;
                  const erpRaw = erpCodeBySheetId[spec.id];
                  const erpDisplay = erpRaw ? erpRaw.replace(/-[^-]*$/, "") : "";
                  return (
                    <div key={`p-${spec.id}`} className="pt-1 text-[10px] leading-snug text-[#8b95a1]">
                      {price > 0 ? <div className="tabular-nums">{price.toLocaleString("ko-KR")}원/장</div> : null}
                      {erpDisplay ? <div className="break-all">{erpDisplay}</div> : null}
                    </div>
                  );
                })}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-[#8b95a1]">기본 또는 90° 행을 켜주세요.</p>
      )}
    </div>
  );
});

type OneSheetCellProps = {
  spec: (typeof SHEET_SPECS)[number];
  buildMode: PlacementMode;
  pieceWMm: number;
  pieceDMm: number;
  showPrice: boolean;
  price: number;
  erpCodeBySheetId: Record<string, string>;
  unavailable: boolean;
  sel: boolean;
  rec: boolean;
  onPick: () => void;
  squareChrome?: boolean;
};

function OneSheetCell({
  spec,
  buildMode,
  pieceWMm,
  pieceDMm,
  showPrice: _showPrice,
  price,
  erpCodeBySheetId: _erpCodeBySheetId,
  unavailable,
  sel,
  rec,
  onPick,
  squareChrome = false,
}: OneSheetCellProps) {
  const s = buildRow(spec, buildMode, pieceWMm, pieceDMm, price);
  const cols = s.layoutCols ?? 0;
  const rows = s.layoutRows ?? 0;
  const mixedMeta = useMemo(() => {
    if (buildMode !== "mixed") return null;
    const { effW, effD } = effectiveSize(pieceWMm, pieceDMm);
    if (effW <= 0 || effD <= 0) return null;
    const mix = mixedLayoutParts(spec.widthMm, spec.heightMm, effW, effD);
    const baseCount = mix.main;
    const rotatedCount = Math.max(0, s.pieces - baseCount);
    return `기본${baseCount}+90°${rotatedCount}`;
  }, [buildMode, pieceWMm, pieceDMm, spec.widthMm, spec.heightMm, s.pieces]);
  const cardBorder = unavailable ? "1px solid #e8ecf2" : sel ? "2px solid #282828" : "1px solid #e8ecf2";
  /** 선택 시에도 본문은 흰 배경 — 원장 그래프만 #F0F0F0 (회색 칠 전체 박스 제거) */
  const cardBg = unavailable ? "#f5f6f8" : "#ffffff";
  const cellR = squareChrome ? "rounded-none" : "rounded-[10px]";
  const btnR = squareChrome ? "rounded-none" : "rounded-[8px]";
  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-col ${cellR} transition-colors`}
      style={{ border: cardBorder, background: cardBg, opacity: unavailable ? 0.55 : 1 }}
    >
      {unavailable ? (
        <div className={`flex flex-col gap-0 py-2 sm:py-3 ${btnR}`}>
          <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-1.5 sm:px-3 sm:pb-2">
            <span className="text-[12px] font-bold text-[#8b95a1] sm:text-[13px]">{s.label}</span>
          </div>
          <div className="w-full bg-[#F0F0F0]">
            <SheetMmPreview
              sheetW={spec.widthMm}
              sheetH={spec.heightMm}
              pieceWMm={pieceWMm}
              pieceDMm={pieceDMm}
              mode={buildMode}
              squareChrome={squareChrome}
            />
          </div>
          <span className="px-2 pt-1.5 text-[10px] font-semibold text-[#aeb5bc] sm:px-3 sm:pt-2 sm:text-[11px]">선택 불가</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          className={`flex w-full min-w-0 flex-col gap-0 ${btnR} py-2 text-left [-webkit-tap-highlight-color:transparent] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-0 sm:py-3`}
          style={{ background: "transparent" }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-1.5 sm:px-3 sm:pb-2">
            <span className="text-[12px] font-bold leading-tight text-[#191f28] sm:text-[13px]">{s.label}</span>
            {rec ? (
              <span className="rounded bg-[#4a4a4a] px-1.5 py-0.5 text-[8px] font-bold text-white sm:text-[9px]">추천</span>
            ) : null}
            {mixedMeta ? <span className="text-[9px] text-[#60a5fa]">{mixedMeta}</span> : null}
          </div>
          <SheetMmPreview
            sheetW={spec.widthMm}
            sheetH={spec.heightMm}
            pieceWMm={pieceWMm}
            pieceDMm={pieceDMm}
            mode={buildMode}
            squareChrome={squareChrome}
          />
          <div className="flex flex-col gap-1 px-2 pt-1.5 sm:px-3 sm:pt-2">
            <StatRow label="수율" value={s.pieces > 0 ? `${s.yieldPct.toFixed(1)}%` : "—"} />
            <StatRow label="배치수량" value={s.pieces > 0 ? `${s.pieces} EA` : "—"} />
            {(() => {
              const lay = layoutLabelLines(cols, rows, s.layoutExtraCols, s.layoutExtraRows);
              return (
                <StatRow
                  label="가로×세로"
                  value={s.pieces > 0 ? (lay?.line1 ?? "—") : "—"}
                  valueLine2={s.pieces > 0 ? lay?.line2 : undefined}
                />
              );
            })()}
          </div>
        </button>
      )}
    </div>
  );
}

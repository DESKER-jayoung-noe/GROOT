import { memo, useCallback } from "react";
import { YieldBoardDiagram } from "./YieldBoardDiagram";

type PlacementMode = "default" | "rotated" | "mixed";

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

type Props = {
  sheets: SheetRow[] | undefined;
  pieceWMm: number;
  pieceDMm: number;
  placementMode: PlacementMode;
  selectedSheetId: string | null;
  computedSelectedId: string | null;
  recommendedSheetId: string | null;
  onSelectSheet: (id: string) => void;
  /** 현재 두께에서 가격 데이터가 없는 원장 ID 목록 */
  unavailableSheetIds?: string[];
  /** sheetId → 원장 단가 (장당) */
  unitPriceBySheetId?: Record<string, number>;
  /** sheetId → ERP 자재코드 */
  erpCodeBySheetId?: Record<string, string>;
  /** H(T)가 선택된 경우에만 true — false면 가격을 "—"로 표시 */
  showPrice?: boolean;
};

function priceLine(s: SheetRow, showPrice: boolean): string {
  if (!showPrice) return "—";
  if (s.sheetPriceWon <= 0) return "—";
  if (s.pieces <= 0) return "—";
  return `${Math.round(s.costPerPiece).toLocaleString("ko-KR")}원`;
}

/**
 * 한 줄에 보이는 모든 원장에 동일 mm→px 비율 적용 → 4×6·4×8(가로 동일), 4×8·6×8(세로 동일)이 실제 비율과 같게 맞춰짐.
 */
function unifiedPxPerMm(sheets: { sheetW: number; sheetH: number }[], maxBoxW: number, maxBoxH: number) {
  const maxW = Math.max(...sheets.map((s) => s.sheetW));
  const maxH = Math.max(...sheets.map((s) => s.sheetH));
  if (!Number.isFinite(maxW) || !Number.isFinite(maxH) || maxW <= 0 || maxH <= 0) return 0.05;
  return Math.min(maxBoxW / maxW, maxBoxH / maxH);
}

export const MaterialSheetCards = memo(function MaterialSheetCards({
  sheets,
  pieceWMm,
  pieceDMm,
  placementMode,
  selectedSheetId,
  computedSelectedId,
  recommendedSheetId,
  onSelectSheet,
  unavailableSheetIds = [],
  unitPriceBySheetId = {},
  erpCodeBySheetId = {},
  showPrice = false,
}: Props) {
  const onPick = useCallback(
    (id: string) => {
      onSelectSheet(id);
    },
    [onSelectSheet]
  );

  if (!sheets?.length) return null;

  const pxPerMm = unifiedPxPerMm(sheets, 132, 124);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
      {sheets.map((s) => {
        const unavailable = unavailableSheetIds.includes(s.sheetId);
        const sel = !unavailable && s.sheetId === (selectedSheetId ?? computedSelectedId);
        const rec = !unavailable && recommendedSheetId != null && s.sheetId === recommendedSheetId;
        const cols = s.layoutCols ?? 0;
        const rows = s.layoutRows ?? 0;
        const extraCols = s.layoutExtraCols;
        const extraRows = s.layoutExtraRows;
        const dia = {
          width: Math.max(1, Math.round(s.sheetW * pxPerMm)),
          height: Math.max(1, Math.round(s.sheetH * pxPerMm)),
        };
        return (
          <div
            key={s.sheetId}
            className={`relative flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border ${
              unavailable
                ? "border-[#e8eaed] bg-[#f5f6f8] opacity-60"
                : sel
                ? "bg-white border-[#3182f6] ring-2 ring-[#3182f6]/25"
                : "bg-white border-[#e8eaed]"
            }`}
          >
            {sel && (
              <div
                className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#3182f6] text-[10px] font-bold text-white shadow-sm"
                aria-hidden
              >
                ✓
              </div>
            )}
            {unavailable ? (
              /* 선택 불가 표시 */
              <div className="flex min-h-0 w-full flex-1 flex-row items-center gap-3 rounded-2xl p-3 sm:p-3.5">
                <div className="flex min-w-0 w-[46%] shrink-0 flex-col gap-2 sm:w-[42%]">
                  <span className="text-[15px] font-bold leading-snug tracking-tight text-[#aeb5bc]">{s.label}</span>
                  <span className="text-[12px] font-semibold text-[#c0c8d4]">선택 불가</span>
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch opacity-40">
                  <div className="max-w-full shrink-0 overflow-hidden" style={{ width: dia.width, height: dia.height, maxWidth: "100%" }}>
                    <YieldBoardDiagram
                      sheetW={s.sheetW}
                      sheetH={s.sheetH}
                      pieceWMm={0}
                      pieceDMm={0}
                      mode={placementMode}
                      className="h-full w-full"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onPick(s.sheetId)}
                className={`flex min-h-0 w-full flex-1 flex-col rounded-2xl p-3 text-left transition-colors sm:p-3.5 ${
                  sel ? "bg-white" : "bg-white hover:bg-[#fafbfc]"
                }`}
              >
                {/* 상단: 스펙 + 도면 */}
                <div className="flex min-h-0 w-full flex-1 flex-row items-stretch gap-3">
                  {/* 좌: 스펙 */}
                  <div className="flex min-w-0 w-[46%] shrink-0 flex-col justify-between gap-2.5 pr-0.5 sm:w-[42%]">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[15px] font-bold leading-snug tracking-tight text-[#191f28]">{s.label}</span>
                        {rec && (
                          <span className="rounded-md bg-[#3182f6] px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                            추천
                          </span>
                        )}
                      </div>
                      <div className="text-[14px] font-bold leading-tight text-[#3182f6] tabular-nums">{priceLine(s, showPrice)}</div>
                    </div>
                    <div className="space-y-1.5 text-[11px] leading-snug text-[#6f7a87]">
                      <div className="flex justify-between gap-2">
                        <span>수율</span>
                        <span className="shrink-0 font-semibold tabular-nums text-[#16b374]">{s.yieldPct.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>배치수량</span>
                        <span className="shrink-0 font-semibold tabular-nums text-[#16b374]">
                          {s.pieces > 0 ? `${s.pieces} EA` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="min-w-0">가로×세로</span>
                        <span className="shrink-0 font-semibold tabular-nums text-[#16b374]">
                          {s.pieces > 0 ? (
                            extraCols && extraRows ? (
                              <span className="flex flex-col items-end leading-tight">
                                <span>{cols}×{rows}</span>
                                <span className="text-[#a8d5b5]">{extraCols}×{extraRows}</span>
                              </span>
                            ) : `${cols}×${rows}`
                          ) : "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 우: 원장 도면 */}
                  <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
                    <div className="max-w-full shrink-0 overflow-hidden" style={{ width: dia.width, height: dia.height, maxWidth: "100%" }}>
                      <YieldBoardDiagram
                        sheetW={s.sheetW}
                        sheetH={s.sheetH}
                        pieceWMm={pieceWMm}
                        pieceDMm={pieceDMm}
                        mode={placementMode}
                        className="h-full w-full"
                      />
                    </div>
                  </div>
                </div>

                {/* 하단: 원장 단가 + ERP 코드 — 전체 너비 한 줄 */}
                {unitPriceBySheetId[s.sheetId] != null && (
                  <div className="mt-2 w-full border-t border-[#f0f2f5] pt-1.5 text-left text-[10px] leading-tight text-[#b8bfc9]">
                    <span className="tabular-nums">{unitPriceBySheetId[s.sheetId]!.toLocaleString("ko-KR")}원/장</span>
                    {erpCodeBySheetId[s.sheetId] && (
                      <span className="ml-1.5 text-[#c8cdd4]">
                        {erpCodeBySheetId[s.sheetId]!.replace(/-[^-]*$/, "")}
                      </span>
                    )}
                  </div>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

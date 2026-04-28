/**
 * 두께(T) × 원장 사이즈별 장당 단가 (원) — ERP DB 기준 (WW LPM/O PB)
 * UploadFlow / MaterialEditDialog / ReviewModal 에서 공유.
 */
import type { SheetId } from "./yield";

const _PB_15 = { "4x6": 23270, "4x8": 32800, "6x8": 23270 };
const _PB_18 = { "4x6": 16620, "4x8": 23270, "6x8": 23770 };
const _PB_22 = { "4x8": 19460, "6x8": 23270 };
const _PB_25 = { "4x8": 23270 };
const _PB_28 = { "4x8": 23270, "6x8": 23270 };

export const SHEET_PRICES_BY_T: Partial<Record<number, Record<string, number>>> = {
  12: { "4x8": 19460 },
  15: _PB_15,    15.5: _PB_15,
  18: _PB_18,    18.5: _PB_18,
  22: _PB_22,    22.5: _PB_22,
  25: _PB_25,
  28: _PB_28,    28.5: _PB_28,
};

export function getSheetPricesForT(t: number): Partial<Record<SheetId, number>> {
  // 정수와 .5 둘 다 매핑 (T_norm = floor(t) 기준)
  const exact = SHEET_PRICES_BY_T[t];
  if (exact) return exact as Partial<Record<SheetId, number>>;
  const floored = SHEET_PRICES_BY_T[Math.floor(t)];
  return (floored ?? {}) as Partial<Record<SheetId, number>>;
}

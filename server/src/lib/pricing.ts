/** 재단비(원) — 원장비교 선택 원장의 배치수량(EA) 구간별 고정 단가 */
export function cuttingFeeFromPlacementCount(pieces: number): number {
  const n = Math.floor(Number(pieces));
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 46) return 150;
  if (n >= 33) return 200;
  if (n >= 21) return 250;
  if (n >= 13) return 300;
  if (n >= 9) return 350;
  if (n >= 5) return 500;
  if (n >= 3) return 800;
  return 1000;
}

/** 핫멜트 두께별 ㎡당 (원) — PRD 8-3 */
export function hotmeltPricePerM2(thicknessMm: number): number {
  const t = thicknessMm;
  if (t <= 12) return 72;
  if (t <= 15) return 85;
  if (t <= 18) return 99;
  if (t <= 22) return 116;
  return 143;
}

/** 관리비율 기본 — PRD 8-5 */
export const DEFAULT_ADMIN_RATE = 0.05;

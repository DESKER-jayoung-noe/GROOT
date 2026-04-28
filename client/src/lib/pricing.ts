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

/** 핫멜트 단가 (원/㎡) — 두께별 ERP DB 기준 */
export function hotmeltPricePerM2(thicknessMm: number): number {
  const t = thicknessMm;
  if (t <= 12) return 72;
  if (t <= 15) return 85;
  if (t <= 18) return 99;
  if (t <= 22) return 116;
  if (t <= 28) return 143;
  if (t <= 30) return 152;
  if (t <= 33) return 166;
  if (t <= 37) return 188;
  if (t <= 40) return 197;
  return 215; // 44T+
}

export const DEFAULT_ADMIN_RATE = 0.05;

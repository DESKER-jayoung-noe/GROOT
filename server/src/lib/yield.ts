/** 원장 규격 및 표시명 — 국내 일반 PB/LPM 원장(피트 환산 mm, 가공 여유 제외) */
export const SHEET_SPECS = [
  { id: "4x6", label: "4×6", widthMm: 1220, heightMm: 1830 },
  { id: "4x8", label: "4×8", widthMm: 1220, heightMm: 2440 },
  { id: "6x8", label: "6×8", widthMm: 1830, heightMm: 2440 },
] as const;

export type SheetId = (typeof SHEET_SPECS)[number]["id"];

export type PlacementMode = "default" | "rotated" | "mixed";

/** 자재 1개당 톱질 손실: 커팅 간격(5+5) - 원장 상하 여백(2+2) = 8 */
const LOSS_MM = 8;

export function effectiveSize(wMm: number, dMm: number) {
  return { effW: wMm + LOSS_MM, effD: dMm + LOSS_MM };
}

function countDefault(sw: number, sh: number, effW: number, effD: number) {
  const nx = Math.floor(sw / effW);
  const ny = Math.floor(sh / effD);
  return { count: nx * ny, nx, ny };
}

/** 혼합 배치 시 격자·우측(회전)·하단(기본) 조각 수 (시각화·라벨용) */
export function mixedLayoutParts(sw: number, sh: number, effW: number, effD: number) {
  const { nx, ny } = countDefault(sw, sh, effW, effD);
  const remW = sw - nx * effW;
  const remH = sh - ny * effD;
  const rightCols = remW > 0 ? Math.floor(remW / effD) : 0;
  const rightRows = remW > 0 ? Math.floor(sh / effW) : 0;
  const bottomRows = remH > 0 ? Math.floor(remH / effD) : 0;
  const main = nx * ny;
  const extraR = rightCols * rightRows;
  const extraB = nx * bottomRows;
  return {
    nx,
    ny,
    remW,
    remH,
    main,
    extraR,
    extraB,
    total: main + extraR + extraB,
    rightCols,
    rightRows,
    bottomRows,
  };
}

/** 카드에 표시할 배치 요약 (실제 piecesPerSheet·수율과 일치) */
export function layoutLabelForPlacement(
  sheetW: number,
  sheetH: number,
  wMm: number,
  dMm: number,
  mode: PlacementMode
): string {
  if (wMm <= 0 || dMm <= 0) return "—";
  const { effW, effD } = effectiveSize(wMm, dMm);
  if (effW <= 0 || effD <= 0) return "—";

  if (mode === "default") {
    const { nx, ny, count } = countDefault(sheetW, sheetH, effW, effD);
    return count <= 0 ? "배치 불가" : `${nx}×${ny} = ${count} EA`;
  }
  if (mode === "rotated") {
    const { nx, ny, count } = countDefault(sheetW, sheetH, effD, effW);
    return count <= 0 ? "배치 불가" : `${nx}×${ny} = ${count} EA`;
  }

  const m = mixedLayoutParts(sheetW, sheetH, effW, effD);
  if (m.total <= 0) return "배치 불가";
  const extra = m.extraR + m.extraB;
  if (extra === 0) return `${m.nx}×${m.ny} = ${m.total} EA`;
  return `${m.total} EA (격자 ${m.nx}×${m.ny} + 추가 ${extra})`;
}

function countRotated(sw: number, sh: number, effW: number, effD: number) {
  return countDefault(sw, sh, effD, effW);
}

/**
 * 혼합(mixed): 기본 배치(격자)와 90° 회전 배치를 섞어 원장 안에 자재를 최대한 많이 넣은 결과.
 * (우측 잔여에 회전 배치 + 하단 잔여에 기본 배치를 포함)
 */
function countMixed(sw: number, sh: number, effW: number, effD: number) {
  const m = mixedLayoutParts(sw, sh, effW, effD);
  return m.total;
}

/** 원장별 카드에 표시할 가로·세로 칸 수 (혼합은 주 격자 + 추가 격자 정보 포함) */
export function placementLayoutGrid(
  sheetW: number,
  sheetH: number,
  wMm: number,
  dMm: number,
  mode: PlacementMode
): { cols: number; rows: number; extraCols?: number; extraRows?: number } {
  if (wMm <= 0 || dMm <= 0) return { cols: 0, rows: 0 };
  const { effW, effD } = effectiveSize(wMm, dMm);
  if (effW <= 0 || effD <= 0) return { cols: 0, rows: 0 };
  if (mode === "default") {
    const { nx, ny } = countDefault(sheetW, sheetH, effW, effD);
    return { cols: nx, rows: ny };
  }
  if (mode === "rotated") {
    const { nx, ny } = countDefault(sheetW, sheetH, effD, effW);
    return { cols: nx, rows: ny };
  }
  const m = mixedLayoutParts(sheetW, sheetH, effW, effD);
  const extra = m.extraR > 0
    ? { extraCols: m.rightCols, extraRows: m.rightRows }
    : m.extraB > 0
      ? { extraCols: m.nx, extraRows: m.bottomRows }
      : {};
  return { cols: m.nx, rows: m.ny, ...extra };
}

export function piecesPerSheet(
  sheetW: number,
  sheetH: number,
  wMm: number,
  dMm: number,
  mode: PlacementMode
): number {
  if (wMm <= 0 || dMm <= 0) return 0;
  const { effW, effD } = effectiveSize(wMm, dMm);
  if (effW <= 0 || effD <= 0) return 0;
  if (mode === "default") return countDefault(sheetW, sheetH, effW, effD).count;
  if (mode === "rotated") return countRotated(sheetW, sheetH, effW, effD).count;
  return countMixed(sheetW, sheetH, effW, effD);
}

export function sheetAreaMm2(sheetW: number, sheetH: number) {
  return sheetW * sheetH;
}

export function pieceAreaMm2(wMm: number, dMm: number) {
  return wMm * dMm;
}

export function yieldPercent(
  pieces: number,
  sheetW: number,
  sheetH: number,
  wMm: number,
  dMm: number
) {
  const sa = sheetAreaMm2(sheetW, sheetH);
  if (sa <= 0) return 0;
  return (pieces * pieceAreaMm2(wMm, dMm)) / sa * 100;
}

export function costPerPiece(sheetPriceWon: number, pieces: number) {
  if (pieces <= 0) return 0;
  return sheetPriceWon / pieces;
}

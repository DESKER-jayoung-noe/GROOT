export const SHEET_SPECS = [
  { id: "4x6", label: "4×6", widthMm: 1220, heightMm: 1830 },
  { id: "4x8", label: "4×8", widthMm: 1220, heightMm: 2440 },
  { id: "6x8", label: "6×8", widthMm: 1830, heightMm: 2440 },
] as const;

export type SheetId = (typeof SHEET_SPECS)[number]["id"];

export type PlacementMode = "default" | "rotated" | "mixed";

const LOSS_MM = 8;

export function effectiveSize(wMm: number, dMm: number) {
  return { effW: wMm + LOSS_MM, effD: dMm + LOSS_MM };
}

function countDefault(sw: number, sh: number, effW: number, effD: number) {
  const nx = Math.floor(sw / effW);
  const ny = Math.floor(sh / effD);
  return { count: nx * ny, nx, ny };
}

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
  return { nx, ny, remW, remH, main, extraR, extraB, total: main + extraR + extraB, rightCols, rightRows, bottomRows };
}

export function layoutLabelForPlacement(
  sheetW: number, sheetH: number, wMm: number, dMm: number, mode: PlacementMode
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

function countMixed(sw: number, sh: number, effW: number, effD: number) {
  const m = mixedLayoutParts(sw, sh, effW, effD);
  return m.total;
}

export function placementLayoutGrid(
  sheetW: number, sheetH: number, wMm: number, dMm: number, mode: PlacementMode
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
  sheetW: number, sheetH: number, wMm: number, dMm: number, mode: PlacementMode
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

export function yieldPercent(pieces: number, sheetW: number, sheetH: number, wMm: number, dMm: number) {
  const sa = sheetAreaMm2(sheetW, sheetH);
  if (sa <= 0) return 0;
  return (pieces * pieceAreaMm2(wMm, dMm)) / sa * 100;
}

export function costPerPiece(sheetPriceWon: number, pieces: number) {
  if (pieces <= 0) return 0;
  return sheetPriceWon / pieces;
}

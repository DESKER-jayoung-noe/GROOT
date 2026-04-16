/** 서버 `server/src/lib/yield.ts` 와 동일한 로스·배치 규칙 (미리보기 시각화용) */
export const LOSS_MM = 5;

export type DiagramMode = "default" | "rotated" | "mixed";

export function effectiveSize(wMm: number, dMm: number) {
  return { effW: wMm + LOSS_MM, effD: dMm + LOSS_MM };
}

export function countDefault(sw: number, sh: number, effW: number, effD: number) {
  const nx = Math.floor(sw / effW);
  const ny = Math.floor(sh / effD);
  return { count: nx * ny, nx, ny };
}

/** 서버 `mixedLayoutParts` 와 동일 */
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

/** yield.ts `countMixed` 와 동일한 총 개수 */
export function countMixed(sw: number, sh: number, effW: number, effD: number) {
  return mixedLayoutParts(sw, sh, effW, effD).total;
}

export type LayoutRegionsMm =
  | {
      mode: "default" | "rotated";
      nx: number;
      ny: number;
      pw: number;
      ph: number;
      usedW: number;
      usedH: number;
    }
  | {
      mode: "mixed";
      nx: number;
      ny: number;
      effW: number;
      effD: number;
      mainUsedW: number;
      mainUsedH: number;
      remW: number;
      remH: number;
    };

/** mm 좌표계에서 채울 영역만 계산 (집약 모드 폴백용) */
export function layoutRegionsMm(
  sheetW: number,
  sheetH: number,
  pieceWMm: number,
  pieceDMm: number,
  mode: DiagramMode
): LayoutRegionsMm | null {
  if (pieceWMm <= 0 || pieceDMm <= 0) return null;
  const { effW, effD } = effectiveSize(pieceWMm, pieceDMm);
  if (effW <= 0 || effD <= 0) return null;

  if (mode === "mixed") {
    const { nx, ny, remW, remH } = mixedLayoutParts(sheetW, sheetH, effW, effD);
    return {
      mode: "mixed",
      nx,
      ny,
      effW,
      effD,
      mainUsedW: nx * effW,
      mainUsedH: ny * effD,
      remW,
      remH,
    };
  }

  const useRot = mode === "rotated";
  const pw = useRot ? effD : effW;
  const ph = useRot ? effW : effD;
  const nx = Math.floor(sheetW / pw);
  const ny = Math.floor(sheetH / ph);
  return {
    mode: mode === "rotated" ? "rotated" : "default",
    nx,
    ny,
    pw,
    ph,
    usedW: nx * pw,
    usedH: ny * ph,
  };
}

/** 격자 칸 수 (성능 상한 판단) */
export function estimatedPieceDrawCount(
  sheetW: number,
  sheetH: number,
  pieceWMm: number,
  pieceDMm: number,
  mode: DiagramMode
): number {
  if (pieceWMm <= 0 || pieceDMm <= 0) return 0;
  const { effW, effD } = effectiveSize(pieceWMm, pieceDMm);
  if (effW <= 0 || effD <= 0) return 0;
  if (mode === "mixed") return mixedLayoutParts(sheetW, sheetH, effW, effD).total;
  const pw = mode === "rotated" ? effD : effW;
  const ph = mode === "rotated" ? effW : effD;
  const nx = Math.floor(sheetW / pw);
  const ny = Math.floor(sheetH / ph);
  return nx * ny;
}

import { memo, useEffect, useRef, useState } from "react";
import {
  effectiveSize,
  estimatedPieceDrawCount,
  layoutRegionsMm,
  mixedLayoutParts,
  type DiagramMode,
} from "./yieldLayoutMm";

type Props = {
  sheetW: number;
  sheetH: number;
  pieceWMm: number;
  pieceDMm: number;
  mode: DiagramMode;
  className?: string;
};

const MAX_PIECE_RECTS = 2800;

const COL_MAIN = "rgba(147, 197, 253, 0.92)";
const COL_MAIN_STROKE = "#2563eb";
const COL_RIGHT = "rgba(34, 197, 94, 0.55)";
const COL_RIGHT_STROKE = "#16a34a";
const COL_BOTTOM = "rgba(56, 189, 248, 0.55)";
const COL_BOTTOM_STROKE = "#0ea5e9";
const COL_SCRAP = "rgba(209, 213, 219, 0.55)";

function draw(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  sheetW: number,
  sheetH: number,
  pieceWMm: number,
  pieceDMm: number,
  mode: DiagramMode
) {
  ctx.clearRect(0, 0, cssW, cssH);
  /** 투명 영역이 부모(따뜻한 톤 배경 등)를 비추지 않도록 */
  ctx.fillStyle = "#F0F0F0";
  ctx.fillRect(0, 0, cssW, cssH);

  const { effW, effD } = effectiveSize(pieceWMm, pieceDMm);
  if (effW <= 0 || effD <= 0) return;

  const pad = 4;
  const scale = Math.min((cssW - pad * 2) / sheetW, (cssH - pad * 2) / sheetH);
  const bw = sheetW * scale;
  const bh = sheetH * scale;
  const ox = (cssW - bw) / 2;
  const oy = (cssH - bh) / 2;

  const R = (mx: number, my: number, mw: number, mh: number) => ({
    x: ox + mx * scale,
    y: oy + my * scale,
    w: mw * scale,
    h: mh * scale,
  });

  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox, oy, bw, bh);

  const totalPieces = estimatedPieceDrawCount(sheetW, sheetH, pieceWMm, pieceDMm, mode);
  if (totalPieces <= 0) return;

  const lineW = Math.max(0.35, Math.min(1.2, scale * 0.4));

  if (totalPieces > MAX_PIECE_RECTS) {
    const regions = layoutRegionsMm(sheetW, sheetH, pieceWMm, pieceDMm, mode);
    if (!regions) return;
    if (regions.mode === "mixed") {
      const { mainUsedW, mainUsedH, remW, remH, nx, ny } = regions;
      if (nx > 0 && ny > 0 && mainUsedW > 0.5 && mainUsedH > 0.5) {
        const main = R(0, 0, mainUsedW, mainUsedH);
        ctx.fillStyle = COL_MAIN;
        ctx.fillRect(main.x, main.y, main.w, main.h);
      }
      if (remH > 0 && nx > 0) {
        const bot = R(0, mainUsedH, mainUsedW, remH);
        ctx.fillStyle = COL_BOTTOM;
        ctx.fillRect(bot.x, bot.y, bot.w, bot.h);
      }
      if (remW > 0) {
        const right = R(mainUsedW, 0, remW, sheetH);
        ctx.fillStyle = COL_RIGHT;
        ctx.fillRect(right.x, right.y, right.w, right.h);
      }
    } else {
      const { usedW, usedH, nx, ny } = regions;
      if (nx > 0 && ny > 0) {
        const used = R(0, 0, usedW, usedH);
        ctx.fillStyle = COL_MAIN;
        ctx.fillRect(used.x, used.y, used.w, used.h);
      }
      if (usedW < sheetW - 0.5) {
        const r = R(usedW, 0, sheetW - usedW, sheetH);
        ctx.fillStyle = COL_SCRAP;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      if (usedH < sheetH - 0.5) {
        const b = R(0, usedH, usedW, sheetH - usedH);
        ctx.fillStyle = "rgba(209, 213, 219, 0.45)";
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
    }
    return;
  }

  if (mode === "default" || mode === "rotated") {
    const pw = mode === "rotated" ? effD : effW;
    const ph = mode === "rotated" ? effW : effD;
    const nx = Math.floor(sheetW / pw);
    const ny = Math.floor(sheetH / ph);
    const usedW = nx * pw;
    const usedH = ny * ph;

    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const p = R(ix * pw, iy * ph, pw, ph);
        ctx.fillStyle = COL_MAIN;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = COL_MAIN_STROKE;
        ctx.lineWidth = lineW;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
      }
    }

    if (usedW < sheetW - 0.5) {
      const r = R(usedW, 0, sheetW - usedW, sheetH);
      ctx.fillStyle = COL_SCRAP;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    if (usedH < sheetH - 0.5) {
      const b = R(0, usedH, usedW, sheetH - usedH);
      ctx.fillStyle = "rgba(209, 213, 219, 0.45)";
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    return;
  }

  // mixed — 서버 yield.ts countMixed / mixedLayoutParts 와 동일
  const m = mixedLayoutParts(sheetW, sheetH, effW, effD);
  const { nx, ny, rightCols, rightRows, bottomRows } = m;
  const mainUsedW = nx * effW;
  const mainUsedH = ny * effD;

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const p = R(ix * effW, iy * effD, effW, effD);
      ctx.fillStyle = COL_MAIN;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = COL_MAIN_STROKE;
      ctx.lineWidth = lineW;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
  }

  for (let r = 0; r < rightRows; r++) {
    for (let c = 0; c < rightCols; c++) {
      const p = R(mainUsedW + c * effD, r * effW, effD, effW);
      ctx.fillStyle = COL_RIGHT;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = COL_RIGHT_STROKE;
      ctx.lineWidth = lineW;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
  }

  for (let r = 0; r < bottomRows; r++) {
    for (let ix = 0; ix < nx; ix++) {
      const p = R(ix * effW, mainUsedH + r * effD, effW, effD);
      ctx.fillStyle = COL_BOTTOM;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = COL_BOTTOM_STROKE;
      ctx.lineWidth = lineW;
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
  }
}

/**
 * Canvas 2D — 다정님 HTML처럼 격자별 자재 블록 표시 (서버 배치 규칙과 동일).
 * 칸이 너무 많으면(>${MAX_PIECE_RECTS}) 집약 표현 + 총 개수만 표시.
 */
function YieldBoardDiagramInner({ sheetW, sheetH, pieceWMm, pieceDMm, mode, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [pxSize, setPxSize] = useState({ w: 200, h: 96 });

  useEffect(() => {
    const canvas = ref.current;
    const el = canvas?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      setPxSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setPxSize({
      w: Math.max(1, Math.floor(r.width)),
      h: Math.max(1, Math.floor(r.height)),
    });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w: cssW, h: cssH } = pxSize;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, cssW, cssH, sheetW, sheetH, pieceWMm, pieceDMm, mode);
  }, [sheetW, sheetH, pieceWMm, pieceDMm, mode, pxSize]);

  return <canvas ref={ref} className={className} style={{ display: "block", width: "100%", height: "100%" }} />;
}

export const YieldBoardDiagram = memo(YieldBoardDiagramInner);

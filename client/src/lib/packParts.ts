export type PackInput = { wMm: number; dMm: number; hMm: number };

/** 적재 결과 (원자재 인덱스와 동일 순서) */
export type PartPacking = {
  xMm: number;
  yMm: number;
  zMm: number;
  /** 바닥면에 놓인 가로·세로 (90° 회전 반영) */
  wMm: number;
  dMm: number;
  hMm: number;
};

type LayerRect = { partIndex: number; x: number; y: number; w: number; d: number; h: number };

function layerXYFootprint(placed: LayerRect[]): { W: number; D: number } {
  if (placed.length === 0) return { W: 0, D: 0 };
  let W = 0;
  let D = 0;
  for (const r of placed) {
    W = Math.max(W, r.x + r.w);
    D = Math.max(D, r.y + r.d);
  }
  return { W, D };
}

function layerMaxH(placed: LayerRect[]): number {
  if (placed.length === 0) return 0;
  return Math.max(...placed.map((r) => r.h));
}

function overlaps2D(
  a: { x: number; y: number; w: number; d: number },
  b: { x: number; y: number; w: number; d: number }
): boolean {
  return !(a.x + a.w <= b.x || a.x >= b.x + b.w || a.y + a.d <= b.y || a.y >= b.y + b.d);
}

function canPlace(placed: LayerRect[], x: number, y: number, w: number, d: number): boolean {
  if (x < 0 || y < 0) return false;
  const t = { x, y, w, d };
  for (const r of placed) {
    if (overlaps2D(t, { x: r.x, y: r.y, w: r.w, d: r.d })) return false;
  }
  return true;
}

function collectCandidates(placed: LayerRect[]): [number, number][] {
  const xs = new Set<number>([0]);
  const ys = new Set<number>([0]);
  for (const r of placed) {
    xs.add(r.x);
    xs.add(r.x + r.w);
    ys.add(r.y);
    ys.add(r.y + r.d);
  }
  const out: [number, number][] = [];
  for (const x of xs) {
    for (const y of ys) {
      out.push([x, y]);
    }
  }
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return out;
}

function findBestPlacement(
  placed: LayerRect[],
  w: number,
  d: number,
  h: number
): { x: number; y: number; area: number } | null {
  let best: { x: number; y: number; area: number } | null = null;
  for (const [x, y] of collectCandidates(placed)) {
    if (!canPlace(placed, x, y, w, d)) continue;
    const trial: LayerRect[] = [...placed, { partIndex: -1, x, y, w, d, h }];
    const { W, D } = layerXYFootprint(trial);
    const area = W * D;
    if (
      !best ||
      area < best.area - 1e-9 ||
      (Math.abs(area - best.area) < 1e-6 && (y < best.y || (y === best.y && x < best.x)))
    ) {
      best = { x, y, area };
    }
  }
  return best;
}

type Cand = {
  layer: number;
  x: number;
  y: number;
  w: number;
  d: number;
  score: number;
  isNew: boolean;
};

function isBetter(newC: Cand, old: Cand | null): boolean {
  if (!old) return true;
  if (newC.score < old.score - 1e-6) return true;
  if (Math.abs(newC.score - old.score) > 1e-6) return false;
  /** 동점이면 기존 층에 얹기를 우선 (높이 증가 방지) */
  if (newC.isNew !== old.isNew) return !newC.isNew;
  return newC.layer < old.layer;
}

/**
 * 넓은 자재(면적 w×d 큰 순)를 먼저 넣고, 층마다 2D로 나란히 배치해 외곽 박스 면적·부피를 줄입니다.
 * 같은 층에 두 자재가 들어갈 수 있으면 나란히 배치합니다(회전 90° 허용).
 */
export function packParts(inputs: PackInput[]): {
  box: { w: number; d: number; h: number };
  placements: PartPacking[];
} {
  const n = inputs.length;
  if (n === 0) {
    return { box: { w: 0, d: 0, h: 0 }, placements: [] };
  }

  const order = inputs.map((_, i) => i).sort((a, b) => {
    const aa = inputs[a].wMm * inputs[a].dMm;
    const bb = inputs[b].wMm * inputs[b].dMm;
    if (bb !== aa) return bb - aa;
    return Math.max(inputs[b].wMm, inputs[b].dMm) - Math.max(inputs[a].wMm, inputs[a].dMm);
  });

  const layers: LayerRect[][] = [];

  for (const partIndex of order) {
    const p = inputs[partIndex];
    const orientations = [
      { w: p.wMm, d: p.dMm },
      { w: p.dMm, d: p.wMm },
    ];

    let best: Cand | null = null;

    for (let li = 0; li < layers.length; li++) {
      const placed = layers[li];
      for (const o of orientations) {
        const bp = findBestPlacement(placed, o.w, o.d, p.hMm);
        if (!bp) continue;
        const next = [...placed, { partIndex, x: bp.x, y: bp.y, w: o.w, d: o.d, h: p.hMm }];
        const { W, D } = layerXYFootprint(next);
        const score = W * D;
        const cand: Cand = { layer: li, x: bp.x, y: bp.y, w: o.w, d: o.d, score, isNew: false };
        if (isBetter(cand, best)) best = cand;
      }
    }

    for (const o of orientations) {
      const score = o.w * o.d;
      const cand: Cand = {
        layer: layers.length,
        x: 0,
        y: 0,
        w: o.w,
        d: o.d,
        score,
        isNew: true,
      };
      if (isBetter(cand, best)) best = cand;
    }

    if (!best) {
      const o = orientations[0];
      layers.push([{ partIndex, x: 0, y: 0, w: o.w, d: o.d, h: p.hMm }]);
      continue;
    }

    const rect: LayerRect = {
      partIndex,
      x: best.x,
      y: best.y,
      w: best.w,
      d: best.d,
      h: p.hMm,
    };

    if (best.isNew) {
      layers.push([rect]);
    } else {
      layers[best.layer].push(rect);
    }
  }

  const placements: PartPacking[] = new Array(n);
  let zBase = 0;
  for (const layer of layers) {
    const lh = layerMaxH(layer);
    for (const r of layer) {
      placements[r.partIndex] = {
        xMm: r.x,
        yMm: r.y,
        zMm: zBase,
        wMm: r.w,
        dMm: r.d,
        hMm: r.h,
      };
    }
    zBase += lh;
  }

  let maxW = 0;
  let maxD = 0;
  for (const pl of placements) {
    if (!pl) continue;
    maxW = Math.max(maxW, pl.xMm + pl.wMm);
    maxD = Math.max(maxD, pl.yMm + pl.dMm);
  }

  return {
    box: { w: maxW, d: maxD, h: zBase },
    placements: placements as PartPacking[],
  };
}

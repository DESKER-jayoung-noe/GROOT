import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductComputed, ResolvedMaterialPart } from "./types";

type Props = {
  computed: ProductComputed | null;
};

/** mm 사이즈 표기 (예시: 1200×800×045) */
function formatSizeMm3(w: number, d: number, h: number): string {
  return `${Math.round(w)}×${Math.round(d)}×${Math.round(h)}`;
}

function formatSizeCol(w: number, d: number, h: number): string {
  const a = String(Math.round(w)).padStart(3, "0");
  const b = String(Math.round(d)).padStart(3, "0");
  const c = String(Math.round(h)).padStart(2, "0");
  return `${a}×${b}×${c}mm`;
}

/** mm³ → cm³ (1 cm³ = 1000 mm³) */
function formatCm3(mm3: number): string {
  const cm3 = mm3 / 1000;
  const rounded = Math.abs(cm3) >= 100 ? Math.round(cm3) : Math.round(cm3 * 100) / 100;
  return `${rounded.toLocaleString("ko-KR")} cm³`;
}

type Pt = { x: number; y: number };

/**
 * 바닥(x-y)을 넓게 보이고 z는 위로 쌓이는 투영 (위·앞쪽에서 내려다보는 느낌).
 * screen Y 아래가 +이므로 z↑ → 화면 위로 가려면 sy에서 z를 빼는 비중을 크게.
 */
function project(x: number, y: number, z: number, scale: number): Pt {
  const sx = (x - y) * 0.5 * scale;
  /** 바닥 면이 넓게 보이고 z는 위로 (위쪽 시점) */
  const sy = (x + y) * 0.32 * scale - z * 0.82 * scale;
  return { x: sx, y: sy };
}

/** 박스 무게중심 기준: pitch(X) 후 yaw(Z) — 드래그 궤도 회전 */
function rotateAroundBoxCenter(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  yaw: number,
  pitch: number
): [number, number, number] {
  let px = x - cx;
  let py = y - cy;
  let pz = z - cz;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x1 = px;
  const y1 = py * cp - pz * sp;
  const z1 = py * sp + pz * cp;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x2 = x1 * c - y1 * s;
  const y2 = x1 * s + y1 * c;
  const z2 = z1;
  return [x2 + cx, y2 + cy, z2 + cz];
}

function pathFromQuad(
  corners: [number, number, number][],
  toSvg: (x: number, y: number, z: number) => Pt
): string {
  const pts = corners.map(([a, b, c]) => toSvg(a, b, c));
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + " Z";
}

function linePath(a: Pt, b: Pt): string {
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

type Scene = {
  toSvg: (x: number, y: number, z: number) => Pt;
  vbW: number;
  vbH: number;
};

const FIXED_VIEWBOX = 260;
const VIEW_PAD = 14;

function buildScene(
  wMm: number,
  dMm: number,
  hMm: number,
  parts: ResolvedMaterialPart[],
  yaw: number,
  pitch: number
): Scene {
  const cx = wMm / 2;
  const cy = dMm / 2;
  const cz = hMm / 2;
  const xf = (x: number, y: number, z: number) => rotateAroundBoxCenter(x, y, z, cx, cy, cz, yaw, pitch);

  const corners: [number, number, number][] = [
    [0, 0, 0],
    [wMm, 0, 0],
    [wMm, dMm, 0],
    [0, dMm, 0],
    [0, 0, hMm],
    [wMm, 0, hMm],
    [wMm, dMm, hMm],
    [0, dMm, hMm],
  ];

  let zAcc = 0;
  for (const p of parts) {
    if (p.packing) {
      const pk = p.packing;
      const x0 = pk.xMm;
      const y0 = pk.yMm;
      const z0 = pk.zMm;
      const x1 = pk.xMm + pk.wMm;
      const y1 = pk.yMm + pk.dMm;
      const z1 = pk.zMm + pk.hMm;
      corners.push(
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1]
      );
    } else {
      const z0 = zAcc;
      const z1 = zAcc + p.hMm;
      const pw = Math.min(p.wMm, wMm);
      const pd = Math.min(p.dMm, dMm);
      corners.push(
        [0, 0, z0],
        [pw, 0, z0],
        [pw, pd, z0],
        [0, pd, z0],
        [0, 0, z1],
        [pw, 0, z1],
        [pw, pd, z1],
        [0, pd, z1]
      );
      zAcc = z1;
    }
  }

  const rawPts = corners.map(([x, y, z]) => {
    const [tx, ty, tz] = xf(x, y, z);
    return project(tx, ty, tz, 1);
  });
  const minPx = Math.min(...rawPts.map((p) => p.x));
  const maxPx = Math.max(...rawPts.map((p) => p.x));
  const minPy = Math.min(...rawPts.map((p) => p.y));
  const maxPy = Math.max(...rawPts.map((p) => p.y));
  const spanX = maxPx - minPx || 1;
  const spanY = maxPy - minPy || 1;
  const inner = FIXED_VIEWBOX - VIEW_PAD * 2;
  const s = inner / Math.max(spanX, spanY);
  const pcx = (minPx + maxPx) / 2;
  const pcy = (minPy + maxPy) / 2;

  const toSvg = (x: number, y: number, z: number): Pt => {
    const [tx, ty, tz] = xf(x, y, z);
    const p = project(tx, ty, tz, 1);
    return {
      x: FIXED_VIEWBOX / 2 + (p.x - pcx) * s,
      y: FIXED_VIEWBOX / 2 - (p.y - pcy) * s,
    };
  };

  return { toSvg, vbW: FIXED_VIEWBOX, vbH: FIXED_VIEWBOX };
}

const PART_FACE_COLORS = [
  "rgba(96, 165, 250, 0.9)",
  "rgba(129, 140, 248, 0.9)",
  "rgba(52, 211, 153, 0.9)",
  "rgba(251, 191, 36, 0.9)",
  "rgba(244, 114, 182, 0.9)",
  "rgba(167, 139, 250, 0.9)",
];

/** 한 박스의 보이는 3면 (상·우·전 y=max) — 투영 기준으로 일관 */
function PartFilledFaces({
  x0,
  y0,
  z0,
  x1,
  y1,
  z1,
  toSvg,
  fill,
  stroke,
}: {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  toSvg: (x: number, y: number, z: number) => Pt;
  fill: string;
  stroke: string;
}) {
  const top = pathFromQuad(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    toSvg
  );
  const right = pathFromQuad(
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    toSvg
  );
  const front = pathFromQuad(
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    toSvg
  );
  return (
    <>
      <path d={front} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={right} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={top} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </>
  );
}

const PITCH_MIN = -1.35;
const PITCH_MAX = 1.35;
const DRAG_SENS = 0.0045;

function StackingSceneSvg({
  boxMm,
  parts,
}: {
  boxMm: { w: number; d: number; h: number };
  parts: ResolvedMaterialPart[];
}) {
  const { w: wMm, d: dMm, h: hMm } = boxMm;
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  const sceneKey = `${wMm},${dMm},${hMm},${parts.length},${parts.map((p) => p.materialId).join("|")}`;
  useEffect(() => {
    setYaw(0);
    setPitch(0);
  }, [sceneKey]);

  const scene = useMemo(
    () => buildScene(wMm, dMm, hMm, parts, yaw, pitch),
    [wMm, dMm, hMm, parts, yaw, pitch]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    setYaw((prev) => prev + dx * DRAG_SENS);
    setPitch((prev) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, prev - dy * DRAG_SENS)));
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d && e.pointerId === d.pointerId) {
      dragRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const toLine = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    linePath(scene.toSvg(x0, y0, z0), scene.toSvg(x1, y1, z1));

  const outerWire = [
    toLine(0, 0, 0, wMm, 0, 0),
    toLine(wMm, 0, 0, wMm, dMm, 0),
    toLine(wMm, dMm, 0, 0, dMm, 0),
    toLine(0, dMm, 0, 0, 0, 0),
    toLine(0, 0, hMm, wMm, 0, hMm),
    toLine(wMm, 0, hMm, wMm, dMm, hMm),
    toLine(wMm, dMm, hMm, 0, dMm, hMm),
    toLine(0, dMm, hMm, 0, 0, hMm),
    toLine(0, 0, 0, 0, 0, hMm),
    toLine(wMm, 0, 0, wMm, 0, hMm),
    toLine(wMm, dMm, 0, wMm, dMm, hMm),
    toLine(0, dMm, 0, 0, dMm, hMm),
  ];

  let zAcc = 0;
  const partBlocks: {
    key: string;
    x0: number;
    y0: number;
    z0: number;
    x1: number;
    y1: number;
    z1: number;
    tip: string;
    colorIdx: number;
  }[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let x0: number;
    let y0: number;
    let z0: number;
    let x1: number;
    let y1: number;
    let z1: number;
    if (p.packing) {
      const pk = p.packing;
      x0 = pk.xMm;
      y0 = pk.yMm;
      z0 = pk.zMm;
      x1 = pk.xMm + pk.wMm;
      y1 = pk.yMm + pk.dMm;
      z1 = pk.zMm + pk.hMm;
    } else {
      z0 = zAcc;
      z1 = zAcc + p.hMm;
      x0 = 0;
      y0 = 0;
      x1 = Math.min(p.wMm, wMm);
      y1 = Math.min(p.dMm, dMm);
      zAcc = z1;
    }
    partBlocks.push({
      key: `${p.materialId}-${i}`,
      x0,
      y0,
      z0,
      x1,
      y1,
      z1,
      tip: `${p.name} / ${formatSizeCol(p.wMm, p.dMm, p.hMm)}`,
      colorIdx: i % PART_FACE_COLORS.length,
    });
  }

  return (
    <div
      className="relative w-full flex flex-col items-center select-none touch-none"
      onDoubleClick={() => {
        setYaw(0);
        setPitch(0);
      }}
    >
      <svg
        viewBox={`0 0 ${scene.vbW} ${scene.vbH}`}
        className="h-full w-full max-h-[260px] max-w-[260px] cursor-grab active:cursor-grabbing"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <title>적층 자재 3D</title>
        {/* 자재 먼저 (면 90% 불투명 + 외곽선), 위에 외곽 와이어 */}
        {partBlocks.map((blk) => {
          const fill = PART_FACE_COLORS[blk.colorIdx];
          const stroke = "rgba(30, 58, 138, 0.85)";
          return (
            <g key={blk.key} className="cursor-pointer outline-none">
              <title>{blk.tip}</title>
              <PartFilledFaces
                x0={blk.x0}
                y0={blk.y0}
                z0={blk.z0}
                x1={blk.x1}
                y1={blk.y1}
                z1={blk.z1}
                toSvg={scene.toSvg}
                fill={fill}
                stroke={stroke}
              />
            </g>
          );
        })}
        <g pointerEvents="none" style={{ paintOrder: "stroke fill" }}>
          {outerWire.map((d, i) => (
            <path key={`o-hi-${i}`} d={d} stroke="white" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.85} />
          ))}
          {outerWire.map((d, i) => (
            <path key={`o-${i}`} d={d} stroke="#94a3b8" strokeWidth={2.25} fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      </svg>
      <p className="mt-1.5 text-[10px] text-slate-500 text-center px-1">
        드래그로 회전 · 더블클릭 초기화 · 자재 호버 시 이름·사이즈
      </p>
    </div>
  );
}

/** 박스 적층 가정 시 외곽 박스 vs 부품 부피 / 빈 공간 % 시각화 */
export function BoxEmptyCard({ computed }: Props) {
  if (!computed || computed.parts.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-[#e0e0e0] bg-[#f8f9fa] p-6 text-center text-sm text-slate-400 min-h-[200px] flex items-center justify-center">
        부품을 추가하면 박스·빈공간 분석이 표시됩니다.
      </div>
    );
  }

  const { boxMm, boxVolumeMm3, partsVolumeMm3, emptyVolumeMm3, emptyPercent, parts } = computed;
  const footprint = boxMm.w * boxMm.d;
  const emptyH =
    footprint > 0 ? Math.min(boxMm.h, Math.max(0, Math.round(emptyVolumeMm3 / footprint))) : 0;

  return (
    <div className="rounded-2xl border border-[#e0e0e0] bg-white p-4 shadow-sm h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-bold text-[#111]">박스 내 빈공간</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            박스 외곽 사이즈 : {formatSizeMm3(boxMm.w, boxMm.d, boxMm.h)} mm
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            박스 내 빈공간 사이즈 : {formatSizeMm3(boxMm.w, boxMm.d, emptyH)} mm
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-3xl font-bold text-[#1e6fff] tabular-nums">{emptyPercent.toFixed(1)}</span>
          <span className="text-lg font-semibold text-[#1e6fff]">%</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center py-2 min-h-[200px]">
        <div className="mx-auto h-[260px] w-[260px] max-w-full shrink-0 flex items-center justify-center overflow-hidden">
          <StackingSceneSvg boxMm={boxMm} parts={parts} />
        </div>
      </div>

      <div className="overflow-x-auto text-xs mt-3 pt-3 border-t border-[#eee]">
        <table className="w-full border-collapse min-w-[280px]">
          <thead>
            <tr className="text-slate-500 border-b border-[#eee]">
              <th className="text-left py-2 font-medium">구분</th>
              <th className="text-left py-2 font-medium whitespace-nowrap">사이즈</th>
              <th className="text-right py-2 font-medium whitespace-nowrap">부피 (cm³)</th>
            </tr>
          </thead>
          <tbody className="text-[#111]">
            <tr className="border-b border-[#f5f5f5]">
              <td className="py-2">전체 박스</td>
              <td className="py-2 font-mono tabular-nums text-[11px] text-slate-700 whitespace-nowrap">
                {formatSizeCol(boxMm.w, boxMm.d, boxMm.h)}
              </td>
              <td className="text-right tabular-nums whitespace-nowrap">{formatCm3(boxVolumeMm3)}</td>
            </tr>
            <tr className="border-b border-[#f5f5f5]">
              <td className="py-2">부품 합계</td>
              <td className="py-2 text-slate-400">—</td>
              <td className="text-right tabular-nums whitespace-nowrap">{formatCm3(partsVolumeMm3)}</td>
            </tr>
            <tr className="border-b border-[#f5f5f5]">
              <td className="py-2">빈 공간</td>
              <td className="py-2 font-mono tabular-nums text-[11px] text-[#1e6fff] font-semibold whitespace-nowrap">
                {formatSizeCol(boxMm.w, boxMm.d, emptyH)}
              </td>
              <td className="text-right tabular-nums text-[#1e6fff] font-semibold whitespace-nowrap">
                {formatCm3(emptyVolumeMm3)}
              </td>
            </tr>
            {parts.map((p, pi) => (
              <tr key={`${p.materialId}-${pi}`} className="border-b border-[#f5f5f5]">
                <td className="py-1.5 pl-2 text-slate-600 min-w-0 max-w-[140px] break-words">{p.name}</td>
                <td className="py-1.5 font-mono tabular-nums text-[11px] text-slate-700 whitespace-nowrap">
                  {formatSizeCol(p.wMm, p.dMm, p.hMm)}
                </td>
                <td className="text-right tabular-nums whitespace-nowrap">
                  {formatCm3(p.wMm * p.dMm * p.hMm)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useMemo } from "react";
import type { EdgeSelection } from "../lib/materialCalc";

type Props = {
  wMm: number;
  dMm: number;
  value: EdgeSelection;
  disabled?: boolean;
  onChange: (next: EdgeSelection) => void;
};

const btn = (on: boolean, disabled?: boolean) =>
  `rounded-[6px] px-2 py-1.5 text-[11px] font-bold transition-colors ${
    disabled ? "opacity-40" : ""
  } ${
    on
      ? "border-[0.5px] border-[#1D9E75] bg-[#1D9E75]/10 text-[#0d6e4d] dark:border-[#1D9E75] dark:bg-[#1D9E75]/15 dark:text-[#7dffc8]"
      : "border-[0.5px] border-[#d8dde4] bg-[#f5f7fa] text-[#555] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
  }`;

/** 위에서 내려다본 판재 — 4면 선택, 중앙 사각형 비율 = W:D */
export function MaterialEdgeFacePicker({ wMm, dMm, value, disabled, onChange }: Props) {
  const toggle = (key: keyof EdgeSelection) => {
    if (disabled) return;
    onChange({ ...value, [key]: !value[key] });
  };

  const { bw, bh } = useMemo(() => {
    const maxW = 118;
    const maxH = 92;
    const ratioWd = wMm > 0 && dMm > 0 ? wMm / dMm : 1;
    let boxW = maxW;
    let boxH = boxW / ratioWd;
    if (!Number.isFinite(boxH) || boxH <= 0) boxH = maxH;
    if (boxH > maxH) {
      boxH = maxH;
      boxW = boxH * ratioWd;
    }
    return { bw: Math.max(48, Math.round(boxW)), bh: Math.max(36, Math.round(boxH)) };
  }, [wMm, dMm]);

  return (
    <div className={`flex flex-col items-center gap-2 ${disabled ? "pointer-events-none opacity-45" : ""}`}>
      <p className="w-full text-left text-xs font-semibold text-[#6f7a87] dark:text-slate-400">엣지 면</p>
      <div className="flex flex-col items-center gap-1">
        <button type="button" onClick={() => toggle("top")} className={btn(value.top, disabled)}>
          상
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => toggle("left")} className={btn(value.left, disabled)}>
            좌
          </button>
          <div
            className="flex shrink-0 items-center justify-center rounded-[8px] border-[0.5px] border-[#b8c0ca] bg-[#fafcfa] dark:border-slate-500 dark:bg-slate-900/60"
            style={{ width: bw, height: bh }}
          >
            <span className="px-2 text-center text-[10px] font-semibold text-[#6f7a87] dark:text-slate-400">
              {wMm > 0 && dMm > 0 ? (
                <span className="tabular-nums">
                  {wMm}×{dMm}
                </span>
              ) : (
                "규격 입력"
              )}
            </span>
          </div>
          <button type="button" onClick={() => toggle("right")} className={btn(value.right, disabled)}>
            우
          </button>
        </div>
        <button type="button" onClick={() => toggle("bottom")} className={btn(value.bottom, disabled)}>
          하
        </button>
      </div>
      <p className="text-[11px] text-[#8d96a0] dark:text-slate-500">적용할 면을 눌러 선택하세요</p>
    </div>
  );
}

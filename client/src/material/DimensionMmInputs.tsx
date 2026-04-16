import { useEffect, useState } from "react";

export const H_OPTIONS = [12, 15, 18, 22, 25, 28] as const;
export type HOption = (typeof H_OPTIONS)[number];

type Props = {
  wMm: number;
  dMm: number;
  hMm: number;
  onCommit: (next: { wMm: number; dMm: number; hMm: number }) => void;
  /** 부모 `grid` 안에서 W/D/H 세 칸만 차지하려면 `contents` */
  gridMode?: "default" | "contents";
};

function toStr(n: number) {
  return n === 0 ? "" : String(n);
}

function parseMm(s: string) {
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * W/D는 자유 입력, H는 12/15/18/22/25/28 드롭다운.
 * 부모(견전체)는 디바운스 후 갱신.
 */
export function DimensionMmInputs({ wMm, dMm, hMm, onCommit, gridMode = "default" }: Props) {
  const [w, setW] = useState(() => toStr(wMm));
  const [d, setD] = useState(() => toStr(dMm));
  const [h, setH] = useState(() => (hMm > 0 ? String(hMm) : ""));

  // W/D 변경은 디바운스
  useEffect(() => {
    const t = window.setTimeout(() => {
      onCommit({ wMm: parseMm(w), dMm: parseMm(d), hMm: parseMm(h) });
    }, 220);
    return () => window.clearTimeout(t);
  }, [w, d, h, onCommit]);

  const wrapClass = gridMode === "contents" ? "contents" : "flex flex-wrap gap-3";

  const inputCls =
    "w-full rounded-xl border border-[#e5e8ec] bg-white px-3 py-2.5 text-[15px] leading-snug text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-2 focus:ring-[#3182f6]/20";

  return (
    <div className={wrapClass}>
      {/* W */}
      <div className="w-[96px] shrink-0">
        <label className="mb-1.5 block text-xs font-medium text-[#6f7a87]">W(mm)</label>
        <input
          type="number"
          min={0}
          maxLength={4}
          className={inputCls}
          value={w}
          onChange={(e) => setW(e.target.value)}
        />
      </div>
      {/* D */}
      <div className="w-[96px] shrink-0">
        <label className="mb-1.5 block text-xs font-medium text-[#6f7a87]">D(mm)</label>
        <input
          type="number"
          min={0}
          maxLength={4}
          className={inputCls}
          value={d}
          onChange={(e) => setD(e.target.value)}
        />
      </div>
      {/* H — 드롭다운 */}
      <div className="w-[96px] shrink-0">
        <label className="mb-1.5 block text-xs font-medium text-[#6f7a87]">H(T)</label>
        <select
          className={inputCls}
          value={h}
          onChange={(e) => setH(e.target.value)}
        >
          <option value="">선택</option>
          {H_OPTIONS.map((t) => (
            <option key={t} value={String(t)}>
              {t}T
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

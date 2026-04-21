import { useEffect, useState, type ReactNode } from "react";

export const H_OPTIONS = [12, 15, 18, 22, 25, 28] as const;
export type HOption = (typeof H_OPTIONS)[number];

type Props = {
  wMm: number;
  dMm: number;
  hMm: number;
  onCommit: (next: { wMm: number; dMm: number; hMm: number }) => void;
  /** 부모 `grid` 안에서 W/D/H 세 칸만 차지하려면 `contents` */
  gridMode?: "default" | "contents";
  /** 한 줄 규격 행용 — 칸·패딩 축소 */
  compact?: boolean;
  /** 견적 전면 개편: 한 줄 30px 높이 + CSS 변수 테두리 */
  variant?: "default" | "quoteRow";
};

function toStr(n: number) {
  return n === 0 ? "" : String(n);
}

function parseMm(s: string) {
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** 규격 W/D/H 입력·셀렉트와 동일한 폭·패딩·타이포 — 사양·엣지 필드에 공통 사용 */
export const DIMENSION_FIELD_CONTROL_CLASS =
  "w-full rounded-xl border border-[#e5e8ec] bg-white px-3 py-2.5 text-[15px] leading-snug text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-2 focus:ring-[#3182f6]/20";

/**
 * W/D는 자유 입력, H는 12/15/18/22/25/28 드롭다운.
 * 부모(견전체)는 디바운스 후 갱신.
 */
const compactControlClass =
  "w-full rounded-lg border border-[#e5e8ec] bg-white px-2 py-1.5 text-[13px] leading-snug text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-1 focus:ring-[#3182f6]/20";

const quoteRowInp =
  "h-[30px] w-[4rem] shrink-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1.5 text-[12px] tabular-nums text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none";

export function DimensionMmInputs({
  wMm,
  dMm,
  hMm,
  onCommit,
  gridMode = "default",
  compact = false,
  variant = "default",
}: Props) {
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

  if (variant === "quoteRow") {
    const lab = "text-[11px] leading-none text-[var(--quote-muted)]";
    const cell = (id: string, label: string, node: ReactNode) => (
      <div key={id} className="flex flex-col gap-0.5">
        <label className={lab}>{label}</label>
        {node}
      </div>
    );
    return (
      <div className="flex min-w-0 flex-nowrap items-end gap-2">
        {cell(
          "w",
          "W(mm)",
          <input type="number" min={0} className={quoteRowInp} value={w} onChange={(e) => setW(e.target.value)} />
        )}
        {cell(
          "d",
          "D(mm)",
          <input type="number" min={0} className={quoteRowInp} value={d} onChange={(e) => setD(e.target.value)} />
        )}
        {cell(
          "h",
          "H(T)",
          <select className={`${quoteRowInp} min-w-[3.75rem]`} value={h} onChange={(e) => setH(e.target.value)}>
            <option value="">선택</option>
            {H_OPTIONS.map((t) => (
              <option key={t} value={String(t)}>
                {t}T
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  const wrapClass = gridMode === "contents" ? "contents" : "flex flex-wrap gap-3";

  const inputCls = compact ? compactControlClass : DIMENSION_FIELD_CONTROL_CLASS;
  const fieldW = compact ? "w-[76px]" : "w-[96px]";
  const labelCls = compact ? "mb-0.5 block text-[10px] font-medium text-[#6f7a87]" : "mb-1.5 block text-xs font-medium text-[#6f7a87]";

  return (
    <div className={wrapClass}>
      {/* W */}
      <div className={`${fieldW} shrink-0`}>
        <label className={labelCls}>W(mm)</label>
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
      <div className={`${fieldW} shrink-0`}>
        <label className={labelCls}>D(mm)</label>
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
      <div className={`${fieldW} shrink-0`}>
        <label className={labelCls}>H(T)</label>
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

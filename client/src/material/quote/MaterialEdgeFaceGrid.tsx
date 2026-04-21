import { useMemo } from "react";
import type { EdgeSelection } from "../../lib/materialCalc";

type Props = {
  wMm: number;
  dMm: number;
  value: EdgeSelection;
  disabled?: boolean;
  onChange: (next: EdgeSelection) => void;
};

const cell = (on: boolean, disabled?: boolean) =>
  `flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border-[0.5px] text-[10px] font-bold transition-colors ${
    disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
  } ${
    on
      ? "border-[#378ADD] bg-[#378ADD] text-white"
      : "border-[var(--quote-border)] bg-[var(--quote-card-muted)] text-[var(--quote-fg)] hover:border-[#378ADD]/60"
  }`;

/** 3×3 — 상·좌·보드·우·하 직관 배치 */
export function MaterialEdgeFaceGrid({ wMm, dMm, value, disabled, onChange }: Props) {
  const t = useMemo(
    () => (wMm > 0 && dMm > 0 ? `${wMm}×${dMm}` : "규격 입력"),
    [wMm, dMm]
  );
  const flip = (k: keyof EdgeSelection) => {
    if (disabled) return;
    onChange({ ...value, [k]: !value[k] });
  };

  const edgeLen = useMemo(() => {
    let mm = 0;
    if (value.top) mm += wMm;
    if (value.bottom) mm += wMm;
    if (value.left) mm += dMm;
    if (value.right) mm += dMm;
    return mm;
  }, [value, wMm, dMm]);

  const faceCount = [value.top, value.bottom, value.left, value.right].filter(Boolean).length;
  const summary = disabled ? "엣지 없음" : `${faceCount}면 · ${edgeLen.toLocaleString("ko-KR")}mm`;

  return (
    <div className={`flex flex-col items-center gap-2 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <p className="w-full text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--quote-muted)]">
        적용 면
      </p>
      <div className="grid grid-cols-3 grid-rows-3 place-items-center gap-1">
        <span className="h-7 w-7" aria-hidden />
        <button type="button" className={cell(value.top, disabled)} onClick={() => flip("top")}>
          상
        </button>
        <span className="h-7 w-7" aria-hidden />
        <button type="button" className={cell(value.left, disabled)} onClick={() => flip("left")}>
          좌
        </button>
        <div className="flex h-7 min-w-[4.5rem] max-w-[5.5rem] items-center justify-center rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card-muted)] px-1 text-center text-[10px] font-semibold tabular-nums text-[var(--quote-muted)]">
          {t}
        </div>
        <button type="button" className={cell(value.right, disabled)} onClick={() => flip("right")}>
          우
        </button>
        <span className="h-7 w-7" aria-hidden />
        <button type="button" className={cell(value.bottom, disabled)} onClick={() => flip("bottom")}>
          하
        </button>
        <span className="h-7 w-7" aria-hidden />
      </div>
      <p className="w-full text-center text-[10px] text-[var(--quote-muted)]">{summary}</p>
    </div>
  );
}

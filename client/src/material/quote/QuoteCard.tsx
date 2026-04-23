import type { ReactNode } from "react";

type Props = {
  /** 없으면 제목/구분선 없이 흰 박스만 */
  label?: string;
  children: ReactNode;
  className?: string;
  /** true면 모서리 라운드 없음(자재 편집 등) */
  square?: boolean;
};

/** 견적 카드 — (선택) 라벨 11px uppercase, 패딩, radius 12px */
export function QuoteCard({ label, children, className = "", square = false }: Props) {
  const radius = square ? "rounded-none" : "rounded-[12px]";
  const pad = square ? "px-4 py-4 sm:px-5 sm:py-5" : "px-[14px] py-3";
  return (
    <section
      className={`flex min-h-0 flex-col ${radius} border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] ${className}`}
    >
      {label ? (
        <h3 className="shrink-0 border-b-[0.5px] border-[var(--quote-border)] px-[14px] py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--quote-muted)]">
          {label}
        </h3>
      ) : null}
      <div className={`min-h-0 flex-1 ${pad}`}>{children}</div>
    </section>
  );
}

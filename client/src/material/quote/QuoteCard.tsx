import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
};

/** 견적 카드 — 라벨 11px uppercase, 패딩 12px 14px, radius 12px */
export function QuoteCard({ label, children, className = "" }: Props) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-[12px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] ${className}`}
    >
      <h3 className="shrink-0 border-b-[0.5px] border-[var(--quote-border)] px-[14px] py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--quote-muted)]">
        {label}
      </h3>
      <div className="min-h-0 flex-1 px-[14px] py-3">{children}</div>
    </section>
  );
}

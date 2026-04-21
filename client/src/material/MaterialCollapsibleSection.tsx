import { type ReactNode, useState } from "react";

type Props = {
  title: string;
  summaryRight?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

function ChevronV({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-[#2b333b] transition-transform duration-200 dark:text-slate-200 ${open ? "rotate-180" : ""} ${className ?? ""}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** 제목은 카드 밖, 본문만 흰 박스 안 (접기 시 본문만 숨김) */
export function MaterialCollapsibleSection({ title, summaryRight, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-0.5 py-0.5 text-left"
      >
        <span className="min-w-0 flex-1 text-[16px] font-bold tracking-tight text-[#191f28] dark:text-slate-100">
          {title}
        </span>
        {summaryRight ? <span className="shrink-0 text-right text-sm">{summaryRight}</span> : null}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-slate-800">
          <ChevronV open={open} />
        </span>
      </button>
      {open && (
        <div className="rounded-[12px] border-[0.5px] border-[#eaeaea] bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-4 sm:py-3.5">
          {children}
        </div>
      )}
    </section>
  );
}

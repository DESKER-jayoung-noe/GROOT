import { useCallback, useRef, useState } from "react";
import { fetchStpBoundingBoxMm } from "../../lib/stpGeometryPlaceholder";

type Kind = "stp" | "pdf" | "dwg";

function inferKind(file: File): Kind | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".stp") || lower.endsWith(".step")) return "stp";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".dwg")) return "dwg";
  return null;
}

function IconStp() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
    </svg>
  );
}
function IconPdf() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}
function IconDwg() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M4 20V4h10l2 3h4v13H4z" />
    </svg>
  );
}

const miniBtn =
  "inline-flex h-[26px] min-w-[2.75rem] items-center justify-center gap-0.5 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card-muted)] px-1.5 text-[11px] font-medium text-[var(--quote-fg)] hover:border-[#378ADD] hover:text-[#378ADD]";

type Props = {
  onApplyDimensions?: (wMm: number, dMm: number, hMm: number) => void;
};

/** 32px 높이 업로드 존 + STP/PDF/DWG */
export function MaterialQuoteFileBar({ onApplyDimensions }: Props) {
  const [names, setNames] = useState<Partial<Record<Kind, string>>>({});
  const stpRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const dwgRef = useRef<HTMLInputElement>(null);

  const onPick = useCallback(
    async (k: Kind, list: FileList | null) => {
      const file = list?.[0];
      if (!file) return;
      setNames((n) => ({ ...n, [k]: file.name }));
      if (k === "stp" && onApplyDimensions) {
        const dims = await fetchStpBoundingBoxMm(file);
        if (dims) onApplyDimensions(dims.wMm, dims.dMm, dims.hMm);
      }
    },
    [onApplyDimensions]
  );

  const row = (k: Kind, label: string, icon: React.ReactNode, ref: React.RefObject<HTMLInputElement | null>, accept: string) => (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => {
          void onPick(k, e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" className={miniBtn} onClick={() => ref.current?.click()}>
        {icon}
        {label}
      </button>
    </>
  );

  return (
    <div className="space-y-1.5">
      <div
        className="flex h-8 min-h-[32px] items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-dashed border-[var(--quote-border)] bg-[var(--quote-card-muted)] px-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (!f) return;
          const k = inferKind(f);
          if (k) void onPick(k, e.dataTransfer.files);
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--quote-muted)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          <span className="truncate">파일 업로드로 자동 입력</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {row("stp", "STP", <IconStp />, stpRef, ".stp,.step")}
          {row("pdf", "PDF", <IconPdf />, pdfRef, ".pdf")}
          {row("dwg", "DWG", <IconDwg />, dwgRef, ".dwg")}
        </div>
      </div>
      {(names.stp || names.pdf || names.dwg) && (
        <p className="truncate text-[10px] text-[var(--quote-muted)]">
          {[names.stp && `STP: ${names.stp}`, names.pdf && `PDF: ${names.pdf}`, names.dwg && `DWG: ${names.dwg}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <p className="text-[10px] leading-snug text-[var(--quote-muted)]">
        STP, DWG, PDF 파일을 올리면 규격이 자동으로 채워집니다. (STP일 때 가로·세로·두께)
      </p>
    </div>
  );
}

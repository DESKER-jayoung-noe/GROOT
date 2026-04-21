import { useCallback, useRef, useState } from "react";
import { fetchStpBoundingBoxMm } from "../lib/stpGeometryPlaceholder";

type Kind = "stp" | "pdf" | "dwg";

type FileSlot = { kind: Kind; name: string; file: File };

function IconStp() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden>
      <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
      <path d="M12 22V12M4 6.5l8 4.5M20 6.5l-8 4.5" />
    </svg>
  );
}
function IconPdf() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}
function IconDwg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden>
      <path d="M4 20V4h10l2 3h4v13H4z" />
      <path d="M14 4v4h4M8 14l2-3 2 3 2-3 2 3" />
    </svg>
  );
}

type Props = {
  onApplyDimensions?: (wMm: number, dMm: number, hMm: number) => void;
  /** split: STP 한 칸 + 도면 한 칸(기존). combined: 단일 업로드 */
  layout?: "split" | "combined";
};

function inferKind(file: File): Kind | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".stp") || lower.endsWith(".step")) return "stp";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".dwg")) return "dwg";
  return null;
}

export function MaterialQuoteFileStrip({ onApplyDimensions, layout = "split" }: Props) {
  const [files, setFiles] = useState<Partial<Record<Kind, FileSlot>>>({});
  const stpRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const dwgRef = useRef<HTMLInputElement>(null);
  const combinedRef = useRef<HTMLInputElement>(null);

  const clearKind = useCallback((k: Kind) => {
    setFiles((f) => {
      const next = { ...f };
      delete next[k];
      return next;
    });
  }, []);

  const onPick = useCallback(
    async (k: Kind, list: FileList | null) => {
      const file = list?.[0];
      if (!file) return;
      setFiles((f) => ({ ...f, [k]: { kind: k, name: file.name, file } }));
      if (k === "stp" && onApplyDimensions) {
        const dims = await fetchStpBoundingBoxMm(file);
        if (dims) onApplyDimensions(dims.wMm, dims.dMm, dims.hMm);
      }
    },
    [onApplyDimensions]
  );

  const onDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const k = inferKind(file);
    if (k) void onPick(k, e.dataTransfer.files);
  };

  const onCombinedFile = useCallback(
    async (list: FileList | null) => {
      const file = list?.[0];
      if (!file) return;
      const k = inferKind(file);
      if (!k) return;
      await onPick(k, list);
    },
    [onPick]
  );

  if (layout === "combined") {
    return (
      <div className="space-y-1.5">
        <div
          className="flex flex-col gap-2 rounded-[10px] border-[0.5px] border-dashed border-[#b8c0ca] bg-[#fafbfc] px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropZone}
        >
          <input
            ref={combinedRef}
            type="file"
            className="hidden"
            accept=".stp,.step,.pdf,.dwg"
            onChange={(e) => {
              void onCombinedFile(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="w-fit rounded-lg border-[0.5px] border-[#c8cdd4] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#191f28] hover:border-[#378ADD] hover:text-[#378ADD] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onClick={() => combinedRef.current?.click()}
          >
            업로드
          </button>
          {(files.stp || files.pdf || files.dwg) && (
            <div className="flex flex-wrap gap-1.5">
              {(["stp", "pdf", "dwg"] as const).map((k) =>
                files[k] ? (
                  <span
                    key={k}
                    className="inline-flex max-w-[min(100%,12rem)] items-center gap-1 rounded-md border-[0.5px] border-[#dfe3e8] px-1.5 py-0.5 text-[10px] text-[#444] dark:border-slate-600 dark:text-slate-300"
                  >
                    <span className="truncate font-medium uppercase">{k}</span>
                    <span className="truncate">{files[k]!.name}</span>
                    <button
                      type="button"
                      className="shrink-0 text-[#E24B4A] hover:opacity-80"
                      aria-label="파일 제거"
                      onClick={() => clearKind(k)}
                    >
                      ×
                    </button>
                  </span>
                ) : null
              )}
            </div>
          )}
        </div>
        <p className="text-[10px] leading-snug text-[#6f7a87] dark:text-slate-500">
          STP, DWG, PDF 파일을 올리면 규격이 자동으로 작성됩니다. (STP일 때 가로·세로·두께 반영)
        </p>
      </div>
    );
  }

  const btnClass =
    "inline-flex items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#c8cdd4] dark:border-slate-600 bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-[#333] dark:text-slate-200 hover:border-[#378ADD] hover:text-[#378ADD] dark:hover:border-[#378ADD] dark:hover:text-[#5aa3e6]";

  const row = (k: Kind, label: string, icon: React.ReactNode, inputRef: React.RefObject<HTMLInputElement | null>, accept: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => {
          void onPick(k, e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" className={btnClass} onClick={() => inputRef.current?.click()}>
        {icon}
        {label}
      </button>
      {files[k] && (
        <span className="inline-flex items-center gap-1 rounded-[8px] border-[0.5px] border-[#dfe3e8] dark:border-slate-600 px-2 py-0.5 text-[11px] text-[#444] dark:text-slate-300 max-w-[200px]">
          <span className="truncate">{files[k]!.name}</span>
          <button
            type="button"
            className="shrink-0 rounded px-0.5 text-[#E24B4A] hover:opacity-80"
            aria-label="파일 제거"
            onClick={() => clearKind(k)}
          >
            ×
          </button>
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div
        className="flex min-h-[72px] items-center justify-center gap-3 rounded-[12px] border-[0.5px] border-dashed border-[#b8c0ca] bg-[#fafbfc] px-3 py-2 dark:border-slate-600 dark:bg-slate-900/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropZone}
      >
        <div className="flex flex-wrap items-center justify-center gap-3">{row("stp", "STP 업로드", <IconStp />, stpRef, ".stp,.step")}</div>
      </div>
      <div
        className="flex min-h-[72px] flex-wrap items-center justify-center gap-3 rounded-[12px] border-[0.5px] border-dashed border-[#b8c0ca] bg-[#fafbfc] px-3 py-2 dark:border-slate-600 dark:bg-slate-900/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropZone}
      >
        <span className="text-[11px] font-semibold text-[#6f7a87] dark:text-slate-400">도면 업로드</span>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {row("pdf", "PDF", <IconPdf />, pdfRef, ".pdf")}
          {row("dwg", "DWG", <IconDwg />, dwgRef, ".dwg")}
        </div>
      </div>
      <p className="text-[11px] text-[#6f7a87] dark:text-slate-500">STP 업로드 시 규격이 자동으로 입력됩니다</p>
    </div>
  );
}

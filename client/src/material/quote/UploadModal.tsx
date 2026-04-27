import { useMemo, useRef, useState } from "react";
import type { ParsedReviewRow } from "./ReviewModal";

const STP_API_URL = (import.meta.env.VITE_STP_API_URL as string | undefined) ?? "http://localhost:8000";

type Props = {
  open: boolean;
  onClose: () => void;
  onParsedDone: (rows: ParsedReviewRow[], sourceLabel: string) => void;
};

type Stage = "form" | "parsing" | "done";
type RowStatus = "wait" | "running" | "done";

const EXT_COLORS: Record<string, string> = {
  zip: "#3b82f6",
  stp: "#16a34a",
  pdf: "#ea580c",
  dwg: "#7c3aed",
};

function extOf(file: File): string {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".stp") || lower.endsWith(".step")) return "stp";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".dwg")) return "dwg";
  return "";
}

function isAccepted(file: File): boolean {
  return extOf(file) !== "";
}

function fileSizeMB(file: File): string {
  return `${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

function buildRows(materials: unknown[], fallbackSource: ParsedReviewRow["source"], fileName: string): ParsedReviewRow[] {
  return materials.map((m, i) => {
    const r = m as Record<string, unknown>;
    const edgeCount = Number(r.edgeCount ?? r.edgeEa ?? 0);
    const sourceRaw = String(r.source ?? fallbackSource).toLowerCase();
    const source: ParsedReviewRow["source"] = sourceRaw === "pdf" || sourceRaw === "dwg" || sourceRaw === "zip" ? sourceRaw : "stp";
    const confidence = Number(r.confidence ?? 0.85);
    const routerMm = Number(r.routerMm ?? r.rutaMm ?? 0);
    const extraProcs = routerMm > 0
      ? [{ type: "router" as const, mm: routerMm, _id: Date.now() + i }]
      : [];
    return {
      id: `${fileName}-${i}`,
      checked: true,
      name: String(r.name ?? r.partName ?? "자재"),
      file: String(r.stpFile ?? r.file ?? r.fileName ?? fileName),
      source,
      W: Number(r.wMm ?? r.w ?? 0),
      D: Number(r.dMm ?? r.d ?? 0),
      T: Number(r.hMm ?? r.t ?? r.thicknessMm ?? 0),
      edge: edgeCount >= 4 ? "4면" : edgeCount >= 2 ? "2면" : edgeCount >= 1 ? "1면" : "없음",
      edgeT: Number(r.edgeT ?? r.edgeThickness ?? (edgeCount > 0 ? 1 : 0)),
      hole1: Number(r.holeCount ?? r.holes ?? 0),
      hole2: Number(r.hole2Count ?? 0),
      extraProcs,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
      warn: edgeCount === 0 ? "엣지 파일 없음 — 수동 확인" : null,
    };
  });
}

export function UploadModal({ open, onClose, onParsedDone }: Props) {
  const [stage, setStage] = useState<Stage>("form");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [bomEnabled, setBomEnabled] = useState(false);
  const [bomFile, setBomFile] = useState<File | null>(null);
  const [dragOn, setDragOn] = useState(false);
  const [statuses, setStatuses] = useState<RowStatus[]>([]);
  const [percent, setPercent] = useState(0);
  const [title, setTitle] = useState("파일 분석 중...");
  const [eta, setEta] = useState("예상 소요 시간 계산 중...");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bomInputRef = useRef<HTMLInputElement>(null);
  const canStart = selectedFiles.length > 0;
  const sourceLabel = useMemo(() => selectedFiles.map((f) => f.name).join(" + "), [selectedFiles]);

  if (!open) return null;

  const appendFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setSelectedFiles((prev) => {
      const next = [...prev];
      [...list].forEach((f) => {
        if (!isAccepted(f)) return;
        if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
      });
      return next;
    });
  };

  const removeFile = (file: File) => {
    setSelectedFiles((prev) => prev.filter((x) => !(x.name === file.name && x.size === file.size)));
  };

  const runParse = async () => {
    if (!canStart) return;
    setError(null);
    setStage("parsing");
    setStatuses(selectedFiles.map(() => "wait"));
    setPercent(0);
    const allRows: ParsedReviewRow[] = [];
    const totalMs = Math.max(4000, selectedFiles.length * 1200);
    const totalSec = Math.max(1, Math.round(totalMs / 1000));
    let elapsedMs = 0;

    for (let i = 0; i < selectedFiles.length; i += 1) {
      const file = selectedFiles[i];
      const ext = extOf(file);
      setStatuses((prev) => prev.map((s, idx) => (idx === i ? "running" : s)));
      setTitle(`${file.name} 처리 중...`);
      setEta(`약 ${Math.max(1, totalSec - Math.round(elapsedMs / 1000))}초 남음 · 전체 ${totalSec}초 소요 예상`);
      try {
        if (ext === "pdf") {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch(`${STP_API_URL}/api/parse/pdf`, { method: "POST", body: fd });
          if (!res.ok) throw new Error(`PDF 파싱 실패 (${res.status})`);
          const json = (await res.json()) as { materials?: unknown[] };
          allRows.push(...buildRows(json.materials ?? [], "pdf", file.name));
        } else if (ext === "zip" || ext === "stp") {
          const fd = new FormData();
          fd.append("file", file);
          if (bomEnabled && bomFile) fd.append("bom", bomFile);
          const res = await fetch(`${STP_API_URL}/api/parse/stp-zip`, { method: "POST", body: fd });
          if (!res.ok) throw new Error(`STP/ZIP 파싱 실패 (${res.status})`);
          const json = (await res.json()) as { materials?: unknown[] };
          allRows.push(...buildRows(json.materials ?? [], ext === "zip" ? "zip" : "stp", file.name));
        } else if (ext === "dwg") {
          allRows.push({
            id: `${file.name}-dwg-0`,
            checked: true,
            name: "(미확인)",
            file: file.name,
            source: "dwg",
            W: 0,
            D: 0,
            T: 0,
            edge: "없음",
            edgeT: 0,
            hole1: 0,
            hole2: 0,
            extraProcs: [],
            confidence: 0.4,
            warn: "DWG 파싱 — 수동 확인 필요",
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "파싱 중 오류";
        allRows.push({
          id: `${file.name}-err-0`,
          checked: true,
          name: "(오류 항목)",
          file: file.name,
          source: ext === "pdf" ? "pdf" : ext === "dwg" ? "dwg" : "stp",
          W: 0,
          D: 0,
          T: 0,
          edge: "없음",
          edgeT: 0,
          hole1: 0,
          hole2: 0,
          extraProcs: [],
          confidence: 0.2,
          warn: msg,
        });
      }

      elapsedMs += Math.max(900, Math.min(2600, Math.floor(file.size / 1600)));
      const p = i === selectedFiles.length - 1 ? 100 : Math.max(3, Math.min(96, Math.round((elapsedMs / totalMs) * 100)));
      setPercent(p);
      setStatuses((prev) => prev.map((s, idx) => (idx === i ? "done" : s)));
    }

    setStage("done");
    setTitle("✓ 분석 완료!");
    setEta("결과를 확인하세요");
    setPercent(100);
    window.setTimeout(() => {
      onParsedDone(allRows, sourceLabel);
      onClose();
      setStage("form");
      setSelectedFiles([]);
      setBomEnabled(false);
      setBomFile(null);
      setStatuses([]);
      setPercent(0);
      setTitle("파일 분석 중...");
      setEta("예상 소요 시간 계산 중...");
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/35 p-4 font-['Pretendard',system-ui]" role="dialog" aria-modal onClick={onClose}>
      <div className="w-[500px] max-w-[98vw] overflow-hidden rounded-[12px] bg-[#fff] shadow-[0_8px_40px_rgba(0,0,0,.13)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pb-0 pt-5">
          <div className="text-[14px] font-bold text-[#1a1a1a]">도면 / 모델링 업로드</div>
          <button type="button" className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[20px] leading-none text-[#bbb] hover:bg-[#f5f5f5] hover:text-[#444]" onClick={onClose}>
            ×
          </button>
        </div>

        {stage === "form" ? (
          <div className="flex flex-col gap-[14px] px-6 pb-6 pt-[18px]">
            <div
              className={`relative cursor-pointer rounded-[8px] border-2 border-dashed px-5 py-7 text-center transition-all ${dragOn ? "border-[#1a1a1a] bg-[#f5f5f5]" : "border-[#e0e0e0] bg-[#fafafa]"}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOn(true);
              }}
              onDragLeave={() => setDragOn(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOn(false);
                appendFiles(e.dataTransfer.files);
              }}
            >
              <input ref={fileInputRef} className="hidden" type="file" multiple accept=".zip,.stp,.STP,.pdf,.PDF,.dwg,.DWG" onChange={(e) => appendFiles(e.target.files)} />
              <div className="mx-auto mb-[10px] flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#f0f0f0] text-[20px] text-[#777]">↑</div>
              <div className="mb-1 text-[13px] font-semibold text-[#333]">파일을 드래그하거나 클릭해서 선택</div>
              <div className="text-[11px] leading-[1.7] text-[#aaa]">
                ZIP 안에 STP·PDF·DWG가 섞여 있어도 자동 분류됩니다
                <br />
                여러 파일을 한 번에 선택할 수 있어요
              </div>
              <div className="mt-[10px] flex flex-wrap justify-center gap-[5px]">
                <span className="rounded-[4px] border border-[#bfdbfe] bg-[#f0f4ff] px-2 py-[2px] text-[10px] font-semibold text-[#3b82f6]">.zip</span>
                <span className="rounded-[4px] border border-[#bbf7d0] bg-[#f0fdf4] px-2 py-[2px] text-[10px] font-semibold text-[#16a34a]">.stp</span>
                <span className="rounded-[4px] border border-[#fed7aa] bg-[#fff7ed] px-2 py-[2px] text-[10px] font-semibold text-[#ea580c]">.pdf</span>
                <span className="rounded-[4px] border border-[#ddd6fe] bg-[#faf5ff] px-2 py-[2px] text-[10px] font-semibold text-[#7c3aed]">.dwg</span>
              </div>
            </div>

            {selectedFiles.length > 0 ? (
              <div className="flex flex-col gap-[6px]">
                {selectedFiles.map((file) => {
                  const ext = extOf(file);
                  const color = EXT_COLORS[ext] ?? "#16a34a";
                  return (
                    <div key={`${file.name}-${file.size}`} className="flex items-center gap-[9px] rounded-[6px] border border-[#ebebeb] bg-[#f8f8f8] px-[10px] py-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[11px] font-bold text-[#fff]" style={{ background: color }}>
                        {ext.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold text-[#333]">{file.name}</div>
                        <div className="text-[10px] text-[#aaa]">
                          {fileSizeMB(file)} · {ext.toUpperCase()}
                        </div>
                      </div>
                      <button type="button" className="flex h-[22px] w-[22px] items-center justify-center rounded-[3px] text-[15px] text-[#ccc] hover:bg-[#fef2f2] hover:text-[#ef4444]" onClick={() => removeFile(file)}>
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="flex flex-col gap-[6px]">
              <label className="flex cursor-pointer items-center gap-[7px] text-[11px] text-[#666]">
                <input type="checkbox" className="accent-[#1a1a1a]" checked={bomEnabled} onChange={(e) => setBomEnabled(e.target.checked)} />
                BOM 파일도 함께 올리기
                <span className="text-[10px] text-[#bbb]">(파트명 자동 입력)</span>
              </label>
              <div className="ml-[22px] text-[10px] text-[#bbb]">BOM(.bom.3)이 있으면 자재명이 한글로 자동 채워져요</div>
              {bomEnabled ? (
                <div className="relative flex cursor-pointer items-center gap-2 rounded-[6px] border-[1.5px] border-dashed border-[#e8e8e8] px-[14px] py-[10px] hover:border-[#aaa] hover:bg-[#fafafa]" onClick={() => bomInputRef.current?.click()}>
                  <input ref={bomInputRef} className="hidden" type="file" accept=".bom.3,.bom" onChange={(e) => setBomFile(e.target.files?.[0] ?? null)} />
                  <span className="text-[11px] text-[#aaa]">{bomFile ? bomFile.name : ".bom.3 파일 선택"}</span>
                </div>
              ) : null}
            </div>

            <div className="rounded-[6px] bg-[#fafafa] px-3 py-[10px] text-[10px] leading-[1.9] text-[#aaa]">
              📁 STP: Creo에서 <strong>Separate Parts</strong>로 내보낸 ZIP 권장
              <br />
              📄 PDF: 도면 파일에서 치수·파트명 자동 추출
              <br />
              📐 DWG: 치수선·텍스트 기반 추출 (정확도 낮을 수 있음)
              <br />
              <a href="#" className="cursor-pointer text-[#555] underline" onClick={(e) => e.preventDefault()}>
                → STP 내보내기 안내서 보기
              </a>
            </div>

            {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fff5f5] px-3 py-2 text-[12px] text-[#ef4444]">{error}</div> : null}

            <div className="flex justify-end gap-2">
              <button className="rounded-[5px] border border-[#e0e0e0] bg-[#fff] px-4 py-2 text-[12px] font-medium text-[#666] hover:border-[#aaa] hover:text-[#333]" onClick={onClose}>
                취소
              </button>
              <button className="rounded-[5px] border border-[#1a1a1a] bg-[#1a1a1a] px-4 py-2 text-[12px] font-medium text-[#fff] enabled:hover:bg-[#333] disabled:cursor-not-allowed disabled:border-[#ccc] disabled:bg-[#ccc]" disabled={!canStart} onClick={() => void runParse()}>
                분석 시작
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-[26px]">
            <div className="mb-5 flex items-center gap-[14px]">
              <div className="relative h-[52px] w-[52px] shrink-0">
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-[#f0f0f0] border-t-[#1a1a1a]" />
                <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[#1a1a1a]">{percent}%</div>
              </div>
              <div className="flex-1">
                <div className="mb-[3px] text-[13px] font-semibold text-[#1a1a1a]">{title}</div>
                <div className="text-[11px] text-[#888]">{eta}</div>
              </div>
            </div>
            <div className="mb-[14px] h-[6px] overflow-hidden rounded-[3px] bg-[#f0f0f0]">
              <div className="h-full rounded-[3px] bg-[#1a1a1a] transition-all duration-300" style={{ width: `${percent}%` }} />
            </div>
            <div className="flex flex-col gap-[5px]">
              {selectedFiles.map((f, i) => {
                const st = statuses[i] ?? "wait";
                return (
                  <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-[5px] bg-[#f8f8f8] px-2 py-1.5 text-[10px]">
                    <span className={`h-[6px] w-[6px] rounded-full ${st === "done" ? "bg-[#16a34a]" : st === "running" ? "animate-pulse bg-[#3b82f6]" : "bg-[#e0e0e0]"}`} />
                    <span className="flex-1 truncate text-[#555]">{f.name}</span>
                    <span className={`${st === "done" ? "font-semibold text-[#16a34a]" : st === "running" ? "text-[#3b82f6]" : "text-[#aaa]"}`}>
                      {st === "done" ? "완료" : st === "running" ? "처리 중..." : "대기"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


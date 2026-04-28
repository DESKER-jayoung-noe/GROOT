import { useEffect, useMemo, useRef, useState } from "react";
import { Stp3DViewer } from "./Stp3DViewer";
import { PdfViewer } from "./PdfViewer";
import { preloadAllViewers } from "./viewerPreload";
import { SheetSelector } from "../../components/SheetSelector";
import { getSheetPricesForT } from "../../lib/sheetPrices";
import type { SheetId } from "../../lib/yield";

export type ExtraProcType = "forming" | "router" | "ruta2" | "tenoner" | "curvedge" | "custom";
export type ExtraProc = { type: ExtraProcType; label?: string; mm: number; _id: number };

export type ParsedReviewRow = {
  id: string;
  checked: boolean;
  name: string;
  file: string;
  source: "stp" | "pdf" | "dwg" | "zip";
  W: number;
  D: number;
  T: number;
  edge: "4면" | "3면" | "2면" | "1면" | "없음";
  edgeT: number;
  hole1: number;
  hole2: number;
  extraProcs: ExtraProc[];
  confidence: number;
  warn?: string | null;
  /** 백엔드가 추론한 단계 (인디케이터용) */
  edgeCountSource?: string;
  edgeTSource?: string;
  hasEdgeFile?: boolean;
  /** 원본 업로드 파일 — 미리보기용 (ZIP=내부 STP 추출, PDF=직접 렌더) */
  uploadFile?: File;
  /** 사용자가 명시적으로 검토 완료 처리 */
  reviewed?: boolean;
  /** 사용자가 값을 한 번이라도 수정 (자동 검토 트리거) */
  userEdited?: boolean;
  /** 데이터 출처 — STP 만 / PDF 만 / 둘 다 교차검증 */
  sources?: string[];
  /** 사용자가 review 모드에서 선택한 원장 ID (저장 시 form.selectedSheetId 로 사용) */
  selectedSheetId?: string | null;
};

/** 백엔드 source → 신뢰도 레벨 분류 */
type EdgeSourceLevel = "confirmed" | "inferred" | "default";

const CONFIRMED_SOURCES = new Set(["descriptor", "process_code", "material_text", "bb_diff"]);
const INFERRED_SOURCES = new Set(["bb_diff_with_fb", "fb_count", "board_heuristic"]);

function classifyEdgeSource(source?: string): EdgeSourceLevel {
  if (!source) return "default";
  if (CONFIRMED_SOURCES.has(source)) return "confirmed";
  if (INFERRED_SOURCES.has(source)) return "inferred";
  return "default"; // fallback / no_edge_file / default / unknown
}

function rowEdgeOverallLevel(row: ParsedReviewRow): EdgeSourceLevel {
  const cl = classifyEdgeSource(row.edgeCountSource);
  const tl = classifyEdgeSource(row.edgeTSource);
  if (cl === "default" || tl === "default") return "default";
  if (cl === "inferred" || tl === "inferred") return "inferred";
  return "confirmed";
}

const SOURCE_LABELS: Record<string, string> = {
  descriptor: "메타데이터 (EDGE_EA)",
  process_code: "PROCESS_CODE",
  material_text: "MATERIAL 텍스트",
  bb_diff: "엣지파일 BB 비교",
  bb_diff_with_fb: "BB+FB 보정",
  fb_count: "FACEBOUND count 추정",
  board_heuristic: "보드 두께 추론",
  fallback: "폴백 계산",
  no_edge_file: "엣지 파일 없음",
  default: "기본값",
  unknown: "?",
};

type Props = {
  open: boolean;
  sourceLabel: string;
  rows: ParsedReviewRow[];
  onClose: () => void;
  onBack: () => void;
  onRegister: (rows: ParsedReviewRow[]) => void;
};

type EditField = "W" | "D" | "T" | "edgeT";

const PROC_TYPES = [
  { key: "forming" as const,  label: "포밍",           rate: 1 },
  { key: "router" as const,   label: "일반 루타",       rate: 2 },
  { key: "ruta2" as const,    label: "2차 루타",        rate: 1 },
  { key: "tenoner" as const,  label: "테노너",          rate: 0.8 },
  { key: "curvedge" as const, label: "곡면엣지 머시닝", rate: 3 },
];

const PROC_COLORS: Record<string, string> = {
  forming:  "bg-[#fdf4ff] text-[#9333ea]",
  router:   "bg-[#f0fdf4] text-[#16a34a]",
  curvedge: "bg-[#fff7ed] text-[#ea580c]",
  custom:   "bg-[#eff6ff] text-[#2563eb]",
};

const SOURCE_CLASS: Record<ParsedReviewRow["source"], string> = {
  stp: "bg-[#f0fdf4] text-[#16a34a]",
  pdf: "bg-[#fff7ed] text-[#ea580c]",
  dwg: "bg-[#faf5ff] text-[#7c3aed]",
  zip: "bg-[#eff6ff] text-[#3b82f6]",
};

// ─────────────────────────────────────────────────────────────
// 가격 계산 (PB + LPM/O + WW 보드 / ABS + WW 엣지 고정)
// ─────────────────────────────────────────────────────────────

const SHEET_DIM: Record<string, { w: number; h: number }> = {
  "4x6": { w: 1830, h: 1220 },
  "4x8": { w: 2440, h: 1220 },
  "6x8": { w: 2440, h: 1830 },
};
const SHEET_AREA: Record<string, number> = {
  "4x6": (1830 * 1220) / 1_000_000,
  "4x8": (2440 * 1220) / 1_000_000,
  "6x8": (2440 * 1830) / 1_000_000,
};

const BOARD_PRICE_WW: Record<number, Partial<Record<string, number>>> = {
  9:  { "4x8": 4500,  "6x8": 4400 },
  12: { "4x8": 5200,  "6x8": 5100 },
  15: { "4x8": 5985,  "6x8": 5878 },
  18: { "4x8": 7226,  "6x8": 6920 },
  22: { "4x8": 8500,  "6x8": 8200 },
  25: { "4x8": 9800,  "6x8": 9500 },
  28: { "4x8": 11000, "6x8": 10700 },
};

const ABS_EDGE_PRICE_WW: Record<number, Partial<Record<number, number>>> = {
  9:  { 1: 139 },
  12: { 1: 139 },
  15: { 1: 166, 2: 251 },
  18: { 1: 184, 2: 271 },
  22: { 1: 224, 2: 338 },
  25: { 1: 280, 2: 439 },
  28: { 1: 280, 2: 439 },
};

const HOTMELT_PRICE: Record<number, number> = {
  9: 60, 12: 72, 15: 85, 18: 99, 22: 116, 25: 130, 28: 143,
};

function edgeStringToCount(edge: ParsedReviewRow["edge"]): number {
  switch (edge) {
    case "4면": return 4;
    case "3면": return 3;
    case "2면": return 2;
    case "1면": return 1;
    default:    return 0;
  }
}

function calcMaterialPrice(row: ParsedReviewRow): number {
  const W = row.W || 0;
  const D = row.D || 0;
  const Tnorm = Math.floor(row.T || 0); // 15.5 → 15 단가 매핑
  if (W === 0 || D === 0 || Tnorm === 0) return 0;

  // 1. 정소요량 (여유 +10mm)
  const reqArea = ((W + 10) * (D + 10)) / 1_000_000;

  // 2. 최적 원장 선택 (수율 최고)
  let bestYield = 0;
  let bestPriceM2 = 0;
  for (const sheet of ["4x6", "4x8", "6x8"]) {
    const { w: sW, h: sH } = SHEET_DIM[sheet];
    const sheetPrice = BOARD_PRICE_WW[Tnorm]?.[sheet] ?? 0;
    if (!sheetPrice) continue;
    const n1 = Math.floor(sW / (W + 10)) * Math.floor(sH / (D + 10));
    const n2 = Math.floor(sW / (D + 10)) * Math.floor(sH / (W + 10));
    const n  = Math.max(n1, n2);
    if (n === 0) continue;
    const yieldRate = (n * reqArea) / SHEET_AREA[sheet];
    if (yieldRate > bestYield) {
      bestYield = yieldRate;
      bestPriceM2 = sheetPrice;
    }
  }

  // 3. 원판재비
  const realArea  = bestYield > 0 ? reqArea / bestYield : reqArea;
  const boardCost = realArea * bestPriceM2;

  // 4. 엣지비 (ABS, WW)
  const edgeCount = edgeStringToCount(row.edge);
  const edgeT     = Math.round(row.edgeT) || 1;
  const edgePrice = ABS_EDGE_PRICE_WW[Tnorm]?.[edgeT] ?? 0;

  let edgeLength = 0;
  if      (edgeCount === 4) edgeLength = ((W + 50) + (D + 50)) * 2 / 1000;
  else if (edgeCount === 3) edgeLength = ((W + 50) + (D + 50) * 2) / 1000;
  else if (edgeCount === 2) edgeLength = (W + 50) * 2 / 1000;
  else if (edgeCount === 1) edgeLength = (W + 50) / 1000;

  const edgeCost = edgeLength * edgePrice;

  // 5. 핫멜트 (엣지 면적 기준)
  const hotmeltPriceM2 = HOTMELT_PRICE[Tnorm] ?? 0;
  const hotmeltArea    = edgeLength * (Tnorm / 1000);
  const hotmeltCost    = hotmeltArea * hotmeltPriceM2;

  return Math.round(boardCost + edgeCost + hotmeltCost);
}

// ─────────────────────────────────────────────────────────────
// 가공비 (보링 + 2단 보링 + 추가 가공)
// ─────────────────────────────────────────────────────────────

const PROCESS_PRICE = {
  boring:  100, // 원/개
  boring2: 200, // 원/개
};

function calcProcessCost(row: ParsedReviewRow): number {
  const b1 = (row.hole1 || 0) * PROCESS_PRICE.boring;
  const b2 = (row.hole2 || 0) * PROCESS_PRICE.boring2;
  const extra = row.extraProcs.reduce((sum, p) => {
    const pt = PROC_TYPES.find((x) => x.key === p.type);
    const rate = pt ? pt.rate : 1; // 원/mm
    return sum + (p.mm || 0) * rate;
  }, 0);
  return Math.round(b1 + b2 + extra);
}

function calcTotalCost(row: ParsedReviewRow): number {
  return calcMaterialPrice(row) + calcProcessCost(row);
}

// ─────────────────────────────────────────────────────────────
// 신뢰도
// ─────────────────────────────────────────────────────────────

type ConfidenceResult = {
  level: "high" | "medium" | "low";
  label: "높음" | "보통" | "낮음";
  issues: string[];
};

const STD_THICKNESS = [4.5, 9, 12, 15, 15.5, 18, 18.5, 22, 22.5, 25, 28, 28.5, 33];

function computeRowConfidence(row: ParsedReviewRow): ConfidenceResult {
  const issues: string[] = [];

  if (!row.W || !row.D || !row.T) issues.push("치수 누락");
  if (row.W > 4000 || row.D > 4000) issues.push("비정상 치수");
  if ((row.W > 0 && row.W < 50) || (row.D > 0 && row.D < 50)) issues.push("치수 너무 작음");
  if (row.W > 0 && row.D > 0 && row.D > row.W * 5) issues.push("W/D 비율 비정상");
  if (row.edge === "없음") issues.push("엣지 정보 없음");
  if (row.warn?.includes("엣지 파일 없음")) issues.push("엣지 파일 없음");

  // 엣지 추론 단계 반영
  const edgeLvl = rowEdgeOverallLevel(row);
  if (edgeLvl === "default") issues.push("엣지 정보 기본값 사용");
  else if (edgeLvl === "inferred") issues.push("엣지 정보 추론됨");

  if (row.T > 0) {
    const closest = STD_THICKNESS.reduce((p, c) =>
      Math.abs(c - row.T) < Math.abs(p - row.T) ? c : p
    );
    if (Math.abs(closest - row.T) > 1.0) issues.push("두께 비표준");
  }

  if (issues.length === 0) return { level: "high",   label: "높음", issues };
  if (issues.length <= 1)  return { level: "medium", label: "보통", issues };
  return                     { level: "low",    label: "낮음", issues };
}

// 신뢰도 dot — 신호등 (초록/노랑/빨강)
const CONF_DOT_BG: Record<ConfidenceResult["level"], string> = {
  high:   "#16a34a",
  medium: "#eab308",
  low:    "#dc2626",
};

// ─────────────────────────────────────────────────────────────
// 행/필드 단위 상태 (확실/추론/확인)
// ─────────────────────────────────────────────────────────────

type ReviewStatus = "confirmed" | "inferred" | "low";

const STATUS_LABEL_KO: Record<ReviewStatus, string> = {
  confirmed: "확실",
  inferred:  "추론",
  low:       "확인",
};

const STATUS_BADGE_STYLE: Record<ReviewStatus, { bg: string; fg: string }> = {
  confirmed: { bg: "#E8F5E9", fg: "#16a34a" },
  inferred:  { bg: "#FEF3C7", fg: "#D97706" },
  low:       { bg: "#FFF1EE", fg: "#FF5948" },
};

function rowOverallStatus(row: ParsedReviewRow): ReviewStatus {
  const lvl = computeRowConfidence(row).level;
  return lvl === "high" ? "confirmed" : lvl === "medium" ? "inferred" : "low";
}

/** 치수(W/D/T) 신뢰 단계: 누락/이상치는 확인, 두께 비표준은 추론, 정상은 확실 */
function dimensionStatus(row: ParsedReviewRow): ReviewStatus {
  if (!row.W || !row.D || !row.T) return "low";
  if (row.W > 4000 || row.D > 4000) return "low";
  if ((row.W > 0 && row.W < 50) || (row.D > 0 && row.D < 50)) return "low";
  if (row.W > 0 && row.D > 0 && row.D > row.W * 5) return "low";
  if (row.T > 0) {
    const closest = STD_THICKNESS.reduce((p, c) =>
      Math.abs(c - row.T) < Math.abs(p - row.T) ? c : p,
    );
    if (Math.abs(closest - row.T) > 1.0) return "inferred";
  }
  return "confirmed";
}

/** 엣지 신뢰 단계: rowEdgeOverallLevel 변환 */
function edgeFieldStatus(row: ParsedReviewRow): ReviewStatus {
  const lvl = rowEdgeOverallLevel(row);
  if (lvl === "default") return "low";
  if (lvl === "inferred") return "inferred";
  return "confirmed";
}

/** 보링 신뢰 단계 — 명시적 source가 없으므로 항상 확실 */
function boringFieldStatus(_row: ParsedReviewRow): ReviewStatus {
  return "confirmed";
}

/** 작은 상태 배지 — '확실/추론/확인' 또는 '치수 추론' 같은 컴포지트 라벨 표시 */
function StatusBadge({
  status,
  label,
  title,
  compact = false,
}: {
  status: ReviewStatus;
  label?: string;
  title?: string;
  compact?: boolean;
}) {
  const s = STATUS_BADGE_STYLE[status];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: compact ? "0 5px" : "1px 7px",
        fontSize: compact ? 9 : 10,
        fontWeight: 600,
        background: s.bg,
        color: s.fg,
        borderRadius: 3,
        lineHeight: compact ? "14px" : "16px",
        whiteSpace: "nowrap",
      }}
    >
      {label ?? STATUS_LABEL_KO[status]}
    </span>
  );
}

export function ReviewModal({ open, sourceLabel, rows, onClose, onBack, onRegister }: Props) {
  const [items, setItems] = useState<ParsedReviewRow[]>(rows);
  const [editing, setEditing] = useState<{ id: string; field: EditField } | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [nameColWidth, setNameColWidth] = useState(250);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // 한 자재씩 검토하는 review 모드 (기본은 list 모드)
  const [viewMode, setViewMode] = useState<"list" | "review">("list");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  // 추가 가공 드롭다운 (review 모드 전용)
  const [reviewProcDropOpen, setReviewProcDropOpen] = useState(false);
  const [reviewCustomProc, setReviewCustomProc] = useState("");

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: nameColWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const next = Math.max(150, Math.min(500, dragRef.current.startWidth + delta));
      setNameColWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const original = useMemo(() => {
    const map = new Map<string, ParsedReviewRow>();
    rows.forEach((r) => map.set(r.id, { ...r }));
    return map;
  }, [rows]);

  useEffect(() => { setItems(rows); }, [rows]);

  useEffect(() => {
    if (!openDropdownId) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".proc-dd-wrap")) setOpenDropdownId(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openDropdownId]);

  // 검토 모드 네비게이션
  const reviewItems = items.filter((r) => r.checked);
  const safeIdx = Math.min(Math.max(0, currentIdx), Math.max(0, reviewItems.length - 1));
  const currentRow = reviewItems[safeIdx];
  const goPrev = () => setCurrentIdx((i) => Math.max(0, i - 1));
  const goNext = () => {
    // 다음 미검토 ⚠ (신뢰도 낮음 + reviewed=false) 항목으로 점프
    const nextLowIdx = reviewItems.findIndex(
      (r, idx) => idx > safeIdx && computeRowConfidence(r).level === "low" && !r.reviewed
    );
    if (nextLowIdx >= 0) {
      setCurrentIdx(nextLowIdx);
      return;
    }
    // 모든 ⚠ 검토 완료 → 일반 다음 인덱스
    const hasUnreviewed = reviewItems.some(
      (r) => computeRowConfidence(r).level === "low" && !r.reviewed
    );
    if (!hasUnreviewed && reviewItems.some((r) => computeRowConfidence(r).level === "low")) {
      setToast("모든 확인 항목 검토 완료");
      setTimeout(() => setToast(null), 1800);
    }
    setCurrentIdx((i) => Math.min(reviewItems.length - 1, i + 1));
  };
  const startReviewMode = () => {
    if (reviewItems.length === 0) return;
    // 무거운 라이브러리 백그라운드 import 시작 (await 안 함)
    preloadAllViewers();
    setCurrentIdx(0);
    setViewMode("review");
  };
  const exitReviewMode = () => setViewMode("list");
  const markSaved = (id: string) => setSavedIds((prev) => new Set(prev).add(id));
  const saveCurrent = () => {
    if (currentRow) markSaved(currentRow.id);
  };
  const saveAndNext = () => {
    saveCurrent();
    if (safeIdx < reviewItems.length - 1) goNext();
  };

  // 키보드 단축키 (review 모드 전용)
  useEffect(() => {
    if (!open || viewMode !== "review") return;
    const isInputFocused = () => {
      const ae = document.activeElement;
      if (!ae) return false;
      const tag = ae.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae as HTMLElement).isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && !isInputFocused()) { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight" && !isInputFocused()) { e.preventDefault(); goNext(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveAndNext(); }
      else if (e.key === "Escape") { e.preventDefault(); exitReviewMode(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewMode, safeIdx, reviewItems.length]);

  if (!open) return null;

  const selectedCount = items.filter((r) => r.checked).length;
  // 신뢰도 기반 카운터 (확실 / 추론 / 확인) + reviewed 반영
  let confirmedCount = 0, inferredCount = 0, lowCount = 0, lowUnreviewedCount = 0, lowReviewedCount = 0;
  for (const r of items) {
    const lvl = computeRowConfidence(r).level;
    if (lvl === "high") confirmedCount++;
    else if (lvl === "medium") inferredCount++;
    else {
      lowCount++;
      if (r.reviewed) lowReviewedCount++;
      else lowUnreviewedCount++;
    }
  }
  const allReviewed = lowCount > 0 && lowUnreviewedCount === 0;
  const totalSelectedAmount = items
    .filter((r) => r.checked)
    .reduce((sum, r) => sum + calcTotalCost(r), 0);

  // 일반 보링 값 변경 (chip 안 입력)
  const updateHole = (rowId: string, field: "hole1" | "hole2", value: number) => {
    setItems((prev) =>
      prev.map((it) => (it.id === rowId ? { ...it, [field]: Math.max(0, value) } : it))
    );
  };

  const addPresetProc = (rowId: string, type: ExtraProcType) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId ? { ...it, extraProcs: [...it.extraProcs, { type, mm: 0, _id: Date.now() }] } : it
      )
    );
    setOpenDropdownId(null);
  };

  const addCustomProc = (rowId: string) => {
    const name = customNames[rowId]?.trim();
    if (!name) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId
          ? { ...it, extraProcs: [...it.extraProcs, { type: "custom", label: name, mm: 0, _id: Date.now() }] }
          : it
      )
    );
    setCustomNames((prev) => ({ ...prev, [rowId]: "" }));
    setOpenDropdownId(null);
  };

  const delProc = (rowId: string, procId: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId ? { ...it, extraProcs: it.extraProcs.filter((ep) => ep._id !== procId) } : it
      )
    );
  };

  const updateProcMm = (rowId: string, procId: number, val: number) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === rowId
          ? { ...it, extraProcs: it.extraProcs.map((ep) => (ep._id === procId ? { ...ep, mm: val } : ep)) }
          : it
      )
    );
  };

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/35 p-4 font-['Pretendard',system-ui]"
      role="dialog"
      aria-modal
    >
      <div
        className="flex max-h-[88vh] flex-col overflow-hidden rounded-[12px] bg-[#fff] shadow-[0_8px_40px_rgba(0,0,0,.13)]"
        style={{
          width: "min(1320px, 98vw)",
          fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif",
          fontFeatureSettings: "'tnum' 1",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#f0f0f0] px-[22px] py-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[#1a1a1a]">
              도면/모델링 분석 결과 <span className="text-[11px] font-normal text-[#bbb]">{sourceLabel}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-[#aaa]">
              더블클릭으로 수치 수정 · 보링·루터는 직접 입력 · 체크박스로 등록할 자재 선택
            </div>
          </div>
          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px]">
              <span className="text-[11px]" style={{ color: "#7E7E7E" }}>선택 합계</span>
              <span
                className="text-[15px] font-bold"
                style={{
                  fontFamily: "Pretendard, system-ui",
                  fontFeatureSettings: "'tnum' 1",
                  color: "#282828",
                }}
              >
                ₩{totalSelectedAmount.toLocaleString()}
              </span>
            </div>
            <span className="text-[#e0e0e0]">·</span>
            <div className="flex gap-[5px]">
              <span
                title="자동 추출이 정확한 자재 — 검토 불필요"
                className="rounded-[4px] px-2 py-[3px] text-[10px] font-semibold"
                style={{ background: STATUS_BADGE_STYLE.confirmed.bg, color: STATUS_BADGE_STYLE.confirmed.fg }}
              >
                ✓ 확실 {confirmedCount}
              </span>
              <span
                title="일부 정보 추론됨 — 검토 권장"
                className="rounded-[4px] px-2 py-[3px] text-[10px] font-semibold"
                style={{ background: STATUS_BADGE_STYLE.inferred.bg, color: STATUS_BADGE_STYLE.inferred.fg }}
              >
                ◐ 추론 {inferredCount}
              </span>
              {lowCount > 0 ? (
                <span
                  title={
                    allReviewed
                      ? `${lowCount}개 모두 검토 완료`
                      : `${lowUnreviewedCount}개 미검토 — 반드시 확인 필요`
                  }
                  className="rounded-[4px] px-2 py-[3px] text-[10px] font-semibold"
                  style={{ background: STATUS_BADGE_STYLE.low.bg, color: STATUS_BADGE_STYLE.low.fg }}
                >
                  ⚠ 확인 {lowCount}
                </span>
              ) : null}
              {allReviewed ? (
                <span
                  title="모든 확인 항목 검토 완료"
                  className="rounded-[4px] px-2 py-[3px] text-[10px] font-semibold"
                  style={{ background: "#E8F5E9", color: "#16a34a" }}
                >
                  ✓ 모두 검토됨
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={() => {
              if (allReviewed) {
                onRegister(items.filter((r) => r.checked));
              } else {
                startReviewMode();
              }
            }}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: selectedCount === 0 ? "#D6D6D6" : "#282828",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: selectedCount === 0 ? "not-allowed" : "pointer",
              boxShadow: allReviewed ? "0 0 0 2px #16a34a inset" : "none",
            }}
          >
            {allReviewed ? "등록하기 →" : "검토하기 →"}
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-[4px] text-[20px] leading-none text-[#bbb] hover:bg-[#f5f5f5] hover:text-[#444]"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Table — list 모드에서만 */}
        {viewMode === "list" && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse" style={{ minWidth: "1100px" }}>
            <thead>
              <tr className="sticky top-0 z-[1] bg-[#fafafa]">
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-left text-[10px] font-semibold text-[#aaa]" style={{ width: "30px" }}>
                  <input
                    type="checkbox"
                    className="h-[14px] w-[14px] cursor-pointer accent-[#1a1a1a]"
                    checked={selectedCount === items.length && items.length > 0}
                    onChange={(e) => setItems((prev) => prev.map((r) => ({ ...r, checked: e.target.checked })))}
                  />
                </th>
                <th
                  className="relative border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-left text-[10px] font-semibold text-[#aaa]"
                  style={{ width: nameColWidth, minWidth: 150, maxWidth: 500 }}
                >
                  자재명 <span className="font-normal text-[#ddd]">✎</span>
                  <div
                    onMouseDown={onResizeMouseDown}
                    title="드래그로 너비 조정"
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize select-none hover:bg-[#e5e5e5]"
                  />
                </th>
                <th
                  className="border-b-2 border-[#f0f0f0] bg-[#F0F0F0] px-[10px] py-[7px] text-right text-[10px] font-semibold text-[#282828]"
                  style={{ width: "92px" }}
                >
                  원재료비
                </th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "36px" }}>소스</th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "60px" }}>W <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "60px" }}>D <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "50px" }}>T <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "78px" }}>엣지 <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "60px" }}>엣지 T <span className="font-normal text-[#ddd]">✎</span></th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "62px" }}>일반 보링</th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "150px" }}>추가 가공</th>
                <th
                  className="border-b-2 border-[#f0f0f0] bg-[#F0F0F0] px-[10px] py-[7px] text-right text-[10px] font-semibold text-[#282828]"
                  style={{ width: "84px" }}
                >
                  가공비
                </th>
                <th
                  className="border-b-2 border-[#f0f0f0] bg-[#F0F0F0] px-[10px] py-[7px] text-right text-[10px] font-semibold text-[#282828]"
                  style={{ width: "100px" }}
                >
                  합계
                </th>
                <th className="border-b-2 border-[#f0f0f0] px-[10px] py-[7px] text-center text-[10px] font-semibold text-[#aaa]" style={{ width: "60px" }}>신뢰도</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const orig = original.get(row.id) ?? row;
                const isErr = row.confidence < 0.5;
                const isWarn = !isErr && (row.confidence < 0.65 || row.edge === "없음" || Boolean(row.warn));
                const changed = (k: keyof ParsedReviewRow) => row[k] !== orig[k];
                const nameChanged = row.name !== orig.name;
                return (
                  <tr key={row.id} className="border-b border-[#f5f5f5] text-[11px] hover:bg-[#fafafa]">
                    {/* Checkbox */}
                    <td className={`px-[10px] py-[7px] ${isErr ? "border-l-[3px] border-[#ef4444]" : isWarn ? "border-l-[3px] border-[#f59e0b]" : ""}`}>
                      <input
                        type="checkbox"
                        className="h-[14px] w-[14px] cursor-pointer accent-[#1a1a1a]"
                        checked={row.checked}
                        onChange={(e) =>
                          setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, checked: e.target.checked } : it)))
                        }
                      />
                    </td>
                    {/* Name — 목록 모드에서는 칩 없이 자재명만 (높이 최소화).
                        상태 칩은 검토하기(review) 모드 sub-header 와 신뢰도 컬럼에서 표시. */}
                    <td className="px-[10px] py-[7px]">
                      <input
                        className={`name-inp${nameChanged ? " changed" : ""}`}
                        value={row.name}
                        onChange={(e) =>
                          setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, name: e.target.value } : it)))
                        }
                      />
                      {row.warn ? (
                        <div className="mt-[2px] inline-block rounded-[3px] border border-[#fde68a] bg-[#fffbeb] px-[5px] py-[1px] text-[9px] text-[#d97706]">
                          {row.warn}
                        </div>
                      ) : null}
                      <div className="mt-[1px] text-[9px] text-[#bbb]">{row.file}</div>
                    </td>
                    {/* Price (원재료비) — 데스커 블랙 */}
                    <td
                      className="px-[10px] py-[7px] text-right whitespace-nowrap"
                      style={{
                        fontFamily: "Pretendard, system-ui",
                        fontFeatureSettings: "'tnum' 1",
                        fontSize: 13,
                        fontWeight: 500,
                        color: calcMaterialPrice(row) > 0 ? "#282828" : "#B3B3B3",
                      }}
                    >
                      {(() => {
                        const p = calcMaterialPrice(row);
                        return p > 0 ? `₩${p.toLocaleString()}` : "₩0";
                      })()}
                    </td>
                    {/* Source */}
                    <td className="px-[10px] py-[7px] text-center">
                      <span className={`rounded-[3px] px-[5px] py-[1px] text-[9px] font-bold ${SOURCE_CLASS[row.source]}`}>
                        {row.source.toUpperCase()}
                      </span>
                    </td>
                    {/* W / D / T — dbl-click edit (좁은 셀) */}
                    {(["W", "D", "T"] as const).map((field) => (
                      <td
                        key={field}
                        className="px-[6px] py-[7px] text-center text-[11px]"
                        style={{ fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1" }}
                      >
                        {editing?.id === row.id && editing.field === field ? (
                          <input
                            autoFocus
                            type="number"
                            step={field === "T" ? 0.5 : 1}
                            defaultValue={row[field]}
                            className="h-[22px] w-[44px] rounded-[3px] border-[1.5px] border-[#1a1a1a] bg-[#fff] text-center text-[11px] outline-none"
                            style={{ fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1" }}
                            onBlur={(e) => {
                              const v = Number.parseFloat(e.target.value) || 0;
                              setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, [field]: v } : it)));
                              setEditing(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                            }}
                          />
                        ) : (
                          <span
                            title="더블클릭으로 수정"
                            onDoubleClick={() => setEditing({ id: row.id, field })}
                            className={`inline-block min-w-[36px] cursor-text rounded-[3px] px-1 py-[2px] text-right ${
                              changed(field) ? "bg-[#fffbeb] font-semibold text-[#d97706]" : "hover:bg-[#f0f0f0]"
                            }`}
                          >
                            {field === "T" ? Math.floor(row[field]) : (Number.isInteger(row[field]) ? row[field] : row[field].toFixed(1))}
                          </span>
                        )}
                      </td>
                    ))}
                    {/* Edge */}
                    <td className="px-[10px] py-[7px] text-center">
                      {(() => {
                        const efs = edgeFieldStatus(row);
                        const tipLines = [
                          `면수 추출: ${SOURCE_LABELS[row.edgeCountSource ?? "unknown"] ?? row.edgeCountSource ?? "?"}`,
                          `두께 추출: ${SOURCE_LABELS[row.edgeTSource ?? "unknown"] ?? row.edgeTSource ?? "?"}`,
                        ];
                        return (
                          <div className="inline-flex items-center gap-[3px] align-middle">
                            <select
                              className="h-[22px] rounded-[3px] border border-[#e0e0e0] bg-[#fff] px-1 text-[10px] outline-none focus:border-[#1a1a1a]"
                              value={row.edge}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((it) =>
                                    it.id === row.id ? { ...it, edge: e.target.value as ParsedReviewRow["edge"] } : it
                                  )
                                )
                              }
                            >
                              <option>4면</option>
                              <option>3면</option>
                              <option>2면</option>
                              <option>1면</option>
                              <option>없음</option>
                            </select>
                            {efs !== "confirmed" && (
                              <StatusBadge
                                status={efs}
                                compact
                                title={`엣지 ${STATUS_LABEL_KO[efs]}\n${tipLines.join("\n")}`}
                              />
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    {/* EdgeT */}
                    <td className="px-[10px] py-[7px] text-center font-mono text-[11px]">
                      {editing?.id === row.id && editing.field === "edgeT" ? (
                        <input
                          autoFocus
                          type="number"
                          step={0.5}
                          defaultValue={row.edgeT}
                          className="h-[22px] w-[56px] rounded-[3px] border-[1.5px] border-[#1a1a1a] bg-[#fff] text-center text-[11px] outline-none"
                          onBlur={(e) => {
                            const v = Number.parseFloat(e.target.value) || 0;
                            setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, edgeT: v } : it)));
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      ) : (
                        <span
                          title="더블클릭으로 수정"
                          onDoubleClick={() => setEditing({ id: row.id, field: "edgeT" })}
                          className={`inline-block min-w-[28px] cursor-text rounded-[3px] px-1 py-[2px] ${
                            changed("edgeT") ? "bg-[#fffbeb] font-semibold text-[#d97706]" : "hover:bg-[#f0f0f0]"
                          }`}
                        >
                          {row.edgeT > 0 ? `${row.edgeT}T` : "—"}
                        </span>
                      )}
                    </td>
                    {/* 일반 보링 (hole1) — 2단보링은 추가가공으로 통합됨 */}
                    <td className="px-[10px] py-[7px] text-center">
                      <input
                        type="number"
                        min={0}
                        value={row.hole1}
                        className={`h-[22px] w-[44px] rounded-[3px] border text-center text-[11px] outline-none focus:border-[#1a1a1a] ${
                          changed("hole1")
                            ? "border-[#f59e0b] bg-[#fffbeb] text-[#d97706]"
                            : "border-[#e0e0e0] bg-[#fff]"
                        }`}
                        style={{ fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1" }}
                        onChange={(e) => updateHole(row.id, "hole1", Number(e.target.value) || 0)}
                      />
                    </td>
                    {/* Extra procs (2단보링 + 추가 가공 통합) */}
                    <td className="px-[8px] py-[6px]">
                      <div className="flex flex-wrap items-center gap-[3px]">
                        {row.hole2 > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-[3px] bg-[#fef3c7] px-[7px] py-[2px] text-[10px] font-medium text-[#b45309]"
                            style={{ fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1" }}
                          >
                            2단보링
                            <input
                              type="number"
                              min={0}
                              value={row.hole2}
                              style={{
                                width: "32px", height: "16px", border: "none", borderBottom: "1px solid #d4a574",
                                background: "transparent", fontSize: "10px", textAlign: "center",
                                outline: "none", margin: "0 2px",
                                fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1",
                              }}
                              onChange={(e) => updateHole(row.id, "hole2", Number(e.target.value) || 0)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span style={{ fontSize: "9px", color: "#a78550" }}>개</span>
                            <button
                              type="button"
                              className="flex h-[14px] w-[14px] items-center justify-center border-0 bg-transparent p-0 text-[12px] leading-none text-[#bbb] hover:text-[#ef4444]"
                              onClick={() => updateHole(row.id, "hole2", 0)}
                            >
                              ×
                            </button>
                          </span>
                        ) : null}
                        {row.extraProcs.map((ep) => (
                          <span
                            key={ep._id}
                            className={`inline-flex items-center gap-1 rounded-[3px] px-[7px] py-[2px] text-[10px] font-medium ${PROC_COLORS[ep.type] ?? PROC_COLORS.custom}`}
                          >
                            {ep.label ?? PROC_TYPES.find((p) => p.key === ep.type)?.label ?? ep.type}
                            <input
                              type="number"
                              min={0}
                              value={ep.mm}
                              style={{
                                width: "38px", height: "16px", border: "none", borderBottom: "1px solid #ccc",
                                background: "transparent", fontSize: "9px", textAlign: "center",
                                outline: "none", fontFamily: "monospace", margin: "0 2px",
                              }}
                              onChange={(e) => updateProcMm(row.id, ep._id, parseFloat(e.target.value) || 0)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span style={{ fontSize: "9px", color: "#aaa" }}>mm</span>
                            <button
                              type="button"
                              className="flex h-[14px] w-[14px] items-center justify-center border-0 bg-transparent p-0 text-[12px] leading-none text-[#bbb] hover:text-[#ef4444]"
                              onClick={() => delProc(row.id, ep._id)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <div className="proc-dd-wrap relative inline-block">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-[4px] border border-dashed border-[#e0e0e0] bg-transparent px-2 py-[3px] text-[10px] text-[#aaa] transition-all hover:border-[#aaa] hover:bg-[#fafafa] hover:text-[#555]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId((id) => (id === row.id ? null : row.id));
                            }}
                          >
                            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            가공 추가
                          </button>
                          {openDropdownId === row.id && (
                            <div
                              className="absolute z-50 mt-1 min-w-[240px] overflow-hidden rounded-[8px] border border-[#e0e0e0] bg-[#fff] shadow-[0_6px_20px_rgba(0,0,0,.12)]"
                              style={{ left: 0, top: "100%" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="border-b border-[#f0f0f0] px-[12px] py-[8px] text-[10px] font-bold uppercase tracking-[.06em] text-[#aaa]">
                                가공 종류 선택
                              </div>
                              {/* 2단 보링 — hole2 카운트 사용 */}
                              <div
                                className="flex cursor-pointer items-center justify-between px-[14px] py-[8px] text-[11px] text-[#333] hover:bg-[#f5f5f5]"
                                onClick={() => {
                                  if (row.hole2 === 0) updateHole(row.id, "hole2", 1);
                                  setOpenDropdownId(null);
                                }}
                              >
                                <span className="font-medium">2단 보링</span>
                                <span className="text-[10px] text-[#aaa]">{PROCESS_PRICE.boring2}원/개 · 개수 입력</span>
                              </div>
                              {PROC_TYPES.map((pt) => (
                                <div
                                  key={pt.key}
                                  className="flex cursor-pointer items-center justify-between px-[14px] py-[8px] text-[11px] text-[#333] hover:bg-[#f5f5f5]"
                                  onClick={() => addPresetProc(row.id, pt.key)}
                                >
                                  <span className="font-medium">{pt.label}</span>
                                  <span className="text-[10px] text-[#aaa]">{pt.rate * 1000}원/m · mm 입력</span>
                                </div>
                              ))}
                              <div className="my-1 h-[1px] bg-[#f0f0f0]" />
                              <div className="flex items-center gap-[6px] px-[14px] py-[8px]">
                                <input
                                  placeholder="직접 입력 (가공명)"
                                  className="h-[26px] flex-1 rounded-[4px] border border-[#e0e0e0] px-2 text-[11px] outline-none focus:border-[#1a1a1a]"
                                  value={customNames[row.id] ?? ""}
                                  onChange={(e) =>
                                    setCustomNames((prev) => ({ ...prev, [row.id]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") addCustomProc(row.id);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="rounded-[4px] border border-[#1a1a1a] bg-[#1a1a1a] px-[10px] py-1 text-[11px] text-[#fff] hover:bg-[#333]"
                                  onClick={() => addCustomProc(row.id)}
                                >
                                  추가
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* 가공비 — 데스커 블랙 (서브) */}
                    {(() => {
                      const proc = calcProcessCost(row);
                      const total = calcMaterialPrice(row) + proc;
                      return (
                        <>
                          <td
                            className="px-[10px] py-[7px] text-right whitespace-nowrap"
                            style={{
                              fontFamily: "Pretendard, system-ui",
                              fontFeatureSettings: "'tnum' 1",
                              fontSize: 13,
                              fontWeight: 500,
                              color: proc > 0 ? "#282828" : "#B3B3B3",
                            }}
                          >
                            ₩{proc.toLocaleString()}
                          </td>
                          {/* 합계 — 메인 금액 (가장 강조) */}
                          <td
                            className="px-[10px] py-[7px] text-right whitespace-nowrap"
                            style={{
                              fontFamily: "Pretendard, system-ui",
                              fontFeatureSettings: "'tnum' 1",
                              fontSize: 14,
                              fontWeight: 700,
                              color: total > 0 ? "#282828" : "#B3B3B3",
                              background: total > 0 ? "#F0F0F0" : undefined,
                            }}
                          >
                            ₩{total.toLocaleString()}
                          </td>
                        </>
                      );
                    })()}
                    {/* Confidence */}
                    <td className="px-[10px] py-[7px] text-center">
                      {(() => {
                        const conf = computeRowConfidence(row);
                        const overall = rowOverallStatus(row);
                        return (
                          <div className="inline-flex items-center gap-[4px] align-middle">
                            <StatusBadge
                              status={overall}
                              title={conf.issues.length > 0 ? conf.issues.join(", ") : `전체 신뢰도: ${STATUS_LABEL_KO[overall]}`}
                            />
                            {conf.issues.length > 0 ? (
                              <span
                                title={conf.issues.join(", ")}
                                className="cursor-help text-[10px] text-[#ef4444]"
                              >
                                ⓘ
                              </span>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}

        {/* Review 모드 — 1자재씩 미리보기 + 편집 */}
        {viewMode === "review" && currentRow && (() => {
          const row = currentRow;
          const ext = (row.file || "").toLowerCase().split(".").pop() ?? "";
          const isStp = ext === "stp" || ext === "step";
          const isPdf = ext === "pdf";
          const matCost = calcMaterialPrice(row);
          const procCost = calcProcessCost(row);
          const total = matCost + procCost;
          const conf = computeRowConfidence(row);
          const isSaved = savedIds.has(row.id);
          // 자동 검토 처리: W/D/T/엣지/엣지T/보링/추가가공 변경 시 reviewed=true + userEdited=true
          const updateRow = (patch: Partial<ParsedReviewRow>) =>
            setItems((prev) => prev.map((it) =>
              it.id === row.id ? { ...it, ...patch, userEdited: true, reviewed: true } : it
            ));
          const setReviewed = (val: boolean) =>
            setItems((prev) => prev.map((it) =>
              it.id === row.id ? { ...it, reviewed: val } : it
            ));
          // 추가 가공 핸들러 (자동 검토 트리거)
          const addProc = (type: ExtraProcType, label?: string) => {
            setItems((prev) => prev.map((it) =>
              it.id === row.id
                ? { ...it, extraProcs: [...it.extraProcs, { type, label, mm: 0, _id: Date.now() + Math.random() }], userEdited: true, reviewed: true }
                : it
            ));
            setReviewProcDropOpen(false);
          };
          const updateProcMmInRow = (procId: number, mm: number) => {
            setItems((prev) => prev.map((it) =>
              it.id === row.id
                ? { ...it, extraProcs: it.extraProcs.map((ep) => ep._id === procId ? { ...ep, mm } : ep), userEdited: true, reviewed: true }
                : it
            ));
          };
          const delProcInRow = (procId: number) => {
            setItems((prev) => prev.map((it) =>
              it.id === row.id
                ? { ...it, extraProcs: it.extraProcs.filter((ep) => ep._id !== procId), userEdited: true, reviewed: true }
                : it
            ));
          };
          // 진행 카운터: 21개 중 X개 자동 확인 · Y개 중 Z개 검토 완료
          const totalAll = reviewItems.length;
          const autoConfirmedAll = reviewItems.filter((r) => computeRowConfidence(r).level !== "low").length;
          const lowAll = totalAll - autoConfirmedAll;
          const lowReviewedAll = reviewItems.filter((r) => computeRowConfidence(r).level === "low" && r.reviewed).length;
          return (
            <>
              {/* Review 헤더 sub-bar — 자재명 / 요약 / 페이지 / nav */}
              <div className="flex items-center gap-3 border-b border-[#f0f0f0] bg-[#FAFAF8] px-[22px] py-3 flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div className="text-[15px] font-semibold text-[#282828]" style={{ letterSpacing: "-0.01em" }}>{row.name}</div>
                    {/* 전체 상태 + 필드별 상태(확실 아닌 것만) — 검토하기 모드에서만 자재명 옆에 표시 */}
                    {(() => {
                      const overall = rowOverallStatus(row);
                      const dim = dimensionStatus(row);
                      const edg = edgeFieldStatus(row);
                      const bor = boringFieldStatus(row);
                      const chips: { key: string; label: string; status: ReviewStatus }[] = [];
                      if (dim !== "confirmed") chips.push({ key: "dim", label: `치수 ${STATUS_LABEL_KO[dim]}`, status: dim });
                      if (edg !== "confirmed") chips.push({ key: "edg", label: `엣지 ${STATUS_LABEL_KO[edg]}`, status: edg });
                      if (bor !== "confirmed") chips.push({ key: "bor", label: `보링 ${STATUS_LABEL_KO[bor]}`, status: bor });
                      return (
                        <>
                          <StatusBadge status={overall} title={`전체 신뢰도: ${STATUS_LABEL_KO[overall]}`} />
                          {chips.map((c) => (
                            <StatusBadge key={c.key} status={c.status} label={c.label} />
                          ))}
                        </>
                      );
                    })()}
                  </div>
                  <div className="mt-[2px] text-[11px]" style={{ color: "#7E7E7E", fontFeatureSettings: "'tnum' 1" }}>
                    {row.W}×{row.D}×{row.T}T · {row.edge}{row.edgeT > 0 ? ` ${row.edgeT}T` : ""}
                    <span style={{ marginLeft: 8, color: "#B3B3B3" }}>{row.file}</span>
                  </div>
                </div>
                <div className="flex items-center gap-[8px]">
                  <span className="text-[11px]" style={{ color: "#7E7E7E", fontFeatureSettings: "'tnum' 1" }}>{safeIdx + 1}/{reviewItems.length}</span>
                  <button type="button" disabled={safeIdx === 0} onClick={goPrev}
                    style={{ padding: "5px 10px", fontSize: 11, color: safeIdx === 0 ? "#B3B3B3" : "#282828", background: "#fff", border: "1px solid #D6D6D6", borderRadius: 4, cursor: safeIdx === 0 ? "not-allowed" : "pointer" }}>
                    ← 이전
                  </button>
                  <button type="button" disabled={safeIdx >= reviewItems.length - 1} onClick={goNext}
                    style={{ padding: "5px 10px", fontSize: 11, color: safeIdx >= reviewItems.length - 1 ? "#B3B3B3" : "#282828", background: "#fff", border: "1px solid #D6D6D6", borderRadius: 4, cursor: safeIdx >= reviewItems.length - 1 ? "not-allowed" : "pointer" }}>
                    다음 →
                  </button>
                  <button type="button" onClick={exitReviewMode}
                    style={{ marginLeft: 4, padding: "5px 10px", fontSize: 11, color: "#7E7E7E", background: "transparent", border: "1px solid transparent", cursor: "pointer" }}>
                    목록 보기
                  </button>
                </div>
              </div>

              {/* 좌(미리보기) / 우(편집) 50:50 */}
              <div className="flex flex-1 min-h-0">
                {/* 좌측: 미리보기 (STP 3D / PDF / 없음) */}
                <div className="flex-1 relative" style={{ background: "#F5F5F2", borderRight: "1px solid #F0F0F0" }}>
                  {isStp && row.uploadFile ? (
                    <Stp3DViewer key={row.id} uploadFile={row.uploadFile} stpName={row.file} />
                  ) : isPdf && row.uploadFile ? (
                    <PdfViewer key={row.id} uploadFile={row.uploadFile} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ color: "#B3B3B3", textAlign: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, color: "#7E7E7E", marginBottom: 6 }}>미리보기 없음</div>
                        <div style={{ fontSize: 11 }}>
                          {!row.uploadFile ? "원본 파일이 보존되지 않음" : "지원하지 않는 파일 형식"}
                        </div>
                        <div style={{ marginTop: 14, fontSize: 11, color: "#B3B3B3" }}>{row.file}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 우측: 편집 폼 */}
                <div className="flex-1 overflow-y-auto" style={{ padding: "20px 24px" }}>
                  {/* 치수 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase" }}>치수</div>
                    {(() => {
                      const s = dimensionStatus(row);
                      return s !== "confirmed" ? <StatusBadge status={s} compact /> : null;
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                    {(["W", "D", "T"] as const).map((field) => (
                      <div key={field} style={{ flex: 1 }}>
                        <label style={{ display: "block", fontSize: 12, color: "#616161", marginBottom: 6 }}>{field === "T" ? "T (mm)" : `${field} (mm)`}</label>
                        <input
                          type="number"
                          step={field === "T" ? 0.5 : 1}
                          value={row[field] || ""}
                          placeholder="0"
                          onChange={(e) => updateRow({ [field]: Number.parseFloat(e.target.value) || 0 } as Partial<ParsedReviewRow>)}
                          style={{ width: "100%", height: 36, padding: "0 12px", fontSize: 14, color: "#282828", border: "1px solid #D6D6D6", borderRadius: 4, outline: "none", fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* 원장 선택 — 두께(T) 가 있을 때만 표시 */}
                  {row.T > 0 ? (
                    <div style={{ marginBottom: 18 }}>
                      <SheetSelector
                        wMm={row.W}
                        dMm={row.D}
                        hMm={row.T}
                        sheetPrices={getSheetPricesForT(row.T)}
                        selectedSheetId={(row.selectedSheetId ?? null) as SheetId | null}
                        onChange={(id) => updateRow({ selectedSheetId: id })}
                      />
                    </div>
                  ) : null}

                  {/* 엣지 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase" }}>엣지</div>
                    {(() => {
                      const s = edgeFieldStatus(row);
                      return s !== "confirmed" ? <StatusBadge status={s} compact /> : null;
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    {(["없음", "1면", "2면", "3면", "4면"] as const).map((opt) => {
                      const active = row.edge === opt;
                      return (
                        <button key={opt} type="button" onClick={() => updateRow({ edge: opt })}
                          style={{ flex: 1, height: 32, fontSize: 12, color: active ? "#fff" : "#616161", background: active ? "#282828" : "#fff", border: `1px solid ${active ? "#282828" : "#D6D6D6"}`, borderRadius: 4, cursor: "pointer" }}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {row.edge !== "없음" && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                      {[1, 2].map((t) => {
                        const active = row.edgeT === t;
                        return (
                          <button key={t} type="button" onClick={() => updateRow({ edgeT: t })}
                            style={{ flex: 1, height: 32, fontSize: 12, color: active ? "#fff" : "#616161", background: active ? "#282828" : "#fff", border: `1px solid ${active ? "#282828" : "#D6D6D6"}`, borderRadius: 4, cursor: "pointer" }}>
                            {t}T
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 보링 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase" }}>보링</div>
                    {(() => {
                      const s = boringFieldStatus(row);
                      return s !== "confirmed" ? <StatusBadge status={s} compact /> : null;
                    })()}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #F0F0F0" }}>
                    <div style={{ fontSize: 13, color: "#282828", fontWeight: 500 }}>일반 보링</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                      <input type="number" min={0} value={row.hole1} onChange={(e) => updateRow({ hole1: Number(e.target.value) || 0 })}
                        style={{ width: 70, height: 32, padding: "0 10px", fontSize: 13, textAlign: "right", border: "1px solid #D6D6D6", borderRadius: 4, outline: "none", fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }} />
                      <span style={{ fontSize: 12, color: "#7E7E7E" }}>개</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #F0F0F0", marginBottom: 18 }}>
                    <div style={{ fontSize: 13, color: "#282828", fontWeight: 500 }}>2단 보링</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                      <input type="number" min={0} value={row.hole2} onChange={(e) => updateRow({ hole2: Number(e.target.value) || 0 })}
                        style={{ width: 70, height: 32, padding: "0 10px", fontSize: 13, textAlign: "right", border: "1px solid #D6D6D6", borderRadius: 4, outline: "none", fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }} />
                      <span style={{ fontSize: 12, color: "#7E7E7E" }}>개</span>
                    </div>
                  </div>

                  {/* 추가 가공 */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase" }}>추가 가공</div>
                    <div className="proc-dd-wrap" style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setReviewProcDropOpen((v) => !v); }}
                        style={{ padding: "5px 10px", fontSize: 11, color: "#7E7E7E", background: "transparent", border: "1px dashed #D6D6D6", borderRadius: 4, cursor: "pointer" }}
                      >
                        + 가공 추가
                      </button>
                      {reviewProcDropOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, minWidth: 240, background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6, boxShadow: "0 6px 20px rgba(0,0,0,.10)", zIndex: 10 }}
                        >
                          <div style={{ padding: "8px 12px", borderBottom: "1px solid #F0F0F0", fontSize: 10, fontWeight: 700, color: "#7E7E7E", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            가공 종류 선택
                          </div>
                          {PROC_TYPES.map((pt) => (
                            <div
                              key={pt.key}
                              onClick={() => addProc(pt.key)}
                              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", fontSize: 11, color: "#282828", cursor: "pointer" }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#F5F5F5"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                            >
                              <span style={{ fontWeight: 500 }}>{pt.label}</span>
                              <span style={{ fontSize: 10, color: "#aaa" }}>{pt.rate * 1000}원/m · mm 입력</span>
                            </div>
                          ))}
                          <div style={{ height: 1, background: "#F0F0F0", margin: "4px 0" }} />
                          <div style={{ display: "flex", gap: 6, padding: "8px 14px" }}>
                            <input
                              placeholder="직접 입력 (가공명)"
                              value={reviewCustomProc}
                              onChange={(e) => setReviewCustomProc(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const name = reviewCustomProc.trim();
                                  if (name) { addProc("custom", name); setReviewCustomProc(""); }
                                }
                              }}
                              style={{ flex: 1, height: 26, padding: "0 8px", fontSize: 11, border: "1px solid #E0E0E0", borderRadius: 4, outline: "none" }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const name = reviewCustomProc.trim();
                                if (name) { addProc("custom", name); setReviewCustomProc(""); }
                              }}
                              style={{ padding: "0 10px", fontSize: 11, color: "#fff", background: "#1A1A1A", border: "none", borderRadius: 4, cursor: "pointer" }}
                            >
                              추가
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 0 18px", minHeight: row.extraProcs.length === 0 ? 0 : undefined }}>
                    {row.extraProcs.length === 0 ? (
                      <div style={{ fontSize: 11, color: "#B3B3B3", padding: "4px 0" }}>추가된 가공 없음</div>
                    ) : (
                      row.extraProcs.map((ep) => {
                        const cls = PROC_COLORS[ep.type] ?? PROC_COLORS.custom;
                        const presetLabel = PROC_TYPES.find((p) => p.key === ep.type)?.label ?? ep.type;
                        return (
                          <span
                            key={ep._id}
                            className={`inline-flex items-center gap-1 rounded-[3px] px-[8px] py-[3px] text-[11px] font-medium ${cls}`}
                          >
                            {ep.label ?? presetLabel}
                            <input
                              type="number"
                              min={0}
                              value={ep.mm}
                              onChange={(e) => updateProcMmInRow(ep._id, Number(e.target.value) || 0)}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: 46, height: 18, border: "none", borderBottom: "1px solid rgba(0,0,0,.2)",
                                background: "transparent", fontSize: 10, textAlign: "center",
                                outline: "none", margin: "0 4px",
                                fontFamily: "inherit", fontFeatureSettings: "'tnum' 1",
                              }}
                            />
                            <span style={{ fontSize: 9, opacity: 0.7 }}>mm</span>
                            <button
                              type="button"
                              onClick={() => delProcInRow(ep._id)}
                              style={{ width: 14, height: 14, border: "none", background: "transparent", padding: 0, marginLeft: 2, fontSize: 11, color: "currentColor", opacity: 0.6, cursor: "pointer" }}
                              title="삭제"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>

                  {/* 가격 요약 */}
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>가격</div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#282828" }}>
                    <span>원재료비</span><span style={{ fontFeatureSettings: "'tnum' 1" }}>₩{matCost.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#282828", borderBottom: "1px solid #F0F0F0", marginBottom: 6 }}>
                    <span>가공비</span><span style={{ fontFeatureSettings: "'tnum' 1" }}>₩{procCost.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", borderTop: "2px solid #282828", fontSize: 14, fontWeight: 700, color: "#282828" }}>
                    <span>합계</span><span style={{ fontFeatureSettings: "'tnum' 1" }}>₩{total.toLocaleString()}</span>
                  </div>

                  {/* 신뢰도 + source 배지 + 검토 완료 토글 */}
                  {(() => {
                    const srcs = row.sources ?? [];
                    const isCross = srcs.includes("stp") && srcs.includes("pdf");
                    const isStpOnly = srcs.length === 1 && srcs[0] === "stp";
                    const isPdfOnly = srcs.length === 1 && srcs[0] === "pdf";
                    const sourceBadge = isCross ? (
                      <span title="STP+PDF 교차검증 — 두 출처 모두 일치"
                        style={{ display: "inline-block", padding: "2px 7px", fontSize: 10, fontWeight: 600, borderRadius: 3, background: "#E8F5E9", color: "#16a34a", marginLeft: 6 }}>
                        STP+PDF 교차검증
                      </span>
                    ) : isStpOnly ? (
                      <span title="STP 3D 분석 결과"
                        style={{ display: "inline-block", padding: "2px 7px", fontSize: 10, fontWeight: 600, borderRadius: 3, background: "#F0F0F0", color: "#282828", marginLeft: 6 }}>
                        STP
                      </span>
                    ) : isPdfOnly ? (
                      <span title="PDF 도면 표제란 추출"
                        style={{ display: "inline-block", padding: "2px 7px", fontSize: 10, fontWeight: 600, borderRadius: 3, background: "#FFF7ED", color: "#ea580c", marginLeft: 6 }}>
                        PDF
                      </span>
                    ) : null;

                    // 신뢰도 high + 출처 배지만 보여줄 케이스 (검토 버튼 불필요)
                    if (conf.level === "high") {
                      return sourceBadge ? (
                        <div style={{ marginTop: 16, padding: "10px 12px", background: "#FAFAF8", borderRadius: 4, fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: "#7E7E7E" }}>
                            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: CONF_DOT_BG.high, marginRight: 6, verticalAlign: "middle" }} />
                            {isCross ? "신뢰도 매우 높음" : "신뢰도 높음"}
                            {sourceBadge}
                          </span>
                        </div>
                      ) : null;
                    }
                    return (
                      <div style={{ marginTop: 16, padding: "10px 12px", background: row.reviewed ? "#F0F0F0" : "#FAFAF8", borderRadius: 4, fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
                        {row.reviewed ? (
                          <>
                            <span style={{ color: "#7E7E7E", flex: 1 }}>
                              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#7E7E7E", marginRight: 6, verticalAlign: "middle" }} />
                              검토 완료됨
                              {sourceBadge}
                            </span>
                            <button
                              type="button"
                              onClick={() => setReviewed(false)}
                              style={{ padding: "5px 10px", fontSize: 11, color: "#7E7E7E", background: "transparent", border: "1px solid #D6D6D6", borderRadius: 4, cursor: "pointer" }}
                            >
                              되돌리기
                            </button>
                          </>
                        ) : (
                          <>
                            <span style={{ color: "#7E7E7E", flex: 1 }}>
                              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: CONF_DOT_BG[conf.level], marginRight: 6, verticalAlign: "middle" }} />
                              신뢰도 {conf.label}
                              {sourceBadge}
                              {conf.issues.length > 0 ? <span style={{ marginLeft: 6, color: "#FF5948" }}>· {conf.issues.join(", ")}</span> : null}
                            </span>
                            <button
                              type="button"
                              onClick={() => setReviewed(true)}
                              style={{ padding: "5px 10px", fontSize: 11, color: "#282828", background: "#fff", border: "1px solid #282828", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 500 }}
                            >
                              검토 완료
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Review 푸터 */}
              <div className="flex items-center justify-between border-t border-[#f0f0f0] bg-[#FAFAF8] px-[22px] py-3 flex-shrink-0 relative">
                <div style={{ fontSize: 11, color: "#7E7E7E", fontFeatureSettings: "'tnum' 1" }}>
                  {totalAll}개 중 {autoConfirmedAll}개 자동 확인
                  {lowAll > 0 ? <> · {lowAll}개 중 <span style={{ color: lowReviewedAll === lowAll ? "#16a34a" : "#FF5948", fontWeight: 600 }}>{lowReviewedAll}개</span> 검토 완료</> : null}
                  {isSaved ? <span style={{ marginLeft: 8, color: "#16a34a" }}>✓ 저장됨</span> : null}
                </div>
                {toast ? (
                  <div style={{ position: "absolute", left: "50%", top: -34, transform: "translateX(-50%)", padding: "6px 14px", background: "#282828", color: "#fff", fontSize: 11, borderRadius: 4, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>
                    {toast}
                  </div>
                ) : null}
                <div className="flex items-center gap-[6px]">
                  <button type="button" onClick={exitReviewMode}
                    style={{ padding: "7px 14px", fontSize: 12, color: "#616161", background: "transparent", border: "1px solid #D6D6D6", borderRadius: 4, cursor: "pointer" }}>
                    취소
                  </button>
                  <button type="button" onClick={saveCurrent}
                    style={{ padding: "7px 14px", fontSize: 12, color: "#282828", background: "#fff", border: "1px solid #282828", borderRadius: 4, cursor: "pointer" }}>
                    저장
                  </button>
                  <button type="button" onClick={saveAndNext}
                    style={{ padding: "7px 14px", fontSize: 12, fontWeight: 500, color: "#fff", background: "#282828", border: "1px solid #282828", borderRadius: 4, cursor: "pointer" }}>
                    저장하고 다음 →
                  </button>
                </div>
              </div>
            </>
          );
        })()}

        {/* Footer (list 모드 전용) */}
        {viewMode === "list" && (
        <div className="flex items-center gap-[10px] border-t border-[#f0f0f0] bg-[#fff] px-[22px] py-3 flex-shrink-0">
          <div className="mr-auto text-[10px] text-[#bbb]">
            ✎ 자재명 클릭 · W/D/T/엣지T 더블클릭 수정 · 보링 직접 입력 · 2단보링/추가 가공은 + 가공 추가
          </div>
          <button
            type="button"
            className="bg-transparent p-0 text-[11px] text-[#aaa] underline hover:text-[#333]"
            onClick={() => setItems((prev) => prev.map((r) => ({ ...r, checked: true })))}
          >
            전체 선택
          </button>
          <span className="text-[#e0e0e0]">·</span>
          <button
            type="button"
            className="bg-transparent p-0 text-[11px] text-[#aaa] underline hover:text-[#333]"
            onClick={() => setItems((prev) => prev.map((r) => ({ ...r, checked: false })))}
          >
            전체 해제
          </button>
          <span className="text-[11px] font-semibold text-[#555]">{selectedCount}개 선택</span>
          <button
            type="button"
            className="rounded-[5px] border border-[#e0e0e0] bg-[#fff] px-4 py-2 text-[12px] font-medium text-[#666] hover:border-[#aaa] hover:text-[#333]"
            onClick={onBack}
          >
            이전
          </button>
          <button
            type="button"
            className="rounded-[5px] border border-[#1a1a1a] bg-[#1a1a1a] px-4 py-2 text-[12px] font-medium text-[#fff] hover:bg-[#333]"
            onClick={() => onRegister(items.filter((r) => r.checked))}
          >
            선택 항목 등록하기 →
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

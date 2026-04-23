import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { openCompareModal } from "../components/CompareModal";
import {
  buildMaterialInput,
  effectiveYieldPlacementMode,
  EDGE45_PAINT_RATES,
  formatEdgeSidesKo,
  TENONER_WON_PER_M,
} from "../lib/materialCalc";
import type { ComputedMaterial } from "../lib/materialCalc";
import { formatWonKorean } from "../util/format";
import { MaterialQuoteFileBar } from "./quote/MaterialQuoteFileBar";
import { MaterialSheetQuoteStrip } from "./quote/MaterialSheetQuoteStrip";
import { QuoteCard } from "./quote/QuoteCard";
import type { MaterialEdgePreset, MaterialFormState } from "./MaterialTab";

const BOARD_MATERIALS = ["PB", "SPB", "MDF"] as const;
const SURFACE_MATERIALS = ["LPM/O", "LPM/-", "FF/-"] as const;
const COLORS = ["WW", "BI", "OHN", "NBK"];

type Props = {
  form: MaterialFormState;
  setForm: Dispatch<SetStateAction<MaterialFormState>>;
  computed: ComputedMaterial | null;
  dimKey: number;
  onDimensionCommit: (next: { wMm: number; dMm: number; hMm: number }) => void;
  previewPending: boolean;
  onSelectSheetOriented: (id: string, o: "default" | "rotated") => void;
  onSelectSheet: (id: string) => void;
  erpCodeBySheetId?: Record<string, string>;
  addedProcs: string[];
  setAddedProcs: Dispatch<SetStateAction<string[]>>;
  onSave: (draft: boolean, opts?: { banner?: boolean }) => Promise<boolean>;
  unavailableSheetIds: string[];
  unitPriceBySheetId: Record<string, number>;
  hSelected: boolean;
  /** true면 우측 요약 패널 숨기고 하단에 요약(원자재비/가공비/합계)만 표시 */
  hideRightPanel?: boolean;
  /** 규격 카드에서 STP/PDF/DWG 바 숨김(업로드는 상단 버튼으로) */
  hideFileBarInSpec?: boolean;
  /** 비교 목록 버튼 숨김 */
  hideCompareActions?: boolean;
  /** 자재 편집: 왼쪽 상단 이름·임시저장, 오른쪽 영수증 분리 */
  showEditorSplitHeader?: boolean;
};

function toStrMm(n: number) {
  return n === 0 ? "" : String(n);
}

/** 영수증 하단 — 흰색/투명 사각형 반복 절취선 */
function ReceiptTearZigZag() {
  const size = 7;
  return (
    <div
      className="pointer-events-none relative w-full shrink-0 overflow-hidden"
      aria-hidden
      style={{ height: size }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(to left, white 0px, white ${size}px, transparent ${size}px, transparent ${size * 2}px)`,
        }}
      />
      <div style={{ position: "absolute", left: 0, top: 0, width: size, height: size, background: "white" }} />
    </div>
  );
}

function parseMmStr(s: string) {
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const specWdhInputClass =
  "h-[30px] w-full min-w-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-2 text-[12px] tabular-nums text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none";

/** W/D/H 수기 입력 — 디바운스 후 onCommit */
function SpecWdhInputs({
  dimKey,
  wMm,
  dMm,
  hMm,
  onCommit,
  inputClassName = specWdhInputClass,
}: {
  dimKey: number;
  wMm: number;
  dMm: number;
  hMm: number;
  onCommit: (next: { wMm: number; dMm: number; hMm: number }) => void;
  inputClassName?: string;
}) {
  const [w, setW] = useState(() => toStrMm(wMm));
  const [d, setD] = useState(() => toStrMm(dMm));
  const [h, setH] = useState(() => toStrMm(hMm));

  useEffect(() => {
    setW(toStrMm(wMm));
    setD(toStrMm(dMm));
    setH(toStrMm(hMm));
  }, [dimKey, wMm, dMm, hMm]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      onCommit({
        wMm: parseMmStr(w),
        dMm: parseMmStr(d),
        hMm: parseMmStr(h),
      });
    }, 220);
    return () => window.clearTimeout(t);
  }, [w, d, h, onCommit]);

  const cell = (id: string, label: string, value: string, set: (s: string) => void) => (
    <div key={id} className="flex min-w-0 flex-col gap-0.5">
      <label className="text-[11px] text-[var(--quote-muted)]">{label}</label>
      <input
        type="number"
        min={0}
        className={inputClassName}
        value={value}
        onChange={(e) => set(e.target.value)}
        inputMode="numeric"
      />
    </div>
  );

  return (
    <div className="contents">
      {cell("w", "W(mm)", w, setW)}
      {cell("d", "D(mm)", d, setD)}
      {cell("h", "H(mm)", h, setH)}
    </div>
  );
}

function ProcRateHint({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="ml-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-[var(--quote-border)] bg-[var(--quote-bg)] text-[9px] font-bold leading-none text-[var(--quote-muted)] hover:border-[#378ADD] hover:text-[#378ADD]"
      title={text}
      tabIndex={-1}
      aria-label="단가 안내"
    >
      ?
    </button>
  );
}

function QuoteProcRow({
  label,
  unit,
  value,
  onChange,
  amount,
  step = 1,
  onRemove,
  help,
  inputRoundClass = "rounded-[6px]",
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (n: number) => void;
  amount: number;
  step?: number;
  onRemove?: () => void;
  help?: string;
  inputRoundClass?: string;
}) {
  return (
    <div className="flex min-h-[34px] items-center gap-2 border-b-[0.5px] border-[var(--quote-border)] py-1.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <span className="text-[12px] text-[var(--quote-fg)]">{label}</span>
        {help ? <ProcRateHint text={help} /> : null}
      </div>
      <input
        type="number"
        min={0}
        step={step}
        className={`h-[30px] w-[50px] shrink-0 ${inputRoundClass} border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-right text-[12px] tabular-nums text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      <span className="w-5 shrink-0 text-center text-[14px] text-[var(--quote-muted)]">{unit}</span>
      <span className="w-[52px] shrink-0 text-right text-[12px] font-medium tabular-nums text-[var(--quote-fg)]">
        {formatWonKorean(amount)}
      </span>
      {onRemove ? (
        <button
          type="button"
          className="shrink-0 rounded px-1 text-[11px] text-[var(--quote-muted)] hover:text-red-500"
          onClick={onRemove}
          aria-label={`${label} 제거`}
        >
          ✕
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden />
      )}
    </div>
  );
}

function SumLine({ label, sub, amount }: { label: string; sub?: string; amount: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[12px] text-[var(--quote-fg)]">{label}</span>
        <span className="shrink-0 text-[12px] font-medium tabular-nums text-[var(--quote-fg)]">{formatWonKorean(amount)}</span>
      </div>
      {sub ? <p className="text-[10px] leading-snug text-[var(--quote-muted)]">{sub}</p> : null}
    </div>
  );
}

type TipLine = { label: string; value: string };

function materialDetailLines(c: ComputedMaterial, hSelected: boolean): TipLine[] {
  if (!hSelected) return [{ label: "안내", value: "H(두께)를 선택하면 원자재·엣지가 반영됩니다." }];
  const o: TipLine[] = [];
  o.push({ label: "목재(원장 기준)", value: formatWonKorean(c.materialCostWon) });
  if (c.edgeCostWon > 0) o.push({ label: "엣지 자재", value: formatWonKorean(c.edgeCostWon) });
  if (c.hotmeltCostWon > 0) o.push({ label: "핫멜트", value: formatWonKorean(c.hotmeltCostWon) });
  return o;
}

function processingDetailLinesExcludingEdgeHotmelt(c: ComputedMaterial): TipLine[] {
  const p = (label: string, w: number) => (w > 0 ? { label, value: formatWonKorean(w) } : null);
  return [
    p("재단(손봉) 요금", c.cuttingCostWon),
    p("포밍", c.formingCostWon),
    p("루터", c.rutaCostWon),
    p("루타 2차", c.ruta2CostWon),
    p("자재 조립(시간)", c.assemblyCostWon),
    p("세척", c.washCostWon),
    p("일반 보링", c.boring1CostWon),
    p("2단 보링", c.boring2CostWon),
    p("곡면 엣지", c.curvedCostWon),
    p("45° 테이핑", c.edge45TapingCostWon),
    p("엣지 도장(면)", c.edge45PaintCostWon),
    p("테노너", c.tenonerCostWon),
  ].filter((x): x is TipLine => x != null);
}

function totalDetailLines(receiptMaterial: number, receiptProc: number, total: number): TipLine[] {
  return [
    { label: "원자재비", value: formatWonKorean(receiptMaterial) },
    { label: "가공비(엣지·핫멜트 제외)", value: formatWonKorean(receiptProc) },
    { label: "합계", value: formatWonKorean(total) },
  ];
}

function ReceiptDetailHover({
  title,
  lines,
  children,
}: {
  title?: string;
  lines: TipLine[] | null;
  children: ReactNode;
}) {
  if (!lines || lines.length === 0) return <>{children}</>;
  return (
    <div className="group relative min-w-0 text-center">
      {children}
      <div className="invisible z-30 absolute bottom-full left-1/2 mb-1 w-[min(280px,92vw)] -translate-x-1/2 rounded-md border border-[var(--quote-border)] bg-[var(--quote-card)] p-2.5 text-left shadow-lg group-hover:visible group-focus-within:visible">
        {title ? <p className="mb-1.5 text-[10px] font-semibold text-[var(--quote-muted)]">{title}</p> : null}
        <div className="space-y-1">
          {lines.map((l) => (
            <div
              key={l.label + l.value}
              className="flex items-start justify-between gap-2 text-[10px] leading-tight text-[var(--quote-fg)]"
            >
              <span className="min-w-0 flex-1 break-words text-left text-[var(--quote-muted)]">{l.label}</span>
              {l.value.trim() && l.value !== " " ? (
                <span className="shrink-0 font-medium tabular-nums text-[11px]">{l.value}</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ADD_PROC_OPTIONS = [
  ["ruta2", "루타 2차"],
  ["forming", "포밍"],
  ["tenoner", "테노너"],
  ["edgePaint", "엣지 도장"],
  ["edge45", "45도 엣지"],
  ["curved", "곡면 엣지"],
] as const;

export function MaterialQuoteV2Layout({
  form,
  setForm,
  computed,
  dimKey,
  onDimensionCommit,
  previewPending,
  onSelectSheetOriented,
  onSelectSheet,
  erpCodeBySheetId = {},
  addedProcs,
  setAddedProcs,
  onSave,
  unavailableSheetIds,
  unitPriceBySheetId,
  hSelected,
  hideRightPanel = false,
  hideFileBarInSpec = false,
  hideCompareActions = false,
  showEditorSplitHeader = false,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [editorTab, setEditorTab] = useState<"spec" | "sheet" | "proc">("spec");
  const ed = showEditorSplitHeader;
  const r6 = ed ? "rounded-none" : "rounded-[6px]";
  const wdhInputClass = ed ? specWdhInputClass.replace("rounded-[6px]", "rounded-none") : specWdhInputClass;

  const onMixedPlacement = useCallback(() => {
    startTransition(() => setForm((f) => ({ ...f, placementMode: "mixed", showDefault: false, showRotated: false })));
  }, [setForm]);

  const onTogglePlacementRow = useCallback(
    (row: "default" | "rotated") => {
      startTransition(() =>
        setForm((f) => {
          if (f.placementMode === "mixed") {
            return { ...f, placementMode: "default", showDefault: true, showRotated: true };
          }
          if (row === "default") {
            const next = !f.showDefault;
            if (!next && !f.showRotated) return f;
            return { ...f, showDefault: next };
          }
          const next = !f.showRotated;
          if (!next && !f.showDefault) return f;
          return { ...f, showRotated: next };
        })
      );
    },
    [setForm]
  );

  const mIn = useMemo(
    () =>
      buildMaterialInput({
        wMm: form.wMm,
        dMm: form.dMm,
        hMm: form.hMm,
        color: form.color,
        boardMaterial: form.boardMaterial,
        placementMode: effectiveYieldPlacementMode(form.placementMode, form.cutOrientation),
        edgePreset: form.edgePreset,
        edgeColor: form.edgeColor,
        edgeCustomSides: form.edgeCustomSides,
        edgeSides: form.edgeSides,
        sheetPrices: form.sheetPrices,
        formingM: form.formingM,
        rutaM: form.rutaM,
        assemblyHours: form.assemblyHours,
        washM2: form.washM2,
        boring1Ea: form.boring1Ea,
        boring2Ea: form.boring2Ea,
        curvedEdgeM: form.curvedEdgeM,
        curvedEdgeType: form.curvedEdgeType,
        edge45TapingM: form.edge45TapingM,
        edge45PaintType: form.edge45PaintType,
        edge45PaintM: form.edge45PaintM,
        ruta2M: form.ruta2M,
        tenonerMm: form.tenonerMm,
      }),
    [form]
  );

  const setEdgePreset = useCallback(
    (k: MaterialEdgePreset) => {
      startTransition(() => setForm((f) => ({ ...f, edgePreset: k, edgeColor: "WW" })));
    },
    [setForm]
  );

  const edgeLabelMap: Record<MaterialEdgePreset, string> = {
    none: "엣지 없음",
    abs1t: "4면 ABS 1T",
    abs2t: "4면 ABS 2T",
    paint: "4면 엣지 도장",
    custom: "사용자 설정",
  };

  const edgeLengthMm = computed ? Math.round(computed.edgeLengthM * 1000) : 0;
  const matAmt = (n: number) => (hSelected ? n : 0);
  const sel = computed?.sheets?.find((s) => s.sheetId === computed?.selectedSheetId);

  const edgeAdhesionWon = computed ? computed.edgeCostWon + computed.hotmeltCostWon : 0;

  const receiptMaterialWon =
    computed && hSelected
      ? computed.materialCostWon + computed.edgeCostWon + computed.hotmeltCostWon
      : 0;
  const receiptProcessingWon = computed
    ? computed.processingTotalWon - computed.edgeCostWon - computed.hotmeltCostWon
    : 0;
  const receiptTotalWon = computed
    ? hSelected
      ? computed.grandTotalWon
      : computed.processingTotalWon
    : 0;

  const removeProc = (key: string) => {
    setAddedProcs((prev) => prev.filter((k) => k !== key));
    setForm((f) => {
      if (key === "ruta2") return { ...f, ruta2M: 0 };
      if (key === "forming") return { ...f, formingM: 0 };
      if (key === "edgePaint") return { ...f, edge45PaintType: "", edge45PaintM: 0 };
      if (key === "edge45") return { ...f, edge45TapingM: 0 };
      if (key === "curved") return { ...f, curvedEdgeM: 0, curvedEdgeType: "" };
      if (key === "tenoner") return { ...f, tenonerMm: 0 };
      return f;
    });
  };

  const sheetStripEl = (
    <MaterialSheetQuoteStrip
      pieceWMm={form.wMm}
      pieceDMm={form.dMm}
      placementMode={form.placementMode}
      cutOrientation={form.cutOrientation}
      showDefault={form.showDefault}
      showRotated={form.showRotated}
      onPlacementModeChange={(m) => {
        if (m !== "mixed") return;
        onMixedPlacement();
      }}
      onToggleRow={onTogglePlacementRow}
      selectedSheetId={form.selectedSheetId}
      computedSelectedId={computed?.selectedSheetId ?? null}
      recommendedSheetId={computed?.recommendedSheetId ?? null}
      onSelectSheetOriented={onSelectSheetOriented}
      onSelectSheet={onSelectSheet}
      unavailableSheetIds={unavailableSheetIds}
      unitPriceBySheetId={unitPriceBySheetId}
      erpCodeBySheetId={erpCodeBySheetId}
      showPrice={form.hMm > 0}
      squareChrome={ed}
    />
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--quote-bg)] text-[var(--quote-fg)]">
      {showEditorSplitHeader ? (
        <div className="flex shrink-0 items-center border-b border-[#e8e8e8] bg-white px-4 py-2.5">
          <span className="text-[10px] font-medium text-[#bbb]">자재 편집</span>
          <span className="mx-1.5 text-[12px] text-[#e0e0e0]">/</span>
          <span className="text-[13px] font-semibold text-[#1a1a1a]">{form.name.trim() || "이름 없음"}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {!hideCompareActions ? (
              <button
                type="button"
                className="whitespace-nowrap rounded-[5px] border border-[#e0e0e0] bg-white px-[11px] py-[6px] text-[11px] font-medium text-[#444] hover:border-[#999] hover:text-[#1a1a1a]"
                onClick={() => openCompareModal()}
              >
                비교하기
              </button>
            ) : null}
            <button
              type="button"
              className="whitespace-nowrap rounded-[5px] border border-[#e0e0e0] bg-white px-[11px] py-[6px] text-[11px] font-medium text-[#444] hover:border-[#999] hover:text-[#1a1a1a]"
            >
              도면/모델링 업로드
            </button>
            <button
              type="button"
              className="whitespace-nowrap rounded-[5px] border border-[#e0e0e0] bg-white px-[11px] py-[6px] text-[11px] font-medium text-[#444] hover:border-[#999] hover:text-[#1a1a1a]"
            >
              내보내기
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 w-full flex-1 flex-row overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={
            showEditorSplitHeader
              ? "flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 sm:p-5"
              : "flex min-h-0 min-w-0 flex-1 flex-col gap-[10px] overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4"
          }
        >
          {showEditorSplitHeader ? (
            <QuoteCard square className="shrink-0 shadow-sm">
              <div className="-mx-5 -mt-5 mb-4 flex shrink-0 border-b border-[#e8e8e8] bg-[#fafafa]">
                {([
                  ["spec", "규격·사양"],
                  ["sheet", "원장 배치"],
                  ["proc", "가공"],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    className={`border-b-2 px-4 py-2.5 text-[12px] font-medium ${
                      editorTab === tab
                        ? "border-[#1a1a1a] bg-white text-[#1a1a1a]"
                        : "border-transparent text-[#aaa]"
                    }`}
                    onClick={() => setEditorTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {editorTab === "spec" ? (
                <>
                  {!hideFileBarInSpec ? (
                    <MaterialQuoteFileBar
                      onApplyDimensions={(wMm, dMm, hMm) => {
                        onDimensionCommit({ wMm, dMm, hMm });
                      }}
                    />
                  ) : null}
                  <div className={`space-y-3 ${hideFileBarInSpec ? "pt-0" : "mt-2 pt-2"}`}>
                    <div className="grid w-full min-w-0 grid-cols-4 gap-3">
                      <SpecWdhInputs
                        dimKey={dimKey}
                        wMm={form.wMm}
                        dMm={form.dMm}
                        hMm={form.hMm}
                        onCommit={onDimensionCommit}
                        inputClassName={wdhInputClass}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">소재</label>
                        <select
                          className={`h-[30px] w-full min-w-0 ${r6} border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none`}
                          value={form.boardMaterial}
                          onChange={(e) => setForm((f) => ({ ...f, boardMaterial: e.target.value }))}
                        >
                          {BOARD_MATERIALS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid w-full min-w-0 grid-cols-4 gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">표면재</label>
                        <select
                          className={`h-[30px] w-full min-w-0 ${r6} border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none`}
                          value={form.surfaceMaterial}
                          onChange={(e) => setForm((f) => ({ ...f, surfaceMaterial: e.target.value }))}
                        >
                          {SURFACE_MATERIALS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">표면재 색상</label>
                        <select
                          className={`h-[30px] w-full min-w-0 ${r6} border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none`}
                          value={form.color}
                          onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                        >
                          {COLORS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">엣지 사양</label>
                        <select
                          className={`h-[30px] w-full min-w-0 ${r6} border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none`}
                          value={form.edgePreset}
                          onChange={(e) => setEdgePreset(e.target.value as MaterialEdgePreset)}
                        >
                          <option value="none">엣지 없음</option>
                          <option value="abs1t">ABS 1T</option>
                          <option value="abs2t">ABS 2T</option>
                          <option value="paint">엣지 도장</option>
                          <option value="custom">사용자 설정</option>
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">엣지 색상</label>
                        <select
                          disabled={form.edgePreset === "none"}
                          value={form.edgeColor}
                          onChange={(e) => setForm((f) => ({ ...f, edgeColor: e.target.value }))}
                          className={`h-[30px] w-full min-w-0 ${r6} border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none disabled:opacity-50`}
                        >
                          {COLORS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {previewPending ? <p className="mt-1 text-[10px] text-[var(--quote-muted)]">반영 중…</p> : null}
                  </div>
                </>
              ) : null}

              {editorTab === "sheet" ? (
                <div className="space-y-3">
                  <div className="min-h-0 w-full">{sheetStripEl}</div>
                </div>
              ) : null}

              {editorTab === "proc" ? (
                <div className="flex flex-col">
                  <QuoteProcRow
                    label="자재 조립"
                    unit="개"
                    value={form.assemblyHours}
                    onChange={(n) => setForm((f) => ({ ...f, assemblyHours: n }))}
                    amount={computed?.assemblyCostWon ?? 0}
                    help={`1시간당 ${mIn.unitAssemblyPerH.toLocaleString("ko-KR")}원 × 조립 시간(시간). (표시·계산: 시간 × ${mIn.unitAssemblyPerH}원)`}
                    inputRoundClass={r6}
                  />
                  <QuoteProcRow
                    label="일반 보링"
                    unit="개"
                    value={form.boring1Ea}
                    onChange={(n) => setForm((f) => ({ ...f, boring1Ea: n }))}
                    amount={computed?.boring1CostWon ?? 0}
                    help="1개당 100원 × 일반 보링 개수"
                    inputRoundClass={r6}
                  />
                  <QuoteProcRow
                    label="2단 보링"
                    unit="개"
                    value={form.boring2Ea}
                    onChange={(n) => setForm((f) => ({ ...f, boring2Ea: n }))}
                    amount={computed?.boring2CostWon ?? 0}
                    help="1개당 50원 × 2단 보링 개수"
                    inputRoundClass={r6}
                  />
                  <QuoteProcRow
                    label="루터 가공"
                    unit="mm"
                    value={Math.round(form.rutaM * 1000)}
                    onChange={(n) => setForm((f) => ({ ...f, rutaM: n / 1000 }))}
                    amount={computed?.rutaCostWon ?? 0}
                    help="1m(1000mm)당 2,000원 — (mm ÷ 1000) × 2,000원"
                    inputRoundClass={r6}
                  />
                </div>
              ) : null}
            </QuoteCard>
          ) : (
            <div className="flex min-h-0 w-full min-w-0 flex-col gap-[10px]">
              <div className="flex min-h-0 w-full min-w-0 flex-col gap-[10px]">
                <QuoteCard className="shrink-0">
                  {!hideFileBarInSpec ? (
                    <MaterialQuoteFileBar
                      onApplyDimensions={(wMm, dMm, hMm) => {
                        onDimensionCommit({ wMm, dMm, hMm });
                      }}
                    />
                  ) : null}
                  <div className={`space-y-2 ${hideFileBarInSpec ? "pt-0" : "mt-2 pt-2"}`}>
                    <div className="grid w-full min-w-0 grid-cols-4 gap-2">
                      <SpecWdhInputs
                        dimKey={dimKey}
                        wMm={form.wMm}
                        dMm={form.dMm}
                        hMm={form.hMm}
                        onCommit={onDimensionCommit}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">소재</label>
                        <select
                          className="h-[30px] w-full min-w-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
                          value={form.boardMaterial}
                          onChange={(e) => setForm((f) => ({ ...f, boardMaterial: e.target.value }))}
                        >
                          {BOARD_MATERIALS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid w-full min-w-0 grid-cols-4 gap-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">표면재</label>
                        <select
                          className="h-[30px] w-full min-w-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
                          value={form.surfaceMaterial}
                          onChange={(e) => setForm((f) => ({ ...f, surfaceMaterial: e.target.value }))}
                        >
                          {SURFACE_MATERIALS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">표면재 색상</label>
                        <select
                          className="h-[30px] w-full min-w-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
                          value={form.color}
                          onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                        >
                          {COLORS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">엣지 사양</label>
                        <select
                          className="h-[30px] w-full min-w-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
                          value={form.edgePreset}
                          onChange={(e) => setEdgePreset(e.target.value as MaterialEdgePreset)}
                        >
                          <option value="none">엣지 없음</option>
                          <option value="abs1t">ABS 1T</option>
                          <option value="abs2t">ABS 2T</option>
                          <option value="paint">엣지 도장</option>
                          <option value="custom">사용자 설정</option>
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label className="text-[11px] text-[var(--quote-muted)]">엣지 색상</label>
                        <select
                          disabled={form.edgePreset === "none"}
                          value={form.edgeColor}
                          onChange={(e) => setForm((f) => ({ ...f, edgeColor: e.target.value }))}
                          className="h-[30px] w-full min-w-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none disabled:opacity-50"
                        >
                          {COLORS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  {previewPending ? <p className="mt-1 text-[10px] text-[var(--quote-muted)]">반영 중…</p> : null}
                </QuoteCard>
                <QuoteCard className="shrink-0">
                  <div className="min-h-0 w-full overflow-x-hidden">{sheetStripEl}</div>
                </QuoteCard>
              </div>
              <QuoteCard className="shrink-0">
                <div className="flex flex-col">
                  <QuoteProcRow
                    label="자재 조립"
                    unit="개"
                    value={form.assemblyHours}
                    onChange={(n) => setForm((f) => ({ ...f, assemblyHours: n }))}
                    amount={computed?.assemblyCostWon ?? 0}
                    help={`1시간당 ${mIn.unitAssemblyPerH.toLocaleString("ko-KR")}원 × 조립 시간(시간). (표시·계산: 시간 × ${mIn.unitAssemblyPerH}원)`}
                  />
                  <QuoteProcRow
                    label="일반 보링"
                    unit="개"
                    value={form.boring1Ea}
                    onChange={(n) => setForm((f) => ({ ...f, boring1Ea: n }))}
                    amount={computed?.boring1CostWon ?? 0}
                    help="1개당 100원 × 일반 보링 개수"
                  />
                  <QuoteProcRow
                    label="2단 보링"
                    unit="개"
                    value={form.boring2Ea}
                    onChange={(n) => setForm((f) => ({ ...f, boring2Ea: n }))}
                    amount={computed?.boring2CostWon ?? 0}
                    help="1개당 50원 × 2단 보링 개수"
                  />
                  <QuoteProcRow
                    label="루터 가공"
                    unit="mm"
                    value={Math.round(form.rutaM * 1000)}
                    onChange={(n) => setForm((f) => ({ ...f, rutaM: n / 1000 }))}
                    amount={computed?.rutaCostWon ?? 0}
                    help="1m(1000mm)당 2,000원 — (mm ÷ 1000) × 2,000원"
                  />

                  {addedProcs.includes("ruta2") && (
                    <QuoteProcRow
                      label="루타 2차"
                      unit="mm"
                      value={Math.round(form.ruta2M * 1000)}
                      onChange={(n) => setForm((f) => ({ ...f, ruta2M: n / 1000 }))}
                      amount={computed?.ruta2CostWon ?? 0}
                      onRemove={() => removeProc("ruta2")}
                      help="1m(1000mm)당 1,000원 — (mm ÷ 1000) × 1,000원"
                    />
                  )}
                  {addedProcs.includes("forming") && (
                    <QuoteProcRow
                      label="포밍"
                      unit="mm"
                      value={Math.round(form.formingM * 1000)}
                      onChange={(n) => setForm((f) => ({ ...f, formingM: n / 1000 }))}
                      amount={computed?.formingCostWon ?? 0}
                      onRemove={() => removeProc("forming")}
                      help={`1m(1000mm)당 ${mIn.unitFormingPerM.toLocaleString("ko-KR")}원 — 가공 길이(m) × ${mIn.unitFormingPerM}원`}
                    />
                  )}
                  {addedProcs.includes("tenoner") && (
                    <QuoteProcRow
                      label="테노너"
                      unit="mm"
                      value={form.tenonerMm}
                      onChange={(n) => setForm((f) => ({ ...f, tenonerMm: n }))}
                      amount={computed?.tenonerCostWon ?? 0}
                      onRemove={() => removeProc("tenoner")}
                      help={`1m(1000mm)당 ${TENONER_WON_PER_M.toLocaleString("ko-KR")}원 — (mm ÷ 1000) × ${TENONER_WON_PER_M}원`}
                    />
                  )}

                  {addedProcs.includes("edgePaint") && (
                    <div className="space-y-1 border-b-[0.5px] border-[var(--quote-border)] py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-0.5">
                          <span className="text-[12px] text-[var(--quote-fg)]">엣지 도장</span>
                          <ProcRateHint
                            text={
                              EDGE45_PAINT_RATES[form.edge45PaintType] != null
                                ? `1m(1000mm)당 ${EDGE45_PAINT_RATES[form.edge45PaintType]!.toLocaleString("ko-KR")}원 — (mm ÷ 1000) × 유형 단가 — 유형: ${form.edge45PaintType || ""}`
                                : "유형을 선택하면 1m당 단가(원)가 적용됩니다."
                            }
                          />
                        </div>
                        <button type="button" className="text-[11px] text-[var(--quote-muted)] hover:text-red-500" onClick={() => removeProc("edgePaint")}>
                          제거
                        </button>
                      </div>
                      <select
                        className="h-[30px] w-full rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)]"
                        value={form.edge45PaintType}
                        onChange={(e) => setForm((f) => ({ ...f, edge45PaintType: e.target.value }))}
                      >
                        <option value="">유형 선택</option>
                        <option value="직각+코팅">직각+코팅</option>
                        <option value="직각+테이핑">직각+테이핑</option>
                        <option value="코팅+스프레이">코팅+스프레이</option>
                        <option value="줄눈도장(메지)">줄눈도장(메지)</option>
                        <option value="테이퍼">테이퍼</option>
                        <option value="테이퍼+테이핑">테이퍼+테이핑</option>
                      </select>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          className="h-[30px] w-[50px] shrink-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-right text-[12px] tabular-nums"
                          value={Math.round(form.edge45PaintM * 1000)}
                          onChange={(e) => setForm((f) => ({ ...f, edge45PaintM: (Number(e.target.value) || 0) / 1000 }))}
                        />
                        <span className="text-[14px] text-[var(--quote-muted)]">mm</span>
                        <span className="ml-auto w-[52px] text-right text-[12px] font-medium tabular-nums">
                          {formatWonKorean(computed?.edge45PaintCostWon ?? 0)}
                        </span>
                      </div>
                    </div>
                  )}

                  {addedProcs.includes("edge45") && (
                    <QuoteProcRow
                      label="45도 엣지"
                      unit="mm"
                      value={Math.round(form.edge45TapingM * 1000)}
                      onChange={(n) => setForm((f) => ({ ...f, edge45TapingM: n / 1000 }))}
                      amount={computed?.edge45TapingCostWon ?? 0}
                      onRemove={() => removeProc("edge45")}
                      help="1m(1000mm)당 500원 — 45° 테이핑 길이(m) × 500원"
                    />
                  )}

                  {addedProcs.includes("curved") && (
                    <div className="space-y-1 border-b-[0.5px] border-[var(--quote-border)] py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-0.5">
                          <span className="text-[12px] text-[var(--quote-fg)]">곡면 엣지</span>
                          <ProcRateHint
                            text={
                              form.curvedEdgeType === "manual"
                                ? "1m(1000mm)당 2,000원 — (mm ÷ 1000) × 2,000원 (수동곡면)"
                                : form.curvedEdgeType === "machining"
                                  ? "1m(1000mm)당 3,000원 — (mm ÷ 1000) × 3,000원 (머시닝)"
                                  : "유형 선택 후: 수동 2,000원/m, 머시닝 3,000원/m (길이 m × 단가)"
                            }
                          />
                        </div>
                        <button type="button" className="text-[11px] text-[var(--quote-muted)] hover:text-red-500" onClick={() => removeProc("curved")}>
                          제거
                        </button>
                      </div>
                      <select
                        className="h-[30px] w-full rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px]"
                        value={form.curvedEdgeType}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, curvedEdgeType: e.target.value as "machining" | "manual" | "" }))
                        }
                      >
                        <option value="">유형 선택</option>
                        <option value="machining">머시닝 (3,000원/m)</option>
                        <option value="manual">수동곡면 (2,000원/m)</option>
                      </select>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          className="h-[30px] w-[50px] shrink-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-right text-[12px]"
                          value={Math.round(form.curvedEdgeM * 1000)}
                          onChange={(e) => setForm((f) => ({ ...f, curvedEdgeM: (Number(e.target.value) || 0) / 1000 }))}
                        />
                        <span className="text-[14px] text-[var(--quote-muted)]">mm</span>
                        <span className="ml-auto w-[52px] text-right text-[12px] font-medium tabular-nums">
                          {formatWonKorean(computed?.curvedCostWon ?? 0)}
                        </span>
                      </div>
                    </div>
                  )}

                  <select
                    className="mt-1 w-full rounded-[8px] border-[0.5px] border-dashed border-[var(--quote-border)] bg-transparent py-2 pl-2 text-left text-[12px] text-[var(--quote-muted)]"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setAddedProcs((p) => (p.includes(v) ? p : [...p, v]));
                    }}
                  >
                    <option value="" className="text-left">
                      + 가공 추가하기
                    </option>
                    {ADD_PROC_OPTIONS.filter(([k]) => !addedProcs.includes(k)).map(([k, lab]) => (
                      <option key={k} value={k}>
                        {lab}
                      </option>
                    ))}
                  </select>
                </div>
              </QuoteCard>
            </div>
          )}
        </div>
        {hideRightPanel ? (
          <div className="shrink-0 space-y-2 border-t-[0.5px] border-[var(--quote-border)] bg-[var(--quote-bg)] px-3 py-2">
            <div className="grid w-full grid-cols-3 gap-2 sm:gap-3">
              <ReceiptDetailHover lines={computed ? materialDetailLines(computed, hSelected) : null}>
                <div className="min-w-0 cursor-default text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--quote-muted)]">원자재비</p>
                  <p className="text-[13px] font-bold tabular-nums text-[var(--quote-fg)]">
                    {computed ? formatWonKorean(receiptMaterialWon) : "—"}
                  </p>
                </div>
              </ReceiptDetailHover>
              <ReceiptDetailHover lines={computed ? processingDetailLinesExcludingEdgeHotmelt(computed) : null}>
                <div className="min-w-0 cursor-default text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--quote-muted)]">가공비</p>
                  <p className="text-[13px] font-bold tabular-nums text-[var(--quote-fg)]">
                    {computed ? formatWonKorean(receiptProcessingWon) : "—"}
                  </p>
                </div>
              </ReceiptDetailHover>
              <ReceiptDetailHover
                lines={computed ? totalDetailLines(receiptMaterialWon, receiptProcessingWon, receiptTotalWon) : null}
              >
                <div className="min-w-0 cursor-default text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--quote-muted)]">합계</p>
                  <p className="text-[14px] font-bold tabular-nums text-[#378ADD]">
                    {computed ? formatWonKorean(receiptTotalWon) : "—"}
                  </p>
                </div>
              </ReceiptDetailHover>
            </div>
          </div>
        ) : null}
      </div>

      {!hideRightPanel ? (
      <aside
        className={
          showEditorSplitHeader
            ? "ml-0 flex w-[min(18rem,36vw)] min-w-0 max-w-full shrink-0 flex-col self-start bg-transparent py-2 pr-2 pl-0 sm:py-3 sm:pr-3"
            : "flex w-[260px] shrink-0 flex-col overflow-y-auto border-l-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] p-3"
        }
      >
        <div
          className={
            showEditorSplitHeader
              ? "w-full rounded-none border border-[#d2d5db] bg-white shadow-sm"
              : "contents"
          }
        >
        {showEditorSplitHeader ? (
          <div className="shrink-0 p-3 pb-0">
            <p className="line-clamp-2 text-[15px] font-bold text-[var(--quote-fg)]" title={form.name.trim() || "이름 없음"}>
              {form.name.trim() || "이름 없음"}
            </p>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <input
              ref={nameRef}
              className="min-w-0 flex-1 border-0 bg-transparent text-[14px] font-semibold text-[var(--quote-fg)] outline-none focus:ring-0"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="이름"
            />
            <button
              type="button"
              className="shrink-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] px-2 py-0.5 text-[11px] text-[var(--quote-muted)] hover:border-[#378ADD] hover:text-[#378ADD]"
              onClick={() => nameRef.current?.focus()}
            >
              수정
            </button>
          </div>
        )}
        <div className={`${showEditorSplitHeader ? "px-3" : ""} ${showEditorSplitHeader ? "mt-1" : "mt-2"} text-[26px] font-extrabold tabular-nums text-[#2f80ed]`}>
          {computed ? formatWonKorean(hSelected ? computed.grandTotalWon : computed.processingTotalWon) : "—"}
        </div>

        {computed && (
          <div
            className={`mt-4 space-y-3 text-[var(--quote-fg)]${showEditorSplitHeader ? " px-3 pb-3" : " min-h-0 flex-1 overflow-y-auto"}`}
          >
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--quote-muted)]">원자재비</p>
              <SumLine
                label="목재 자재비"
                sub={`${form.wMm}×${form.dMm}×${form.hMm}T, ${form.boardMaterial}, ${form.surfaceMaterial}, ${form.color}${sel ? `, ${sel.label}` : ""}`}
                amount={matAmt(computed.materialCostWon)}
              />
              {form.edgePreset !== "none" && (
                <SumLine
                  label="엣지 자재비"
                  sub={`${edgeLabelMap[form.edgePreset]}${form.edgePreset === "abs1t" || form.edgePreset === "abs2t" ? `, ${form.edgeColor}` : ""}, ${formatEdgeSidesKo(form.edgeSides)}, ${edgeLengthMm}mm`}
                  amount={matAmt(computed.edgeCostWon)}
                />
              )}
              {(form.edgePreset === "abs1t" || form.edgePreset === "abs2t") && (
                <SumLine label="핫멜트" sub={`${form.hMm}T, ${edgeLengthMm}mm`} amount={matAmt(computed.hotmeltCostWon)} />
              )}
            </div>
            <div className="h-px bg-[var(--quote-border)]" />
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--quote-muted)]">가공비</p>
              <SumLine label="재단" sub={`${computed.cuttingPlacementCount ?? 0}개`} amount={computed.cuttingCostWon} />
              <SumLine label="엣지 접착비" sub="엣지 밴딩·핫멜트 처리 구간" amount={edgeAdhesionWon} />
              <SumLine
                label="보링류"
                sub={`일반 ${form.boring1Ea} / 2단 ${form.boring2Ea}`}
                amount={(computed.boring1CostWon ?? 0) + (computed.boring2CostWon ?? 0)}
              />
            </div>
            <div className="h-px bg-[var(--quote-border)]" />
            <div className="flex justify-between text-[13px] font-bold">
              <span>합계</span>
              <span className="tabular-nums text-[#378ADD]">
                {formatWonKorean(hSelected ? computed.grandTotalWon : computed.processingTotalWon)}
              </span>
            </div>
          </div>
        )}

        {showEditorSplitHeader ? null : (
          <div className="mt-auto flex shrink-0 flex-col gap-2 border-t-[0.5px] border-[var(--quote-border)] pt-3">
            <button
              type="button"
              className="w-full rounded-[8px] bg-black py-2.5 text-[13px] font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              onClick={() => void onSave(false, { banner: true })}
            >
              저장
            </button>
            {!hideCompareActions ? (
              <button
                type="button"
                className="w-full rounded-[8px] border-[0.5px] border-[var(--quote-border)] bg-transparent py-2.5 text-[13px] font-semibold text-[var(--quote-fg)] hover:border-[#378ADD] hover:text-[#378ADD]"
                onClick={() => openCompareModal()}
              >
                비교 목록에 추가
              </button>
            ) : null}
          </div>
        )}
        {showEditorSplitHeader ? <ReceiptTearZigZag /> : null}
        </div>
      </aside>
      ) : null}
      </div>
    </div>
  );
}

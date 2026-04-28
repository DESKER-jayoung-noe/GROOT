import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { SHEET_SPECS, piecesPerSheet, yieldPercent, type PlacementMode } from "../lib/yield";

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
  hideRightPanel?: boolean;
  hideFileBarInSpec?: boolean;
  hideCompareActions?: boolean;
  showEditorSplitHeader?: boolean;
};

function toStrMm(n: number) {
  return n === 0 ? "" : String(n);
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

/* ─────────────────────────────────────────────
   V3 에디터 전용 헬퍼 컴포넌트
───────────────────────────────────────────── */

function V3SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "#888",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function V3HDiv() {
  return <div style={{ height: "0.5px", background: "#e0e0e0", margin: "12px 0" }} />;
}

function V3FieldLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: "#555", marginBottom: 3 }}>{children}</div>;
}

const V3_INP =
  "h-[30px] w-full border-[0.5px] border-[#e0e0e0] bg-white px-2 text-[13px] text-[#1a1a1a] outline-none focus:border-[#999] tabular-nums";
const V3_SEL =
  "h-[30px] w-full border-[0.5px] border-[#e0e0e0] bg-white px-1.5 text-[12px] text-[#1a1a1a] outline-none";

/** 없음/ABS/우레탄/도장 등 세그먼트 토글 */
function V3SegToggle({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div style={{ display: "flex", border: "0.5px solid #e0e0e0" }}>
      {options.map((opt, i) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          style={{
            flex: 1,
            padding: "6px 0",
            fontSize: 11,
            cursor: "pointer",
            color: value === opt.key ? "#fff" : "#888",
            background: value === opt.key ? "#1a1a1a" : "#fff",
            borderTop: "none",
            borderBottom: "none",
            borderLeft: "none",
            borderRight: i < options.length - 1 ? "0.5px solid #e0e0e0" : "none",
            outline: "none",
          } as CSSProperties}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** V3 가공 행: [이름 + ?아이콘] [입력 or 자동계산] [금액] */
function V3ProcRow({
  label,
  help,
  value,
  onChange,
  amount,
  autoCalc,
}: {
  label: string;
  help?: string;
  value: number;
  onChange?: (n: number) => void;
  amount: number;
  autoCalc?: boolean;
}) {
  const muted = amount === 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
        borderBottom: "0.5px solid #e0e0e0",
      }}
      className="last-of-type:border-b-0"
    >
      {/* 이름 + ? */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
        <span style={{ fontSize: 12, color: "#1a1a1a" }}>{label}</span>
        {help ? (
          <div
            style={{
              position: "relative",
              display: "inline-flex",
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#e0e0e0",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              color: "#888",
              cursor: "default",
              flexShrink: 0,
            }}
            className="group"
          >
            ?
            <div
              style={{
                display: "none",
                position: "absolute",
                left: 18,
                top: "50%",
                transform: "translateY(-50%)",
                background: "#1a1a1a",
                color: "#fff",
                fontSize: 11,
                padding: "6px 10px",
                zIndex: 50,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                lineHeight: 1.5,
              }}
              className="group-hover:!block"
            >
              {help}
            </div>
          </div>
        ) : null}
      </div>

      {/* 입력 or 자동계산 */}
      {autoCalc ? (
        <div style={{ fontSize: 10, color: "#969696", flex: 1, textAlign: "right" }}>자동 계산</div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            border: "0.5px solid #e0e0e0",
            height: 24,
            padding: "0 6px",
            background: "#fff",
          }}
        >
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => onChange?.(Number(e.target.value) || 0)}
            style={{
              border: "none",
              outline: "none",
              fontSize: 12,
              width: 36,
              background: "transparent",
              textAlign: "right",
              color: "#1a1a1a",
            }}
          />
          <span style={{ fontSize: 10, color: "#888" }}>개</span>
        </div>
      )}

      {/* 금액 */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: muted ? "#b0b0b0" : "#1a1a1a",
          minWidth: 40,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatWonKorean(amount)}
      </div>
    </div>
  );
}

/** V3 영수증 일반 항목 */
function V3ReceiptRow({
  label,
  sub,
  value,
  muted,
}: {
  label: string;
  sub?: string;
  value: number;
  muted?: boolean;
}) {
  const isMuted = muted || value === 0;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
      <div>
        <div style={{ fontSize: 11, color: "#1a1a1a" }}>{label}</div>
        {sub ? <div style={{ fontSize: 10, color: "#969696", marginTop: 1 }}>{sub}</div> : null}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: isMuted ? "#b0b0b0" : "#1a1a1a",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatWonKorean(value)}
      </div>
    </div>
  );
}

/** V3 영수증 합계 행 (빨간색) */
function V3ReceiptSum({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "#FF5948" }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: "#FF5948", fontVariantNumeric: "tabular-nums" }}>
        {formatWonKorean(value)}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   메인 컴포넌트
───────────────────────────────────────────── */

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
    edge45: "45도 엣지",
    curved: "곱면 엣지",
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

  // ── V3 전용 state (항상 동일 순서로 호출) ──────────────────────────

  /** 원장 팝업 열림 여부 */
  const [showBoardPopup, setShowBoardPopup] = useState(false);
  /** 팝업 내 임시 선택 */
  const [popupSheetId, setPopupSheetId] = useState<string>(
    () => form.selectedSheetId ?? computed?.recommendedSheetId ?? "4x8"
  );
  const [popupMode, setPopupMode] = useState<PlacementMode>(() => form.placementMode ?? "default");

  /** 엣지 외부 토글: none / abs / urethane / paint */
  const [edgeTypeLocal, setEdgeTypeLocal] = useState<"none" | "abs" | "urethane" | "paint">(() => {
    const p = form.edgePreset;
    if (p === "none") return "none";
    if (p === "paint") return "paint";
    return "abs";
  });

  /** edgePreset 변경 시 외부 토글 동기화 */
  useEffect(() => {
    const p = form.edgePreset;
    if (p === "none") setEdgeTypeLocal("none");
    else if (p === "paint") setEdgeTypeLocal("paint");
    else setEdgeTypeLocal("abs");
  }, [form.edgePreset]);

  /** V3 WDT 로컬 입력 state (디바운스) */
  const [wStr, setWStr] = useState(() => toStrMm(form.wMm));
  const [dStr, setDStr] = useState(() => toStrMm(form.dMm));
  const [tStr, setTStr] = useState(() => toStrMm(form.hMm));

  useEffect(() => {
    setWStr(toStrMm(form.wMm));
    setDStr(toStrMm(form.dMm));
    setTStr(toStrMm(form.hMm));
  }, [dimKey, form.wMm, form.dMm, form.hMm]);

  useEffect(() => {
    if (!showEditorSplitHeader) return;
    const t = window.setTimeout(() => {
      onDimensionCommit({ wMm: parseMmStr(wStr), dMm: parseMmStr(dStr), hMm: parseMmStr(tStr) });
    }, 220);
    return () => window.clearTimeout(t);
  }, [wStr, dStr, tStr, onDimensionCommit, showEditorSplitHeader]);

  /** 원장 팝업 데이터 (3행 × 3열) */
  const POPUP_MODES: { mode: PlacementMode; label: string }[] = useMemo(
    () => [
      { mode: "default", label: "정방향" },
      { mode: "rotated", label: "90°" },
      { mode: "mixed", label: "혼합" },
    ],
    []
  );

  const boardPopupRows = useMemo(() => {
    const allCells = POPUP_MODES.flatMap(({ mode }) =>
      SHEET_SPECS.map((spec) => {
        const price = unitPriceBySheetId[spec.id] ?? 0;
        const n = piecesPerSheet(spec.widthMm, spec.heightMm, form.wMm, form.dMm, mode);
        const y = n > 0 ? yieldPercent(n, spec.widthMm, spec.heightMm, form.wMm, form.dMm) : 0;
        const u = n > 0 && price > 0 ? Math.ceil(price / n) : 0;
        return { mode, sheetId: spec.id, pieces: n, yieldPct: y, unitPrice: u };
      })
    );
    const valid = allCells.filter((c) => c.pieces > 0);
    const maxY = valid.length ? Math.max(...valid.map((c) => c.yieldPct)) : 0;
    const minUArr = valid.filter((c) => c.unitPrice > 0).map((c) => c.unitPrice);
    const minU = minUArr.length ? Math.min(...minUArr) : Infinity;
    const EPS = 0.01;

    return POPUP_MODES.map(({ mode, label }) => ({
      mode,
      label,
      cells: SHEET_SPECS.map((spec) => {
        const cell = allCells.find((c) => c.mode === mode && c.sheetId === spec.id)!;
        return {
          ...cell,
          sheetLabel: spec.label,
          sheetPrice: unitPriceBySheetId[spec.id] ?? 0,
          isTop: cell.pieces > 0 && cell.yieldPct >= maxY - EPS,
          isCheap: cell.pieces > 0 && cell.unitPrice > 0 && cell.unitPrice <= minU + EPS,
        };
      }),
    }));
  }, [form.wMm, form.dMm, unitPriceBySheetId, POPUP_MODES]);

  /** 원장 추천 바 표시 데이터 */
  const barSheetId = form.selectedSheetId ?? computed?.recommendedSheetId ?? "4x8";
  const barMode: PlacementMode = form.placementMode ?? "default";
  const barSpec = SHEET_SPECS.find((s) => s.id === barSheetId);
  const barPieces = barSpec
    ? piecesPerSheet(barSpec.widthMm, barSpec.heightMm, form.wMm, form.dMm, barMode)
    : 0;
  const barYield = barSpec
    ? yieldPercent(barPieces, barSpec.widthMm, barSpec.heightMm, form.wMm, form.dMm)
    : 0;
  const barUnitPrice =
    barPieces > 0 ? Math.ceil((unitPriceBySheetId[barSheetId] ?? 0) / barPieces) : 0;
  const barOrientLabel =
    barMode === "rotated" ? "90°" : barMode === "mixed" ? "혼합" : "정방향";
  const barSheetLabel = barSpec?.label ?? "4×8";

  /** 엣지 외부 토글 변경 핸들러 */
  const handleEdgeTypeChange = useCallback(
    (type: "none" | "abs" | "urethane" | "paint") => {
      setEdgeTypeLocal(type);
      startTransition(() => {
        if (type === "none") {
          setForm((f) => ({ ...f, edgePreset: "none" }));
        } else if (type === "abs") {
          setForm((f) => {
            const cur = f.edgePreset;
            if (cur === "abs1t" || cur === "abs2t" || cur === "custom") return f;
            return { ...f, edgePreset: "abs1t" };
          });
        } else {
          // urethane / paint → 모두 "paint" preset 으로 처리
          setForm((f) => ({ ...f, edgePreset: "paint" }));
        }
      });
    },
    [setForm]
  );

  /** 원장 팝업 선택 저장 */
  const handleSaveBoardSel = useCallback(() => {
    if (popupMode === "mixed") {
      onMixedPlacement();
      onSelectSheet?.(popupSheetId);
    } else {
      onSelectSheetOriented(popupSheetId, popupMode as "default" | "rotated");
    }
    setShowBoardPopup(false);
  }, [popupSheetId, popupMode, onMixedPlacement, onSelectSheet, onSelectSheetOriented]);

  // ── 공통 sheetStrip 엘리먼트 (레거시 탭용) ──────────────────────
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
      squareChrome={false}
    />
  );

  /* ══════════════════════════════════════════════════════════
     V3 에디터 레이아웃 (showEditorSplitHeader=true)
  ══════════════════════════════════════════════════════════ */
  if (showEditorSplitHeader) {
    const edgeOuterOptions = [
      { key: "none", label: "없음" },
      { key: "abs", label: "ABS" },
      { key: "urethane", label: "우레탄" },
      { key: "paint", label: "도장" },
    ];
    const absSubOptions = [
      { key: "abs1t", label: "4면 1T" },
      { key: "abs2t", label: "4면 2T" },
      { key: "custom", label: "사용자" },
    ];
    const urethaneSubOptions = [
      { key: "4면", label: "4면" },
      { key: "custom", label: "사용자 설정" },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "#fff", color: "#1a1a1a", fontFamily: "Pretendard, -apple-system, sans-serif" }}>

        {/* ─── 상단 헤더 바 ─── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            padding: "10px 16px",
            borderBottom: "0.5px solid #e8e8e8",
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 500, color: "#bbb" }}>자재 편집</span>
            <span style={{ fontSize: 12, color: "#e0e0e0" }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
              {form.name.trim() || "이름 없음"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {!hideCompareActions ? (
              <button
                type="button"
                style={{ fontSize: 11, fontWeight: 500, color: "#444", border: "0.5px solid #e0e0e0", background: "#fff", padding: "6px 11px", cursor: "pointer" }}
                onClick={() => openCompareModal()}
              >
                비교하기
              </button>
            ) : null}
            <button
              type="button"
              style={{ fontSize: 11, fontWeight: 500, color: "#444", border: "0.5px solid #e0e0e0", background: "#fff", padding: "6px 11px", cursor: "pointer" }}
            >
              도면/모델링 업로드
            </button>
            <button
              type="button"
              style={{ fontSize: 11, fontWeight: 500, color: "#444", border: "0.5px solid #e0e0e0", background: "#fff", padding: "6px 11px", cursor: "pointer" }}
            >
              내보내기
            </button>
          </div>
        </div>

        {/* ─── 2열 바디 ─── */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* ── 왼쪽: 폼 ── */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              overflowX: "hidden",
              padding: "16px 18px",
              borderRight: "0.5px solid #e0e0e0",
            }}
          >
            {/* 패널 규격 */}
            <V3SectionLabel>패널 규격</V3SectionLabel>

            {/* W / D / T */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {(
                [
                  { label: "W (mm)", val: wStr, set: setWStr },
                  { label: "D (mm)", val: dStr, set: setDStr },
                  { label: "T", val: tStr, set: setTStr },
                ] as Array<{ label: string; val: string; set: (s: string) => void }>
              ).map(({ label, val, set }) => (
                <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <V3FieldLabel>{label}</V3FieldLabel>
                  <input
                    type="number"
                    min={0}
                    className={V3_INP}
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              ))}
            </div>

            {/* 보드 소재 / 표면재 / 색상 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <V3FieldLabel>보드 소재</V3FieldLabel>
                <select
                  className={V3_SEL}
                  value={form.boardMaterial}
                  onChange={(e) => setForm((f) => ({ ...f, boardMaterial: e.target.value }))}
                >
                  {BOARD_MATERIALS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <V3FieldLabel>표면재</V3FieldLabel>
                <select
                  className={V3_SEL}
                  value={form.surfaceMaterial}
                  onChange={(e) => setForm((f) => ({ ...f, surfaceMaterial: e.target.value }))}
                >
                  {SURFACE_MATERIALS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <V3FieldLabel>색상</V3FieldLabel>
                <select
                  className={V3_SEL}
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                >
                  {COLORS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 원장 추천 바 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                background: "#f8f8f8",
                border: "0.5px solid #e0e0e0",
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1a" }}>
                  {barSheetLabel} 원장 · {barOrientLabel} 배치{" "}
                  <span style={{ color: "#FF5948", fontWeight: 600 }}>
                    ({barYield > 0 ? barYield.toFixed(1) : "—"}%)
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#888", marginTop: 1 }}>목재 패널 자재비</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1a" }}>
                  {barUnitPrice > 0 ? `${barUnitPrice.toLocaleString("ko-KR")}원` : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPopupSheetId(barSheetId);
                    setPopupMode(barMode);
                    setShowBoardPopup(true);
                  }}
                  style={{
                    fontSize: 11,
                    color: "#555",
                    border: "0.5px solid #e0e0e0",
                    padding: "3px 8px",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  변경
                </button>
              </div>
            </div>

            <V3HDiv />

            {/* ─── 엣지 ─── */}
            <V3SectionLabel>엣지</V3SectionLabel>

            <V3FieldLabel>사양</V3FieldLabel>
            <div style={{ marginBottom: 6 }}>
              <V3SegToggle
                options={edgeOuterOptions}
                value={edgeTypeLocal}
                onChange={(k) => handleEdgeTypeChange(k as "none" | "abs" | "urethane" | "paint")}
              />
            </div>

            {/* 없음 */}
            {edgeTypeLocal === "none" && (
              <div style={{ fontSize: 12, color: "#888", padding: "4px 0" }}>—</div>
            )}

            {/* ABS 서브 */}
            {edgeTypeLocal === "abs" && (
              <div style={{ marginTop: 6 }}>
                <V3FieldLabel>규격</V3FieldLabel>
                <div style={{ marginBottom: 6 }}>
                  <V3SegToggle
                    options={absSubOptions}
                    value={form.edgePreset === "abs1t" || form.edgePreset === "abs2t" || form.edgePreset === "custom" ? form.edgePreset : "abs1t"}
                    onChange={(k) => setEdgePreset(k as MaterialEdgePreset)}
                  />
                </div>
                {form.edgePreset === "custom" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    {(["top", "bottom", "left", "right"] as const).map((side, i) => (
                      <div key={side} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                        <V3FieldLabel>{["상", "하", "좌", "우"][i]}</V3FieldLabel>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          className={V3_INP}
                          value={form.edgeCustomSides[side] || ""}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              edgeCustomSides: {
                                ...f.edgeCustomSides,
                                [side]: Number(e.target.value) || 0,
                              },
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 우레탄 / 도장 서브 */}
            {(edgeTypeLocal === "urethane" || edgeTypeLocal === "paint") && (
              <div style={{ marginTop: 6 }}>
                <V3FieldLabel>규격</V3FieldLabel>
                <V3SegToggle
                  options={urethaneSubOptions}
                  value="4면"
                  onChange={() => {}}
                />
              </div>
            )}

            <V3HDiv />

            {/* ─── 가공 ─── */}
            <V3SectionLabel>가공</V3SectionLabel>

            <div>
              {/* 보링 */}
              <V3ProcRow
                label="보링"
                help={"접구 당 150원\n2단 보링 1개당 250원"}
                value={form.boring1Ea}
                onChange={(n) => setForm((f) => ({ ...f, boring1Ea: n }))}
                amount={(computed?.boring1CostWon ?? 0) + (computed?.boring2CostWon ?? 0)}
              />

              {/* 재단 */}
              <V3ProcRow
                label="재단"
                help="1회당 250원"
                value={computed?.cuttingPlacementCount ?? 0}
                amount={computed?.cuttingCostWon ?? 0}
                autoCalc
              />

              {/* 엣지 접착 */}
              <V3ProcRow
                label="엣지 접착"
                help={"바링 1m당 120원\n핫멜트 1m당 80원"}
                value={0}
                amount={edgeAdhesionWon}
                autoCalc
              />
            </div>

            {/* + 가공 추가하기 */}
            <button
              type="button"
              style={{
                height: 26,
                width: "100%",
                fontSize: 11,
                border: "0.5px dashed #e0e0e0",
                background: "transparent",
                cursor: "pointer",
                color: "#888",
                marginTop: 8,
              }}
              onClick={() => {
                // 현재 V3에서는 단순 토스트 역할 — 필요 시 확장
              }}
            >
              + 가공 추가하기
            </button>
          </div>

          {/* ── 오른쪽: 영수증 ── */}
          <aside
            style={{
              width: 188,
              flexShrink: 0,
              overflowY: "auto",
              padding: "16px 14px",
              fontFamily: "Pretendard, -apple-system, sans-serif",
            }}
          >
            {/* 자재명 */}
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#1a1a1a",
                marginBottom: 2,
                lineHeight: 1.3,
              }}
            >
              {form.name.trim() || "이름 없음"}
            </div>

            {/* 합계금액 */}
            <div
              style={{
                fontSize: 28,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                color: "#1a1a1a",
                marginBottom: 12,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatWonKorean(receiptTotalWon)}
            </div>

            {/* 원재료비 섹션 */}
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#969696",
                marginBottom: 5,
              }}
            >
              원재료비
            </div>

            <V3ReceiptRow
              label="목재 원재료비"
              sub={`${form.wMm}×${form.dMm}×${form.hMm}T · ${form.boardMaterial}`}
              value={matAmt(computed?.materialCostWon ?? 0)}
            />

            {form.edgePreset !== "none" && (
              <V3ReceiptRow
                label="엣지 원재료비"
                sub={`${edgeLabelMap[form.edgePreset]}${edgeLengthMm > 0 ? ` · ${(edgeLengthMm / 1000).toFixed(2)}m` : ""}`}
                value={matAmt(computed?.edgeCostWon ?? 0)}
              />
            )}

            {(form.edgePreset === "abs1t" || form.edgePreset === "abs2t") && (
              <V3ReceiptRow label="핫멜트" value={matAmt(computed?.hotmeltCostWon ?? 0)} />
            )}

            <V3ReceiptSum label="원재료비 합계" value={receiptMaterialWon} />

            <div style={{ height: "0.5px", background: "#EBEBEB", margin: "7px 0" }} />

            {/* 가공비 섹션 */}
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#969696",
                marginBottom: 5,
              }}
            >
              가공비
            </div>

            <V3ReceiptRow
              label="재단"
              sub={`${computed?.cuttingPlacementCount ?? 0}개`}
              value={computed?.cuttingCostWon ?? 0}
            />
            <V3ReceiptRow
              label="엣지 접착비"
              value={edgeAdhesionWon}
              muted={edgeAdhesionWon === 0}
            />
            <V3ReceiptRow
              label="보링류"
              value={(computed?.boring1CostWon ?? 0) + (computed?.boring2CostWon ?? 0)}
              muted={(computed?.boring1CostWon ?? 0) + (computed?.boring2CostWon ?? 0) === 0}
            />

            <V3ReceiptSum label="가공비 합계" value={receiptProcessingWon} />

            <div style={{ height: "0.5px", background: "#EBEBEB", margin: "7px 0" }} />

            {/* 합계 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>합계</span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#1a1a1a",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatWonKorean(receiptTotalWon)}
              </span>
            </div>
          </aside>
        </div>

        {/* ─── 원장 배치 팝업 ─── */}
        {showBoardPopup && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              paddingTop: 30,
              zIndex: 999,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowBoardPopup(false);
            }}
          >
            <div
              style={{
                background: "#fff",
                width: "min(95%, 660px)",
                maxHeight: "78vh",
                overflowY: "auto",
                border: "0.5px solid #e0e0e0",
              }}
            >
              {/* 팝업 헤더 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderBottom: "0.5px solid #e0e0e0",
                  position: "sticky",
                  top: 0,
                  background: "#fff",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500 }}>원장 배치 선택</span>
                <button
                  type="button"
                  onClick={() => setShowBoardPopup(false)}
                  style={{ fontSize: 18, cursor: "pointer", background: "none", border: "none", color: "#888" }}
                >
                  ×
                </button>
              </div>

              {/* 팝업 바디 */}
              <div style={{ padding: "12px 14px" }}>
                {/* 열 헤더 (원장 규격 + 가격) */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "48px repeat(3, 1fr)",
                    gap: 4,
                    marginBottom: 4,
                  }}
                >
                  <div />
                  {SHEET_SPECS.map((spec) => (
                    <div
                      key={spec.id}
                      style={{
                        padding: "6px 8px",
                        background: "#f8f8f8",
                        border: "0.5px solid #e0e0e0",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{spec.label}</div>
                      <div style={{ fontSize: 10, color: "#888" }}>
                        {(unitPriceBySheetId[spec.id] ?? 0).toLocaleString("ko-KR")}원
                      </div>
                    </div>
                  ))}
                </div>

                {/* 배치 행 (정방향 / 90° / 혼합) */}
                {boardPopupRows.map((row) => (
                  <div
                    key={row.mode}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "48px repeat(3, 1fr)",
                      gap: 4,
                      marginBottom: 4,
                      alignItems: "start",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: "#888",
                        paddingTop: 8,
                        textAlign: "center",
                      }}
                    >
                      {row.label}
                    </div>
                    {row.cells.map((cell, si) => {
                      const spec = SHEET_SPECS[si];
                      const isSel = popupSheetId === spec.id && popupMode === row.mode;
                      const isBest = cell.isTop || cell.isCheap;
                      return (
                        <button
                          key={spec.id}
                          type="button"
                          onClick={() => {
                            setPopupSheetId(spec.id);
                            setPopupMode(row.mode);
                          }}
                          style={{
                            border: isSel
                              ? "2px solid #1a1a1a"
                              : isBest
                              ? "2px solid #FF5948"
                              : "1px solid #e0e0e0",
                            background: "#fff",
                            cursor: "pointer",
                            padding: 8,
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            textAlign: "left",
                          }}
                        >
                          {/* 태그 */}
                          <div style={{ display: "flex", gap: 2, minHeight: 12, marginBottom: 2 }}>
                            {cell.isTop && cell.isCheap ? (
                              <>
                                <span style={{ fontSize: 9, padding: "2px 4px", fontWeight: 500, background: "#FF5948", color: "#fff" }}>추천</span>
                                <span style={{ fontSize: 9, padding: "2px 4px", fontWeight: 500, background: "#1a1a1a", color: "#fff" }}>최저가</span>
                              </>
                            ) : cell.isTop ? (
                              <span style={{ fontSize: 9, padding: "2px 4px", fontWeight: 500, background: "#FF5948", color: "#fff" }}>추천</span>
                            ) : cell.isCheap ? (
                              <span style={{ fontSize: 9, padding: "2px 4px", fontWeight: 500, background: "#1a1a1a", color: "#fff" }}>최저가</span>
                            ) : null}
                          </div>
                          {/* 가격 */}
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: isBest ? "#FF5948" : "#1a1a1a",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {cell.unitPrice > 0
                              ? `${cell.unitPrice.toLocaleString("ko-KR")}원`
                              : "—"}
                          </div>
                          {/* EA */}
                          <div style={{ fontSize: 10, color: "#888" }}>
                            {cell.pieces > 0 ? `${cell.pieces}EA` : "—"}
                          </div>
                          {/* 수율 */}
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              color: isBest ? "#FF5948" : "#555",
                            }}
                          >
                            {cell.pieces > 0 ? `${cell.yieldPct.toFixed(1)}%` : "—"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* 팝업 푸터 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 6,
                  padding: "10px 14px",
                  borderTop: "0.5px solid #e0e0e0",
                  position: "sticky",
                  bottom: 0,
                  background: "#fff",
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowBoardPopup(false)}
                  style={{
                    height: 30,
                    padding: "0 12px",
                    fontSize: 12,
                    cursor: "pointer",
                    border: "0.5px solid #e0e0e0",
                    background: "transparent",
                    color: "#555",
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveBoardSel}
                  style={{
                    height: 30,
                    padding: "0 12px",
                    fontSize: 12,
                    cursor: "pointer",
                    border: "none",
                    background: "#1a1a1a",
                    color: "#fff",
                    fontWeight: 500,
                  }}
                >
                  선택 저장
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     레거시 레이아웃 (showEditorSplitHeader=false)
  ══════════════════════════════════════════════════════════ */
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--quote-bg)] text-[var(--quote-fg)]">
      <div className="flex min-h-0 w-full flex-1 flex-row overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[10px] overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
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
                          <option key={c} value={c}>{c}</option>
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
                          <option key={c} value={c}>{c}</option>
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
                          <option key={c} value={c}>{c}</option>
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
                          <option key={c} value={c}>{c}</option>
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
                                ? `1m(1000mm)당 ${EDGE45_PAINT_RATES[form.edge45PaintType]!.toLocaleString("ko-KR")}원`
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
                                ? "1m(1000mm)당 2,000원 (수동곡면)"
                                : form.curvedEdgeType === "machining"
                                  ? "1m(1000mm)당 3,000원 (머시닝)"
                                  : "유형 선택 후: 수동 2,000원/m, 머시닝 3,000원/m"
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
          <aside className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-l-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] p-3">
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
            <div className="mt-2 text-[26px] font-extrabold tabular-nums text-[#2f80ed]">
              {computed ? formatWonKorean(hSelected ? computed.grandTotalWon : computed.processingTotalWon) : "—"}
            </div>

            {computed && (
              <div className="mt-4 space-y-3 min-h-0 flex-1 overflow-y-auto text-[var(--quote-fg)]">
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
          </aside>
        ) : null}
      </div>
    </div>
  );
}

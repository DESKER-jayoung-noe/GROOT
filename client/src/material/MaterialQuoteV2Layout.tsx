import { startTransition, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { formatEdgeSidesKo } from "../lib/materialCalc";
import type { ComputedMaterial } from "../lib/materialCalc";
import { formatWonKorean } from "../util/format";
import { quotePathForKind } from "../quote/quotePaths";
import { useQuoteTabs, type QuoteKind } from "../context/QuoteTabsContext";
import { DimensionMmInputs } from "./DimensionMmInputs";
import { MaterialQuoteFileBar } from "./quote/MaterialQuoteFileBar";
import { MaterialSheetQuoteStrip } from "./quote/MaterialSheetQuoteStrip";
import { MaterialEdgeFaceGrid } from "./quote/MaterialEdgeFaceGrid";
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
  /** true면 우측 요약 패널 숨기고 하단에 이름·합계·저장만 표시 */
  hideRightPanel?: boolean;
};

function QuoteProcRow({
  label,
  unit,
  value,
  onChange,
  amount,
  step = 1,
  onRemove,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (n: number) => void;
  amount: number;
  step?: number;
  onRemove?: () => void;
}) {
  return (
    <div className="flex min-h-[34px] items-center gap-2 border-b-[0.5px] border-[var(--quote-border)] py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1 text-[12px] text-[var(--quote-fg)]">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        className="h-[30px] w-[50px] shrink-0 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-right text-[12px] tabular-nums text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
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
}: Props) {
  const loc = useLocation();
  const nav = useNavigate();
  const { tabs, activeTabId } = useQuoteTabs();
  const nameRef = useRef<HTMLInputElement>(null);

  const quotePaths = ["/material", "/product", "/set"];
  const quoteTabActive = quotePaths.some((p) => loc.pathname === p || loc.pathname.endsWith(p));

  const quoteTo = activeTabId
    ? quotePathForKind((tabs.find((t) => t.tabId === activeTabId)?.kind ?? "material") as QuoteKind)
    : "/material";

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

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--quote-bg)] text-[var(--quote-fg)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 gap-8 border-b-[0.5px] border-[var(--quote-border)] px-[10px] pt-2">
          <Link
            to={quoteTo}
            className={`pb-2 text-[13px] font-medium ${
              quoteTabActive ? "border-b-2 border-[var(--quote-fg)] text-[var(--quote-fg)]" : "border-b-2 border-transparent text-[var(--quote-muted)]"
            }`}
          >
            견적내기
          </Link>
          <NavLink
            to="/compare"
            className={({ isActive }) =>
              `pb-2 text-[13px] font-medium ${isActive ? "border-b-2 border-[var(--quote-fg)] text-[var(--quote-fg)]" : "border-b-2 border-transparent text-[var(--quote-muted)]"}`
            }
          >
            견적비교하기
          </NavLink>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-hidden p-[10px]">
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-[10px] overflow-hidden">
          <div className="flex min-h-0 flex-col gap-[10px] overflow-hidden">
            <QuoteCard label="규격 & 사양" className="shrink-0">
              <MaterialQuoteFileBar
                onApplyDimensions={(wMm, dMm, hMm) => {
                  onDimensionCommit({ wMm, dMm, hMm });
                }}
              />
              <div className="mt-2 flex min-w-0 flex-nowrap items-end gap-2 overflow-x-auto border-t-[0.5px] border-[var(--quote-border)] pt-2">
                <DimensionMmInputs
                  key={dimKey}
                  variant="quoteRow"
                  wMm={form.wMm}
                  dMm={form.dMm}
                  hMm={form.hMm}
                  onCommit={onDimensionCommit}
                />
                <div className="mx-1 h-6 w-px shrink-0 bg-[var(--quote-border)]" aria-hidden />
                <div className="flex min-w-0 flex-nowrap items-end gap-1.5">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[11px] text-[var(--quote-muted)]">소재</label>
                    <select
                      className="h-[30px] min-w-[3.25rem] rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
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
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[11px] text-[var(--quote-muted)]">표면재</label>
                    <select
                      className="h-[30px] min-w-[3.25rem] rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
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
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[11px] text-[var(--quote-muted)]">색상</label>
                    <select
                      className="h-[30px] min-w-[3rem] rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none"
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
                </div>
              </div>
              {previewPending ? <p className="mt-1 text-[10px] text-[var(--quote-muted)]">반영 중…</p> : null}
            </QuoteCard>
          </div>

          <div className="flex min-h-0 flex-col gap-[10px] overflow-hidden">
            <QuoteCard label="엣지" className="max-h-[48%] shrink-0 overflow-y-auto">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["abs1t", "ABS 1T"],
                        ["abs2t", "ABS 2T"],
                        ["paint", "엣지 도장"],
                        ["none", "엣지 없음"],
                      ] as const
                    ).map(([k, lab]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setEdgePreset(k)}
                        className={`rounded-full border-[0.5px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          form.edgePreset === k
                            ? "border-[#378ADD] bg-[#378ADD] text-white"
                            : "border-[var(--quote-border)] bg-[var(--quote-card-muted)] text-[var(--quote-fg)] hover:border-[#378ADD]/50"
                        }`}
                      >
                        {lab}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] text-[var(--quote-muted)]">색상</label>
                    <select
                      disabled={form.edgePreset === "none"}
                      value={form.edgeColor}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, edgeColor: e.target.value as "WW" | "BI" }))
                      }
                      className="h-[30px] w-[80px] rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-1 text-[12px] text-[var(--quote-fg)] focus:border-[#378ADD] focus:outline-none disabled:opacity-50"
                    >
                      <option value="WW">WW</option>
                      <option value="BI">BI</option>
                    </select>
                  </div>
                </div>
                <MaterialEdgeFaceGrid
                  wMm={form.wMm}
                  dMm={form.dMm}
                  value={form.edgeSides}
                  disabled={form.edgePreset === "none"}
                  onChange={(next) => setForm((f) => ({ ...f, edgeSides: next }))}
                />
              </div>
            </QuoteCard>

            <QuoteCard label="가공" className="min-h-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                <QuoteProcRow
                  label="자재 조립"
                  unit="개"
                  value={form.assemblyHours}
                  onChange={(n) => setForm((f) => ({ ...f, assemblyHours: n }))}
                  amount={computed?.assemblyCostWon ?? 0}
                />
                <QuoteProcRow
                  label="일반 보링"
                  unit="개"
                  value={form.boring1Ea}
                  onChange={(n) => setForm((f) => ({ ...f, boring1Ea: n }))}
                  amount={computed?.boring1CostWon ?? 0}
                />
                <QuoteProcRow
                  label="2단 보링"
                  unit="개"
                  value={form.boring2Ea}
                  onChange={(n) => setForm((f) => ({ ...f, boring2Ea: n }))}
                  amount={computed?.boring2CostWon ?? 0}
                />
                <QuoteProcRow
                  label="루터 가공"
                  unit="mm"
                  value={Math.round(form.rutaM * 1000)}
                  onChange={(n) => setForm((f) => ({ ...f, rutaM: n / 1000 }))}
                  amount={computed?.rutaCostWon ?? 0}
                />

                {addedProcs.includes("ruta2") && (
                  <QuoteProcRow
                    label="루타 2차"
                    unit="mm"
                    value={Math.round(form.ruta2M * 1000)}
                    onChange={(n) => setForm((f) => ({ ...f, ruta2M: n / 1000 }))}
                    amount={computed?.ruta2CostWon ?? 0}
                    onRemove={() => removeProc("ruta2")}
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
                  />
                )}

                {addedProcs.includes("edgePaint") && (
                  <div className="space-y-1 border-b-[0.5px] border-[var(--quote-border)] py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[12px] text-[var(--quote-fg)]">엣지 도장</span>
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
                  />
                )}

                {addedProcs.includes("curved") && (
                  <div className="space-y-1 border-b-[0.5px] border-[var(--quote-border)] py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[12px] text-[var(--quote-fg)]">곡면 엣지</span>
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
                  className="mt-1 w-full rounded-[8px] border-[0.5px] border-dashed border-[var(--quote-border)] bg-transparent py-2 text-center text-[12px] text-[var(--quote-muted)]"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setAddedProcs((p) => (p.includes(v) ? p : [...p, v]));
                  }}
                >
                  <option value="">+ 가공 추가하기</option>
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

          <QuoteCard label="원장 선택" className="flex min-h-0 max-h-[min(420px,48vh)] shrink-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
              <MaterialSheetQuoteStrip
                pieceWMm={form.wMm}
                pieceDMm={form.dMm}
                placementMode={form.placementMode}
                onPlacementModeChange={(m) => startTransition(() => setForm((f) => ({ ...f, placementMode: m })))}
                selectedSheetId={form.selectedSheetId}
                computedSelectedId={computed?.selectedSheetId ?? null}
                recommendedSheetId={computed?.recommendedSheetId ?? null}
                onSelectSheetOriented={onSelectSheetOriented}
                onSelectSheet={onSelectSheet}
                unavailableSheetIds={unavailableSheetIds}
                unitPriceBySheetId={unitPriceBySheetId}
                erpCodeBySheetId={erpCodeBySheetId}
                showPrice={form.hMm > 0}
              />
            </div>
          </QuoteCard>
        </div>
        {hideRightPanel ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t-[0.5px] border-[var(--quote-border)] bg-[var(--quote-card)] px-3 py-2">
            <input
              ref={nameRef}
              className="min-w-[6rem] flex-1 rounded-[6px] border-[0.5px] border-[var(--quote-border)] bg-[var(--quote-bg)] px-2 py-1 text-[13px] font-semibold text-[var(--quote-fg)] outline-none focus:border-[#378ADD]"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="이름"
            />
            <span className="text-[15px] font-bold tabular-nums text-[#378ADD]">
              {computed ? formatWonKorean(hSelected ? computed.grandTotalWon : computed.processingTotalWon) : "—"}
            </span>
            <button
              type="button"
              className="rounded-[8px] bg-black px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              onClick={() => void onSave(false, { banner: true })}
            >
              저장
            </button>
            <button
              type="button"
              className="rounded-[8px] border-[0.5px] border-[var(--quote-border)] px-3 py-2 text-[12px] font-semibold text-[var(--quote-fg)] hover:border-[#378ADD]"
              onClick={() => nav("/compare")}
            >
              비교 목록에 추가
            </button>
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
        <div className="mt-2 text-[26px] font-bold tabular-nums text-[#378ADD]">
          {computed ? formatWonKorean(hSelected ? computed.grandTotalWon : computed.processingTotalWon) : "—"}
        </div>

        {computed && (
          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto text-[var(--quote-fg)]">
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
          <button
            type="button"
            className="w-full rounded-[8px] border-[0.5px] border-[var(--quote-border)] bg-transparent py-2.5 text-[13px] font-semibold text-[var(--quote-fg)] hover:border-[#378ADD] hover:text-[#378ADD]"
            onClick={() => nav("/compare")}
          >
            비교 목록에 추가
          </button>
        </div>
      </aside>
      ) : null}
    </div>
  );
}

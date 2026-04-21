import {
  forwardRef,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  computeMaterial,
  buildMaterialInput,
  DEFAULT_EDGE_SIDES as DEFAULT_EDGE_SELECTION,
  formatEdgeSidesKo,
  type EdgeSelection,
} from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import {
  deleteMaterial as lsDelete,
  getMaterial as lsGet,
  getMaterials as lsGetAll,
  materialListRow,
  newId,
  putMaterial as lsSave,
  type StoredMaterial,
} from "../offline/stores";
import { formatWonKorean } from "../util/format";
import { DIMENSION_FIELD_CONTROL_CLASS, DimensionMmInputs } from "./DimensionMmInputs";
import { MaterialQuoteV2Layout } from "./MaterialQuoteV2Layout";
import { MaterialSheetCards } from "./MaterialSheetCards";
import { MaterialQuoteFileStrip } from "./MaterialQuoteFileStrip";
import { MaterialCollapsibleSection } from "./MaterialCollapsibleSection";
import { MaterialEdgeFacePicker } from "./MaterialEdgeFacePicker";

/** 규격·사양 한 줄용 좁은 셀렉트 */
const SPEC_SELECT_FIELD_CLASS =
  "w-[78px] shrink-0 rounded-lg border border-[#e5e8ec] bg-white px-2 py-1.5 text-[12px] text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-1 focus:ring-[#3182f6]/20";

export type PlacementMode = "default" | "rotated" | "mixed";

/** 두께(T) × 원장 사이즈별 장당 단가 (원) — ERP 데이터 기반 */
const SHEET_PRICE_BY_THICKNESS: Partial<Record<number, Partial<Record<string, number>>>> = {
  12: { "4x8": 16720 },
  15: { "4x6": 14450, "4x8": 19060, "6x8": 27320 },
  18: { "4x6": 16620, "4x8": 21510, "6x8": 30650 },
  22: { "4x8": 24680, "6x8": 35610 },
  25: { "4x8": 6640 },
  28: { "4x8": 29620, "6x8": 42600 },
};

/** 두께(T) × 원장 사이즈별 ERP 자재코드 */
const SHEET_ERP_CODE_BY_THICKNESS: Partial<Record<number, Partial<Record<string, string>>>> = {
  12: { "4x8": "WDWP000260-R000" },
  15: { "4x6": "WDWP001205-R000", "4x8": "WDWP000258-R000", "6x8": "WDWP001360-R000" },
  18: { "4x6": "WDPGBL0000550", "4x8": "WDWP000274-R000", "6x8": "WDWPMF0000354" },
  22: { "4x8": "WDWP000266-R000", "6x8": "WDWP000730-R000" },
  25: { "4x8": "WDWP001811-R000" },
  28: { "4x8": "WDWP000262-R000", "6x8": "WDWP000951-R000" },
};

const ALL_SHEET_IDS = ["4x6", "4x8", "6x8"] as const;

export type MaterialEdgePreset = "none" | "abs1t" | "abs2t" | "paint" | "custom";

export type EdgeCustomSidesForm = { top: number; bottom: number; left: number; right: number };

export type MaterialFormState = {
  name: string;
  /** 테이블·BOM 연동용 파트 코드 (선택) */
  partCode?: string;
  wMm: number;
  dMm: number;
  hMm: number;
  color: string;
  boardMaterial: string;
  surfaceMaterial: string;
  edgePreset: MaterialEdgePreset;
  edgeColor: "WW" | "BI";
  edgeCustomSides: EdgeCustomSidesForm;
  /** 엣지 적용 면 */
  edgeSides: EdgeSelection;
  placementMode: PlacementMode;
  sheetPrices: Record<string, number>;
  selectedSheetId: string | null;
  formingM: number;
  rutaM: number;
  assemblyHours: number;
  washM2: number;
  boring1Ea: number;
  boring2Ea: number;
  curvedEdgeM: number;
  curvedEdgeType: "machining" | "manual" | "";
  edge45TapingM: number;
  edge45PaintType: string;
  edge45PaintM: number;
  ruta2M: number;
  /** 테노너 가공 길이 (mm) */
  tenonerMm: number;
};

type SheetRow = {
  sheetId: string;
  label: string;
  pieces: number;
  layoutCols: number;
  layoutRows: number;
  layoutExtraCols?: number;
  layoutExtraRows?: number;
  yieldPct: number;
  costPerPiece: number;
  sheetPriceWon: number;
  sheetW: number;
  sheetH: number;
};

type Computed = {
  sheets: SheetRow[];
  recommendedSheetId: string | null;
  selectedSheetId: string | null;
  resolvedEdgeProfileKey?: string;
  materialCostWon: number;
  edgeLengthM: number;
  edgeCostWon: number;
  hotmeltCostWon: number;
  cuttingCostWon: number;
  cuttingPlacementCount?: number;
  formingCostWon: number;
  rutaCostWon: number;
  ruta2CostWon: number;
  assemblyCostWon: number;
  washCostWon: number;
  boring1CostWon: number;
  boring2CostWon: number;
  boringCostWon: number;
  curvedCostWon: number;
  edge45TapingCostWon: number;
  edge45PaintCostWon: number;
  edge45CostWon: number;
  tenonerCostWon: number;
  processingTotalWon: number;
  grandTotalWon: number;
  cuttingSheetCount: number;
  sheetCount: number;
};

const COLORS = ["WW", "BI", "OHN", "NBK"];
const BOARD_MATERIALS = ["PB", "SPB", "MDF"] as const;
const SURFACE_MATERIALS = ["LPM/O", "LPM/-", "FF/-"] as const;

const DEFAULT_EDGE_SIDES: EdgeCustomSidesForm = { top: 0, bottom: 0, left: 0, right: 0 };

/** 구버전 저장분(edgeProfileKey) → 프리셋 */
function migrateEdgePreset(form: { edgePreset?: MaterialEdgePreset; edgeProfileKey?: string }): MaterialEdgePreset {
  if (form.edgePreset === "custom") return "abs1t";
  if (form.edgePreset) return form.edgePreset;
  const k = form.edgeProfileKey?.trim() ?? "";
  if (!k) return "none";
  if (k === "4면 ABS 2T") return "abs2t";
  return "abs1t";
}

function normalizeBoardSurface(form: { boardMaterial?: string; surfaceMaterial?: string }): {
  boardMaterial: string;
  surfaceMaterial: string;
} {
  const bm = form.boardMaterial ?? "";
  const board = (["PB", "SPB", "MDF"] as const).includes(bm as "PB" | "SPB" | "MDF") ? bm : "PB";
  const sm = form.surfaceMaterial ?? "";
  const surface = sm || "LPM/O";
  return { boardMaterial: board, surfaceMaterial: surface };
}

/** 임시저장/불러오기 시 변경 여부 판별용 */
function serializeMaterialState(id: string | null, f: MaterialFormState): string {
  return JSON.stringify({
    id,
    name: f.name,
    partCode: f.partCode ?? "",
    wMm: f.wMm,
    dMm: f.dMm,
    hMm: f.hMm,
    color: f.color,
    boardMaterial: f.boardMaterial,
    surfaceMaterial: f.surfaceMaterial,
    edgePreset: f.edgePreset,
    edgeColor: f.edgeColor,
    edgeCustomSides: f.edgeCustomSides,
    edgeSides: f.edgeSides,
    placementMode: f.placementMode,
    sheetPrices: f.sheetPrices,
    selectedSheetId: f.selectedSheetId,
    formingM: f.formingM,
    rutaM: f.rutaM,
    assemblyHours: f.assemblyHours,
    washM2: f.washM2,
    boring1Ea: f.boring1Ea,
    boring2Ea: f.boring2Ea,
    curvedEdgeM: f.curvedEdgeM,
    curvedEdgeType: f.curvedEdgeType,
    edge45TapingM: f.edge45TapingM,
    edge45PaintType: f.edge45PaintType,
    edge45PaintM: f.edge45PaintM,
    ruta2M: f.ruta2M,
    tenonerMm: f.tenonerMm,
  });
}

function isBlankNewMaterial(id: string | null, f: MaterialFormState): boolean {
  if (id != null) return false;
  return (
    !f.name.trim() &&
    f.wMm === 0 &&
    f.dMm === 0 &&
    f.hMm === 0 &&
    f.formingM === 0 &&
    f.rutaM === 0 &&
    f.assemblyHours === 0 &&
    f.washM2 === 0 &&
    f.boring1Ea === 0 &&
    f.boring2Ea === 0 &&
    f.curvedEdgeM === 0 &&
    f.edge45TapingM === 0 &&
    f.edge45PaintM === 0 &&
    (f.tenonerMm ?? 0) === 0 &&
    Object.keys(f.sheetPrices).length === 0
  );
}

function defaultForm(): MaterialFormState {
  return {
    name: "",
    partCode: "",
    wMm: 0,
    dMm: 0,
    hMm: 0,
    color: "WW",
    boardMaterial: "PB",
    surfaceMaterial: "LPM/O",
    edgePreset: "none",
    edgeColor: "WW",
    edgeCustomSides: { ...DEFAULT_EDGE_SIDES },
    edgeSides: { top: true, bottom: true, left: true, right: true },
    placementMode: "default",
    sheetPrices: {},
    selectedSheetId: null,
    formingM: 0,
    rutaM: 0,
    assemblyHours: 0,
    washM2: 0,
    boring1Ea: 0,
    boring2Ea: 0,
    curvedEdgeM: 0,
    curvedEdgeType: "",
    edge45TapingM: 0,
    edge45PaintType: "",
    edge45PaintM: 0,
    ruta2M: 0,
    tenonerMm: 0,
  };
}

export type MaterialTabHandle = {
  saveDraft: () => Promise<void>;
  save: () => Promise<void>;
  createNew: () => Promise<void>;
  openLibrary: () => void;
  /** 통합 보관함에서 항목 불러오기 */
  loadFromVault: (id: string) => Promise<void>;
};

/**
 * 영수증 하단 — 직사각 슬롯(성곽형). w↑ → 톱니 촘촘·스트립 높이↓ 이므로 너무 크면 얇은 띠처럼 보임.
 */
function ReceiptTornEdge() {
  // 흰색 사각형 - 투명 반복 (그림자가 자연스럽게 보이도록 투명 갭)
  // 오른쪽에서 시작하는 gradient + 왼쪽 캡 → 양 끝 모두 흰색 사각형
  const size = 7; // 정사각형 한 변 (px) — 이전의 절반
  return (
    <div
      className="pointer-events-none relative w-full shrink-0 overflow-hidden"
      aria-hidden
      style={{ height: size }}
    >
      {/* 오른쪽 끝부터 흰색으로 시작하는 repeating gradient → 오른쪽 끝 항상 흰색 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(
            to left,
            white 0px,
            white ${size}px,
            transparent ${size}px,
            transparent ${size * 2}px
          )`,
        }}
      />
      {/* 왼쪽 끝 흰색 캡 → 왼쪽 끝도 항상 흰색 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          background: "white",
        }}
      />
    </div>
  );
}

export const MaterialTab = forwardRef<
  MaterialTabHandle,
  {
    active?: boolean;
    onBannerMessage?: (msg: string | null) => void;
    /** 견적 페이지 다중 탭: 이 엔티티만 편집 */
    quoteBindEntityId?: string | null;
    onQuoteMeta?: (meta: { name: string; grandTotalWon: number }) => void;
    /** 불러오기 등으로 편집 중 엔티티 id가 바뀌면 상위(탭)에 알림 */
    onQuoteEntityRebind?: (entityId: string) => void;
    /** 탭 제목에서 이름 변경 시 증가 — 로컬 폼과 스토어 동기화 */
    stripRenameEpoch?: number;
    /** 견적 편집 UI에서 우측 요약 패널 숨김 (테이블 모달 등) */
    quoteHideRightPanel?: boolean;
  }
>(function MaterialTab({
  active = true,
  onBannerMessage,
  quoteBindEntityId,
  onQuoteMeta,
  onQuoteEntityRebind,
  stripRenameEpoch = 0,
  quoteHideRightPanel = false,
}, ref) {
  const [form, setForm] = useState<MaterialFormState>(defaultForm);
  const [computed, setComputed] = useState<Computed | null>(null);
  const [list, setList] = useState<
    { id: string; name: string; status: string; updatedAt: string; grandTotalWon: number; summary: string }[]
  >([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [listOpen, setListOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** 불러오기·새 자재 시 치수 입력을 props와 맞추기 위해 remount */
  const [dimKey, setDimKey] = useState(0);
  /** 추가된 가공 항목 목록 (UI 전용) */
  const [addedProcs, setAddedProcs] = useState<string[]>([]);
  /** 마지막으로 서버/불러오기와 일치한다고 본 스냅샷 */
  const savedRef = useRef(serializeMaterialState(null, defaultForm()));
  const formRef = useRef(form);
  formRef.current = form;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  const onQuoteEntityRebindRef = useRef(onQuoteEntityRebind);
  onQuoteEntityRebindRef.current = onQuoteEntityRebind;

  /** 저장/임시저장용 — 이름 포함 전체 폼 */
  const saveBody = useMemo(() => ({ ...form }), [form]);

  /** 미리보기 API용 — 견적에 영향 없는 필드만 (이름 입력 시 불필요한 재요청 방지) */
  const previewPayload = useMemo(
    () => ({
      wMm: form.wMm,
      dMm: form.dMm,
      hMm: form.hMm,
      color: form.color,
      boardMaterial: form.boardMaterial,
      surfaceMaterial: form.surfaceMaterial,
      edgePreset: form.edgePreset,
      edgeColor: form.edgeColor,
      edgeCustomSides: form.edgeCustomSides,
      edgeSides: form.edgeSides,
      placementMode: form.placementMode,
      sheetPrices: form.sheetPrices,
      selectedSheetId: form.selectedSheetId,
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
    [
      form.wMm,
      form.dMm,
      form.hMm,
      form.color,
      form.boardMaterial,
      form.surfaceMaterial,
      form.edgePreset,
      form.edgeColor,
      form.edgeCustomSides,
      form.edgeSides,
      form.placementMode,
      form.sheetPrices,
      form.selectedSheetId,
      form.formingM,
      form.rutaM,
      form.assemblyHours,
      form.washM2,
      form.boring1Ea,
      form.boring2Ea,
      form.curvedEdgeM,
      form.curvedEdgeType,
      form.edge45TapingM,
      form.edge45PaintType,
      form.edge45PaintM,
      form.ruta2M,
      form.tenonerMm,
    ]
  );

  /** 입력이 잠시 멈출 때까지 미리보기를 늦춰 메인 스레드·API 부담 감소 */
  const previewKey = useMemo(() => JSON.stringify(previewPayload), [previewPayload]);
  const deferredPreviewKey = useDeferredValue(previewKey);
  const previewPending = previewKey !== deferredPreviewKey;

  const refreshList = useCallback(() => {
    setList(
      lsGetAll().map((m) => {
        const row = materialListRow(m);
        return {
          id: row.id,
          name: row.name,
          status: m.status,
          updatedAt: m.updatedAt,
          grandTotalWon: row.grandTotalWon,
          summary: row.summary,
        };
      })
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    refreshList();
  }, [active, refreshList]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(deferredPreviewKey) as MaterialFormState & { selectedSheetId: string | null };
        const input = buildMaterialInput({
          ...payload,
          sheetPrices: payload.sheetPrices as Partial<Record<SheetId, number>>,
        });
        const result = computeMaterial(input, (payload.selectedSheetId ?? null) as SheetId | null);
        startTransition(() => setComputed(result as unknown as Computed));
      } catch {
        startTransition(() => setComputed(null));
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [active, deferredPreviewKey]);

  const loadMaterial = useCallback(
    (id: string) => {
      const row = lsGet(id);
      if (!row) return;
      const raw = row.form as MaterialFormState & {
        edges?: unknown;
        edgeProfileKey?: string;
        boringEa?: number;
        edge45M?: number;
      };
      const { edges: _omitEdges, edgeProfileKey: _omitKey, ...saved } = raw;
      void _omitEdges;
      void _omitKey;
      const ns = normalizeBoardSurface(raw);
      const nextForm: MaterialFormState = {
        ...saved,
        ...ns,
        name: row.name,
        partCode: typeof (raw as { partCode?: string }).partCode === "string" ? (raw as { partCode?: string }).partCode : "",
        edgePreset: migrateEdgePreset(raw),
        edgeCustomSides: raw.edgeCustomSides ?? { ...DEFAULT_EDGE_SIDES },
        edgeSides: raw.edgeSides ?? { ...DEFAULT_EDGE_SELECTION },
        edgeColor: "WW",
        tenonerMm: (saved as { tenonerMm?: number }).tenonerMm ?? 0,
        boring1Ea: (saved as { boring1Ea?: number }).boring1Ea ?? (raw as { boringEa?: number }).boringEa ?? 0,
        boring2Ea: (saved as { boring2Ea?: number }).boring2Ea ?? 0,
        curvedEdgeType: (saved as { curvedEdgeType?: "machining" | "manual" | "" }).curvedEdgeType ?? "",
        edge45TapingM: (saved as { edge45TapingM?: number }).edge45TapingM ?? (raw as { edge45M?: number }).edge45M ?? 0,
        edge45PaintType: (saved as { edge45PaintType?: string }).edge45PaintType ?? "",
        edge45PaintM: (saved as { edge45PaintM?: number }).edge45PaintM ?? 0,
      };
      const restoredProcs: string[] = [];
      if ((nextForm.rutaM ?? 0) > 0) restoredProcs.push("ruta");
      if ((nextForm.ruta2M ?? 0) > 0) restoredProcs.push("ruta2");
      if ((nextForm.formingM ?? 0) > 0) restoredProcs.push("forming");
      if (nextForm.edge45PaintType || (nextForm.edge45PaintM ?? 0) > 0) restoredProcs.push("edgePaint");
      if ((nextForm.edge45TapingM ?? 0) > 0) restoredProcs.push("edge45");
      if ((nextForm.curvedEdgeM ?? 0) > 0) restoredProcs.push("curved");
      if ((nextForm.tenonerMm ?? 0) > 0) restoredProcs.push("tenoner");
      setAddedProcs(restoredProcs);
      setForm(nextForm);
      setEditingId(id);
      setDimKey((k) => k + 1);
      savedRef.current = serializeMaterialState(id, nextForm);
      onQuoteEntityRebindRef.current?.(id);
    },
    []
  );

  const onDimensionCommit = useCallback((next: { wMm: number; dMm: number; hMm: number }) => {
    startTransition(() =>
      setForm((f) => {
        // H가 변경됐을 때만 원장 단가를 자동 갱신
        if (next.hMm !== f.hMm) {
          const prices = SHEET_PRICE_BY_THICKNESS[next.hMm] ?? {};
          const sheetPrices: Record<string, number> = {};
          for (const id of ALL_SHEET_IDS) {
            if (prices[id] != null) sheetPrices[id] = prices[id]!;
          }
          return { ...f, ...next, sheetPrices };
        }
        return { ...f, ...next };
      })
    );
  }, []);

  const onSelectSheet = useCallback((sheetId: string) => {
    startTransition(() => setForm((f) => ({ ...f, selectedSheetId: sheetId })));
  }, []);

  const onSelectSheetOriented = useCallback((sheetId: string, orientation: "default" | "rotated") => {
    startTransition(() => setForm((f) => ({ ...f, selectedSheetId: sheetId, placementMode: orientation })));
  }, []);

  type SaveOpts = { banner?: boolean };

  const onSaveRef = useRef<(d: boolean, o?: SaveOpts) => Promise<boolean>>(async () => false);
  const onSave = useCallback(
    async (draft: boolean, opts?: SaveOpts): Promise<boolean> => {
      const showBanner = opts?.banner === true;
      if (showBanner) setMsg(null);
      try {
        const id = editingId ?? newId("m");
        const status = draft ? "DRAFT" : "SAVED";
        lsSave({
          id,
          name: saveBody.name || "이름 없음",
          status,
          updatedAt: new Date().toISOString(),
          grandTotalWon: 0,
          summary: "",
          form: saveBody,
        });
        setEditingId(id);
        savedRef.current = serializeMaterialState(id, saveBody);
        if (showBanner) {
          onBannerMessage?.(draft ? "임시저장 되었습니다." : "저장 되었습니다.");
        }
        refreshList();
        return true;
      } catch {
        setMsg("저장에 실패했습니다.");
        if (showBanner) onBannerMessage?.(null);
        return false;
      }
    },
    [saveBody, editingId, refreshList, onBannerMessage]
  );

  onSaveRef.current = onSave;

  const quoteMode = Boolean(quoteBindEntityId);

  useEffect(() => {
    if (!quoteMode) return;
    return () => {
      void onSaveRef.current(true, { banner: false });
    };
  }, [quoteMode]);

  useEffect(() => {
    if (!active || !quoteBindEntityId) return;
    loadMaterial(quoteBindEntityId);
  }, [active, quoteBindEntityId, loadMaterial]);

  useEffect(() => {
    if (!stripRenameEpoch || !active || !quoteBindEntityId) return;
    loadMaterial(quoteBindEntityId);
  }, [stripRenameEpoch, active, quoteBindEntityId, loadMaterial]);

  useEffect(() => {
    if (!quoteBindEntityId || !active) return;
    if (editingId !== quoteBindEntityId) return;
    onQuoteMeta?.({
      name: form.name?.trim() || "이름 없음",
      grandTotalWon: computed?.grandTotalWon ?? 0,
    });
  }, [quoteBindEntityId, active, editingId, form.name, computed?.grandTotalWon, onQuoteMeta]);

  const onDelete = useCallback(
    (id: string) => {
      if (!window.confirm("이 항목을 삭제할까요?")) return;
      lsDelete(id);
      if (editingId === id) {
        const empty = defaultForm();
        setForm(empty);
        setDimKey((k) => k + 1);
        setEditingId(null);
        setComputed(null);
        savedRef.current = serializeMaterialState(null, empty);
      }
      refreshList();
      setMsg("삭제되었습니다.");
    },
    [editingId, refreshList]
  );

  const onCopy = useCallback(
    (id: string) => {
      const src = lsGet(id);
      if (!src) return;
      const newItem: StoredMaterial = { ...src, id: newId("m"), name: `${src.name} (복사)`, updatedAt: new Date().toISOString() };
      lsSave(newItem);
      loadMaterial(newItem.id);
      setMsg(`복사됨: ${newItem.name}`);
      refreshList();
    },
    [loadMaterial, refreshList]
  );

  const openListItem = useCallback(
    async (targetId: string) => {
      if (targetId === editingId) return;
      setMsg(null);
      const cur = formRef.current;
      const id = editingIdRef.current;
      if (serializeMaterialState(id, cur) !== savedRef.current) {
        await onSave(true, { banner: false });
      }
      loadMaterial(targetId);
    },
    [editingId, loadMaterial, onSave]
  );

  const autoSaveKey = useMemo(() => serializeMaterialState(editingId, saveBody), [editingId, saveBody]);

  useEffect(() => {
    if (!active) return;
    if (autoSaveKey === savedRef.current) return;
    if (isBlankNewMaterial(editingId, saveBody)) return;
    const tid = window.setTimeout(() => {
      const id = editingIdRef.current;
      const f = formRef.current;
      if (serializeMaterialState(id, f) === savedRef.current) return;
      if (isBlankNewMaterial(id, f)) return;
      void onSave(true, { banner: false });
    }, 1600);
    return () => clearTimeout(tid);
  }, [active, autoSaveKey, editingId, saveBody, onSave]);

  const filtered = useMemo(() => {
    let rows = list.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
    rows = [...rows].sort((a, b) =>
      sort === "new"
        ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        : new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );
    return rows;
  }, [list, search, sort]);

  const placeholderSlots = Math.max(0, 4 - filtered.length);

  const createNew = useCallback(async () => {
    setMsg(null);
    const cur = formRef.current;
    const id = editingIdRef.current;
    if (serializeMaterialState(id, cur) !== savedRef.current) {
      await onSave(true, { banner: false });
    }
    const empty = defaultForm();
    setForm(empty);
    setDimKey((k) => k + 1);
    setEditingId(null);
    setComputed(null);
    savedRef.current = serializeMaterialState(null, empty);
  }, [onSave]);

  useImperativeHandle(
    ref,
    () => ({
      saveDraft: async () => {
        await onSave(true, { banner: true });
      },
      save: async () => {
        await onSave(false, { banner: true });
      },
      createNew,
      openLibrary: () => {
        setListOpen(true);
      },
      loadFromVault: async (id: string) => {
        await openListItem(id);
      },
    }),
    [createNew, onSave, openListItem]
  );

  const qCompact = quoteMode;

  const quoteSheetProps = useMemo(() => {
    const availPrices = SHEET_PRICE_BY_THICKNESS[form.hMm] ?? null;
    const unavailableSheetIds =
      form.hMm > 0 && availPrices !== null ? ALL_SHEET_IDS.filter((id) => availPrices[id] == null) : [];
    const unitPriceBySheetId: Record<string, number> = {};
    if (availPrices) {
      ALL_SHEET_IDS.forEach((id) => {
        if (availPrices[id] != null) unitPriceBySheetId[id] = availPrices[id]!;
      });
    }
    const erpMap = SHEET_ERP_CODE_BY_THICKNESS[form.hMm] ?? {};
    const erpCodeBySheetId: Record<string, string> = {};
    ALL_SHEET_IDS.forEach((id) => {
      const c = erpMap[id as keyof typeof erpMap];
      if (c) erpCodeBySheetId[id] = c;
    });
    return { unavailableSheetIds, unitPriceBySheetId, erpCodeBySheetId };
  }, [form.hMm]);

  if (quoteMode) {
    return (
      <>
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--quote-bg)]">
          <MaterialQuoteV2Layout
            form={form}
            setForm={setForm}
            computed={computed as import("../lib/materialCalc").ComputedMaterial | null}
            dimKey={dimKey}
            onDimensionCommit={onDimensionCommit}
            previewPending={previewPending}
            onSelectSheetOriented={onSelectSheetOriented}
            onSelectSheet={onSelectSheet}
            erpCodeBySheetId={quoteSheetProps.erpCodeBySheetId}
            addedProcs={addedProcs}
            setAddedProcs={setAddedProcs}
            onSave={onSave}
            unavailableSheetIds={quoteSheetProps.unavailableSheetIds}
            unitPriceBySheetId={quoteSheetProps.unitPriceBySheetId}
            hSelected={form.hMm > 0}
            hideRightPanel={quoteHideRightPanel}
          />
        </div>
        {listOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
              onClick={() => setListOpen(false)}
              aria-hidden
            />
            <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[340px] flex-col bg-[#fafbfc] shadow-2xl">
              <div className="border-b border-[#eceef1] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-bold tracking-tight text-[#191f28]">보관함</h2>
                  <button
                    type="button"
                    onClick={() => setListOpen(false)}
                    className="rounded-lg p-1.5 text-[#6f7a87] hover:bg-[#eceef1] hover:text-[#191f28]"
                    title="닫기"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className="relative">
                  <input
                    placeholder="검색"
                    className="w-full rounded-xl border border-[#e0e0e0] bg-[#f8f9fa] pl-3 pr-10 py-2.5 text-sm placeholder:text-slate-400 focus:border-[#1e6fff] focus:outline-none focus:ring-1 focus:ring-[#1e6fff]/25"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                  <button
                    type="button"
                    className={sort === "new" ? "font-semibold text-[#1e6fff]" : "hover:text-[#111]"}
                    onClick={() => setSort("new")}
                  >
                    최신순
                  </button>
                  <span className="text-[#e0e0e0]">|</span>
                  <button
                    type="button"
                    className={sort === "old" ? "font-semibold text-[#1e6fff]" : "hover:text-[#111]"}
                    onClick={() => setSort("old")}
                  >
                    오래된 순
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {filtered.map((item) => {
                  const active = editingId === item.id;
                  const isDraft = item.status === "DRAFT";
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border-2 p-4 transition-colors ${
                        active
                          ? "border-[#3182f6] bg-[#f8fbff]"
                          : isDraft
                            ? "border-dashed border-slate-400 bg-[#fafbfc]"
                            : "border-[#e0e0e0] bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-lg text-left outline-offset-2 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#3182f6]/40"
                          onClick={() => {
                            void openListItem(item.id);
                            setListOpen(false);
                          }}
                        >
                          <div className="text-sm font-semibold leading-snug text-[#191f28]">
                            {item.name}
                            {isDraft && <span className="ml-1.5 font-medium text-[#3182f6]">(작성중)</span>}
                          </div>
                          <div className="mt-1 text-base font-bold tabular-nums text-[#3182f6]">
                            {formatWonKorean(item.grandTotalWon)}
                          </div>
                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#8d96a0]">{item.summary}</p>
                        </button>
                        <details className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                          <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-lg leading-none text-slate-500 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
                            ⋯
                          </summary>
                          <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-[#e8e8e8] bg-white py-1 shadow-lg">
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                              onClick={() => void onCopy(item.id)}
                            >
                              복사
                            </button>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                void openListItem(item.id);
                                setListOpen(false);
                              }}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                              onClick={() => void onDelete(item.id)}
                            >
                              삭제
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="rounded-xl border-2 border-dashed border-[#e0e0e0] bg-[#f8f9fa] py-12 text-center text-sm text-slate-400">
                    보관함에 항목이 없습니다
                  </div>
                )}
                {Array.from({ length: placeholderSlots }).map((_, i) => (
                  <div key={`slot-${i}`} className="h-24 rounded-xl border-2 border-dashed border-[#e8e8e8] bg-[#f8f9fa]" aria-hidden />
                ))}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div
      className={`flex flex-col bg-[#f5f6f8] dark:bg-slate-950 lg:flex-row ${
        qCompact ? "h-full min-h-0 overflow-hidden" : "h-full min-h-0"
      }`}
    >
      {/* 메인 패널 */}
      <div
        className={`flex min-w-0 flex-1 flex-col ${
          qCompact ? "min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4" : "overflow-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-6 lg:py-6 2xl:px-8"
        }`}
      >
        <div className="mx-auto w-full max-w-none lg:mx-0">
          {/* ── 분할 레이아웃 ── */}
          <div className={`flex flex-col xl:flex-row xl:items-start ${qCompact ? "gap-3 xl:gap-4" : "gap-6 xl:gap-6"}`}>
            <div className={`flex min-w-0 flex-1 flex-col ${qCompact ? "gap-3" : "gap-6"}`}>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="material-quote-name" className="text-[12px] font-semibold text-[#6f7a87] dark:text-slate-400">
                  자재 이름
                </label>
                <div className="flex min-w-0 items-center gap-2.5">
                  <input
                    id="material-quote-name"
                    className={`w-full min-w-0 rounded-[8px] border-[0.5px] border-[#e8eaed] bg-white px-3 font-bold tracking-tight text-[#191f28] outline-none placeholder:text-[#aeb5bc] focus:border-[#378ADD] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 ${
                      qCompact ? "py-2 text-base" : "py-2.5 text-lg"
                    }`}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="자재 이름을 입력하세요"
                  />
                </div>
              </div>

              <MaterialCollapsibleSection
                title="규격 및 사양"
                defaultOpen
                summaryRight={previewPending ? <span className="text-xs text-[#aeb5bc]">반영 중…</span> : undefined}
              >
                <MaterialQuoteFileStrip
                  layout="combined"
                  onApplyDimensions={(wMm, dMm, hMm) => {
                    onDimensionCommit({ wMm, dMm, hMm });
                  }}
                />
                <div className="mt-3 flex flex-wrap items-end gap-x-2 gap-y-2 border-t border-[#eceef1] pt-3 dark:border-slate-700">
                  <span className="shrink-0 text-[11px] font-bold text-[#191f28]">규격</span>
                  <DimensionMmInputs
                    key={dimKey}
                    compact
                    gridMode="default"
                    wMm={form.wMm}
                    dMm={form.dMm}
                    hMm={form.hMm}
                    onCommit={onDimensionCommit}
                  />
                  <span className="ml-1 shrink-0 border-l border-[#e8eaed] pl-2 text-[11px] font-bold text-[#191f28] dark:border-slate-600">
                    사양
                  </span>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="shrink-0">
                      <label className="mb-0.5 block text-[10px] font-medium text-[#6f7a87]">소재</label>
                      <select
                        className={SPEC_SELECT_FIELD_CLASS}
                        value={form.boardMaterial}
                        onChange={(e) => startTransition(() => setForm((f) => ({ ...f, boardMaterial: e.target.value })))}
                      >
                        {BOARD_MATERIALS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="shrink-0">
                      <label className="mb-0.5 block text-[10px] font-medium text-[#6f7a87]">표면재</label>
                      <select
                        className={SPEC_SELECT_FIELD_CLASS}
                        value={form.surfaceMaterial}
                        onChange={(e) => startTransition(() => setForm((f) => ({ ...f, surfaceMaterial: e.target.value })))}
                      >
                        {SURFACE_MATERIALS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="shrink-0">
                      <label className="mb-0.5 block text-[10px] font-medium text-[#6f7a87]">색상</label>
                      <select
                        className={SPEC_SELECT_FIELD_CLASS}
                        value={form.color}
                        onChange={(e) => startTransition(() => setForm((f) => ({ ...f, color: e.target.value })))}
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
              </MaterialCollapsibleSection>

              <MaterialCollapsibleSection
                title="원장 선택"
                defaultOpen
                summaryRight={previewPending ? <span className="text-xs text-[#aeb5bc]">반영 중…</span> : undefined}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 border-t-[0.5px] border-[#eceef1] pt-3 dark:border-slate-700">
                  <label className="inline-flex cursor-pointer select-none items-center gap-2.5 rounded-xl border border-[#e8eaed] bg-[#fafbfc] px-3 py-2 dark:border-slate-600 dark:bg-slate-800/60">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[#d0d6de] accent-[#3182f6]"
                      checked={form.placementMode === "mixed"}
                      onChange={(e) =>
                        startTransition(() =>
                          setForm((f) => ({
                            ...f,
                            placementMode: e.target.checked ? "mixed" : "default",
                          }))
                        )
                      }
                    />
                    <span className="text-sm font-semibold text-[#191f28] dark:text-slate-100">혼합 배치</span>
                  </label>
                </div>
                <div className="flex min-h-0 flex-col pt-1">
                  {(() => {
                    const availPrices = SHEET_PRICE_BY_THICKNESS[form.hMm] ?? null;
                    const availErp = SHEET_ERP_CODE_BY_THICKNESS[form.hMm] ?? {};
                    const unavailableSheetIds =
                      form.hMm > 0 && availPrices !== null
                        ? ALL_SHEET_IDS.filter((id) => availPrices[id] == null)
                        : [];
                    const unitPriceBySheetId: Record<string, number> = {};
                    if (availPrices)
                      ALL_SHEET_IDS.forEach((id) => {
                        if (availPrices[id] != null) unitPriceBySheetId[id] = availPrices[id]!;
                      });
                    const isMixed = form.placementMode === "mixed";
                    return (
                      <MaterialSheetCards
                        sheets={computed?.sheets}
                        pieceWMm={form.wMm}
                        pieceDMm={form.dMm}
                        placementMode={form.placementMode}
                        selectedSheetId={form.selectedSheetId}
                        computedSelectedId={computed?.selectedSheetId ?? null}
                        recommendedSheetId={computed?.recommendedSheetId ?? null}
                        onSelectSheet={onSelectSheet}
                        unavailableSheetIds={unavailableSheetIds}
                        unitPriceBySheetId={unitPriceBySheetId}
                        erpCodeBySheetId={availErp as Record<string, string>}
                        showPrice={form.hMm > 0}
                        dualOrientation={!isMixed}
                        onSelectSheetOriented={isMixed ? undefined : onSelectSheetOriented}
                      />
                    );
                  })()}
                </div>
              </MaterialCollapsibleSection>
            </div>

            <div className={`flex min-w-0 flex-1 flex-col ${qCompact ? "gap-3" : "gap-6"}`}>
              <MaterialCollapsibleSection title="엣지" defaultOpen>
                <div className={`flex flex-col lg:flex-row lg:items-start lg:justify-between ${qCompact ? "gap-3" : "gap-6"}`}>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="mb-1.5 text-[10px] font-medium text-[#6f7a87] dark:text-slate-400">
                        엣지 종류 <span className="font-normal text-[#aeb5bc]">(선택 없음 = 엣지 없음)</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["abs1t", "ABS 1T"],
                            ["abs2t", "ABS 2T"],
                            ["paint", "엣지 도장"],
                          ] as const
                        ).map(([k, lab]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() =>
                              startTransition(() =>
                                setForm((f) => ({
                                  ...f,
                                  edgePreset: f.edgePreset === k ? "none" : k,
                                  edgeColor: "WW",
                                }))
                              )
                            }
                            className={`rounded-[8px] border-[0.5px] px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                              form.edgePreset === k
                                ? "border-[#1D9E75] bg-[#1D9E75]/10 text-[#0d6e4d] dark:border-[#1D9E75] dark:text-[#7dffc8]"
                                : "border-[#e0e4ea] text-[#444] hover:border-[#378ADD]/50 dark:border-slate-600 dark:text-slate-200"
                            }`}
                          >
                            {lab}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="max-w-[220px]">
                      <label className="mb-1.5 block text-xs font-medium text-[#6f7a87] dark:text-slate-400">엣지 색상</label>
                      <input
                        readOnly
                        disabled
                        value="WW"
                        title="WW 고정"
                        className={`${DIMENSION_FIELD_CONTROL_CLASS} cursor-not-allowed opacity-70`}
                      />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 justify-center lg:justify-end">
                    <MaterialEdgeFacePicker
                      wMm={form.wMm}
                      dMm={form.dMm}
                      value={form.edgeSides}
                      disabled={form.edgePreset === "none"}
                      onChange={(next) => startTransition(() => setForm((f) => ({ ...f, edgeSides: next })))}
                    />
                  </div>
                </div>
              </MaterialCollapsibleSection>

              <MaterialCollapsibleSection title="가공" defaultOpen>
                <div className="space-y-2.5">
                  {/* 자재 조립 */}
                      <ProcInput
                        label="자재 조립"
                        unit="개"
                        value={form.assemblyHours}
                        onChange={(n) => setForm((f) => ({ ...f, assemblyHours: n }))}
                        amount={computed?.assemblyCostWon ?? 0}
                        step={1}
                        compact
                        tooltip="판재에 조립 출고 되는 자재 (케이싱스크류, 케이싱 등) 수량"
                      />

                      {/* 일반 보링 */}
                      <ProcInput
                        label="일반 보링"
                        unit="개"
                        value={form.boring1Ea}
                        onChange={(n) => setForm((f) => ({ ...f, boring1Ea: n }))}
                        amount={computed?.boring1CostWon ?? 0}
                        step={1}
                        compact
                      />

                      {/* 2단 보링 */}
                      <ProcInput
                        label="2단 보링"
                        unit="개"
                        value={form.boring2Ea}
                        onChange={(n) => setForm((f) => ({ ...f, boring2Ea: n }))}
                        amount={computed?.boring2CostWon ?? 0}
                        step={1}
                        compact
                      />

                      {/* 가공 추가하기 — 선택하면 항목 추가됨 */}
                      {(() => {
                        const ALL_PROCS = [
                          { key: "ruta",      label: "루타 (2,000원/m)" },
                          { key: "ruta2",     label: "루타 2차 (1,000원/m)" },
                          { key: "forming",   label: "포밍 (1,000원/m)" },
                          { key: "tenoner",   label: "테노너 (800원/m)" },
                          { key: "edgePaint", label: "엣지 도장" },
                          { key: "edge45",    label: "45도 엣지 (500원/m)" },
                          { key: "curved",    label: "곡면 엣지" },
                        ];
                        const available = ALL_PROCS.filter((p) => !addedProcs.includes(p.key));
                        const mmInput = (
                          val: number,
                          onChange: (mm: number) => void,
                          key: string,
                        ) => (
                          <div className="relative min-w-0 flex-1">
                            <input
                              type="number" min={0} step={1} key={key}
                              className="w-full rounded-xl border border-[#e5e8ec] bg-white py-2 pl-2 pr-8 text-right text-sm tabular-nums text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-2 focus:ring-[#3182f6]/20"
                              defaultValue={val}
                              onBlur={(e) => onChange(Number(e.target.value) || 0)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#aeb5bc]">mm</span>
                          </div>
                        );
                        const removeProc = (key: string) => {
                          setAddedProcs((prev) => prev.filter((k) => k !== key));
                          setForm((f) => {
                            if (key === "ruta")      return { ...f, rutaM: 0 };
                            if (key === "ruta2")     return { ...f, ruta2M: 0 };
                            if (key === "forming")   return { ...f, formingM: 0 };
                            if (key === "edgePaint") return { ...f, edge45PaintType: "", edge45PaintM: 0 };
                            if (key === "edge45")    return { ...f, edge45TapingM: 0 };
                            if (key === "curved")    return { ...f, curvedEdgeM: 0, curvedEdgeType: "" };
                            if (key === "tenoner")  return { ...f, tenonerMm: 0 };
                            return f;
                          });
                        };
                        const xBtn = (key: string) => (
                          <button type="button" onClick={() => removeProc(key)}
                            className="shrink-0 rounded-lg p-1 text-[#aeb5bc] hover:bg-[#f2f4f7] hover:text-[#e55]">✕</button>
                        );
                        const amtSpan = (n: number) => (
                          <span className="w-[4.5rem] shrink-0 text-right font-semibold tabular-nums text-[#191f28]">{formatWonKorean(n)}</span>
                        );
                        return (
                          <div className="space-y-2 pt-1">
                            {addedProcs.map((key) => {
                              if (key === "ruta") return (
                                <div key="ruta" className="flex min-w-0 items-center gap-2 text-sm">
                                  <span className="w-[4.25rem] shrink-0 font-semibold text-[#191f28]">루타</span>
                                  {mmInput(Math.round(form.rutaM * 1000), (mm) => setForm((f) => ({ ...f, rutaM: mm / 1000 })), "ruta-mm")}
                                  {amtSpan(computed?.rutaCostWon ?? 0)}
                                  {xBtn("ruta")}
                                </div>
                              );
                              if (key === "ruta2") return (
                                <div key="ruta2" className="flex min-w-0 items-center gap-2 text-sm">
                                  <span className="w-[4.25rem] shrink-0 font-semibold text-[#191f28]">루타 2차</span>
                                  {mmInput(Math.round(form.ruta2M * 1000), (mm) => setForm((f) => ({ ...f, ruta2M: mm / 1000 })), "ruta2-mm")}
                                  {amtSpan(computed?.ruta2CostWon ?? 0)}
                                  {xBtn("ruta2")}
                                </div>
                              );
                              if (key === "forming") return (
                                <div key="forming" className="flex min-w-0 items-center gap-2 text-sm">
                                  <span className="w-[4.25rem] shrink-0 font-semibold text-[#191f28]">포밍</span>
                                  {mmInput(Math.round(form.formingM * 1000), (mm) => setForm((f) => ({ ...f, formingM: mm / 1000 })), "forming-mm")}
                                  {amtSpan(computed?.formingCostWon ?? 0)}
                                  {xBtn("forming")}
                                </div>
                              );
                              if (key === "tenoner") return (
                                <div key="tenoner" className="flex min-w-0 items-center gap-2 text-sm">
                                  <span className="w-[4.25rem] shrink-0 font-semibold text-[#191f28] dark:text-slate-100">테노너</span>
                                  {mmInput(form.tenonerMm, (mm) => setForm((f) => ({ ...f, tenonerMm: mm })), "tenoner-mm")}
                                  {amtSpan(computed?.tenonerCostWon ?? 0)}
                                  {xBtn("tenoner")}
                                </div>
                              );
                              if (key === "edgePaint") return (
                                <div key="edgePaint" className="space-y-1.5">
                                  <div className="flex min-w-0 items-center gap-2 text-sm">
                                    <span className="w-[4.25rem] shrink-0 font-semibold text-[#191f28]">엣지 도장</span>
                                    <select
                                      className="min-w-0 flex-1 rounded-xl border border-[#e5e8ec] bg-white px-2 py-2.5 text-sm text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-2 focus:ring-[#3182f6]/20"
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
                                    {xBtn("edgePaint")}
                                  </div>
                                  <div className="flex min-w-0 items-center gap-2 text-sm">
                                    <span className="w-[4.25rem] shrink-0" aria-hidden />
                                    {mmInput(Math.round(form.edge45PaintM * 1000), (mm) => setForm((f) => ({ ...f, edge45PaintM: mm / 1000 })), "edgePaint-mm")}
                                    {amtSpan(computed?.edge45PaintCostWon ?? 0)}
                                    <span className="w-6 shrink-0" aria-hidden />
                                  </div>
                                </div>
                              );
                              if (key === "edge45") return (
                                <div key="edge45" className="flex min-w-0 items-center gap-2 text-sm">
                                  <span className="w-[4.25rem] shrink-0 font-semibold text-[#191f28]">45도 엣지</span>
                                  {mmInput(Math.round(form.edge45TapingM * 1000), (mm) => setForm((f) => ({ ...f, edge45TapingM: mm / 1000 })), "edge45-mm")}
                                  {amtSpan(computed?.edge45TapingCostWon ?? 0)}
                                  {xBtn("edge45")}
                                </div>
                              );
                              if (key === "curved") return (
                                <div key="curved" className="space-y-1.5">
                                  <div className="flex min-w-0 items-center gap-2 text-sm">
                                    <span className="w-[4.25rem] shrink-0 font-semibold text-[#191f28]">곡면 엣지</span>
                                    <select
                                      className="min-w-0 flex-1 rounded-xl border border-[#e5e8ec] bg-white px-2 py-2.5 text-sm text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-2 focus:ring-[#3182f6]/20"
                                      value={form.curvedEdgeType}
                                      onChange={(e) => setForm((f) => ({ ...f, curvedEdgeType: e.target.value as "machining" | "manual" | "" }))}
                                    >
                                      <option value="">유형 선택</option>
                                      <option value="machining">머시닝 (3,000원/m)</option>
                                      <option value="manual">수동곡면 (2,000원/m)</option>
                                    </select>
                                    {xBtn("curved")}
                                  </div>
                                  <div className="flex min-w-0 items-center gap-2 text-sm">
                                    <span className="w-[4.25rem] shrink-0" aria-hidden />
                                    {mmInput(Math.round(form.curvedEdgeM * 1000), (mm) => setForm((f) => ({ ...f, curvedEdgeM: mm / 1000 })), "curved-mm")}
                                    {amtSpan(computed?.curvedCostWon ?? 0)}
                                    <span className="w-6 shrink-0" aria-hidden />
                                  </div>
                                </div>
                              );
                              return null;
                            })}

                            {available.length > 0 && (
                              <select
                                className="w-full rounded-xl border border-dashed border-[#c0c8d4] bg-white px-3 py-2.5 text-sm text-[#6f7a87] focus:border-[#3182f6] focus:outline-none focus:ring-2 focus:ring-[#3182f6]/20"
                                value=""
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (!val) return;
                                  setAddedProcs((prev) => prev.includes(val) ? prev : [...prev, val]);
                                }}
                              >
                                <option value="">＋ 가공 추가하기</option>
                                {available.map((p) => (
                                  <option key={p.key} value={p.key}>{p.label}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })()}

                </div>
              </MaterialCollapsibleSection>
            </div>
            {/* ══ 오른쪽: 영수증 패널 ══ */}
            <div
              className={`w-full shrink-0 xl:w-[min(45%,27rem)] ${qCompact ? "min-h-0" : ""}`}
              style={{ filter: "drop-shadow(0 4px 18px rgba(0,0,0,0.09)) drop-shadow(0 1px 3px rgba(0,0,0,0.05))" }}
            >
              <div className="flex min-h-0 flex-col rounded-none">
                <div className="min-h-0 bg-white">
                <div
                  className={
                    qCompact
                      ? "flex-1 space-y-3 overflow-y-auto p-3 max-h-[min(52vh,28rem)]"
                      : "flex-1 space-y-4 p-5"
                  }
                >
                  {/* 자재이름 + 총액 */}
                  <div className="border-b-[3px] border-[#5d6570] pb-3">
                    <div className="text-base font-bold tracking-tight text-[#191f28]">
                      {form.name || <span className="text-[#aeb5bc]">자재 이름</span>}
                    </div>
                    <div className="mt-1 text-2xl font-extrabold leading-none tracking-tight text-[#3182f6] tabular-nums">
                      {computed
                        ? formatWonKorean(
                            form.hMm > 0
                              ? computed.grandTotalWon
                              : computed.processingTotalWon
                          )
                        : "—"}
                    </div>
                  </div>

                  {computed && (() => {
                    const hSelected = form.hMm > 0;
                    /** H 미선택 시 원자재 금액을 0으로 마스킹 */
                    const matAmt = (n: number) => (hSelected ? n : 0);
                    const sel = computed.sheets.find((s) => s.sheetId === computed.selectedSheetId);
                    const edgeLabelMap: Record<MaterialEdgePreset, string> = {
                      none: "엣지 없음",
                      abs1t: "4면 ABS 1T",
                      abs2t: "4면 ABS 2T",
                      paint: "4면 엣지 도장",
                      custom: "사용자 설정",
                    };
                    const edgeLengthMm = Math.round(computed.edgeLengthM * 1000);
                    const additionalItems: { label: string; desc: string; amount: number }[] = [];
                    if (form.assemblyHours > 0) additionalItems.push({ label: "자재 조립", desc: `${form.assemblyHours}개`, amount: computed.assemblyCostWon });
                    if (form.boring1Ea > 0) additionalItems.push({ label: "일반 보링", desc: `${form.boring1Ea}개`, amount: computed.boring1CostWon ?? 0 });
                    if (form.boring2Ea > 0) additionalItems.push({ label: "2단 보링", desc: `${form.boring2Ea}개`, amount: computed.boring2CostWon ?? 0 });
                    if (addedProcs.includes("ruta") && form.rutaM > 0) additionalItems.push({ label: "루타", desc: `${Math.round(form.rutaM * 1000)}mm`, amount: computed.rutaCostWon });
                    if (addedProcs.includes("ruta2") && form.ruta2M > 0) additionalItems.push({ label: "루타 2차", desc: `${Math.round(form.ruta2M * 1000)}mm`, amount: computed.ruta2CostWon ?? 0 });
                    if (addedProcs.includes("forming") && form.formingM > 0) additionalItems.push({ label: "포밍", desc: `${Math.round(form.formingM * 1000)}mm`, amount: computed.formingCostWon });
                    if (addedProcs.includes("edgePaint") && form.edge45PaintM > 0 && form.edge45PaintType) additionalItems.push({ label: "엣지 도장", desc: `${form.edge45PaintType} ${Math.round(form.edge45PaintM * 1000)}mm`, amount: computed.edge45PaintCostWon ?? 0 });
                    if (addedProcs.includes("edge45") && form.edge45TapingM > 0) additionalItems.push({ label: "45도 엣지", desc: `${Math.round(form.edge45TapingM * 1000)}mm`, amount: computed.edge45TapingCostWon ?? 0 });
                    if (addedProcs.includes("curved") && form.curvedEdgeM > 0) additionalItems.push({ label: "곡면 엣지", desc: `${form.curvedEdgeType === "machining" ? "머시닝" : form.curvedEdgeType === "manual" ? "수동곡면" : ""} ${Math.round(form.curvedEdgeM * 1000)}mm`.trim(), amount: computed.curvedCostWon });
                    return (
                      <>
                        {/* 원자재비 */}
                        <div className="space-y-1.5">
                          <div className="flex items-baseline justify-between">
                            <span className="text-[15px] font-bold text-[#191f28]">원자재비</span>
                            <span className="tabular-nums text-[15px] font-bold text-[#191f28]">
                              {formatWonKorean(matAmt(computed.materialCostWon + computed.edgeCostWon))}
                            </span>
                          </div>
                          <div className="space-y-1.5 border-t border-[#d0d6de] pt-1.5">
                            <RcptLine
                              label="목재 자재비"
                              desc={`${form.wMm}×${form.dMm}×${form.hMm}T, ${form.boardMaterial}, ${form.surfaceMaterial}, ${form.color}${sel ? `, ${sel.label} 원장` : ""}`}
                              amount={matAmt(computed.materialCostWon)}
                            />
                            {form.edgePreset !== "none" && (
                              <RcptLine
                                label="엣지 자재비"
                                desc={`${edgeLabelMap[form.edgePreset]}${form.edgePreset === "abs1t" || form.edgePreset === "abs2t" ? `, ${form.edgeColor}` : ""}, ${formatEdgeSidesKo(form.edgeSides)}, ${edgeLengthMm}mm`}
                                amount={matAmt(computed.edgeCostWon)}
                              />
                            )}
                            {(form.edgePreset === "abs1t" || form.edgePreset === "abs2t") && (
                              <RcptLine
                                label="핫멜트"
                                desc={`${form.hMm}T, ${edgeLengthMm}mm`}
                                amount={matAmt(computed.hotmeltCostWon)}
                              />
                            )}
                          </div>
                        </div>

                        {/* 가공비 */}
                        <div className="space-y-1.5">
                          <div className="flex items-baseline justify-between">
                            <span className="text-[15px] font-bold text-[#191f28]">가공비</span>
                            <span className="tabular-nums text-[15px] font-bold text-[#191f28]">
                              {formatWonKorean(computed.processingTotalWon)}
                            </span>
                          </div>
                          <div className="space-y-1.5 border-t border-[#d0d6de] pt-1.5">
                            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#6f7a87]">기본 가공</p>
                            <RcptLine label="재단" desc={`${computed.cuttingPlacementCount ?? 0}개`} amount={computed.cuttingCostWon} />
                            {additionalItems.length > 0 && (
                              <>
                                <p className="pt-1 text-[12px] font-semibold uppercase tracking-wide text-[#6f7a87]">추가 가공</p>
                                {additionalItems.map(({ label, desc, amount }) => (
                                  <RcptLine key={label} label={label} desc={desc} amount={amount} />
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                </div>{/* end bg-white */}
                <ReceiptTornEdge />
              </div>
            </div>
            {/* ══ End 오른쪽 영수증 패널 ══ */}

          </div>
          {/* ── End 분할 레이아웃 ── */}

          {msg && <p className="mt-5 px-1 text-sm text-[#6f7a87]">{msg}</p>}
        </div>
      </div>

      {/* ── 보관함 오버레이 드로어 (견적 통합 보관함 사용 시 비활성) ── */}
      {listOpen && (
        <>
          {/* 반투명 배경 */}
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={() => setListOpen(false)}
            aria-hidden
          />
          {/* 드로어 패널 */}
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[340px] flex-col bg-[#fafbfc] shadow-2xl">
            {/* 헤더 */}
            <div className="border-b border-[#eceef1] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight text-[#191f28]">보관함</h2>
                <button
                  type="button"
                  onClick={() => setListOpen(false)}
                  className="rounded-lg p-1.5 text-[#6f7a87] hover:bg-[#eceef1] hover:text-[#191f28]"
                  title="닫기"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="relative">
                <input
                  placeholder="검색"
                  className="w-full rounded-xl border border-[#e0e0e0] bg-[#f8f9fa] pl-3 pr-10 py-2.5 text-sm placeholder:text-slate-400 focus:border-[#1e6fff] focus:outline-none focus:ring-1 focus:ring-[#1e6fff]/25"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                <button
                  type="button"
                  className={sort === "new" ? "font-semibold text-[#1e6fff]" : "hover:text-[#111]"}
                  onClick={() => setSort("new")}
                >
                  최신순
                </button>
                <span className="text-[#e0e0e0]">|</span>
                <button
                  type="button"
                  className={sort === "old" ? "font-semibold text-[#1e6fff]" : "hover:text-[#111]"}
                  onClick={() => setSort("old")}
                >
                  오래된 순
                </button>
              </div>
            </div>

            {/* 목록 */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
              {filtered.map((item) => {
                const active = editingId === item.id;
                const isDraft = item.status === "DRAFT";
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border-2 p-4 transition-colors ${
                      active
                        ? "border-[#3182f6] bg-[#f8fbff]"
                        : isDraft
                          ? "border-dashed border-slate-400 bg-[#fafbfc]"
                          : "border-[#e0e0e0] bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex justify-between gap-2 items-start">
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-lg text-left outline-offset-2 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#3182f6]/40"
                        onClick={() => { void openListItem(item.id); setListOpen(false); }}
                      >
                        <div className="font-semibold text-[#191f28] text-sm leading-snug">
                          {item.name}
                          {isDraft && <span className="ml-1.5 font-medium text-[#3182f6]">(작성중)</span>}
                        </div>
                        <div className="text-[#3182f6] font-bold text-base mt-1 tabular-nums">
                          {formatWonKorean(item.grandTotalWon)}
                        </div>
                        <p className="text-xs text-[#8d96a0] mt-2 leading-relaxed line-clamp-2">{item.summary}</p>
                      </button>
                      <details className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                        <summary className="cursor-pointer select-none list-none w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 text-lg leading-none [&::-webkit-details-marker]:hidden">
                          ⋯
                        </summary>
                        <div className="absolute right-0 top-full mt-1 z-20 min-w-[120px] rounded-lg border border-[#e8e8e8] bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => void onCopy(item.id)}
                          >
                            복사
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => { void openListItem(item.id); setListOpen(false); }}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => void onDelete(item.id)}
                          >
                            삭제
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-[#e0e0e0] bg-[#f8f9fa] py-12 text-center text-sm text-slate-400">
                  보관함에 항목이 없습니다
                </div>
              )}

              {Array.from({ length: placeholderSlots }).map((_, i) => (
                <div
                  key={`slot-${i}`}
                  className="h-24 rounded-xl border-2 border-dashed border-[#e8e8e8] bg-[#f8f9fa]"
                  aria-hidden
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

/** 영수증 패널 한 줄 항목 — 금액은 라벨과 같은 줄, 설명(desc)은 아랫 줄 */
function RcptLine({ label, desc, amount }: { label: string; desc?: string; amount: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-[#191f28]">{label}</span>
        <span className="shrink-0 tabular-nums text-[14px] font-semibold text-[#191f28]">
          {formatWonKorean(amount)}
        </span>
      </div>
      {desc && (
        <p className="text-[11px] leading-snug text-[#aeb5bc]">{desc}</p>
      )}
    </div>
  );
}


function ProcInput({
  label,
  unit,
  value,
  onChange,
  amount,
  step = 1,
  compact,
  tooltip,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (n: number) => void;
  amount: number;
  step?: number;
  compact?: boolean;
  tooltip?: string;
}) {
  if (compact) {
    return (
      <div className="flex min-w-0 max-w-full items-center gap-2 text-sm leading-snug">
        <span
          className="w-[4.25rem] shrink-0 text-left font-semibold text-[#191f28]"
          title={tooltip}
        >{label}</span>
        <div className="relative min-w-0 flex-1">
          <input
            type="number"
            min={0}
            step={step}
            className="w-full rounded-xl border border-[#e5e8ec] bg-white py-2 pl-2 pr-9 text-right text-sm tabular-nums text-[#191f28] focus:border-[#3182f6] focus:outline-none focus:ring-2 focus:ring-[#3182f6]/20"
            value={value}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
          />
          {unit && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#aeb5bc]">
              {unit}
            </span>
          )}
        </div>
        <span className="w-[4.5rem] shrink-0 text-right text-sm font-semibold tabular-nums text-[#191f28]">
          {formatWonKorean(amount)}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-14 shrink-0 font-medium text-[#111]">{label}</span>
      <div className="relative min-w-0 flex-1">
        <input
          type="number"
          min={0}
          step={step}
          className="w-full rounded-lg border border-[#e0e0e0] bg-white py-1.5 pl-2 pr-7 text-right text-xs tabular-nums focus:border-[#1e6fff] focus:outline-none focus:ring-1 focus:ring-[#1e6fff]/25"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {unit}
          </span>
        )}
      </div>
      <span className="w-24 shrink-0 text-right font-semibold text-[#111] tabular-nums">{formatWonKorean(amount)}</span>
    </div>
  );
}

/** 드롭다운 선택 + 수량 입력을 한 묶음으로 보여주는 추가가공 행 */

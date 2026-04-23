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
  effectiveYieldPlacementMode,
  DEFAULT_EDGE_SIDES as DEFAULT_EDGE_SELECTION,
  type EdgeSelection,
} from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import {
  deleteMaterial as lsDelete,
  getMaterial as lsGet,
  getMaterials as lsGetAll,
  getBomNodeData,
  putBomNodeData,
  materialListRow,
  newId,
  putMaterial as lsSave,
  ensureEntityByTreeId,
  type BomMaterialData,
  type StoredMaterial,
} from "../offline/stores";
import { useTree } from "../context/TreeContext";
import { formatWonKorean } from "../util/format";
import { YieldBoardGrid } from "./YieldBoardGrid";


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
  edgeColor: string;
  edgeCustomSides: EdgeCustomSidesForm;
  /** 엣지 적용 면 */
  edgeSides: EdgeSelection;
  placementMode: PlacementMode;
  /** 90° 탭: 기본/90° 열 중 실제로 선택된 절단 방향(원장 배치) */
  cutOrientation: "default" | "rotated";
  /** 배치 테이블: 기본 행 표시 여부 (기본 true) */
  showDefault: boolean;
  /** 배치 테이블: 90° 행 표시 여부 (기본 true) */
  showRotated: boolean;
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
    cutOrientation: f.cutOrientation,
    showDefault: f.showDefault,
    showRotated: f.showRotated,
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

function edgePresetToBom(preset: MaterialEdgePreset): { edgeType: string; edgeSetting: string } {
  if (preset === "abs1t") return { edgeType: "ABS", edgeSetting: "4면 1T" };
  if (preset === "abs2t") return { edgeType: "ABS", edgeSetting: "4면 2T" };
  if (preset === "paint") return { edgeType: "도장", edgeSetting: "" };
  return { edgeType: "없음", edgeSetting: "" };
}

function bomToEdgePreset(edgeType: string, edgeSetting: string): MaterialEdgePreset {
  if (edgeType === "ABS") return edgeSetting === "4면 2T" ? "abs2t" : "abs1t";
  if (edgeType === "도장") return "paint";
  return "none";
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
    cutOrientation: "default",
    showDefault: true,
    showRotated: true,
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
  /** STP 등 업로드로 규격(mm) 반영 */
  applyDimensionsMm: (wMm: number, dMm: number, hMm: number) => void;
  getMaterialName: () => string;
  setMaterialName: (name: string) => void;
};

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
    /** 우측 패널 전용: 상단 견적 탭·규격 카드 내 파일 업로드 등 간소화 */
    quoteEditorChrome?: boolean;
  }
>(function MaterialTab({
  active = true,
  onBannerMessage,
  quoteBindEntityId,
  onQuoteMeta,
  onQuoteEntityRebind,
  stripRenameEpoch = 0,
  quoteHideRightPanel: _quoteHideRightPanel = false,
  quoteEditorChrome: _quoteEditorChrome = false,
}, ref) {
  // Tree context: active mat node ID for BOM data save/load
  const { treeNodes, activeItem, updateNodeData } = useTree();
  const activeMatNodeId = treeNodes[activeItem]?.type === "mat" ? (treeNodes[activeItem]?.id ?? null) : null;

  const [form, setForm] = useState<MaterialFormState>(defaultForm);
  const [computed, setComputed] = useState<Computed | null>(null);
  const [list, setList] = useState<
    { id: string; name: string; status: string; updatedAt: string; grandTotalWon: number; summary: string }[]
  >([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [listOpen, setListOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [, setDimKey] = useState(0);
  /** 추가된 가공 항목 목록 (UI 전용) */
  const [addedProcs, setAddedProcs] = useState<string[]>([]);
  const [edTab, setEdTab] = useState<0|1|2>(0);
  const [, setMsg] = useState<string | null>(null);
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
      cutOrientation: form.cutOrientation,
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
      form.cutOrientation,
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
          placementMode: effectiveYieldPlacementMode(
            payload.placementMode,
            (payload as { cutOrientation?: "default" | "rotated" }).cutOrientation ?? "default"
          ),
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
      if (!lsGet(id)) ensureEntityByTreeId("mat", id, "이름 없음");
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
        cutOrientation: (saved as { cutOrientation?: "default" | "rotated" }).cutOrientation === "rotated" ? "rotated" : "default",
        showDefault: (saved as { showDefault?: boolean }).showDefault !== false,
        showRotated: (saved as { showRotated?: boolean }).showRotated !== false,
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

      // Merge from groot_bom node data if available (immediate-saved, may be fresher than StoredMaterial)
      // activeMatNodeId is not available here so use tree activeItem via ref
      let finalProcs = restoredProcs;
      const bomData = getBomNodeData(id); // node id same as material id when tree node wraps material
      if (bomData) {
        const origHMm = nextForm.hMm;
        nextForm.wMm = bomData.w;
        nextForm.dMm = bomData.d;
        nextForm.hMm = bomData.t;
        nextForm.boardMaterial = bomData.material;
        nextForm.surfaceMaterial = bomData.surface;
        nextForm.color = bomData.color;
        nextForm.edgePreset = bomToEdgePreset(bomData.edgeType, bomData.edgeSetting);
        nextForm.edgeCustomSides = bomData.edgeCustom ?? { ...DEFAULT_EDGE_SIDES };
        if (nextForm.hMm !== origHMm) {
          const prices = SHEET_PRICE_BY_THICKNESS[nextForm.hMm] ?? {};
          const sp: Record<string, number> = {};
          for (const sid of ALL_SHEET_IDS) {
            if (prices[sid] != null) sp[sid] = prices[sid]!;
          }
          nextForm.sheetPrices = sp;
        }
        if (Array.isArray(bomData.processes) && bomData.processes.length > 0) {
          finalProcs = [...bomData.processes];
        }
      }

      setAddedProcs(finalProcs);
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

  const onGridSelect = useCallback((sheetId: string, mode: "default" | "rotated" | "mixed") => {
    startTransition(() => setForm((f) => ({
      ...f,
      selectedSheetId: sheetId,
      placementMode: mode,
      cutOrientation: mode === "mixed" ? f.cutOrientation : mode,
    })));
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

  // Immediate BOM save: on every form/addedProcs change, save to groot_bom mat node
  useEffect(() => {
    if (!activeMatNodeId) return;
    const { edgeType, edgeSetting } = edgePresetToBom(form.edgePreset);
    const data: BomMaterialData = {
      w: form.wMm,
      d: form.dMm,
      t: form.hMm,
      material: form.boardMaterial,
      surface: form.surfaceMaterial,
      color: form.color,
      edgeType,
      edgeSetting,
      edgeCustom: form.edgeCustomSides,
      processes: addedProcs,
    };
    putBomNodeData(activeMatNodeId, data);
    updateNodeData(activeMatNodeId, data);
  }, [activeMatNodeId, form, addedProcs]); // eslint-disable-line react-hooks/exhaustive-deps

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
    }, quoteMode ? 800 : 1600);
    return () => clearTimeout(tid);
  }, [active, autoSaveKey, editingId, saveBody, onSave, quoteMode]);

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
      applyDimensionsMm: (wMm: number, dMm: number, hMm: number) => {
        onDimensionCommit({ wMm, dMm, hMm });
        setDimKey((k) => k + 1);
      },
      getMaterialName: () => formRef.current.name,
      setMaterialName: (name: string) => {
        startTransition(() => setForm((f) => ({ ...f, name })));
      },
    }),
    [createNew, onSave, openListItem, onDimensionCommit]
  );


  const sheetDisplayPrice = (id: string) =>
    form.sheetPrices[id] ?? SHEET_PRICE_BY_THICKNESS[form.hMm]?.[id] ?? 0;

  const fmtWon = (n: number) => (n > 0 ? Math.ceil(n).toLocaleString() + "원" : "0원");

  return (
    <>
      <div style={{display:'flex',height:'100%',minHeight:0,width:'100%',overflow:'hidden'}}>
        <div className="editor-body">
          {/* Left panel */}
          <div className="editor-left">
            <div className="ed-tabs">
              <button type="button" className={`ed-tab${edTab===0?' on':''}`} onClick={()=>setEdTab(0)}>규격·사양</button>
              <button type="button" className={`ed-tab${edTab===1?' on':''}`} onClick={()=>setEdTab(1)}>원장 배치</button>
              <button type="button" className={`ed-tab${edTab===2?' on':''}`} onClick={()=>setEdTab(2)}>가공</button>
            </div>

            {/* Tab 0: 규격·사양 */}
            <div className="ed-content" style={{display: edTab===0?'block':'none'}}>
              <div className="sec-title mb10">기본 규격</div>
              <div className="grid3 mb16">
                <div>
                  <div className="sl">W (mm)</div>
                  <input className="fi" type="number" value={form.wMm||''}
                    onChange={e=>onDimensionCommit({wMm:Number(e.target.value)||0,dMm:form.dMm,hMm:form.hMm})}
                    placeholder="0" />
                </div>
                <div>
                  <div className="sl">D (mm)</div>
                  <input className="fi" type="number" value={form.dMm||''}
                    onChange={e=>onDimensionCommit({wMm:form.wMm,dMm:Number(e.target.value)||0,hMm:form.hMm})}
                    placeholder="0" />
                </div>
                <div>
                  <div className="sl">두께 T</div>
                  <input className="fi" type="number" value={form.hMm||''}
                    onChange={e=>onDimensionCommit({wMm:form.wMm,dMm:form.dMm,hMm:Number(e.target.value)||0})}
                    placeholder="0" />
                </div>
              </div>

              <div className="sec-title mb10">소재</div>
              <div className="grid3 mb16">
                <div>
                  <div className="sl">소재</div>
                  <select className="fi" value={form.boardMaterial}
                    onChange={e=>setForm(f=>({...f,boardMaterial:e.target.value}))}>
                    <option>PB</option><option>SPB</option><option>MDF</option>
                  </select>
                </div>
                <div>
                  <div className="sl">표면재</div>
                  <select className="fi" value={form.surfaceMaterial}
                    onChange={e=>setForm(f=>({...f,surfaceMaterial:e.target.value}))}>
                    <option>LPM/O</option><option>LPM/-</option><option>FF/-</option>
                  </select>
                </div>
                <div>
                  <div className="sl">색상</div>
                  <select className="fi" value={form.color}
                    onChange={e=>setForm(f=>({...f,color:e.target.value}))}>
                    <option>WW</option><option>BI</option><option>OHN</option><option>NBK</option>
                  </select>
                </div>
              </div>

              <div className="sec-title mb10">엣지 마감</div>
              <div className="seg mb14">
                <button type="button" className={`seg-btn${form.edgePreset==='none'?' on':''}`} onClick={()=>setForm(f=>({...f,edgePreset:'none'}))}>엣지 없음</button>
                <button type="button" className={`seg-btn${(form.edgePreset==='abs1t'||form.edgePreset==='abs2t')?' on':''}`} onClick={()=>setForm(f=>({...f,edgePreset:'abs2t'}))}>ABS 엣지</button>
                <button type="button" className={`seg-btn${form.edgePreset==='paint'?' on':''}`} onClick={()=>setForm(f=>({...f,edgePreset:'paint'}))}>엣지 도장</button>
              </div>
              {(form.edgePreset==='abs1t'||form.edgePreset==='abs2t'||(form.edgePreset as string)==='custom') && (
                <div>
                  <div className="sl" style={{marginBottom:'6px'}}>엣지 설정</div>
                  <div className="seg mb10">
                    <button type="button" className="seg-btn" onClick={()=>setForm(f=>({...f,edgePreset:'none'}))}>엣지 없음</button>
                    <button type="button" className={`seg-btn${form.edgePreset==='abs1t'?' on':''}`} onClick={()=>setForm(f=>({...f,edgePreset:'abs1t'}))}>4면 1T</button>
                    <button type="button" className={`seg-btn${form.edgePreset==='abs2t'?' on':''}`} onClick={()=>setForm(f=>({...f,edgePreset:'abs2t'}))}>4면 2T</button>
                    <button type="button" className={`seg-btn${(form.edgePreset as string)==='custom'?' on':''}`} onClick={()=>setForm(f=>({...f,edgePreset:'custom' as MaterialEdgePreset}))}>사용자 설정</button>
                  </div>
                  {(form.edgePreset as string)==='custom' && (
                    <div className="edge-custom show">
                      <div className="face-grid">
                        {(['top','bottom','left','right'] as const).map((side,i)=>(
                          <div key={side} className="face-col">
                            <div className="face-col-label">{['상','하','좌','우'][i]}</div>
                            <div className="face-col-mm">{(i<2?form.wMm:form.dMm)+'mm'}</div>
                            <input className="t-inp" type="number" value={form.edgeCustomSides[side]||0}
                              onChange={e=>setForm(f=>({...f,edgeCustomSides:{...f.edgeCustomSides,[side]:Number(e.target.value)||0}}))} />
                            <div className="t-unit">T</div>
                          </div>
                        ))}
                      </div>
                      <div style={{fontSize:'10px',color:'#bbb',marginTop:'8px'}}>0 입력 시 해당 면 엣지 없음</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tab 1: 원장 배치 */}
            <div className="ed-content" style={{display: edTab===1?'flex':'none', flexDirection:'column', padding:'12px 16px 16px', overflow:'auto'}}>
              <YieldBoardGrid
                wMm={form.wMm}
                dMm={form.dMm}
                boardMaterial={form.boardMaterial}
                sheetPriceBySheetId={
                  Object.fromEntries(
                    ALL_SHEET_IDS.map(id => [id, sheetDisplayPrice(id)])
                  )
                }
                selectedKey={
                  form.selectedSheetId
                    ? `${form.selectedSheetId}|${form.placementMode}`
                    : null
                }
                onSelect={onGridSelect}
              />
            </div>

            {/* Tab 2: 가공 */}
            <div className="ed-content" style={{display: edTab===2?'block':'none'}}>
              <div className="sec-title mb10">가공비 입력</div>
              <div className="proc-row">
                <span className="pn">세척비</span>
                <span className="pr">{((form.wMm*form.dMm)/1000000*2*250).toFixed(0)}원 (자동)</span>
                <input className="pi" type="number" value={form.washM2||0}
                  onChange={e=>setForm(f=>({...f,washM2:Number(e.target.value)||0}))} />
                <span className="pu">m²</span>
                <span className={`pp${(!computed?.washCostWon)?' z':''}`}>{fmtWon(computed?.washCostWon??0)}</span>
              </div>
              <div className="proc-row">
                <span className="pn">일반 보링</span>
                <span className="pr">100원/개</span>
                <input className="pi" type="number" value={form.boring1Ea||0}
                  onChange={e=>setForm(f=>({...f,boring1Ea:Number(e.target.value)||0}))} />
                <span className="pu">개</span>
                <span className={`pp${(!computed?.boring1CostWon)?' z':''}`}>{fmtWon(computed?.boring1CostWon??0)}</span>
              </div>
              <div className="proc-row">
                <span className="pn">2단 보링</span>
                <span className="pr">50원/개</span>
                <input className="pi" type="number" value={form.boring2Ea||0}
                  onChange={e=>setForm(f=>({...f,boring2Ea:Number(e.target.value)||0}))} />
                <span className="pu">개</span>
                <span className={`pp${(!computed?.boring2CostWon)?' z':''}`}>{fmtWon(computed?.boring2CostWon??0)}</span>
              </div>
              {addedProcs.map(key=>{
                if(key==='ruta') return (
                  <div key="ruta" className="proc-row">
                    <span className="pn">루타 가공</span>
                    <span className="pr">2,000원/m</span>
                    <input className="pi" type="number" value={Math.round(form.rutaM*1000)||0}
                      onChange={e=>setForm(f=>({...f,rutaM:(Number(e.target.value)||0)/1000}))} />
                    <span className="pu">mm</span>
                    <span className={`pp${(!computed?.rutaCostWon)?' z':''}`}>{fmtWon(computed?.rutaCostWon??0)}</span>
                  </div>
                );
                if(key==='forming') return (
                  <div key="forming" className="proc-row">
                    <span className="pn">포밍</span>
                    <span className="pr">1,000원/m</span>
                    <input className="pi" type="number" value={Math.round(form.formingM*1000)||0}
                      onChange={e=>setForm(f=>({...f,formingM:(Number(e.target.value)||0)/1000}))} />
                    <span className="pu">mm</span>
                    <span className={`pp${(!computed?.formingCostWon)?' z':''}`}>{fmtWon(computed?.formingCostWon??0)}</span>
                  </div>
                );
                return null;
              })}
              <button type="button" className="add-proc" onClick={()=>{
                const opts=['ruta','forming','ruta2','tenoner','edgePaint','edge45','curved'];
                const avail=opts.filter(k=>!addedProcs.includes(k));
                if(avail.length) setAddedProcs(p=>[...p,avail[0]]);
              }}>+ 가공 추가하기</button>
            </div>
          </div>

          {/* Right panel: receipt */}
          <div className="editor-right">
            <div className="rcpt-panel">
              <div className="rcpt-name">{form.name||'이름 없음'}</div>
              <div className="rcpt-total">{computed?fmtWon(form.hMm>0?computed.grandTotalWon:computed.processingTotalWon):'—'}</div>

              <div className="rsec">원재료비</div>
              {(() => {
                const matCost  = computed?.materialCostWon ?? 0;
                const edgeCost = computed?.edgeCostWon ?? 0;
                const hmCost   = computed?.hotmeltCostWon ?? 0;
                return (
                  <>
                    <div className={`rrow${matCost===0?' rrow--zero':''}`}>
                      <span className="l">목재 원재료비<small>{form.wMm}×{form.dMm}×{form.hMm}T · {form.boardMaterial}, {form.surfaceMaterial}</small></span>
                      <span className="r">{fmtWon(matCost)}</span>
                    </div>
                    <div className={`rrow${edgeCost===0?' rrow--zero':''}`}>
                      <span className="l">엣지 원재료비<small>{form.edgePreset!=='none'?`4면 ${form.edgePreset==='abs2t'?'ABS 2T':'ABS 1T'}`:'없음'} · {computed?.edgeLengthM?.toFixed(2)?? '0.00'}m</small></span>
                      <span className="r">{fmtWon(edgeCost)}</span>
                    </div>
                    <div className={`rrow${hmCost===0?' rrow--zero':''}`}>
                      <span className="l">핫멜트<small>{form.hMm}T · {computed?.edgeLengthM?.toFixed(2)?? '0'}m</small></span>
                      <span className="r">{fmtWon(hmCost)}</span>
                    </div>
                    <div className="rsub">
                      <span>원재료비 합계</span>
                      <span>{fmtWon(matCost+edgeCost+hmCost)}</span>
                    </div>
                  </>
                );
              })()}

              <div className="rdiv" />

              <div className="rsec">가공비</div>
              {(() => {
                const cutCost  = computed?.cuttingCostWon ?? 0;
                const borCost  = (computed?.boring1CostWon??0)+(computed?.boring2CostWon??0);
                const washCost = computed?.washCostWon ?? 0;
                return (
                  <>
                    <div className={`rrow${cutCost===0?' rrow--zero':''}`}>
                      <span className="l">재단<small>{computed?.cuttingPlacementCount??0}개</small></span>
                      <span className="r">{fmtWon(cutCost)}</span>
                    </div>
                    <div className="rrow rrow--zero">
                      <span className="l">엣지 접착비<small>버밍·핫멜트 구간</small></span>
                      <span className="r">{fmtWon(0)}</span>
                    </div>
                    <div className={`rrow${borCost===0?' rrow--zero':''}`}>
                      <span className="l">보링류<small>일반 {form.boring1Ea} / 2단 {form.boring2Ea}</small></span>
                      <span className="r">{fmtWon(borCost)}</span>
                    </div>
                    {washCost>0 && (
                      <div className="rrow">
                        <span className="l">세척비</span>
                        <span className="r">{fmtWon(washCost)}</span>
                      </div>
                    )}
                    <div className="rsub">
                      <span>가공비 합계</span>
                      <span>{fmtWon(computed?.processingTotalWon??0)}</span>
                    </div>
                  </>
                );
              })()}

              <div className="rdiv" />
              <div className="rsum">
                <span className="rl">합계</span>
                <span className="rr">{computed?fmtWon(form.hMm>0?computed.grandTotalWon:computed.processingTotalWon):'—'}</span>
              </div>
            </div>
          </div>
        </div>
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
                >최신순</button>
                <span className="text-[#e0e0e0]">|</span>
                <button
                  type="button"
                  className={sort === "old" ? "font-semibold text-[#1e6fff]" : "hover:text-[#111]"}
                  onClick={() => setSort("old")}
                >오래된 순</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {filtered.map((item) => {
                const isActive = editingId === item.id;
                const isDraft = item.status === "DRAFT";
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border-2 p-4 transition-colors ${
                      isActive
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
                        onClick={() => { void openListItem(item.id); setListOpen(false); }}
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
                        <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-lg leading-none text-slate-500 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">⋯</summary>
                        <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-[#e8e8e8] bg-white py-1 shadow-lg">
                          <button type="button" className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={() => void onCopy(item.id)}>복사</button>
                          <button type="button" className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={() => { void openListItem(item.id); setListOpen(false); }}>수정</button>
                          <button type="button" className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50" onClick={() => void onDelete(item.id)}>삭제</button>
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
});




/** 드롭다운 선택 + 수량 입력을 한 묶음으로 보여주는 추가가공 행 */

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
  EDGE45_PAINT_RATES,
  THICK_TO_ABS_WIDTH,
  ABS_PRICE,
  ABS_CODE,
  hasAbs2T,
  type EdgeSelection,
} from "../lib/materialCalc";
import { SHEET_SPECS, piecesPerSheet, yieldPercent, type SheetId } from "../lib/yield";
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


export type PlacementMode = "default" | "rotated" | "mixed";

/** 두께(T) × 원장 사이즈별 장당 단가 (원) — ERP DB 기준 (WW LPM/O PB) */
const _SP_15  = { "4x6": 23270, "4x8": 32800, "6x8": 23270 } as const;
const _SP_18  = { "4x6": 16620, "4x8": 23270, "6x8": 23770 } as const;
const _SP_22  = { "4x8": 19460, "6x8": 23270 } as const;
const _SP_25  = { "4x8": 23270 } as const;
const _SP_28  = { "4x8": 23270, "6x8": 23270 } as const;
const SHEET_PRICE_BY_THICKNESS: Partial<Record<number, Partial<Record<string, number>>>> = {
  12: { "4x8": 19460 },
  15: _SP_15,   15.5: _SP_15,   // parser.py STANDARD_THICKNESSES .5 alias
  18: _SP_18,   18.5: _SP_18,
  22: _SP_22,   22.5: _SP_22,
  25: _SP_25,
  28: _SP_28,   28.5: _SP_28,
};


const ALL_SHEET_IDS = ["4x6", "4x8", "6x8"] as const;

/** ERP 자재코드 + 장당 단가 매핑 (WW LPM/O PB, T값 기준)
 *  parser.py STANDARD_THICKNESSES (.5 단위) 호환 위해 정수+소수 alias 둘 다 등록 */
const _ERP_4x6_15 = { price: 23270, code: 'WDWP001205-R000' };
const _ERP_4x6_18 = { price: 16620, code: 'WDPGBL0000550'  };
const _ERP_4x8_12 = { price: 19460, code: 'WDWP000260-R000' };
const _ERP_4x8_15 = { price: 32800, code: 'WDWP000258-R000' };
const _ERP_4x8_18 = { price: 23270, code: 'WDWP000274-R000' };
const _ERP_4x8_22 = { price: 19460, code: 'WDWP000266-R000' };
const _ERP_4x8_25 = { price: 23270, code: 'WDWP001811-R000' };
const _ERP_4x8_28 = { price: 23270, code: 'WDWP000407-R000' };
const _ERP_6x8_15 = { price: 23270, code: 'WDWP001360-R000' };
const _ERP_6x8_18 = { price: 23770, code: 'WDWPMF0000237'  };
const _ERP_6x8_22 = { price: 23270, code: 'WDWP000730-R000' };
const _ERP_6x8_28 = { price: 23270, code: 'WDWP000951-R000' };
const SHEET_ERP: Record<string, Partial<Record<number, { price: number; code: string }>>> = {
  '4x6': {
    15: _ERP_4x6_15, 15.5: _ERP_4x6_15,
    18: _ERP_4x6_18, 18.5: _ERP_4x6_18,
  },
  '4x8': {
    12: _ERP_4x8_12,
    15: _ERP_4x8_15, 15.5: _ERP_4x8_15,
    18: _ERP_4x8_18, 18.5: _ERP_4x8_18,
    22: _ERP_4x8_22, 22.5: _ERP_4x8_22,
    25: _ERP_4x8_25,
    28: _ERP_4x8_28, 28.5: _ERP_4x8_28,
  },
  '6x8': {
    15: _ERP_6x8_15, 15.5: _ERP_6x8_15,
    18: _ERP_6x8_18, 18.5: _ERP_6x8_18,
    22: _ERP_6x8_22, 22.5: _ERP_6x8_22,
    28: _ERP_6x8_28, 28.5: _ERP_6x8_28,
  },
};

/** 추가 가공 드롭다운 옵션 (기본 3개 제외) */
const PROC_OPTIONS: Array<{key: string; label: string; unit: string; tip: string}> = [
  { key: 'forming', label: '포밍',    unit: 'mm', tip: 'm당 1,000원' },
  { key: 'ruta',    label: '일반 루타', unit: 'mm', tip: 'm당 2,000원' },
  { key: 'ruta2',   label: '2차 루타', unit: 'mm', tip: 'm당 1,000원' },
  { key: 'tenoner', label: '테노너',   unit: 'mm', tip: 'm당 800원' },
];

/** 도장 엣지 방식 목록 */
const PAINT_OPTIONS = Object.entries(EDGE45_PAINT_RATES).map(([key, rate]) => ({ key, rate }));


/** 팝업 전용 상수 */
const POPUP_LOSS_MM = 4;

/** 원장 SVG 미리보기 — Portrait 고정 42×64, 모드별 컬러 */
function SheetSVG({ sheetW, sheetH, wMm, dMm, mode }: {
  sheetW: number; sheetH: number; wMm: number; dMm: number;
  mode: "default" | "rotated" | "mixed";
}) {
  const SVG_W = 42, SVG_H = 64;
  const scX = SVG_W / sheetW;
  const scY = SVG_H / sheetH;
  const pw = wMm + POPUP_LOSS_MM, ph = dMm + POPUP_LOSS_MM;
  const G = 0.5;

  const BLUE   = '#4A7CF7';
  const ORANGE = '#F5A000';
  const GREEN  = '#3DB97A';

  type PD = { key: string; x: number; y: number; w: number; h: number; fill: string };
  const pcs: PD[] = [];

  if (wMm > 0 && dMm > 0) {
    if (mode === "default") {
      const cols = Math.floor(sheetW / pw), rows = Math.floor(sheetH / ph);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        pcs.push({ key:`${r}-${c}`, x:c*pw*scX+G, y:r*ph*scY+G, w:Math.max(0.5,pw*scX-G*2), h:Math.max(0.5,ph*scY-G*2), fill:BLUE });
    } else if (mode === "rotated") {
      const cols = Math.floor(sheetW / ph), rows = Math.floor(sheetH / pw);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
        pcs.push({ key:`${r}-${c}`, x:c*ph*scX+G, y:r*pw*scY+G, w:Math.max(0.5,ph*scX-G*2), h:Math.max(0.5,pw*scY-G*2), fill:ORANGE });
    } else {
      const mC = Math.floor(sheetW / pw), mR = Math.floor(sheetH / ph);
      for (let r = 0; r < mR; r++) for (let c = 0; c < mC; c++)
        pcs.push({ key:`m${r}-${c}`, x:c*pw*scX+G, y:r*ph*scY+G, w:Math.max(0.5,pw*scX-G*2), h:Math.max(0.5,ph*scY-G*2), fill:BLUE });
      const remW = sheetW - mC * pw;
      const rC = Math.floor(remW / ph), rR = Math.floor(sheetH / pw);
      for (let r = 0; r < rR; r++) for (let c = 0; c < rC; c++)
        pcs.push({ key:`r${r}-${c}`, x:(mC*pw+c*ph)*scX+G, y:r*pw*scY+G, w:Math.max(0.5,ph*scX-G*2), h:Math.max(0.5,pw*scY-G*2), fill:GREEN });
      const remH = sheetH - mR * ph;
      const bC = Math.floor(mC * pw / ph), bR = Math.floor(remH / pw);
      for (let r = 0; r < bR; r++) for (let c = 0; c < bC; c++)
        pcs.push({ key:`b${r}-${c}`, x:c*ph*scX+G, y:(mR*ph+r*pw)*scY+G, w:Math.max(0.5,ph*scX-G*2), h:Math.max(0.5,pw*scY-G*2), fill:GREEN });
    }
  }

  return (
    <svg width={SVG_W} height={SVG_H} style={{display:'block', flexShrink:0}}>
      <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#f8f8f8" stroke="#d8d8d8" strokeWidth={0.5} />
      {pcs.map(p => <rect key={p.key} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill} />)}
    </svg>
  );
}

/** i 아이콘 + hover 툴팁 */
function IIcon({ tip }: { tip: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{position:'relative',display:'inline-flex',alignItems:'center',marginLeft:'4px',flexShrink:0}}>
      <span
        onMouseEnter={()=>setShow(true)}
        onMouseLeave={()=>setShow(false)}
        style={{
          display:'inline-flex',alignItems:'center',justifyContent:'center',
          width:'14px',height:'14px',borderRadius:'50%',
          background:'#888',color:'#fff',fontSize:'9px',fontStyle:'italic',fontWeight:700,
          cursor:'default',flexShrink:0,userSelect:'none',lineHeight:1,
        }}>i</span>
      {show && (
        <span style={{
          position:'absolute',left:'18px',top:'50%',transform:'translateY(-50%)',
          background:'#1A1A1A',color:'#fff',fontSize:'11px',
          padding:'6px 10px',whiteSpace:'nowrap',lineHeight:1.6,
          zIndex:100,pointerEvents:'none',
        }}>{tip}</span>
      )}
    </span>
  );
}

export type MaterialEdgePreset = "none" | "abs1t" | "abs2t" | "paint" | "custom" | "edge45" | "curved";

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
  /** 곱면 수동 가공 길이 (mm) */
  curvedManualMm: number;
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
  const valid: MaterialEdgePreset[] = ["none","abs1t","abs2t","paint","custom","edge45","curved"];
  if (form.edgePreset && valid.includes(form.edgePreset)) return form.edgePreset;
  const k = form.edgeProfileKey?.trim() ?? "";
  if (!k) return "none";
  if (k === "4면 ABS 2T") return "abs2t";
  return "abs1t";
}

function normalizeBoardSurface(_form: { boardMaterial?: string; surfaceMaterial?: string }): {
  boardMaterial: string;
  surfaceMaterial: string;
} {
  // 소재/표면재는 PB/LPM-O로 고정
  return { boardMaterial: "PB", surfaceMaterial: "LPM/O" };
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
    curvedManualMm: f.curvedManualMm ?? 0,
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
  if (preset === "custom") return { edgeType: "ABS", edgeSetting: "사용자" };
  if (preset === "paint")  return { edgeType: "도장", edgeSetting: "" };
  if (preset === "edge45") return { edgeType: "45도", edgeSetting: "" };
  if (preset === "curved") return { edgeType: "곱면", edgeSetting: "" };
  return { edgeType: "없음", edgeSetting: "" };
}

function bomToEdgePreset(edgeType: string, edgeSetting: string): MaterialEdgePreset {
  if (edgeType === "ABS") {
    if (edgeSetting === "4면 2T") return "abs2t";
    if (edgeSetting === "사용자") return "custom";
    return "abs1t";
  }
  if (edgeType === "도장") return "paint";
  if (edgeType === "45도") return "edge45";
  if (edgeType === "곱면") return "curved";
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
    curvedManualMm: 0,
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
  const [showBoardPopup, setShowBoardPopup] = useState(false);
  const [popupSelRI, setPopupSelRI] = useState(0); // 0=정방향, 1=90°, 2=혼합
  const [popupSelSI, setPopupSelSI] = useState(1); // 0=4x6, 1=4x8, 2=6x8
  const [showProcDropdown, setShowProcDropdown] = useState(false);
  /** 팝업 열 인라인 편집 상태 */
  const [popupEditSI, setPopupEditSI] = useState<number | null>(null);
  const [popupEditPrice, setPopupEditPrice] = useState('');
  const [popupEditCode, setPopupEditCode] = useState('');
  const [popupCustomCodes, setPopupCustomCodes] = useState<Record<string, string>>({});
  const [, setMsg] = useState<string | null>(null);
  /** 마지막으로 서버/불러오기와 일치한다고 본 스냅샷 */
  const savedRef = useRef(serializeMaterialState(null, defaultForm()));
  const formRef = useRef(form);
  formRef.current = form;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  const onQuoteEntityRebindRef = useRef(onQuoteEntityRebind);
  onQuoteEntityRebindRef.current = onQuoteEntityRebind;
  const procDropdownRef = useRef<HTMLDivElement>(null);

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
      curvedManualMm: form.curvedManualMm ?? 0,
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
      form.curvedManualMm,
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
        color: "WW",      // 패널 색상 고정
        edgeColor: "WW",  // 엣지 색상 고정
        tenonerMm: (saved as { tenonerMm?: number }).tenonerMm ?? 0,
        boring1Ea: (saved as { boring1Ea?: number }).boring1Ea ?? (raw as { boringEa?: number }).boringEa ?? 0,
        boring2Ea: (saved as { boring2Ea?: number }).boring2Ea ?? 0,
        curvedEdgeType: (saved as { curvedEdgeType?: "machining" | "manual" | "" }).curvedEdgeType ?? "",
        edge45TapingM: (saved as { edge45TapingM?: number }).edge45TapingM ?? (raw as { edge45M?: number }).edge45M ?? 0,
        edge45PaintType: (saved as { edge45PaintType?: string }).edge45PaintType ?? "",
        edge45PaintM: (saved as { edge45PaintM?: number }).edge45PaintM ?? 0,
        curvedManualMm: (saved as { curvedManualMm?: number }).curvedManualMm ?? 0,
      };
      // addedProcs: only user-addable processing items (edge types now handled by edgePreset)
      const restoredProcs: string[] = [];
      if ((nextForm.formingM ?? 0) > 0) restoredProcs.push("forming");
      if ((nextForm.rutaM ?? 0) > 0) restoredProcs.push("ruta");
      if ((nextForm.ruta2M ?? 0) > 0) restoredProcs.push("ruta2");
      if ((nextForm.tenonerMm ?? 0) > 0) restoredProcs.push("tenoner");

      // 두께 정수화 — 15.5/18.5/22.5/28.5 같은 STP 실측값을 사용자 표시 통일 (15T/18T/22T/28T)
      if (nextForm.hMm > 0 && !Number.isInteger(nextForm.hMm)) {
        nextForm.hMm = Math.floor(nextForm.hMm);
      }

      // sheetPrices 자동 보완 — 빈 객체였던 기존 자재 복구
      const _hasPrices = nextForm.sheetPrices && Object.keys(nextForm.sheetPrices).length > 0;
      if (!_hasPrices && nextForm.hMm > 0) {
        const _p = SHEET_PRICE_BY_THICKNESS[nextForm.hMm] ?? {};
        const _sp: Record<string, number> = {};
        for (const sid of ALL_SHEET_IDS) if (_p[sid] != null) _sp[sid] = _p[sid]!;
        nextForm.sheetPrices = _sp;
      }

      // Merge from groot_bom node data if available (immediate-saved, may be fresher than StoredMaterial)
      // activeMatNodeId is not available here so use tree activeItem via ref
      let finalProcs = restoredProcs;
      const bomData = getBomNodeData(id); // node id same as material id when tree node wraps material
      if (bomData) {
        const origHMm = nextForm.hMm;
        nextForm.wMm = bomData.w;
        nextForm.dMm = bomData.d;
        // bomData.t 가 18.5 등 .5 단위면 정수로 통일 (사용자 표시 일관성)
        nextForm.hMm = Number.isInteger(bomData.t) ? bomData.t : Math.floor(bomData.t);
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
          const validKeys = ["forming","ruta","ruta2","tenoner"];
          finalProcs = bomData.processes.filter((k: string) => validKeys.includes(k));
        }
      }

      // edgeCustomSides 자동 복구 — bomData 가 모두 0 인 손상 상태도 보정
      // (edgeSides 가 일부만 true 인 1면/2면/3면 경우, 그 면에 edgeT 두께값 부여)
      {
        const _ecs = nextForm.edgeCustomSides;
        const _allZero = _ecs && [_ecs.top, _ecs.bottom, _ecs.left, _ecs.right].every((v) => !v);
        const _es = nextForm.edgeSides;
        const _someActive = _es && [_es.top, _es.bottom, _es.left, _es.right].some(Boolean);
        const _notAll = _es && ![_es.top, _es.bottom, _es.left, _es.right].every(Boolean);
        if (_allZero && _someActive && _notAll) {
          const _t = nextForm.edgePreset === "abs2t" ? 2 : 1;
          nextForm.edgeCustomSides = {
            top:    _es.top    ? _t : 0,
            bottom: _es.bottom ? _t : 0,
            left:   _es.left   ? _t : 0,
            right:  _es.right  ? _t : 0,
          };
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
  // 주의: loadMaterial 이 완료되기 전(editingId !== activeMatNodeId)에 발화하면
  // 빈 defaultForm 으로 BOM 데이터를 덮어쓰는 race condition 발생.
  // editingId 가 activeMatNodeId 와 일치할 때만 (= 해당 자재의 form 이 로드된 상태) 저장.
  useEffect(() => {
    if (!activeMatNodeId) return;
    if (editingId !== activeMatNodeId) return;
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
  }, [activeMatNodeId, editingId, form, addedProcs]); // eslint-disable-line react-hooks/exhaustive-deps

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
    }, quoteMode ? 300 : 1600);
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


  const fmtWon = (n: number) => (n > 0 ? Math.ceil(n).toLocaleString() + "원" : "0원");

  // V3: 3×3 board popup data (3 modes × 3 sheet sizes)
  const boardAllData = useMemo(() => {
    const MODES: Array<{ label: string; mode: "default" | "rotated" | "mixed" }> = [
      { label: "정방향", mode: "default" },
      { label: "90°",   mode: "rotated" },
      { label: "혼합",  mode: "mixed"   },
    ];
    return MODES.map((m, ri) =>
      SHEET_SPECS.map((s, si) => {
        const price = form.sheetPrices[s.id] ?? SHEET_PRICE_BY_THICKNESS[form.hMm]?.[s.id] ?? 0;
        const pieces = piecesPerSheet(s.widthMm, s.heightMm, form.wMm, form.dMm, m.mode);
        const yieldPct = yieldPercent(pieces, s.widthMm, s.heightMm, form.wMm, form.dMm);
        const unitPrice = pieces > 0 ? Math.ceil(price / pieces) : 0;
        return { ri, si, label: m.label, mode: m.mode, sheetId: s.id, sheetLabel: s.label, pieces, yieldPct, unitPrice, sheetPrice: price };
      })
    );
  }, [form.wMm, form.dMm, form.hMm, form.sheetPrices]);

  const flatCells = useMemo(() => boardAllData.flat().filter(c => c.pieces > 0), [boardAllData]);
  const maxYieldPct = useMemo(() => flatCells.length > 0 ? Math.max(...flatCells.map(c => c.yieldPct)) : 0, [flatCells]);
  // The bar shows the user-selected sheet, or auto-recommends highest yield
  const barData = useMemo(() => {
    const EPS = 0.01;
    if (form.selectedSheetId) {
      const si = SHEET_SPECS.findIndex(s => s.id === form.selectedSheetId);
      const ri = form.placementMode === "rotated" ? 1 : form.placementMode === "mixed" ? 2 : 0;
      const cell = boardAllData[ri]?.[si >= 0 ? si : 0];
      if (cell && cell.pieces > 0) return cell;
    }
    return flatCells.find(c => c.yieldPct >= maxYieldPct - EPS) ?? null;
  }, [form.selectedSheetId, form.placementMode, boardAllData, flatCells, maxYieldPct]);

  // 팝업 전용 계산 (POPUP_LOSS_MM=4)
  const popupAllData = useMemo(() => {
    const MODES: Array<{ label: string; mode: "default" | "rotated" | "mixed" }> = [
      { label: "정방향", mode: "default" },
      { label: "90°",   mode: "rotated" },
      { label: "혼합",  mode: "mixed"   },
    ];
    return MODES.map((m, ri) =>
      SHEET_SPECS.map((s, si) => {
        const price = form.sheetPrices[s.id] ?? SHEET_PRICE_BY_THICKNESS[form.hMm]?.[s.id] ?? 0;
        const pw = form.wMm + POPUP_LOSS_MM, ph = form.dMm + POPUP_LOSS_MM;
        let count = 0;
        if (form.wMm > 0 && form.dMm > 0) {
          if (m.mode === "default") count = Math.floor(s.widthMm/pw) * Math.floor(s.heightMm/ph);
          else if (m.mode === "rotated") count = Math.floor(s.widthMm/ph) * Math.floor(s.heightMm/pw);
          else {
            const mC = Math.floor(s.widthMm/pw), mR = Math.floor(s.heightMm/ph);
            const right = Math.floor((s.widthMm-mC*pw)/ph) * Math.floor(s.heightMm/pw);
            const bottom = Math.floor((mC*pw)/ph) * Math.floor((s.heightMm-mR*ph)/pw);
            count = mC*mR + right + bottom;
          }
        }
        const yieldPct = count > 0 ? count*pw*ph/(s.widthMm*s.heightMm)*100 : 0;
        const unitPrice = count > 0 ? Math.ceil(price/count) : 0;
        return { ri, si, label:m.label, mode:m.mode, sheetId:s.id, sheetLabel:s.label,
                 sheetW:s.widthMm, sheetH:s.heightMm, count, yieldPct, unitPrice, sheetPrice:price };
      })
    );
  }, [form.wMm, form.dMm, form.hMm, form.sheetPrices]);

  const popupFlatCells = useMemo(() => popupAllData.flat().filter(c => c.count > 0), [popupAllData]);
  const popupMaxYield  = useMemo(() => popupFlatCells.length > 0 ? Math.max(...popupFlatCells.map(c => c.yieldPct)) : 0, [popupFlatCells]);
  const popupMinPrice  = useMemo(() => popupFlatCells.length > 0 ? Math.min(...popupFlatCells.map(c => c.unitPrice)) : Infinity, [popupFlatCells]);

  const openBoardPopup = useCallback(() => {
    if (form.selectedSheetId) {
      const si = SHEET_SPECS.findIndex(s => s.id === form.selectedSheetId);
      const ri = form.placementMode === "rotated" ? 1 : form.placementMode === "mixed" ? 2 : 0;
      setPopupSelRI(ri >= 0 ? ri : 0); setPopupSelSI(si >= 0 ? si : 1);
    } else {
      const EPS = 0.01;
      const best = popupFlatCells.find(c => c.yieldPct >= popupMaxYield - EPS);
      setPopupSelRI(best?.ri ?? 0); setPopupSelSI(best?.si ?? 1);
    }
    // 커스텀 코드 localStorage 복원
    try {
      const lsKey = `groot-sheet-codes-${editingIdRef.current ?? '_new'}`;
      const saved = localStorage.getItem(lsKey);
      setPopupCustomCodes(saved ? (JSON.parse(saved) as Record<string, string>) : {});
    } catch { setPopupCustomCodes({}); }
    setPopupEditSI(null);
    setShowBoardPopup(true);
  }, [form.selectedSheetId, form.placementMode, popupFlatCells, popupMaxYield]);

  // BOM 트리 이름 변경 시 form.name 실시간 동기화
  const activeNodeName =
    activeItem !== null &&
    treeNodes[activeItem]?.type === "mat" &&
    treeNodes[activeItem]?.id === editingId
      ? (treeNodes[activeItem]?.name ?? "")
      : undefined;

  useEffect(() => {
    if (activeNodeName === undefined || !editingId) return;
    setForm((f) => {
      if (f.name === activeNodeName) return f;
      return { ...f, name: activeNodeName };
    });
  }, [activeNodeName, editingId]);

  const saveBoardSel = useCallback(() => {
    const modeKey: "default" | "rotated" | "mixed" = popupSelRI === 1 ? "rotated" : popupSelRI === 2 ? "mixed" : "default";
    const sheetId = (["4x6", "4x8", "6x8"] as const)[popupSelSI as 0|1|2] ?? "4x8";
    onGridSelect(sheetId, modeKey);
    setShowBoardPopup(false);
  }, [popupSelRI, popupSelSI, onGridSelect]);

  // 가공 드롭다운 바깥 클릭 시 닫기 + 열릴 때 자동 포커스
  useEffect(() => {
    if (!showProcDropdown) return;
    procDropdownRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!procDropdownRef.current?.contains(e.target as Node)) {
        setShowProcDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProcDropdown]);

  return (
    <>
      <div style={{display:'flex',height:'100%',minHeight:0,width:'100%',overflow:'hidden'}}>
        <div className="editor-body">

          {/* ── Left column: 토스 영수증 스타일 섹션 카드 ── */}
          <div className="editor-left" style={{ fontFamily: "Pretendard, system-ui", letterSpacing: "-0.01em" }}>
            <div className="ed-content" style={{padding:'0',overflowY:'auto'}}>
              <div style={{maxWidth:'640px'}}>

              {/* ── 섹션: 패널 ── */}
              <section style={{padding:'20px 24px',borderBottom:'1px solid #F0F0F0'}}>
                <div style={{fontSize:'11px',fontWeight:500,color:'#7E7E7E',letterSpacing:'0.05em',textTransform:'uppercase',marginBottom:'12px'}}>패널</div>

                {/* W / D / H(T) */}
                <div style={{display:'flex',gap:'12px',marginBottom:'12px'}}>
                  <div style={{flex:1}}>
                    <label style={{display:'block',fontSize:'12px',color:'#616161',marginBottom:'6px'}}>W (mm)</label>
                    <input className="fi" type="number" value={form.wMm||''} placeholder="0"
                      onChange={e=>onDimensionCommit({wMm:Number(e.target.value)||0,dMm:form.dMm,hMm:form.hMm})} />
                  </div>
                  <div style={{flex:1}}>
                    <label style={{display:'block',fontSize:'12px',color:'#616161',marginBottom:'6px'}}>D (mm)</label>
                    <input className="fi" type="number" value={form.dMm||''} placeholder="0"
                      onChange={e=>onDimensionCommit({wMm:form.wMm,dMm:Number(e.target.value)||0,hMm:form.hMm})} />
                  </div>
                  <div style={{flex:1}}>
                    <label style={{display:'block',fontSize:'12px',color:'#616161',marginBottom:'6px'}}>H (T)</label>
                    <input className="fi" type="number" value={form.hMm||''} placeholder="0"
                      onChange={e=>onDimensionCommit({wMm:form.wMm,dMm:form.dMm,hMm:Number(e.target.value)||0})} />
                  </div>
                </div>

                {/* 소재 / 표면재 / 색상 — 고정 (데스커 비활성 스타일) */}
                {(()=>{
                  const fixedCell = (label: string, val: string) => (
                    <div style={{flex:1}}>
                      <div style={{fontSize:'12px',color:'#616161',marginBottom:'6px'}}>{label}</div>
                      <div style={{
                        height:'36px',display:'flex',alignItems:'center',padding:'0 12px',
                        background:'#F0F0F0',border:'1px solid #F0F0F0',borderRadius:'4px',
                        fontSize:'14px',color:'#616161',userSelect:'none',cursor:'not-allowed',
                      }}>{val}</div>
                    </div>
                  );
                  return (
                    <div style={{display:'flex',gap:'12px',marginBottom:'14px'}}>
                      {fixedCell('소재', 'PB')}
                      {fixedCell('표면재', 'LPM/O')}
                      {fixedCell('색상', 'WW')}
                    </div>
                  );
                })()}

                {/* 원장 선택 카드 (토스 스타일) */}
                <div
                  onClick={openBoardPopup}
                  onMouseEnter={(e)=>{(e.currentTarget as HTMLDivElement).style.background='#E8E8E8'}}
                  onMouseLeave={(e)=>{(e.currentTarget as HTMLDivElement).style.background='#F0F0F0'}}
                  style={{
                    display:'flex',alignItems:'center',justifyContent:'space-between',
                    padding:'12px 16px',background:'#F0F0F0',border:'1px solid #F0F0F0',
                    borderRadius:'4px',cursor:'pointer',transition:'background .15s',
                  }}>
                  <div>
                    <div style={{fontSize:'13px',fontWeight:600,color:'#282828'}}>
                      {barData
                        ? <>{barData.sheetLabel} 원장 · {barData.label} 배치 <span style={{color:'#7E7E7E',fontWeight:500}}>({barData.yieldPct.toFixed(1)}%)</span></>
                        : '원장 미선택'}
                    </div>
                    <div style={{fontSize:'11px',color:'#7E7E7E',marginTop:'2px'}}>목재 패널 자재비</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
                    <span style={{fontSize:'14px',fontWeight:700,color:'#282828',fontFeatureSettings:"'tnum' 1"}}>
                      {barData ? fmtWon(barData.unitPrice) : '—'}
                    </span>
                    <span style={{fontSize:'11px',color:'#7E7E7E'}}>변경 ›</span>
                  </div>
                </div>
              </section>

              {/* ── 섹션: 엣지 ── */}
              <section style={{padding:'20px 24px',borderBottom:'1px solid #F0F0F0'}}>
                <div style={{fontSize:'11px',fontWeight:500,color:'#7E7E7E',letterSpacing:'0.05em',textTransform:'uppercase',marginBottom:'12px'}}>엣지</div>
                <div style={{fontSize:'12px',color:'#616161',marginBottom:'6px'}}>사양</div>

              {/* 사양 토글: 없음 / ABS / 도장(비활성) / 45도(비활성) / 곡면(비활성) */}
              {(()=>{
                const TABS = [
                  { id:'none',   label:'없음', disabled:false },
                  { id:'abs',    label:'ABS',  disabled:false },
                  { id:'paint',  label:'도장', disabled:true  },
                  { id:'edge45', label:'45도', disabled:true  },
                  { id:'curved', label:'곡면', disabled:true  },
                ] as const;
                const activeTab =
                  form.edgePreset==='none' ? 'none'
                  : (form.edgePreset==='abs1t'||form.edgePreset==='abs2t'||form.edgePreset==='custom') ? 'abs'
                  : form.edgePreset==='paint' ? 'paint'
                  : form.edgePreset==='edge45' ? 'edge45'
                  : 'curved';
                return (
                  <div style={{display:'flex',border:'0.5px solid #e0e0e0',marginBottom:'8px'}}>
                    {TABS.map(({id,label,disabled},i)=>{
                      const isOn = id===activeTab;
                      return (
                        <button key={id} type="button"
                          disabled={disabled}
                          title={disabled ? '준비 중' : undefined}
                          onClick={()=>{
                            if (disabled) return;
                            setForm(f=>({...f,edgePreset:
                              id==='none'?'none':id==='abs'?'abs1t':'none'
                            }));
                          }}
                          style={{
                            flex:1, padding:'6px 0', fontSize:'11px',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            border: 'none',
                            color: disabled ? '#ccc' : isOn ? '#fff' : '#888',
                            background: isOn && !disabled ? '#1A1A1A' : '#fff',
                            borderRight: i<TABS.length-1 ? '0.5px solid #e0e0e0' : 'none',
                            opacity: disabled ? 0.45 : 1,
                          }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ABS: 4면 1T / 4면 2T / 사용자 설정 */}
              {(form.edgePreset==='abs1t'||form.edgePreset==='abs2t'||form.edgePreset==='custom') && (()=>{
                const absWidth = THICK_TO_ABS_WIDTH[form.hMm];
                const can2T    = hasAbs2T(form.hMm);
                // 현재 프리셋 기준 대표 자재코드
                const repTVal: 1|2 = form.edgePreset==='abs2t' ? 2 : 1;
                const repCode = absWidth ? ABS_CODE[absWidth]?.[repTVal] : undefined;
                return (
                  <div style={{marginBottom:'8px'}}>
                    <div style={{fontSize:'11px',color:'#555',marginBottom:'3px'}}>규격</div>
                    <div style={{display:'flex',border:'0.5px solid #e0e0e0',marginBottom:'6px'}}>
                      {([
                        {v:'abs1t' as MaterialEdgePreset, lbl:'4면 1T',  disabled:false},
                        {v:'abs2t' as MaterialEdgePreset, lbl:'4면 2T',  disabled:!can2T},
                        {v:'custom' as MaterialEdgePreset, lbl:'사용자 설정', disabled:false},
                      ]).map(({v,lbl,disabled},i,arr)=>(
                        <button key={v} type="button"
                          disabled={disabled}
                          title={disabled ? '해당 두께는 2T ABS 없음' : undefined}
                          onClick={()=>{ if(!disabled) setForm(f=>({...f, edgePreset:v, edgeColor:'WW'})); }}
                          style={{
                            flex:1, padding:'6px 0', fontSize:'11px',
                            cursor: disabled?'not-allowed':'pointer',
                            border:'none',
                            color: disabled ? '#ccc' : form.edgePreset===v ? '#fff' : '#888',
                            background: form.edgePreset===v && !disabled ? '#1A1A1A' : '#fff',
                            borderRight: i<arr.length-1 ? '0.5px solid #e0e0e0' : 'none',
                            opacity: disabled ? 0.5 : 1,
                          }}>
                          {lbl}
                        </button>
                      ))}
                    </div>

                    {/* 사용자 설정: 면별 T값 선택 */}
                    {form.edgePreset==='custom' && (
                      <div style={{marginBottom:'6px'}}>
                        <div style={{display:'flex',gap:'8px',marginBottom:'4px'}}>
                          {(['top','bottom','left','right'] as const).map((side,i)=>{
                            const label = ['상 T','하 T','좌 T','우 T'][i];
                            const val   = form.edgeCustomSides[side] ?? 0;
                            const w50m  = (i < 2 ? form.wMm : form.dMm) + 50;
                            const tv    = val as 0|1|2;
                            const sideRate = (tv === 2 && absWidth) ? (ABS_PRICE[absWidth]?.[2] ?? 0)
                                           : (tv === 1 && absWidth) ? (ABS_PRICE[absWidth]?.[1] ?? 0) : 0;
                            const sideCost = tv > 0 ? (w50m / 1000) * sideRate : 0;
                            return (
                              <div key={side} style={{flex:1,display:'flex',flexDirection:'column'}}>
                                <div style={{fontSize:'11px',color:'#555',marginBottom:'3px'}}>{label}</div>
                                <select
                                  className="fi"
                                  value={val}
                                  style={{height:'30px',fontSize:'12px'}}
                                  onChange={e=>setForm(f=>({...f,edgeCustomSides:{...f.edgeCustomSides,[side]:Number(e.target.value)}}))}
                                >
                                  <option value={0}>없음</option>
                                  <option value={1}>1T</option>
                                  <option value={2} disabled={!can2T}>2T</option>
                                </select>
                                {tv > 0 && (
                                  <div style={{fontSize:'10px',color:'#969696',marginTop:'2px'}}>
                                    {sideCost > 0 ? `${Math.round(sideCost).toLocaleString()}원` : '—'}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* 사용자 설정 면별 자재코드 */}
                        {(['top','bottom','left','right'] as const).map((side,i)=>{
                          const tv = (form.edgeCustomSides[side] ?? 0) as 1|2;
                          if (!tv) return null;
                          const sideCode = absWidth ? ABS_CODE[absWidth]?.[tv] : undefined;
                          if (!sideCode) return null;
                          const lbl = ['상','하','좌','우'][i];
                          return (
                            <div key={side} style={{fontSize:'10px',color:'#969696',fontFamily:'monospace',marginBottom:'1px'}}>
                              {lbl} · {sideCode}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 색상 + 자재코드 — WW 고정 */}
                    {form.edgePreset !== 'custom' && (
                      <div>
                        <div style={{fontSize:'11px',color:'#555',marginBottom:'3px'}}>색상</div>
                        <div style={{
                          height:'30px',display:'flex',alignItems:'center',padding:'0 8px',
                          background:'#f4f4f4',border:'0.5px solid #e0e0e0',
                          fontSize:'12px',color:'#888',userSelect:'none',
                        }}>WW</div>
                        {repCode && (
                          <div style={{fontSize:'10px',color:'#969696',marginTop:'3px',fontFamily:'monospace'}}>{repCode}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 도장: 6가지 방식 토글 */}
              {form.edgePreset==='paint' && (
                <div style={{marginBottom:'8px'}}>
                  {PAINT_OPTIONS.map(({key,rate})=>{
                    const isOn = form.edge45PaintType===key;
                    return (
                      <div key={key} onClick={()=>setForm(f=>({...f,edge45PaintType:key}))}
                        style={{
                          display:'flex',justifyContent:'space-between',alignItems:'center',
                          padding:'7px 10px',marginBottom:'3px',cursor:'pointer',
                          border: isOn?'1.5px solid #1A1A1A':'0.5px solid #e8e8e8',
                          background: isOn?'#1A1A1A':'#fff',
                        }}>
                        <span style={{fontSize:'12px',color:isOn?'#fff':'#1a1a1a'}}>{key}</span>
                        <span style={{fontSize:'11px',color:isOn?'rgba(255,255,255,0.65)':'#969696'}}>{rate.toLocaleString()}원</span>
                      </div>
                    );
                  })}
                  {/* 색상 — WW 고정 */}
                  <div style={{marginTop:'6px'}}>
                    <div style={{fontSize:'11px',color:'#555',marginBottom:'3px'}}>색상</div>
                    <div style={{
                      height:'30px',display:'flex',alignItems:'center',padding:'0 8px',
                      background:'#f4f4f4',border:'0.5px solid #e0e0e0',
                      fontSize:'12px',color:'#888',userSelect:'none',
                    }}>WW</div>
                  </div>
                </div>
              )}

              {/* 45도: mm 입력 */}
              {form.edgePreset==='edge45' && (
                <div style={{marginBottom:'8px'}}>
                  <div style={{fontSize:'11px',color:'#555',marginBottom:'3px'}}>길이 (mm)</div>
                  <div style={{display:'flex',alignItems:'center',gap:'3px',border:'0.5px solid #e0e0e0',height:'30px',padding:'0 8px',background:'#fff',width:'120px'}}>
                    <input type="number" value={Math.round(form.edge45TapingM*1000)||0}
                      onChange={e=>setForm(f=>({...f,edge45TapingM:(Number(e.target.value)||0)/1000}))}
                      style={{border:'none',outline:'none',fontSize:'12px',width:'60px',background:'transparent',textAlign:'right',color:'#1a1a1a'}} />
                    <span style={{fontSize:'10px',color:'#888'}}>mm</span>
                  </div>
                </div>
              )}

              {/* 곱면: 머시닝 + 수동곱면 */}
              {form.edgePreset==='curved' && (
                <div style={{marginBottom:'8px',display:'flex',gap:'10px'}}>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',alignItems:'center',fontSize:'11px',color:'#555',marginBottom:'3px'}}>
                      머시닝<IIcon tip="머시닝 곱면. m당 3,000원" />
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:'3px',border:'0.5px solid #e0e0e0',height:'30px',padding:'0 8px',background:'#fff'}}>
                      <input type="number" value={Math.round(form.curvedEdgeM*1000)||0}
                        onChange={e=>setForm(f=>({...f,curvedEdgeM:(Number(e.target.value)||0)/1000,curvedEdgeType:'machining'}))}
                        style={{border:'none',outline:'none',fontSize:'12px',flex:1,background:'transparent',textAlign:'right',color:'#1a1a1a'}} />
                      <span style={{fontSize:'10px',color:'#888'}}>mm</span>
                    </div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',alignItems:'center',fontSize:'11px',color:'#555',marginBottom:'3px'}}>
                      수동곱면<IIcon tip="수동 곱면 작업. m당 2,000원" />
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:'3px',border:'0.5px solid #e0e0e0',height:'30px',padding:'0 8px',background:'#fff'}}>
                      <input type="number" value={form.curvedManualMm||0}
                        onChange={e=>setForm(f=>({...f,curvedManualMm:Number(e.target.value)||0}))}
                        style={{border:'none',outline:'none',fontSize:'12px',flex:1,background:'transparent',textAlign:'right',color:'#1a1a1a'}} />
                      <span style={{fontSize:'10px',color:'#888'}}>mm</span>
                    </div>
                  </div>
                </div>
              )}

              </section>

              {/* ── 섹션: 가공 ── */}
              <section style={{padding:'20px 24px',borderBottom:'1px solid #F0F0F0'}}>
                <div style={{fontSize:'11px',fontWeight:500,color:'#7E7E7E',letterSpacing:'0.05em',textTransform:'uppercase',marginBottom:'12px'}}>가공</div>

              {/* 공통 가공 행 컴포넌트 스타일 */}
              {(()=>{
                const rowStyle: React.CSSProperties = {display:'flex',alignItems:'center',gap:'8px',padding:'6px 0',borderBottom:'0.5px solid #e8e8e8'};
                const labelStyle: React.CSSProperties = {display:'flex',alignItems:'center',fontSize:'12px',color:'#1a1a1a',flex:1,minWidth:0};
                const costStyle = (v: number): React.CSSProperties => ({fontSize:'12px',fontWeight:500,minWidth:'48px',textAlign:'right',color:v?'#1a1a1a':'#B0B0B0',flexShrink:0});
                const numBox = {display:'flex',alignItems:'center',gap:'3px',border:'0.5px solid #e0e0e0',height:'26px',padding:'0 6px',background:'#fff',flexShrink:0 as const};
                const numInput: React.CSSProperties = {border:'none',outline:'none',fontSize:'12px',width:'40px',background:'transparent',textAlign:'right',color:'#1a1a1a'};

                return (
                  <>
                    {/* 일반 보링 */}
                    <div style={rowStyle}>
                      <div style={labelStyle}>일반 보링<IIcon tip="일반 돌입맞주기. 개당 100원" /></div>
                      <div style={numBox}>
                        <input type="number" value={form.boring1Ea||0}
                          onChange={e=>setForm(f=>({...f,boring1Ea:Number(e.target.value)||0}))}
                          style={numInput} />
                        <span style={{fontSize:'10px',color:'#888'}}>개</span>
                      </div>
                      <span style={costStyle(computed?.boring1CostWon??0)}>{fmtWon(computed?.boring1CostWon??0)}</span>
                    </div>

                    {/* 2차 보링 */}
                    <div style={rowStyle}>
                      <div style={labelStyle}>2차 보링<IIcon tip="2단 돌입. 개당 50원" /></div>
                      <div style={numBox}>
                        <input type="number" value={form.boring2Ea||0}
                          onChange={e=>setForm(f=>({...f,boring2Ea:Number(e.target.value)||0}))}
                          style={numInput} />
                        <span style={{fontSize:'10px',color:'#888'}}>개</span>
                      </div>
                      <span style={costStyle(computed?.boring2CostWon??0)}>{fmtWon(computed?.boring2CostWon??0)}</span>
                    </div>

                    {/* 철물 조립 */}
                    <div style={rowStyle}>
                      <div style={labelStyle}>철물 조립<IIcon tip="자재에 조립되어 출고되는 철물의 수. 케이싱, 케이싱 스크류 등. 조립비 개당 35원" /></div>
                      <div style={numBox}>
                        <input type="number" value={form.assemblyHours||0}
                          onChange={e=>setForm(f=>({...f,assemblyHours:Number(e.target.value)||0}))}
                          style={numInput} />
                        <span style={{fontSize:'10px',color:'#888'}}>개</span>
                      </div>
                      <span style={costStyle(computed?.assemblyCostWon??0)}>{fmtWon(computed?.assemblyCostWon??0)}</span>
                    </div>

                    {/* 45도 엣지 선택 시 자동 추가: 테이핑 (읽기 전용) */}
                    {form.edgePreset==='edge45' && (
                      <div style={rowStyle}>
                        <div style={labelStyle}>테이핑<IIcon tip="45도 엣지 테이핑. m당 500원" /></div>
                        <span style={{fontSize:'10px',color:'#969696',flexShrink:0}}>45도 엣지</span>
                        <span style={costStyle(computed?.edge45TapingCostWon??0)}>{fmtWon(computed?.edge45TapingCostWon??0)}</span>
                      </div>
                    )}

                    {/* 추가된 가공 항목 */}
                    {addedProcs.map(key=>{
                      const opt = PROC_OPTIONS.find(o=>o.key===key);
                      if (!opt) return null;
                      const costVal =
                        key==='forming'  ? (computed?.formingCostWon??0)
                        : key==='ruta'   ? (computed?.rutaCostWon??0)
                        : key==='ruta2'  ? (computed?.ruta2CostWon??0)
                        : key==='tenoner'? (computed?.tenonerCostWon??0)
                        : 0;
                      const mmVal =
                        key==='forming'  ? Math.round(form.formingM*1000)
                        : key==='ruta'   ? Math.round(form.rutaM*1000)
                        : key==='ruta2'  ? Math.round(form.ruta2M*1000)
                        : key==='tenoner'? (form.tenonerMm??0)
                        : 0;
                      const onChange = (v: number) => setForm(f=>{
                        if(key==='forming')  return {...f,formingM:v/1000};
                        if(key==='ruta')     return {...f,rutaM:v/1000};
                        if(key==='ruta2')    return {...f,ruta2M:v/1000};
                        if(key==='tenoner')  return {...f,tenonerMm:v};
                        return f;
                      });
                      return (
                        <div key={key} style={rowStyle}>
                          <div style={labelStyle}>{opt.label}<IIcon tip={opt.tip} /></div>
                          <div style={numBox}>
                            <input type="number" value={mmVal||0} onChange={e=>onChange(Number(e.target.value)||0)}
                              style={numInput} />
                            <span style={{fontSize:'10px',color:'#888'}}>{opt.unit}</span>
                          </div>
                          <span style={costStyle(costVal)}>{fmtWon(costVal)}</span>
                          {/* X 버튼 */}
                          <button type="button" onClick={()=>setAddedProcs(p=>p.filter(k=>k!==key))}
                            style={{border:'none',background:'none',cursor:'pointer',color:'#bbb',fontSize:'14px',lineHeight:1,padding:'0 2px',flexShrink:0}}>×</button>
                        </div>
                      );
                    })}

                    {/* + 가공 추가하기 드롭다운 */}
                    <div style={{position:'relative',marginTop:'8px'}}>
                      <button type="button" onClick={()=>setShowProcDropdown(p=>!p)}
                        style={{height:'28px',width:'100%',fontSize:'11px',border:'0.5px dashed #d0d0d0',background:'transparent',cursor:'pointer',color:'#999'}}>
                        + 가공 추가하기
                      </button>
                      {showProcDropdown && (
                        <div ref={procDropdownRef} tabIndex={-1}
                          style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:'0.5px solid #e0e0e0',boxShadow:'0 4px 12px rgba(0,0,0,0.08)',zIndex:20,marginTop:'2px',outline:'none'}}>
                          {PROC_OPTIONS.filter(opt=>!addedProcs.includes(opt.key)).map(opt=>(
                            <div key={opt.key}
                              onClick={()=>{setAddedProcs(p=>[...p,opt.key]);setShowProcDropdown(false);}}
                              style={{padding:'9px 12px',fontSize:'12px',color:'#1a1a1a',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}
                              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#f8f8f8';}}
                              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='';}}
                            >
                              <span>{opt.label}</span>
                              <span style={{fontSize:'10px',color:'#aaa'}}>{opt.tip}</span>
                            </div>
                          ))}
                          {PROC_OPTIONS.every(opt=>addedProcs.includes(opt.key)) && (
                            <div style={{padding:'9px 12px',fontSize:'12px',color:'#bbb'}}>추가 가능한 항목 없음</div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
              </section>

              </div>{/* /maxWidth wrapper */}
            </div>
          </div>

          {/* ── Right column: receipt (토스 영수증 스타일 + 데스커 컬러) ── */}
          <div
            className="editor-right"
            style={{ fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1", letterSpacing: "-0.01em" }}
          >
            {/* 자재명 */}
            <div style={{fontSize:'13px',color:'#7E7E7E',marginBottom:'4px'}}>{form.name||'이름 없음'}</div>
            {/* 합계 큰 숫자 */}
            <div style={{fontSize:'26px',fontWeight:700,letterSpacing:'-0.02em',color:'#282828',marginBottom:'18px'}}>
              {computed ? fmtWon(form.hMm>0 ? computed.grandTotalWon : computed.processingTotalWon) : '—'}
            </div>

            {/* ── 원재료비 ── */}
            {(()=>{
              const matCost  = computed?.materialCostWon ?? 0;
              const edgeCost = computed?.edgeCostWon ?? 0;
              const hmCost   = computed?.hotmeltCostWon ?? 0;
              const isAbs    = form.edgePreset==='abs1t'||form.edgePreset==='abs2t'||form.edgePreset==='custom';
              const matTotal = matCost + edgeCost + hmCost;
              const rcRow = (label: string, sub: string|null, cost: number) => (
                <div style={{display:'flex',justifyContent:'space-between',padding:'2px 0',fontSize:'11px',color:'#1a1a1a'}}>
                  <div>
                    <div>{label}</div>
                    {sub && <div style={{fontSize:'10px',color:'#969696',marginTop:'1px'}}>{sub}</div>}
                  </div>
                  <div style={{fontWeight:500,color:cost?'#1a1a1a':'#B0B0B0',flexShrink:0,marginLeft:'8px'}}>{fmtWon(cost)}</div>
                </div>
              );
              return (
                <>
                  <div style={{fontSize:'10px',fontWeight:600,color:'#888',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:'5px'}}>원재료비</div>
                  {rcRow('목재 원재료비', `${form.wMm}×${form.dMm}×${form.hMm}T · ${form.boardMaterial}`, matCost)}
                  {(form.edgePreset==='abs1t'||form.edgePreset==='abs2t') && rcRow(
                    '엣지 원재료비',
                    `ABS ${form.edgePreset==='abs2t'?'2T':'1T'} WW · ${(computed?.edgeLengthM??0).toFixed(2)}m`,
                    edgeCost,
                  )}
                  {form.edgePreset==='custom' && rcRow(
                    '엣지 원재료비',
                    `ABS 사용자설정 WW · ${(computed?.edgeLengthM??0).toFixed(2)}m`,
                    edgeCost,
                  )}
                  {form.edgePreset==='paint' && rcRow('엣지 원재료비', `도장엣지 WW · ${(computed?.edgeLengthM??0).toFixed(2)}m`, edgeCost)}
                  {isAbs && rcRow('핫멜트', `${(computed?.edgeLengthM??0).toFixed(2)}m × ${form.hMm}T`, hmCost)}
                  <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 0',marginTop:'6px',borderTop:'1px solid #F0F0F0',fontSize:'13px',fontWeight:700,color:'#282828'}}>
                    <span>원재료비 합계</span><span>{fmtWon(matTotal)}</span>
                  </div>
                </>
              );
            })()}

            <div style={{height:'0.5px',background:'#EBEBEB',margin:'7px 0'}} />

            {/* ── 가공비 ── */}
            {(()=>{
              const rcRow = (label: string, sub: string|null, cost: number) => cost > 0 ? (
                <div style={{display:'flex',justifyContent:'space-between',padding:'2px 0',fontSize:'11px',color:'#1a1a1a'}}>
                  <div>
                    <div>{label}</div>
                    {sub && <div style={{fontSize:'10px',color:'#969696',marginTop:'1px'}}>{sub}</div>}
                  </div>
                  <div style={{fontWeight:500,flexShrink:0,marginLeft:'8px'}}>{fmtWon(cost)}</div>
                </div>
              ) : null;

              const cutCost   = computed?.cuttingCostWon ?? 0;
              const bor1Cost  = computed?.boring1CostWon ?? 0;
              const bor2Cost  = computed?.boring2CostWon ?? 0;
              const asmCost   = computed?.assemblyCostWon ?? 0;
              const frmCost   = computed?.formingCostWon ?? 0;
              const rutaCost  = computed?.rutaCostWon ?? 0;
              const ruta2Cost = computed?.ruta2CostWon ?? 0;
              const tenCost   = computed?.tenonerCostWon ?? 0;
              const tapCost   = computed?.edge45TapingCostWon ?? 0;
              const paintCost = computed?.edge45PaintCostWon ?? 0;
              const curvCost  = computed?.curvedCostWon ?? 0;

              return (
                <>
                  <div style={{fontSize:'10px',fontWeight:600,color:'#888',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:'5px'}}>가공비</div>
                  {cutCost > 0 && rcRow('재단', `${computed?.cuttingPlacementCount??0}개`, cutCost)}
                  {bor1Cost > 0 && rcRow('일반 보링', `${form.boring1Ea}개 × 100원`, bor1Cost)}
                  {bor2Cost > 0 && rcRow('2차 보링', `${form.boring2Ea}개 × 50원`, bor2Cost)}
                  {asmCost  > 0 && rcRow('철물 조립', `${form.assemblyHours}개 × 35원`, asmCost)}
                  {addedProcs.includes('forming')  && rcRow('포밍', `${Math.round(form.formingM*1000)}mm`, frmCost)}
                  {addedProcs.includes('ruta')     && rcRow('일반 루타', `${Math.round(form.rutaM*1000)}mm`, rutaCost)}
                  {addedProcs.includes('ruta2')    && rcRow('2차 루타', `${Math.round(form.ruta2M*1000)}mm`, ruta2Cost)}
                  {addedProcs.includes('tenoner')  && rcRow('테노너', `${form.tenonerMm??0}mm`, tenCost)}
                  {form.edgePreset==='edge45'      && rcRow('테이핑', '45도 엣지', tapCost)}
                  {form.edgePreset==='paint'       && rcRow('도장 엣지', form.edge45PaintType||'—', paintCost)}
                  {form.edgePreset==='curved'      && rcRow('곱면 엣지', `머시닝 ${Math.round(form.curvedEdgeM*1000)}mm · 수동 ${form.curvedManualMm??0}mm`, curvCost)}
                  <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 0',marginTop:'6px',borderTop:'1px solid #F0F0F0',fontSize:'13px',fontWeight:700,color:'#282828'}}>
                    <span>가공비 합계</span><span>{fmtWon(computed?.processingTotalWon??0)}</span>
                  </div>
                </>
              );
            })()}

            {/* 최종 합계 — 데스커 블랙 2px 라인으로 강조 */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'14px 0 0',marginTop:'10px',borderTop:'2px solid #282828'}}>
              <div style={{fontSize:'14px',fontWeight:600,color:'#282828'}}>합계</div>
              <div style={{fontSize:'18px',fontWeight:700,letterSpacing:'-0.02em',color:'#282828'}}>
                {computed ? fmtWon(form.hMm>0 ? computed.grandTotalWon : computed.processingTotalWon) : '—'}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── 원장 배치 선택 팝업 ── */}
      {showBoardPopup && (()=>{
        const EPS = 0.01;
        const COL = '80px repeat(3,1fr)';
        const GAP = '6px';
        const PAD = '0 16px';

        /** 커스텀 가격/코드 저장 헬퍼 */
        const saveCustomCode = (sheetId: string, code: string) => {
          const next = { ...popupCustomCodes, [sheetId]: code };
          setPopupCustomCodes(next);
          try { localStorage.setItem(`groot-sheet-codes-${editingIdRef.current ?? '_new'}`, JSON.stringify(next)); } catch {}
        };
        const clearCustomCode = (sheetId: string) => {
          const next = { ...popupCustomCodes };
          delete next[sheetId];
          setPopupCustomCodes(next);
          try { localStorage.setItem(`groot-sheet-codes-${editingIdRef.current ?? '_new'}`, JSON.stringify(next)); } catch {}
        };

        return (
          <>
            <div style={{position:'fixed',inset:0,zIndex:998,background:'rgba(0,0,0,0.45)'}} onClick={()=>setShowBoardPopup(false)} aria-hidden />
            <div style={{
              position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
              zIndex:999,background:'#fff',width:'95%',maxWidth:'860px',
              maxHeight:'86vh',display:'flex',flexDirection:'column',
              border:'0.5px solid #e0e0e0',boxShadow:'0 8px 32px rgba(0,0,0,0.18)',
            }}>
              {/* 타이틀 */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 16px',borderBottom:'0.5px solid #e0e0e0',flexShrink:0}}>
                <div style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                  <span style={{fontSize:'13px',fontWeight:600,color:'#1a1a1a'}}>원장 배치 선택</span>
                  {(form.wMm > 0 || form.dMm > 0) && (
                    <span style={{fontSize:'11px',color:'#888'}}>
                      {form.name?.trim() || '이름 없음'} · {form.wMm}×{form.dMm}×{form.hMm}T
                    </span>
                  )}
                </div>
                <button type="button" onClick={()=>setShowBoardPopup(false)} style={{fontSize:'20px',cursor:'pointer',background:'none',border:'none',color:'#aaa',lineHeight:1,padding:'0 2px'}}>×</button>
              </div>

              {/* ── 열 헤더 (고정) ── */}
              <div style={{
                display:'grid',gridTemplateColumns:COL,columnGap:GAP,
                padding:PAD,paddingTop:'10px',paddingBottom:'10px',
                borderBottom:'0.5px solid #e0e0e0',flexShrink:0,background:'#fff',
              }}>
                {/* 빈 라벨 셀 */}
                <div />
                {/* 원장별 헤더 셀 */}
                {SHEET_SPECS.map((s, si) => {
                  const erpEntry = SHEET_ERP[s.id]?.[form.hMm];
                  const currentPrice = form.sheetPrices[s.id] ?? erpEntry?.price ?? 0;
                  const currentCode  = popupCustomCodes[s.id] ?? erpEntry?.code ?? '—';
                  const priceCustom  = erpEntry !== undefined && form.sheetPrices[s.id] !== undefined && form.sheetPrices[s.id] !== erpEntry.price;
                  const codeCustom   = popupCustomCodes[s.id] !== undefined && popupCustomCodes[s.id] !== (erpEntry?.code ?? '');
                  const isCustom     = priceCustom || codeCustom;
                  const isEditing    = popupEditSI === si;

                  return (
                    <div key={s.id} style={{
                      position:'relative',padding:'8px 10px 8px 10px',
                      background: isCustom ? '#FFF8F7' : '#f8f8f8',
                      border: isCustom ? '0.5px solid #FFCCC8' : '0.5px solid #e0e0e0',
                      textAlign:'center',
                    }}>
                      {/* 원장 크기 */}
                      <div style={{fontSize:'13px',fontWeight:500,color:'#1a1a1a',marginBottom:'4px'}}>{s.label}</div>

                      {/* 표시 모드 */}
                      {!isEditing && (
                        <>
                          <div style={{fontSize:'11px',color: isCustom?'#FF5948':'#969696',fontWeight: isCustom?500:400}}>
                            {currentPrice.toLocaleString()}원
                          </div>
                          <div style={{fontSize:'10px',color:'#969696',fontFamily:'monospace',marginTop:'2px',letterSpacing:'0.03em'}}>
                            {currentCode}
                          </div>
                          {isCustom && (
                            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'3px',marginTop:'4px'}}>
                              <span style={{width:'5px',height:'5px',borderRadius:'50%',background:'#FF5948',flexShrink:0}} />
                              <span style={{fontSize:'9px',color:'#FF5948',fontWeight:500}}>수정됨</span>
                            </div>
                          )}
                          {isCustom && (
                            <button type="button" onClick={()=>{
                              if (erpEntry !== undefined) {
                                setForm(f=>({...f,sheetPrices:{...f.sheetPrices,[s.id]:erpEntry.price}}));
                              } else {
                                setForm(f=>{ const p={...f.sheetPrices}; delete p[s.id]; return {...f,sheetPrices:p}; });
                              }
                              clearCustomCode(s.id);
                            }} style={{fontSize:'10px',color:'#FF5948',background:'none',border:'none',cursor:'pointer',marginTop:'3px',padding:'0',display:'block',width:'100%'}}>
                              기본값으로
                            </button>
                          )}
                        </>
                      )}

                      {/* 편집 모드 */}
                      {isEditing && (
                        <div style={{display:'flex',flexDirection:'column',gap:'4px',marginTop:'2px'}}>
                          <input type="number" value={popupEditPrice}
                            onChange={e=>setPopupEditPrice(e.target.value)}
                            placeholder="단가"
                            style={{height:'24px',fontSize:'11px',border:'0.5px solid #ccc',padding:'0 6px',width:'100%',boxSizing:'border-box',outline:'none',textAlign:'right'}}
                            onFocus={e=>{e.currentTarget.style.borderColor='var(--color-border-primary,#1a1a1a)';}}
                            onBlur={e=>{e.currentTarget.style.borderColor='#ccc';}}
                          />
                          <input type="text" value={popupEditCode}
                            onChange={e=>setPopupEditCode(e.target.value)}
                            placeholder="자재코드"
                            style={{height:'24px',fontSize:'10px',fontFamily:'monospace',border:'0.5px solid #ccc',padding:'0 6px',width:'100%',boxSizing:'border-box',outline:'none'}}
                            onFocus={e=>{e.currentTarget.style.borderColor='var(--color-border-primary,#1a1a1a)';}}
                            onBlur={e=>{e.currentTarget.style.borderColor='#ccc';}}
                          />
                          <div style={{display:'flex',gap:'4px',justifyContent:'center'}}>
                            <button type="button" onClick={()=>setPopupEditSI(null)}
                              style={{height:'22px',padding:'0 8px',fontSize:'10px',cursor:'pointer',border:'0.5px solid #e0e0e0',background:'transparent',color:'#555'}}>취소</button>
                            <button type="button" onClick={()=>{
                              const newPrice = parseInt(popupEditPrice) || 0;
                              setForm(f=>({...f,sheetPrices:{...f.sheetPrices,[s.id]:newPrice}}));
                              saveCustomCode(s.id, popupEditCode.trim());
                              setPopupEditSI(null);
                            }} style={{height:'22px',padding:'0 8px',fontSize:'10px',cursor:'pointer',border:'none',background:'#1A1A1A',color:'#fff',fontWeight:500}}>저장</button>
                          </div>
                        </div>
                      )}

                      {/* 연필 아이콘 (상시) */}
                      <button type="button" title="직접 입력"
                        onClick={()=>{
                          if (isEditing) { setPopupEditSI(null); }
                          else { setPopupEditSI(si); setPopupEditPrice(String(currentPrice)); setPopupEditCode(currentCode==='—'?'':currentCode); }
                        }}
                        style={{
                          position:'absolute',top:'8px',right:'8px',
                          width:'20px',height:'20px',borderRadius:'50%',
                          border:'none',cursor:'pointer',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:'12px',lineHeight:1,
                          background: isEditing ? 'var(--color-border-tertiary,#e8e8e8)' : 'transparent',
                          color: isEditing ? 'var(--color-text-primary,#1a1a1a)' : 'var(--color-text-tertiary,#aaa)',
                          transition:'background 0.1s',
                        }}
                        onMouseEnter={e=>{if(!isEditing)(e.currentTarget as HTMLElement).style.background='var(--color-border-tertiary,#e8e8e8)';}}
                        onMouseLeave={e=>{if(!isEditing)(e.currentTarget as HTMLElement).style.background='transparent';}}
                      >✎</button>
                    </div>
                  );
                })}
              </div>

              {/* ── 스크롤 바디 ── */}
              <div style={{overflowY:'auto',flex:1,padding:'10px 16px 14px'}}>
                <div style={{display:'grid',gridTemplateColumns:COL,columnGap:GAP,rowGap:'8px'}}>
                  {popupAllData.flatMap((rowCells, ri) => {
                    const rowLabel = ri===0?'정방향':ri===1?'90°\n회전':'혼합\n배치';
                    const cells = rowCells.map(cell => {
                      const isMaxYield = cell.count>0 && cell.yieldPct>=popupMaxYield-EPS;
                      const isMinPrice = cell.count>0 && cell.unitPrice<=popupMinPrice+EPS;
                      const isHighlighted = isMaxYield || isMinPrice;
                      const opacity = cell.count===0 ? 0.15 : isHighlighted ? 1 : 0.38;
                      const isSel = ri===popupSelRI && cell.si===popupSelSI;
                      return (
                        <div key={`${ri}-${cell.si}`}
                          onClick={()=>{if(cell.count>0){setPopupSelRI(ri);setPopupSelSI(cell.si);}}}
                          style={{
                            display:'flex',alignItems:'flex-start',gap:'8px',
                            padding:'8px 9px',position:'relative',
                            border:'1px solid #e8e8e8',
                            borderTop: isSel ? '2px solid #1A1A1A' : '1px solid #e8e8e8',
                            background:'#fff',
                            cursor: cell.count>0?'pointer':'default',
                            opacity,
                          }}>
                          {/* SVG */}
                          <div style={{flexShrink:0}}>
                            <SheetSVG sheetW={cell.sheetW} sheetH={cell.sheetH} wMm={form.wMm} dMm={form.dMm} mode={cell.mode} />
                          </div>
                          {/* 정보 */}
                          <div style={{flex:1,minWidth:0,paddingTop:'2px'}}>
                            <div style={{display:'flex',gap:'3px',marginBottom:'4px',minHeight:'14px',flexWrap:'wrap'}}>
                              {isMaxYield && <span style={{fontSize:'9px',padding:'1px 5px',fontWeight:600,background:'#FF5948',color:'#fff'}}>추천</span>}
                              {isMinPrice && <span style={{fontSize:'9px',padding:'1px 5px',fontWeight:600,background:'#3DB97A',color:'#fff'}}>최저가</span>}
                            </div>
                            <div style={{fontSize:'11px',fontWeight:600,color:'#1a1a1a',marginBottom:'2px'}}>{cell.sheetLabel}</div>
                            <div style={{fontSize:'12px',fontWeight:700,color:'#1a1a1a',marginBottom:'1px'}}>
                              {cell.count>0?`${cell.count} EA`:'배치 불가'}
                            </div>
                            <div style={{fontSize:'11px',color: isMaxYield?'#FF5948':'#888',fontWeight: isMaxYield?600:400,marginBottom:'2px'}}>
                              {cell.count>0?`수율 ${cell.yieldPct.toFixed(1)}%`:''}
                            </div>
                            {cell.count>0 && (
                              <div style={{fontSize:'11px',color:'#555'}}>
                                장당 {cell.unitPrice.toLocaleString()}원
                              </div>
                            )}
                          </div>
                          {/* 선택 체크 원 (흰 배경, 검은 체크) */}
                          {isSel && (
                            <div style={{position:'absolute',top:'6px',right:'6px',width:'16px',height:'16px',borderRadius:'50%',background:'#fff',border:'1.5px solid #1A1A1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                <polyline points="1,4 3,6.5 7,1.5" stroke="#1A1A1A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    });
                    return [
                      <div key={`lbl-${ri}`} style={{display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:'10px',fontWeight:500,color:'#969696',whiteSpace:'pre-line',padding:'4px 2px'}}>
                        {rowLabel}
                      </div>,
                      ...cells,
                    ];
                  })}
                </div>
              </div>

              {/* 푸터 */}
              <div style={{padding:'10px 14px',borderTop:'0.5px solid #e0e0e0',display:'flex',justifyContent:'flex-end',gap:'6px',flexShrink:0}}>
                <button type="button" onClick={()=>setShowBoardPopup(false)} style={{height:'32px',padding:'0 14px',fontSize:'12px',cursor:'pointer',border:'0.5px solid #e0e0e0',background:'transparent',color:'#555'}}>취소</button>
                <button type="button" onClick={saveBoardSel} style={{height:'32px',padding:'0 14px',fontSize:'12px',cursor:'pointer',border:'none',background:'#1A1A1A',color:'#fff',fontWeight:500}}>선택 저장</button>
              </div>
            </div>
          </>
        );
      })()}

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

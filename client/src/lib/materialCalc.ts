import {
  SHEET_SPECS,
  type PlacementMode,
  type SheetId,
  piecesPerSheet,
  yieldPercent,
  costPerPiece,
  layoutLabelForPlacement,
  placementLayoutGrid,
} from "./yield";

/** 배치 탭(기본|90°|혼합) + 90° 탭에서 선택한 절단 방향 → yield용 방향 */
export function effectiveYieldPlacementMode(
  tab: PlacementMode,
  cutOrientation: "default" | "rotated"
): PlacementMode {
  if (tab === "mixed") return "mixed";
  if (tab === "rotated") return cutOrientation;
  return "default";
}
import { cuttingFeeFromPlacementCount, hotmeltPricePerM2 } from "./pricing";

export type MaterialEdgePreset = "none" | "abs1t" | "abs2t" | "paint" | "custom" | "edge45" | "curved";
export type EdgeCustomSides = { top: number; bottom: number; left: number; right: number };
export type EdgeSelection = { top: boolean; bottom: boolean; left: boolean; right: boolean };

/** 엣지 도장(면 단위) 기본 단가 — m당 원 */
export const PAINT_EDGE_WON_PER_M = 3500;

/** 테노너 — m당 원 (입력 mm → m 환산 후 적용) */
export const TENONER_WON_PER_M = 800;

export const DEFAULT_EDGE_SIDES: EdgeSelection = { top: true, bottom: true, left: true, right: true };

export function formatEdgeSidesKo(s: EdgeSelection): string {
  const parts: string[] = [];
  if (s.top) parts.push("상");
  if (s.bottom) parts.push("하");
  if (s.left) parts.push("좌");
  if (s.right) parts.push("우");
  return parts.length ? parts.join("·") : "없음";
}

/** 보드 두께(T) → ABS 엣지 폭(mm) 매핑 */
export const THICK_TO_ABS_WIDTH: Partial<Record<number, number>> = {
  9: 16, 12: 16, 15: 19, 18: 21, 22: 26, 25: 33, 28: 33,
};

/**
 * ABS 평엣지 WW 단가표 (원/m) — 폭(mm) × T값
 * null: 해당 폭에서 2T 없음
 */
export const ABS_PRICE: Record<number, { 1: number; 2: number | null }> = {
  16: { 1: 139, 2: null },
  19: { 1: 166, 2: 251  },
  21: { 1: 184, 2: 271  },
  26: { 1: 224, 2: 338  },
  33: { 1: 280, 2: 439  },
};

/** ABS 평엣지 WW 자재코드 — 폭(mm) × T값 */
export const ABS_CODE: Record<number, Partial<Record<1 | 2, string>>> = {
  16: { 1: 'W21-3E-3400A' },
  19: { 1: 'W21-3E-3399A', 2: 'W21-3E-3174'  },
  21: { 1: 'W21-3E-3401A', 2: 'W21-3E-3168'  },
  26: { 1: 'W21-3E-3398B', 2: 'W21-3E-3398C' },
  33: { 1: 'W21-3E-3402',  2: 'W21-3E-3152'  },
};

/** 보드 두께로 ABS 엣지 폭 결정 */
export function getAbsWidth(hMm: number): number | undefined {
  return THICK_TO_ABS_WIDTH[hMm];
}

/** 해당 보드 두께에서 2T ABS 사용 가능 여부 */
export function hasAbs2T(hMm: number): boolean {
  const w = THICK_TO_ABS_WIDTH[hMm];
  return w !== undefined && ABS_PRICE[w]?.['2'] !== null;
}

/** 도장엣지 WW — DB 단가 (원/m) */
const PAINT_EDGE_MATERIAL_WON_PER_M = 2500;

export const EDGE45_PAINT_RATES: Record<string, number> = {
  "직각+코팅": 2500,
  "직각+테이핑": 3500,
  "코팅+스프레이": 3750,
  "줄눈도장(메지)": 4500,
  "테이퍼": 12000,
  "테이퍼+테이핑": 13000,
};

export function edgeLengthMm(wMm: number, dMm: number, e: EdgeSelection): number {
  let mm = 0;
  if (e.top) mm += wMm;
  if (e.bottom) mm += wMm;
  if (e.left) mm += dMm;
  if (e.right) mm += dMm;
  return mm;
}

export function perimeterMm(wMm: number, dMm: number): number {
  return (wMm + dMm) * 2;
}

function edgeLabelFromPreset(preset: MaterialEdgePreset): string {
  if (preset === "abs1t") return "4면 ABS 1T";
  if (preset === "abs2t") return "4면 ABS 2T";
  if (preset === "paint") return "4면 엣지 도장";
  if (preset === "custom") return "사용자 설정";
  return "";
}

export function legacyEdgePresetFromKey(edgeProfileKey?: string): MaterialEdgePreset {
  const k = edgeProfileKey?.trim() ?? "";
  if (!k) return "none";
  if (k === "4면 ABS 2T") return "abs2t";
  return "abs1t";
}

const DEFAULT_CUSTOM_SIDES: EdgeCustomSides = { top: 0, bottom: 0, left: 0, right: 0 };

export interface MaterialInput {
  wMm: number;
  dMm: number;
  hMm: number;
  color: string;
  boardMaterial: string;
  placementMode: PlacementMode;
  edgePreset: MaterialEdgePreset;
  edgeColor: string;
  edgeCustomSides: EdgeCustomSides;
  /** 엣지 적용 면 (ABS/엣지 도장 시 길이 산출) */
  edgeSides: EdgeSelection;
  sheetPrices: Partial<Record<SheetId, number>>;
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
  /** 곱면 수동 가공 길이 (mm) — curved 엣지 선택 시 머시닝과 별도 입력 */
  curvedManualMm: number;
  unitFormingPerM: number;
  unitAssemblyPerH: number;
  unitWashPerM2: number;
}

export function buildMaterialInput(f: {
  wMm: number; dMm: number; hMm: number; color: string; boardMaterial: string;
  placementMode: PlacementMode; edgePreset?: MaterialEdgePreset; edgeProfileKey?: string;
  edgeColor?: string; edgeCustomSides?: EdgeCustomSides; edgeSides?: EdgeSelection;
  sheetPrices: Partial<Record<SheetId, number>>;
  formingM: number; rutaM: number; assemblyHours: number; washM2: number;
  boringEa?: number; boring1Ea?: number; boring2Ea?: number; curvedEdgeM: number;
  curvedEdgeType?: "machining" | "manual" | ""; edge45M?: number; edge45TapingM?: number;
  edge45PaintType?: string; edge45PaintM?: number; ruta2M?: number;
  tenonerMm?: number;
  unitFormingPerM?: number; unitRutaPerM?: number; unitAssemblyPerH?: number;
  unitWashPerM2?: number; unitBoringPerEa?: number; unitCurvedPerM?: number; unitEdge45PerM?: number;
}): MaterialInput {
  return {
    wMm: f.wMm, dMm: f.dMm, hMm: f.hMm, color: f.color, boardMaterial: f.boardMaterial,
    placementMode: f.placementMode,
    edgePreset: f.edgePreset ?? legacyEdgePresetFromKey(f.edgeProfileKey),
    edgeColor: f.edgeColor ?? "WW",
    edgeCustomSides: f.edgeCustomSides ?? { ...DEFAULT_CUSTOM_SIDES },
    edgeSides: f.edgeSides ?? { ...DEFAULT_EDGE_SIDES },
    sheetPrices: f.sheetPrices,
    formingM: f.formingM, rutaM: f.rutaM, assemblyHours: f.assemblyHours, washM2: f.washM2,
    boring1Ea: f.boring1Ea ?? f.boringEa ?? 0,
    boring2Ea: f.boring2Ea ?? 0,
    curvedEdgeM: f.curvedEdgeM,
    curvedEdgeType: f.curvedEdgeType ?? "machining",
    edge45TapingM: f.edge45TapingM ?? f.edge45M ?? 0,
    edge45PaintType: f.edge45PaintType ?? "",
    edge45PaintM: f.edge45PaintM ?? 0,
    ruta2M: f.ruta2M ?? 0,
    tenonerMm: f.tenonerMm ?? 0,
    curvedManualMm: (f as unknown as { curvedManualMm?: number }).curvedManualMm ?? 0,
    unitFormingPerM: f.unitFormingPerM ?? 1000,
    unitAssemblyPerH: f.unitAssemblyPerH ?? 35,
    unitWashPerM2: f.unitWashPerM2 ?? 500,
  };
}


export interface SheetYieldRow {
  sheetId: SheetId; label: string; sheetW: number; sheetH: number; pieces: number;
  layoutLabel: string; layoutCols: number; layoutRows: number;
  layoutExtraCols?: number; layoutExtraRows?: number;
  usedAreaMm2: number; yieldPct: number; costPerPiece: number; sheetPriceWon: number;
}

export interface ComputedMaterial {
  sheets: SheetYieldRow[]; recommendedSheetId: SheetId | null; selectedSheetId: SheetId | null;
  resolvedEdgeProfileKey: string; materialCostWon: number; edgeLengthM: number;
  edgeCostWon: number; hotmeltCostWon: number; cuttingSheetCount: number;
  cuttingPlacementCount: number; sheetCount: number; cuttingCostWon: number;
  formingCostWon: number; rutaCostWon: number; ruta2CostWon: number;
  assemblyCostWon: number; washCostWon: number; boring1CostWon: number;
  boring2CostWon: number; boringCostWon: number; curvedCostWon: number;
  edge45TapingCostWon: number; edge45PaintCostWon: number; edge45CostWon: number;
  tenonerCostWon: number;
  processingTotalWon: number; grandTotalWon: number;
}

function bestSheetPrices(input: MaterialInput): { rows: SheetYieldRow[]; bestId: SheetId | null } {
  const rows: SheetYieldRow[] = [];
  let bestId: SheetId | null = null;
  let bestCpu = Infinity;
  for (const spec of SHEET_SPECS) {
    const price = input.sheetPrices[spec.id];
    const pieces = piecesPerSheet(spec.widthMm, spec.heightMm, input.wMm, input.dMm, input.placementMode);
    const sheetPrice = price ?? 0;
    const cpu = pieces <= 0 ? Infinity : sheetPrice > 0 ? costPerPiece(sheetPrice, pieces) : Infinity;
    const y = yieldPercent(pieces, spec.widthMm, spec.heightMm, input.wMm, input.dMm);
    const layoutLabel = layoutLabelForPlacement(spec.widthMm, spec.heightMm, input.wMm, input.dMm, input.placementMode);
    const grid = placementLayoutGrid(spec.widthMm, spec.heightMm, input.wMm, input.dMm, input.placementMode);
    rows.push({
      sheetId: spec.id, label: spec.label, sheetW: spec.widthMm, sheetH: spec.heightMm,
      pieces, layoutLabel, layoutCols: grid.cols, layoutRows: grid.rows,
      layoutExtraCols: grid.extraCols, layoutExtraRows: grid.extraRows,
      usedAreaMm2: pieces * input.wMm * input.dMm, yieldPct: y,
      costPerPiece: pieces > 0 && sheetPrice > 0 ? costPerPiece(sheetPrice, pieces) : 0,
      sheetPriceWon: sheetPrice,
    });
    if (pieces > 0 && cpu < bestCpu) { bestCpu = cpu; bestId = spec.id; }
  }
  return { rows, bestId };
}

export function computeMaterial(input: MaterialInput, selectedSheetId: SheetId | null): ComputedMaterial {
  const isAbs1T  = input.edgePreset === "abs1t";
  const isAbs2T  = input.edgePreset === "abs2t";
  const isCustom = input.edgePreset === "custom";
  const isPaintPreset  = input.edgePreset === "paint";
  const isEdge45Preset = input.edgePreset === "edge45";
  const isCurvedPreset = input.edgePreset === "curved";
  const isAnyAbs = isAbs1T || isAbs2T || isCustom;

  const { rows, bestId } = bestSheetPrices(input);
  const sel = selectedSheetId && rows.find((r) => r.sheetId === selectedSheetId)?.pieces
    ? selectedSheetId : bestId;
  const row = sel ? rows.find((r) => r.sheetId === sel) : null;
  const materialCostWon = row && row.pieces > 0 ? row.costPerPiece : 0;

  // 보드 두께 → ABS 폭 → 단가 (DB 기준)
  const absWidth = THICK_TO_ABS_WIDTH[input.hMm];
  const absP1 = absWidth ? (ABS_PRICE[absWidth]?.[1] ?? 0) : 0;
  const absP2 = absWidth ? (ABS_PRICE[absWidth]?.[2] ?? 0) : 0;

  // ── 엣지 길이(m) + 재료비 계산 ──────────────────────────────────────
  // 4면 1T / 4면 2T: 각 변마다 +50mm 트림 여유
  //   총길이 = (W+50)×2 + (D+50)×2
  // 사용자 설정: 면별 T값(0=없음,1=1T,2=2T)으로 개별 계산
  //   상/하 = (W+50)/1000 × rate(T), 좌/우 = (D+50)/1000 × rate(T)
  // 도장: 전체 둘레 × 재료비 단가
  let edgeLengthM = 0;
  let edgeCostWon = 0;

  if (isAbs1T || isAbs2T) {
    const lenMm = (input.wMm + 50) * 2 + (input.dMm + 50) * 2;
    edgeLengthM = lenMm / 1000;
    edgeCostWon = edgeLengthM * (isAbs2T ? absP2 : absP1);
  } else if (isCustom) {
    const cs = input.edgeCustomSides;
    const w50m = (input.wMm + 50) / 1000;
    const d50m = (input.dMm + 50) / 1000;
    const sideLen  = [w50m, w50m, d50m, d50m];
    const sideTVals = [cs.top, cs.bottom, cs.left, cs.right];
    sideTVals.forEach((t, i) => {
      if (t <= 0 || !absWidth) return;
      const rate = t === 2 ? absP2 : absP1;
      edgeLengthM += sideLen[i];
      edgeCostWon += sideLen[i] * rate;
    });
  } else if (isPaintPreset) {
    edgeLengthM = perimeterMm(input.wMm, input.dMm) / 1000;
    edgeCostWon = edgeLengthM * PAINT_EDGE_MATERIAL_WON_PER_M;
  }

  const edgeLabel = edgeLabelFromPreset(input.edgePreset);

  // 핫멜트: ABS 계열(abs1t/abs2t/custom) — 실소요량(㎡) × 단가(원/㎡)
  //   실소요량 = 엣지 길이(m) × 보드 두께(m) = edgeLengthM × hMm/1000
  const hotmeltCostWon = isAnyAbs && edgeLengthM > 0
    ? edgeLengthM * (input.hMm / 1000) * hotmeltPricePerM2(input.hMm)
    : 0;

  const cuttingSheetCount = row && row.pieces > 0 ? 1 : 0;
  const cuttingPlacementCount = row && row.pieces > 0 ? row.pieces : 0;
  const cuttingCostWon = cuttingFeeFromPlacementCount(cuttingPlacementCount);
  const formingCostWon = input.formingM * (input.unitFormingPerM || 1000);
  const rutaCostWon  = input.rutaM * 2000;
  const ruta2CostWon = input.ruta2M * 1000;
  const assemblyCostWon = input.assemblyHours * (input.unitAssemblyPerH || 35);
  const washCostWon  = input.washM2 * (input.unitWashPerM2 || 500);
  const boring1CostWon = input.boring1Ea * 100;
  const boring2CostWon = input.boring2Ea * 50;
  const boringCostWon  = boring1CostWon + boring2CostWon;

  // 곱면 엣지: curved 선택 시에만 (머시닝 m당 3,000원 + 수동 m당 2,000원)
  const curvedCostWon = isCurvedPreset
    ? input.curvedEdgeM * 3000 + (input.curvedManualMm ?? 0) / 1000 * 2000
    : 0;

  // 45도 테이핑: edge45 선택 시에만 (m당 500원)
  const edge45TapingCostWon = isEdge45Preset ? input.edge45TapingM * 500 : 0;

  // 도장 엣지: paint 선택 시 패널 둘레 자동 적용 (방식별 단가)
  const paintRate = EDGE45_PAINT_RATES[input.edge45PaintType] ?? 0;
  const edge45PaintCostWon = isPaintPreset
    ? (perimeterMm(input.wMm, input.dMm) / 1000) * paintRate
    : 0;

  const edge45CostWon = edge45TapingCostWon + edge45PaintCostWon;
  const tenonerCostWon = (Math.max(0, input.tenonerMm) / 1000) * TENONER_WON_PER_M;
  const processingTotalWon = edgeCostWon + hotmeltCostWon + cuttingCostWon + formingCostWon +
    rutaCostWon + ruta2CostWon + assemblyCostWon + washCostWon + boringCostWon + curvedCostWon + edge45CostWon +
    tenonerCostWon;
  const grandTotalWon = materialCostWon + processingTotalWon;
  return {
    sheets: rows, recommendedSheetId: bestId, selectedSheetId: sel,
    resolvedEdgeProfileKey: edgeLabel, materialCostWon, edgeLengthM, edgeCostWon, hotmeltCostWon,
    cuttingSheetCount, cuttingPlacementCount, sheetCount: cuttingSheetCount, cuttingCostWon,
    formingCostWon, rutaCostWon, ruta2CostWon, assemblyCostWon, washCostWon,
    boring1CostWon, boring2CostWon, boringCostWon, curvedCostWon,
    edge45TapingCostWon, edge45PaintCostWon, edge45CostWon, tenonerCostWon, processingTotalWon, grandTotalWon,
  };
}

import {
  SHEET_SPECS,
  type PlacementMode,
  type SheetId,
  piecesPerSheet,
  yieldPercent,
  costPerPiece,
  layoutLabelForPlacement,
  placementLayoutGrid,
} from "./yield.js";
import { cuttingFeeFromPlacementCount, hotmeltPricePerM2 } from "./pricing.js";

/** 가공비 엣지 프리셋 (UI) */
export type MaterialEdgePreset = "none" | "abs1t" | "abs2t" | "paint" | "custom";

export type EdgeCustomSides = { top: number; bottom: number; left: number; right: number };

/** ABS 1T WW 두께별 원/m */
function abs1tRatePerM(hMm: number, color: string): number {
  if (color === "BI") return 0; // BI 단가 추후 추가
  if (hMm <= 12) return 139;
  if (hMm <= 15) return 143;
  if (hMm <= 18) return 159;
  if (hMm <= 21) return 224;
  return 280;
}

/** ABS 2T WW 두께별 원/m */
function abs2tRatePerM(hMm: number, color: string): number {
  if (color === "BI") return 0; // BI 단가 추후 추가
  if (hMm <= 15) return 251;
  if (hMm <= 18) return 293;
  return 364;
}

/** 45도 엣지 도장 유형별 원/m */
export const EDGE45_PAINT_RATES: Record<string, number> = {
  "직각+코팅": 2500,
  "직각+테이핑": 3500,
  "코팅+스프레이": 3750,
  "줄눈도장(메지)": 4500,
  "테이퍼": 12000,
  "테이퍼+테이핑": 13000,
};

export type EdgeSelection = { top: boolean; bottom: boolean; left: boolean; right: boolean };

export const PAINT_EDGE_WON_PER_M = 3500;
export const TENONER_WON_PER_M = 800;
export const DEFAULT_EDGE_SIDES: EdgeSelection = { top: true, bottom: true, left: true, right: true };

export function edgeLengthMm(wMm: number, dMm: number, e: EdgeSelection): number {
  let mm = 0;
  if (e.top) mm += wMm;
  if (e.bottom) mm += wMm;
  if (e.left) mm += dMm;
  if (e.right) mm += dMm;
  return mm;
}

/** 자재 면적 윤곽 (W+D)×2 (mm) — 견적 엣지 길이 */
export function perimeterMm(wMm: number, dMm: number): number {
  return (wMm + dMm) * 2;
}

/** 프리셋 → 표시용 레이블 */
function edgeLabelFromPreset(preset: MaterialEdgePreset): string {
  if (preset === "abs1t") return "4면 ABS 1T";
  if (preset === "abs2t") return "4면 ABS 2T";
  if (preset === "paint") return "4면 엣지 도장";
  if (preset === "custom") return "사용자 설정";
  return "";
}

/** 저장된 구버전 edgeProfileKey → 프리셋 */
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
  /** ABS 엣지 색상 (WW / BI) */
  edgeColor: string;
  edgeCustomSides: EdgeCustomSides;
  edgeSides: EdgeSelection;
  sheetPrices: Partial<Record<SheetId, number>>;
  formingM: number;
  rutaM: number;
  assemblyHours: number;
  washM2: number;
  /** 1차 보링 (개당 100원) */
  boring1Ea: number;
  /** 2차 보링 (개당 50원) */
  boring2Ea: number;
  /** 곡면 엣지 (m) */
  curvedEdgeM: number;
  /** 곡면 엣지 유형: machining=3,000원/m / manual=2,000원/m */
  curvedEdgeType: "machining" | "manual" | "";
  /** 45도 엣지 테이핑 (m, 500원/m) */
  edge45TapingM: number;
  /** 45도 엣지 도장 유형 (EDGE45_PAINT_RATES 키 또는 "") */
  edge45PaintType: string;
  /** 45도 엣지 도장 길이 (m) */
  edge45PaintM: number;
  /** 루타 2차 (m, 1,000원/m) */
  ruta2M: number;
  tenonerMm: number;
  /** 단가 오버라이드 (관리자용) */
  unitFormingPerM: number;
  unitAssemblyPerH: number;
  unitWashPerM2: number;
}

/** 관리자 재계산·미리보기 공통 입력 조립 */
export function buildMaterialInput(
  f: {
    wMm: number;
    dMm: number;
    hMm: number;
    color: string;
    boardMaterial: string;
    placementMode: PlacementMode;
    edgePreset?: MaterialEdgePreset;
    edgeProfileKey?: string;
    edgeColor?: string;
    edgeCustomSides?: EdgeCustomSides;
    edgeSides?: EdgeSelection;
    sheetPrices: Partial<Record<SheetId, number>>;
    formingM: number;
    rutaM: number;
    assemblyHours: number;
    washM2: number;
    /** 구버전 호환 (없으면 boring1Ea로 사용) */
    boringEa?: number;
    boring1Ea?: number;
    boring2Ea?: number;
    curvedEdgeM: number;
    curvedEdgeType?: "machining" | "manual" | "";
    /** 구버전 호환 (없으면 edge45TapingM으로 사용) */
    edge45M?: number;
    edge45TapingM?: number;
    edge45PaintType?: string;
    edge45PaintM?: number;
    ruta2M?: number;
    tenonerMm?: number;
    unitFormingPerM?: number;
    unitRutaPerM?: number;
    unitAssemblyPerH?: number;
    unitWashPerM2?: number;
    unitBoringPerEa?: number;
    unitCurvedPerM?: number;
    unitEdge45PerM?: number;
  }
): MaterialInput {
  const edgePreset: MaterialEdgePreset = f.edgePreset ?? legacyEdgePresetFromKey(f.edgeProfileKey);
  const edgeColor = f.edgeColor ?? "WW";
  const edgeCustomSides = f.edgeCustomSides ?? { ...DEFAULT_CUSTOM_SIDES };
  const boring1Ea = f.boring1Ea ?? f.boringEa ?? 0;
  const boring2Ea = f.boring2Ea ?? 0;
  const edge45TapingM = f.edge45TapingM ?? f.edge45M ?? 0;
  const edge45PaintType = f.edge45PaintType ?? "";
  const edge45PaintM = f.edge45PaintM ?? 0;
  const curvedEdgeType = f.curvedEdgeType ?? "machining";

  return {
    wMm: f.wMm,
    dMm: f.dMm,
    hMm: f.hMm,
    color: f.color,
    boardMaterial: f.boardMaterial,
    placementMode: f.placementMode,
    edgePreset,
    edgeColor,
    edgeCustomSides,
    edgeSides: f.edgeSides ?? { ...DEFAULT_EDGE_SIDES },
    sheetPrices: f.sheetPrices,
    formingM: f.formingM,
    rutaM: f.rutaM,
    assemblyHours: f.assemblyHours,
    washM2: f.washM2,
    boring1Ea,
    boring2Ea,
    curvedEdgeM: f.curvedEdgeM,
    curvedEdgeType,
    edge45TapingM,
    edge45PaintType,
    edge45PaintM,
    ruta2M: f.ruta2M ?? 0,
    tenonerMm: f.tenonerMm ?? 0,
    unitFormingPerM: f.unitFormingPerM ?? 1000,
    unitAssemblyPerH: f.unitAssemblyPerH ?? 35,
    unitWashPerM2: f.unitWashPerM2 ?? 500,
  };
}

/** 핫멜트 두께별 선형 단가 (원/m) */
function hotmeltWonPerLinearM(thicknessMm: number): number {
  return hotmeltPricePerM2(thicknessMm); // pricing.ts 값이 원/m 그대로
}

export interface SheetYieldRow {
  sheetId: SheetId;
  label: string;
  sheetW: number;
  sheetH: number;
  pieces: number;
  layoutLabel: string;
  layoutCols: number;
  layoutRows: number;
  layoutExtraCols?: number;
  layoutExtraRows?: number;
  usedAreaMm2: number;
  yieldPct: number;
  costPerPiece: number;
  sheetPriceWon: number;
}

export interface ComputedMaterial {
  sheets: SheetYieldRow[];
  recommendedSheetId: SheetId | null;
  selectedSheetId: SheetId | null;
  resolvedEdgeProfileKey: string;
  materialCostWon: number;
  edgeLengthM: number;
  edgeCostWon: number;
  hotmeltCostWon: number;
  cuttingSheetCount: number;
  cuttingPlacementCount: number;
  sheetCount: number;
  cuttingCostWon: number;
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
}

function bestSheetPrices(input: MaterialInput): { rows: SheetYieldRow[]; bestId: SheetId | null } {
  const rows: SheetYieldRow[] = [];
  let bestId: SheetId | null = null;
  let bestCpu = Infinity;

  for (const spec of SHEET_SPECS) {
    const price = input.sheetPrices[spec.id];
    const pieces = piecesPerSheet(spec.widthMm, spec.heightMm, input.wMm, input.dMm, input.placementMode);
    const sheetPrice = price ?? 0;
    const cpu =
      pieces <= 0 ? Infinity : sheetPrice > 0 ? costPerPiece(sheetPrice, pieces) : Infinity;
    const y = yieldPercent(pieces, spec.widthMm, spec.heightMm, input.wMm, input.dMm);
    const layoutLabel = layoutLabelForPlacement(
      spec.widthMm,
      spec.heightMm,
      input.wMm,
      input.dMm,
      input.placementMode
    );
    const grid = placementLayoutGrid(
      spec.widthMm,
      spec.heightMm,
      input.wMm,
      input.dMm,
      input.placementMode
    );

    rows.push({
      sheetId: spec.id,
      label: spec.label,
      sheetW: spec.widthMm,
      sheetH: spec.heightMm,
      pieces,
      layoutLabel,
      layoutCols: grid.cols,
      layoutRows: grid.rows,
      layoutExtraCols: grid.extraCols,
      layoutExtraRows: grid.extraRows,
      usedAreaMm2: pieces * input.wMm * input.dMm,
      yieldPct: y,
      costPerPiece: pieces > 0 && sheetPrice > 0 ? costPerPiece(sheetPrice, pieces) : 0,
      sheetPriceWon: sheetPrice,
    });

    if (pieces > 0 && cpu < bestCpu) {
      bestCpu = cpu;
      bestId = spec.id;
    }
  }

  return { rows, bestId };
}

export function computeMaterial(input: MaterialInput, selectedSheetId: SheetId | null): ComputedMaterial {
  const preset = input.edgePreset === "custom" ? ("abs1t" as const) : input.edgePreset;
  const { rows, bestId } = bestSheetPrices(input);
  const sel = selectedSheetId && rows.find((r) => r.sheetId === selectedSheetId)?.pieces
    ? selectedSheetId
    : bestId;

  const row = sel ? rows.find((r) => r.sheetId === sel) : null;
  const materialCostWon = row && row.pieces > 0 ? row.costPerPiece : 0;

  const sides: EdgeSelection =
    preset === "none" ? { top: false, bottom: false, left: false, right: false } : input.edgeSides ?? DEFAULT_EDGE_SIDES;
  const edgeLenMm = edgeLengthMm(input.wMm, input.dMm, sides);
  const edgeLengthM = edgeLenMm / 1000;
  const edgeLabel = edgeLabelFromPreset(preset);

  let edgeRate = 0;
  if (preset === "abs1t") edgeRate = abs1tRatePerM(input.hMm, input.edgeColor);
  else if (preset === "abs2t") edgeRate = abs2tRatePerM(input.hMm, input.edgeColor);
  else if (preset === "paint") edgeRate = PAINT_EDGE_WON_PER_M;
  const edgeCostWon = preset === "none" ? 0 : edgeLengthM * edgeRate;
  const applyHotmelt = (preset === "abs1t" || preset === "abs2t") && edgeLengthM > 0;
  const hotmeltCostWon = applyHotmelt ? edgeLengthM * hotmeltWonPerLinearM(input.hMm) : 0;

  const cuttingSheetCount = row && row.pieces > 0 ? 1 : 0;
  const sheetCount = cuttingSheetCount;
  const cuttingPlacementCount = row && row.pieces > 0 ? row.pieces : 0;
  const cuttingCostWon = cuttingFeeFromPlacementCount(cuttingPlacementCount);

  const formingCostWon = input.formingM * (input.unitFormingPerM || 1000);
  const rutaCostWon = input.rutaM * 2000;
  const ruta2CostWon = input.ruta2M * 1000;
  const assemblyCostWon = input.assemblyHours * (input.unitAssemblyPerH || 35);
  const washCostWon = input.washM2 * (input.unitWashPerM2 || 500);

  const boring1CostWon = input.boring1Ea * 100;
  const boring2CostWon = input.boring2Ea * 50;
  const boringCostWon = boring1CostWon + boring2CostWon;

  const curvedRate = input.curvedEdgeType === "manual" ? 2000 : input.curvedEdgeType === "machining" ? 3000 : 0;
  const curvedCostWon = input.curvedEdgeM * curvedRate;

  const edge45TapingCostWon = input.edge45TapingM * 500;
  const paintRate = EDGE45_PAINT_RATES[input.edge45PaintType] ?? 0;
  const edge45PaintCostWon = input.edge45PaintM * paintRate;
  const edge45CostWon = edge45TapingCostWon + edge45PaintCostWon;
  const tenonerCostWon = (Math.max(0, input.tenonerMm) / 1000) * TENONER_WON_PER_M;

  const processingTotalWon =
    edgeCostWon +
    hotmeltCostWon +
    cuttingCostWon +
    formingCostWon +
    rutaCostWon +
    ruta2CostWon +
    assemblyCostWon +
    washCostWon +
    boringCostWon +
    curvedCostWon +
    edge45CostWon +
    tenonerCostWon;

  const grandTotalWon = materialCostWon + processingTotalWon;

  return {
    sheets: rows,
    recommendedSheetId: bestId,
    selectedSheetId: sel,
    resolvedEdgeProfileKey: edgeLabel,
    materialCostWon,
    edgeLengthM,
    edgeCostWon,
    hotmeltCostWon,
    cuttingSheetCount,
    cuttingPlacementCount,
    sheetCount,
    cuttingCostWon,
    formingCostWon,
    rutaCostWon,
    ruta2CostWon,
    assemblyCostWon,
    washCostWon,
    boring1CostWon,
    boring2CostWon,
    boringCostWon,
    curvedCostWon,
    edge45TapingCostWon,
    edge45PaintCostWon,
    edge45CostWon,
    tenonerCostWon,
    processingTotalWon,
    grandTotalWon,
  };
}

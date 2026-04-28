/**
 * 회귀 테스트용 fixture — 단품 계산 결과 baseline
 * ===================================================
 *
 * PR0 캡처 시점에 만들어진 결정론적 단품 1개 + 자재 2개.
 * 각 PR 끝나면 같은 fixture 재계산하고 결과를 baseline 과 비교.
 *
 * dev 환경에서만 시드 — production 데이터에 영향 X.
 *
 * 사용법:
 *   import { createRegressionFixture, computeRegressionFixture } from "./fixtures";
 *   const out = computeRegressionFixture(); // -> ProductComputed 결과
 *   // out.grandTotalWon 이 baseline 과 일치해야 함
 */
import type { MaterialFormState } from "../material/MaterialTab";
import type { ProductFormState } from "../product/types";
import { computeProductLocal } from "../lib/productCalcLocal";

// ─── 결정론적 fixture 입력 ───────────────────────────────────────────

export const FIXTURE_PART_ID = "fx_part_regression_v1";
export const FIXTURE_MAT_ID_A = "fx_mat_regression_A";
export const FIXTURE_MAT_ID_B = "fx_mat_regression_B";

/** 자재 A: 위판 1200×590×18mm, ABS 4면 2T */
export const FIXTURE_MAT_A_FORM: MaterialFormState = {
  name: "[FX] 1200 위판",
  partCode: "",
  wMm: 1200,
  dMm: 590,
  hMm: 18,
  color: "WW",
  boardMaterial: "PB",
  surfaceMaterial: "LPM/O",
  edgePreset: "abs2t",
  edgeColor: "WW",
  edgeCustomSides: { top: 2, bottom: 2, left: 2, right: 2 },
  edgeSides: { top: true, bottom: true, left: true, right: true },
  placementMode: "default",
  cutOrientation: "default",
  showDefault: true,
  showRotated: true,
  sheetPrices: { "4x6": 16620, "4x8": 23270, "6x8": 23770 },
  selectedSheetId: "4x8",
  formingM: 0,
  rutaM: 0,
  assemblyHours: 0,
  washM2: 0,
  boring1Ea: 8,
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

/** 자재 B: 측판 596×356×18mm, ABS 4면 1T */
export const FIXTURE_MAT_B_FORM: MaterialFormState = {
  name: "[FX] 측판",
  partCode: "",
  wMm: 596,
  dMm: 356,
  hMm: 18,
  color: "WW",
  boardMaterial: "PB",
  surfaceMaterial: "LPM/O",
  edgePreset: "abs1t",
  edgeColor: "WW",
  edgeCustomSides: { top: 1, bottom: 1, left: 1, right: 1 },
  edgeSides: { top: true, bottom: true, left: true, right: true },
  placementMode: "default",
  cutOrientation: "default",
  showDefault: true,
  showRotated: true,
  sheetPrices: { "4x6": 16620, "4x8": 23270, "6x8": 23770 },
  selectedSheetId: "4x8",
  formingM: 0,
  rutaM: 0,
  assemblyHours: 0,
  washM2: 0,
  boring1Ea: 4,
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

/** 단품 form: 자재 A×1, 자재 B×2 */
export const FIXTURE_PRODUCT_FORM: ProductFormState = {
  name: "[FX] 회귀 테스트 단품",
  lineItems: [
    { materialId: FIXTURE_MAT_ID_A, qty: 1 },
    { materialId: FIXTURE_MAT_ID_B, qty: 2 },
  ],
  hardwareEa: 12,    // 철물 12개 (포장비 자동 계산 입력)
  stickerEa: 1,
  adminRate: 0.05,
};

// ─── 계산 ─────────────────────────────────────────────────────────────

import { computeMaterial, buildMaterialInput } from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";

function computeMaterialFixture(form: MaterialFormState) {
  const input = buildMaterialInput({
    ...form,
    sheetPrices: form.sheetPrices as Partial<Record<SheetId, number>>,
  });
  return computeMaterial(input, (form.selectedSheetId ?? null) as SheetId | null);
}

/**
 * PR0 Baseline — PR1 시작 시점에 캡처한 결정론적 결과값.
 * 어느 PR 끝나든 verifyRegression() 이 이 값과 정확히 일치해야 함.
 * 값이 바뀌면 (1) 의도된 단가/계산 변경이거나 (2) 회귀 — 둘 중 하나.
 */
export const BASELINE_PR0 = {
  matA: {
    boring1CostWon:     800,
    cuttingCostWon:     800,
    edgeCostWon:        1024.3799999999999,
    grandTotalWon:      8448.61596,
    hotmeltCostWon:     6.735959999999999,
    materialCostWon:    5817.5,
    processingTotalWon: 2631.11596,
  },
  matB: {
    boring1CostWon:     400,
    cuttingCostWon:     350,
    edgeCostWon:        387.136,
    grandTotalWon:      3080.051994666667,
    hotmeltCostWon:     3.7493279999999998,
    materialCostWon:    1939.1666666666667,
    processingTotalWon: 1140.885328,
  },
  product: {
    adminWon:           1138.4133774666666,
    boxWon:             900,
    cleaningWon:        1198.844,
    grandTotalWon:      23906.680926799996,
    hardwarePackWon:    6000,
    packagingTotalWon:  8159.5476,
    partsCostWon:       14608.719949333332,
    stickerWon:         5.5,
    tapeWon:            55.2036,
  },
} as const;

/** 부동소수점 비교: 1e-6 미만 오차 허용 */
function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

/** Baseline 회귀 검증 — 모든 항목 일치하면 ok=true */
export function verifyRegression(): { ok: boolean; mismatches: Array<{ path: string; got: number; expected: number; delta: number }> } {
  const cur = computeRegressionFixture();
  const mismatches: Array<{ path: string; got: number; expected: number; delta: number }> = [];
  const compare = (path: string, got: number, expected: number) => {
    if (!approxEqual(got, expected)) {
      mismatches.push({ path, got, expected, delta: got - expected });
    }
  };
  for (const [k, v] of Object.entries(BASELINE_PR0.matA)) compare(`matA.${k}`, (cur.matA as Record<string, number>)[k], v);
  for (const [k, v] of Object.entries(BASELINE_PR0.matB)) compare(`matB.${k}`, (cur.matB as Record<string, number>)[k], v);
  for (const [k, v] of Object.entries(BASELINE_PR0.product)) compare(`product.${k}`, (cur.product as Record<string, number>)[k], v);
  return { ok: mismatches.length === 0, mismatches };
}

/** fixture 단품 1개의 ProductComputed 결과 (자동 계산 전체 — 포장비/관리비 포함) */
export function computeRegressionFixture() {
  const matA = computeMaterialFixture(FIXTURE_MAT_A_FORM);
  const matB = computeMaterialFixture(FIXTURE_MAT_B_FORM);

  const materialsInput = [
    { id: FIXTURE_MAT_ID_A, name: FIXTURE_MAT_A_FORM.name, form: FIXTURE_MAT_A_FORM },
    { id: FIXTURE_MAT_ID_B, name: FIXTURE_MAT_B_FORM.name, form: FIXTURE_MAT_B_FORM },
  ];

  const productOut = computeProductLocal(FIXTURE_PRODUCT_FORM, materialsInput);

  return {
    matA: {
      grandTotalWon: matA.grandTotalWon,
      materialCostWon: matA.materialCostWon,
      edgeCostWon: matA.edgeCostWon,
      hotmeltCostWon: matA.hotmeltCostWon,
      processingTotalWon: matA.processingTotalWon,
      cuttingCostWon: matA.cuttingCostWon,
      boring1CostWon: matA.boring1CostWon,
    },
    matB: {
      grandTotalWon: matB.grandTotalWon,
      materialCostWon: matB.materialCostWon,
      edgeCostWon: matB.edgeCostWon,
      hotmeltCostWon: matB.hotmeltCostWon,
      processingTotalWon: matB.processingTotalWon,
      cuttingCostWon: matB.cuttingCostWon,
      boring1CostWon: matB.boring1CostWon,
    },
    product: {
      partsCostWon: productOut.partsCostWon,
      packagingTotalWon: productOut.packagingTotalWon,
      hardwarePackWon: productOut.packaging.hardwareWon,
      cleaningWon: productOut.packaging.cleaningWon,
      boxWon: productOut.packaging.boxWon,
      tapeWon: productOut.packaging.tapeWon,
      stickerWon: productOut.packaging.stickerWon,
      adminWon: productOut.adminWon,
      grandTotalWon: productOut.grandTotalWon,
    },
  };
}

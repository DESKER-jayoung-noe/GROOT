/**
 * UI 레이어 합계 헬퍼 — partExtras 의 부속/철물 비용 + 단품 추가비용(세척/포장/관리)
 *
 * ⚠️ 기존 productComputed/computeMaterial 함수는 절대 변경하지 않고,
 *    부속/철물 + 세척/포장/관리비는 UI 레이어에서만 더해서 표시.
 *
 * 단품 비용 = 자재들(grandTotalWon + 종속 부속) + 별도철물 + 단품추가비용(세척+포장+일반관리비)
 *
 * 일반관리비 base = 자재비+가공비 + 별도철물 + 세척비 + 포장비  (× adminRate)
 *  - 사용자 사양: 종속 부속은 admin base 에 미포함 (단품 총합엔 포함)
 *  - 자재비+가공비 = 각 자재 grandTotalWon 합 (자재비+엣지비+가공비 모두 포함)
 */
import type { TreeNode } from "../context/TreeContext";
import { getMaterialsForPart } from "../context/TreeContext";
import { calcMaterialAttachmentsCost, calcPartHardwaresCost, getMaterialEnabled } from "../offline/partExtras";
import { getMaterial } from "../offline/stores";
import { computeProductLocal } from "./productCalcLocal";
import type { ProductFormState } from "../product/types";

/** 활성(enabled) 자재 노드만 필터 */
function activeMaterialNodes(nodes: TreeNode[], partId: string): TreeNode[] {
  return getMaterialsForPart(nodes, partId).filter((m) => getMaterialEnabled(m.id ?? ""));
}

/** 단품에 속한 활성 자재의 grandTotalWon 합 (자재비+엣지비+가공비) — 비활성은 제외 */
export function sumMaterialsForPart(nodes: TreeNode[], partId: string): number {
  const mats = activeMaterialNodes(nodes, partId);
  return mats.reduce((s, m) => s + (getMaterial(m.id ?? "")?.grandTotalWon ?? 0), 0);
}

/** 단품에 속한 활성 자재의 종속 부속 합 — 비활성 자재의 부속은 제외 */
export function sumAttachmentsForPart(nodes: TreeNode[], partId: string): number {
  const mats = activeMaterialNodes(nodes, partId);
  return mats.reduce((s, m) => s + calcMaterialAttachmentsCost(m.id ?? ""), 0);
}

/** 단품 추가비용 — 세척비 / 포장비 / 일반관리비 */
export type PartFees = {
  cleaning: number;   // 세척비 — 표면적 × 500원/m² (자재 면적 합산)
  packaging: number;  // 포장비 — 박스 + 테이프 + 스티커 + 철물보호
  admin: number;      // 일반관리비 — (자재비+가공비 + 별도철물 + 세척비 + 포장비) × adminRate
  total: number;      // = cleaning + packaging + admin
};

/**
 * 단품 추가비용 계산.
 * - 세척비/포장비: productCalcLocal (기존 함수 변경 없음) 호출 결과에서 추출
 * - 일반관리비: (자재 grandTotalWon 합 + 별도철물 + 세척비 + 포장비) × adminRate
 *   ※ adminWon 은 productCalcLocal 의 값을 쓰지 않고 직접 계산 — 별도철물 포함하기 위함
 */
export function calcPartFees(nodes: TreeNode[], partId: string, adminRate = 0.05): PartFees {
  // 비활성(off) 자재는 제외 — 단품 합계 / 추가비용 모두에서 빠짐
  const matNodes = activeMaterialNodes(nodes, partId);
  const matRows = matNodes
    .map((mn) => {
      const stored = getMaterial(mn.id ?? "");
      if (!stored?.form) return null;
      return { id: stored.id, name: stored.name ?? "", form: stored.form, grandTotalWon: stored.grandTotalWon ?? 0 };
    })
    .filter((m): m is { id: string; name: string; form: NonNullable<ReturnType<typeof getMaterial>>["form"]; grandTotalWon: number } => m !== null);

  if (matRows.length === 0) {
    return { cleaning: 0, packaging: 0, admin: 0, total: 0 };
  }

  // 1. 자재비+가공비 = 각 자재 grandTotalWon 합
  const materialsTotal = matRows.reduce((s, m) => s + m.grandTotalWon, 0);

  // 2. 별도 철물
  const hardwaresTotal = calcPartHardwaresCost(partId);

  // 3. 세척비 + 포장비 — productCalcLocal (변경 X) 호출 결과에서 분리해 사용.
  //    adminRate=0 으로 호출해서 admin 계산은 우리가 직접 함.
  const form: ProductFormState = {
    name: "",
    lineItems: matRows.map((m) => ({ materialId: m.id, qty: 1 })),
    hardwareEa: 0, // 별도철물은 partExtras 로 별도 가산
    stickerEa: 1,
    adminRate: 0,
  };

  let cleaning = 0;
  let packaging = 0;
  try {
    const c = computeProductLocal(
      form,
      matRows.map((m) => ({ id: m.id, name: m.name, form: m.form })),
    );
    cleaning = Math.round(c.packaging.cleaningWon);
    packaging = Math.round(
      c.packaging.boxWon + c.packaging.tapeWon + c.packaging.stickerWon + c.packaging.hardwareWon,
    );
  } catch {
    // ignore — 0 으로 표시
  }

  // 4. 일반관리비 = (자재비+가공비 + 별도철물 + 세척비 + 포장비) × adminRate
  const adminBase = materialsTotal + hardwaresTotal + cleaning + packaging;
  const admin = Math.round(adminBase * adminRate);

  return { cleaning, packaging, admin, total: cleaning + packaging + admin };
}

/**
 * 단품 표시용 합계 — 사용 안 함(deprecated). SetOnePagePage 가 직접 합산하도록 변경됨.
 * 호환을 위해 export 만 유지.
 */
export function calcPartGrandTotal(
  nodes: TreeNode[], partId: string, productBaseTotal: number,
): number {
  return Math.round(
    (productBaseTotal || 0)
    + sumAttachmentsForPart(nodes, partId)
    + calcPartHardwaresCost(partId),
  );
}

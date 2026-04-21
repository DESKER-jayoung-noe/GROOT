import type { PartPacking } from "../lib/packParts";

export type { PartPacking };

export type ResolvedMaterialPart = {
  materialId: string;
  name: string;
  grandTotalWon: number;
  wMm: number;
  dMm: number;
  hMm: number;
  color: string;
  edgeProfileKey: string;
  sheetLabel: string;
  /** 단품 라인(행) 인덱스 — 수량 펼침 시 동일 인덱스가 여러 개 */
  sourceLineIndex?: number;
  /** 적층·2D 배치 결과 (미리보기 계산 시 채움) */
  packing?: PartPacking;
};

export type ProductComputed = {
  parts: ResolvedMaterialPart[];
  partsCostWon: number;
  boxMm: { w: number; d: number; h: number };
  boxVolumeMm3: number;
  partsVolumeMm3: number;
  emptyVolumeMm3: number;
  emptyPercent: number;
  totalSurfaceM2: number;
  packaging: {
    hardwareWon: number;
    cleaningWon: number;
    boxWon: number;
    tapeWon: number;
    stickerWon: number;
  };
  packagingTotalWon: number;
  adminWon: number;
  grandTotalWon: number;
};

export type ProductLineItem = {
  materialId: string;
  qty: number;
};

export type ProductFormState = {
  name: string;
  lineItems: ProductLineItem[];
  /** 구 저장 데이터 호환 */
  materialIds?: string[];
  hardwareEa: number;
  stickerEa: number;
  adminRate: number;
};

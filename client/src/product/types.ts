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

export type ProductFormState = {
  name: string;
  materialIds: string[];
  hardwareEa: number;
  stickerEa: number;
  adminRate: number;
};

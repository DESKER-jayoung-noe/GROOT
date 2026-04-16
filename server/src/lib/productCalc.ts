import type { PrismaClient } from "@prisma/client";

/** PRD: 테이프 15.42원/m, 스티커 5.5원/EA, 세척 500원/㎡ */
export const TAPE_WON_PER_M = 15.42;
export const STICKER_WON_PER_EA = 5.5;
export const CLEAN_WON_PER_M2 = 500;
export const DEFAULT_ADMIN_RATE = 0.05;
export const HARDWARE_WON_PER_EA = 500;

export type ProductFormInput = {
  name: string;
  materialIds: string[];
  hardwareEa: number;
  stickerEa: number;
  adminRate: number;
};

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

function surfaceM2(wMm: number, dMm: number, hMm: number): number {
  const a = 2 * (wMm * dMm + wMm * hMm + dMm * hMm);
  return a / 1_000_000;
}

function boxPriceWon(maxEdgeMm: number, volumeMm3: number): number {
  const vL = volumeMm3 / 1e9;
  if (maxEdgeMm <= 900 && vL < 0.5) return 639;
  if (maxEdgeMm <= 1400) return 900;
  if (vL > 2) return 1265;
  return 950;
}

export async function computeProduct(
  userId: string,
  form: ProductFormInput,
  prisma: PrismaClient
): Promise<ProductComputed> {
  const ids = [...new Set(form.materialIds.filter(Boolean))];
  if (ids.length === 0) {
    return {
      parts: [],
      partsCostWon: 0,
      boxMm: { w: 0, d: 0, h: 0 },
      boxVolumeMm3: 0,
      partsVolumeMm3: 0,
      emptyVolumeMm3: 0,
      emptyPercent: 0,
      totalSurfaceM2: 0,
      packaging: {
        hardwareWon: 0,
        cleaningWon: 0,
        boxWon: 0,
        tapeWon: 0,
        stickerWon: 0,
      },
      packagingTotalWon: 0,
      adminWon: 0,
      grandTotalWon: 0,
    };
  }
  const materials = await prisma.material.findMany({
    where: { userId, id: { in: ids }, status: "SAVED" },
  });
  const byId = new Map(materials.map((m) => [m.id, m]));

  const parts: ResolvedMaterialPart[] = [];
  let partsCostWon = 0;

  for (const mid of form.materialIds) {
    const row = byId.get(mid);
    if (!row) continue;
    let grandTotalWon = 0;
    let wMm = 0;
    let dMm = 0;
    let hMm = 0;
    let color = "";
    let edgeProfileKey = "";
    let sheetLabel = "";
    try {
      const p = JSON.parse(row.payload) as {
        computed?: { grandTotalWon: number; sheets?: { sheetId: string; label: string }[]; selectedSheetId?: string | null };
        form?: {
          wMm: number;
          dMm: number;
          hMm: number;
          color: string;
          edgeProfileKey: string;
        };
      };
      grandTotalWon = p.computed?.grandTotalWon ?? 0;
      wMm = p.form?.wMm ?? 0;
      dMm = p.form?.dMm ?? 0;
      hMm = p.form?.hMm ?? 0;
      color = p.form?.color ?? "";
      edgeProfileKey = p.form?.edgeProfileKey ?? "";
      const sid = p.computed?.selectedSheetId;
      const sheets = p.computed?.sheets;
      const hit = sheets?.find((s) => s.sheetId === sid) ?? sheets?.[0];
      sheetLabel = hit?.label ?? "";
    } catch {
      /* ignore */
    }
    parts.push({
      materialId: row.id,
      name: row.name,
      grandTotalWon,
      wMm,
      dMm,
      hMm,
      color,
      edgeProfileKey,
      sheetLabel,
    });
    partsCostWon += grandTotalWon;
  }

  let maxW = 0;
  let maxD = 0;
  let sumH = 0;
  let partsVolumeMm3 = 0;
  let totalSurfaceM2 = 0;

  for (const p of parts) {
    maxW = Math.max(maxW, p.wMm);
    maxD = Math.max(maxD, p.dMm);
    sumH += p.hMm;
    partsVolumeMm3 += p.wMm * p.dMm * p.hMm;
    totalSurfaceM2 += surfaceM2(p.wMm, p.dMm, p.hMm);
  }

  const boxMm = { w: maxW, d: maxD, h: sumH };
  const boxVolumeMm3 = maxW * maxD * sumH;
  const emptyVolumeMm3 = Math.max(0, boxVolumeMm3 - partsVolumeMm3);
  const emptyPercent = boxVolumeMm3 > 0 ? (emptyVolumeMm3 / boxVolumeMm3) * 100 : 0;

  const maxEdge = Math.max(maxW, maxD, sumH);
  const tapeM = (2 * (maxW + maxD)) / 1000;
  const tapeWon = tapeM * TAPE_WON_PER_M;
  const cleaningWon = totalSurfaceM2 * CLEAN_WON_PER_M2;
  const boxWon = parts.length > 0 ? boxPriceWon(maxEdge, boxVolumeMm3) : 0;
  const hardwareWon = form.hardwareEa * HARDWARE_WON_PER_EA;
  const stickerWon = form.stickerEa * STICKER_WON_PER_EA;

  const packaging = {
    hardwareWon,
    cleaningWon,
    boxWon,
    tapeWon,
    stickerWon,
  };
  const packagingTotalWon =
    hardwareWon + cleaningWon + boxWon + tapeWon + stickerWon;

  const rate = form.adminRate > 0 && form.adminRate < 1 ? form.adminRate : DEFAULT_ADMIN_RATE;
  const baseForAdmin = partsCostWon + packagingTotalWon;
  const adminWon = baseForAdmin * rate;
  const grandTotalWon = baseForAdmin + adminWon;

  return {
    parts,
    partsCostWon,
    boxMm,
    boxVolumeMm3,
    partsVolumeMm3,
    emptyVolumeMm3,
    emptyPercent,
    totalSurfaceM2,
    packaging,
    packagingTotalWon,
    adminWon,
    grandTotalWon,
  };
}

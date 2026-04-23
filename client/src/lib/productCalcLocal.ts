import type { MaterialFormState } from "../material/MaterialTab";
import type { ProductComputed, ProductFormState } from "../product/types";
import { buildMaterialInput, computeMaterial, effectiveYieldPlacementMode } from "./materialCalc";
import { packParts } from "./packParts";
import type { SheetId } from "./yield";

export const TAPE_WON_PER_M = 15.42;
export const STICKER_WON_PER_EA = 5.5;
export const CLEAN_WON_PER_M2 = 500;
export const DEFAULT_ADMIN_RATE = 0.05;
export const HARDWARE_WON_PER_EA = 500;

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

export type MaterialRowInput = {
  id: string;
  name: string;
  form: MaterialFormState;
};

function getLineItems(form: ProductFormState): { materialId: string; qty: number }[] {
  if (form.lineItems?.length) {
    return form.lineItems.filter((l) => l.materialId && l.qty >= 1);
  }
  if (form.materialIds?.length) {
    return form.materialIds.map((id) => ({ materialId: id, qty: 1 }));
  }
  return [];
}

export function computeProductLocal(form: ProductFormState, materials: MaterialRowInput[]): ProductComputed {
  const lineItems = getLineItems(form);
  const ids = [...new Set(lineItems.map((l) => l.materialId).filter(Boolean))];
  if (ids.length === 0 || lineItems.length === 0) {
    return {
      parts: [],
      partsCostWon: 0,
      boxMm: { w: 0, d: 0, h: 0 },
      boxVolumeMm3: 0,
      partsVolumeMm3: 0,
      emptyVolumeMm3: 0,
      emptyPercent: 0,
      totalSurfaceM2: 0,
      packaging: { hardwareWon: 0, cleaningWon: 0, boxWon: 0, tapeWon: 0, stickerWon: 0 },
      packagingTotalWon: 0,
      adminWon: 0,
      grandTotalWon: 0,
    };
  }

  const byId = new Map(materials.map((m) => [m.id, m]));

  const parts: ProductComputed["parts"] = [];
  let partsCostWon = 0;

  for (let lineIdx = 0; lineIdx < lineItems.length; lineIdx++) {
    const { materialId, qty } = lineItems[lineIdx];
    const row = byId.get(materialId);
    if (!row) continue;
    const input = buildMaterialInput({
      ...row.form,
      sheetPrices: row.form.sheetPrices as Partial<Record<SheetId, number>>,
      placementMode: effectiveYieldPlacementMode(
        row.form.placementMode,
        row.form.cutOrientation ?? "default"
      ),
    });
    const comp = computeMaterial(input, (row.form.selectedSheetId ?? null) as SheetId | null);
    const grandTotalWon = comp.grandTotalWon;
    const wMm = row.form.wMm;
    const dMm = row.form.dMm;
    const hMm = row.form.hMm;
    const color = row.form.color;
    const edgeProfileKey = comp.resolvedEdgeProfileKey || "";
    const sid = comp.selectedSheetId;
    const hit = comp.sheets?.find((s) => s.sheetId === sid) ?? comp.sheets?.[0];
    const sheetLabel = hit?.label ?? "";
    for (let q = 0; q < qty; q++) {
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
        sourceLineIndex: lineIdx,
      });
      partsCostWon += grandTotalWon;
    }
  }

  let partsVolumeMm3 = 0;
  let totalSurfaceM2 = 0;
  for (const p of parts) {
    partsVolumeMm3 += p.wMm * p.dMm * p.hMm;
    totalSurfaceM2 += surfaceM2(p.wMm, p.dMm, p.hMm);
  }

  const { box: packedBox, placements } = packParts(parts.map((p) => ({ wMm: p.wMm, dMm: p.dMm, hMm: p.hMm })));
  parts.forEach((p, i) => {
    const pl = placements[i];
    if (pl) p.packing = pl;
  });

  const boxMm = { w: packedBox.w, d: packedBox.d, h: packedBox.h };
  const boxVolumeMm3 = boxMm.w * boxMm.d * boxMm.h;
  const emptyVolumeMm3 = Math.max(0, boxVolumeMm3 - partsVolumeMm3);
  const emptyPercent = boxVolumeMm3 > 0 ? (emptyVolumeMm3 / boxVolumeMm3) * 100 : 0;
  const maxEdge = Math.max(boxMm.w, boxMm.d, boxMm.h);
  const tapeM = (2 * (boxMm.w + boxMm.d)) / 1000;
  const tapeWon = tapeM * TAPE_WON_PER_M;
  const cleaningWon = totalSurfaceM2 * CLEAN_WON_PER_M2;
  const boxWon = parts.length > 0 ? boxPriceWon(maxEdge, boxVolumeMm3) : 0;
  const hardwareWon = form.hardwareEa * HARDWARE_WON_PER_EA;
  const stickerWon = form.stickerEa * STICKER_WON_PER_EA;
  const packaging = { hardwareWon, cleaningWon, boxWon, tapeWon, stickerWon };
  const packagingTotalWon = hardwareWon + cleaningWon + boxWon + tapeWon + stickerWon;
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

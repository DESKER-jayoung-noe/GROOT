import type { MaterialFormState } from "../material/MaterialTab";
import type { ProductComputed } from "../product/types";
import { buildMaterialInput, computeMaterial, formatEdgeSidesKo } from "./materialCalc";
import type { SheetId } from "./yield";
import type { SetComputed } from "./setCalcLocal";

export type SlotRef = { kind: "material" | "product" | "set"; id: string };

export type CompareColumn = {
  kind: SlotRef["kind"];
  id: string;
  name: string;
  grandTotalWon: number;
  rawMaterialWon: number;
  processingWon: number;
  rawDetail: { label: string; value: string }[];
  procDetail: { label: string; value: string }[];
};

export type ComparisonComputed = { columns: (CompareColumn | null)[] };

type MatRow = { id: string; name: string; form: MaterialFormState };
type ProdRow = { id: string; name: string; form: { name: string }; computed?: ProductComputed };
type SetRow = { id: string; name: string; form: { name: string; productIds: string[] }; computed?: SetComputed };

export function diffHighlights(columns: (CompareColumn | null)[]): { raw: boolean; proc: boolean; total: boolean } {
  const nums = columns.filter((c): c is CompareColumn => c !== null);
  if (nums.length < 2) return { raw: false, proc: false, total: false };
  const uniq = <T>(arr: T[]) => new Set(arr).size;
  return {
    raw: uniq(nums.map((c) => Math.round(c.rawMaterialWon))) > 1,
    proc: uniq(nums.map((c) => Math.round(c.processingWon))) > 1,
    total: uniq(nums.map((c) => Math.round(c.grandTotalWon))) > 1,
  };
}

export function computeComparisonLocal(
  slots: (SlotRef | null)[],
  materials: Map<string, MatRow>,
  products: Map<string, ProdRow>,
  sets: Map<string, SetRow>
): ComparisonComputed {
  const out: (CompareColumn | null)[] = [];
  for (const slot of slots.slice(0, 4)) {
    if (!slot) {
      out.push(null);
      continue;
    }
    if (slot.kind === "material") {
      const row = materials.get(slot.id);
      if (!row) {
        out.push(null);
        continue;
      }
      const input = buildMaterialInput({
        ...row.form,
        sheetPrices: row.form.sheetPrices as Partial<Record<SheetId, number>>,
      });
      const comp = computeMaterial(input, (row.form.selectedSheetId ?? null) as SheetId | null);
      const form = row.form;
      const rawWon = comp.materialCostWon ?? 0;
      const procWon = comp.processingTotalWon ?? 0;
      const g = comp.grandTotalWon ?? rawWon + procWon;
      out.push({
        kind: "material",
        id: row.id,
        name: row.name,
        grandTotalWon: g,
        rawMaterialWon: rawWon,
        processingWon: procWon,
        rawDetail: [
          { label: "사이즈", value: `${form.wMm}×${form.dMm}×${form.hMm}T` },
          {
            label: "엣지",
            value:
              form.edgePreset === "none"
                ? "엣지 없음"
                : `${String(comp.resolvedEdgeProfileKey ?? "")} · ${formatEdgeSidesKo(form.edgeSides ?? { top: true, bottom: true, left: true, right: true })}`,
          },
          { label: "소재", value: String(form.boardMaterial ?? "") },
          { label: "색상", value: String(form.color ?? "") },
        ],
        procDetail: [
          { label: "원자재 소계", value: `${Math.round(rawWon).toLocaleString()}원` },
          { label: "가공 소계", value: `${Math.round(procWon).toLocaleString()}원` },
        ],
      });
      continue;
    }
    if (slot.kind === "product") {
      const row = products.get(slot.id);
      if (!row) {
        out.push(null);
        continue;
      }
      const c = row.computed;
      const partsCost = c?.partsCostWon ?? 0;
      const pack = c?.packagingTotalWon ?? 0;
      const adm = c?.adminWon ?? 0;
      const g = c?.grandTotalWon ?? 0;
      const procWon = g - partsCost;
      const first = c?.parts?.[0];
      out.push({
        kind: "product",
        id: row.id,
        name: row.name,
        grandTotalWon: g,
        rawMaterialWon: partsCost,
        processingWon: procWon,
        rawDetail: [
          { label: "부품 원가 합", value: `${Math.round(partsCost).toLocaleString()}원` },
          ...(first ? [{ label: "대표 부품", value: first.name }] : []),
        ],
        procDetail: [
          { label: "포장·세척·테이프 등", value: `${Math.round(pack).toLocaleString()}원` },
          { label: "일반관리비", value: `${Math.round(adm).toLocaleString()}원` },
        ],
      });
      continue;
    }
    if (slot.kind === "set") {
      const row = sets.get(slot.id);
      if (!row) {
        out.push(null);
        continue;
      }
      const c = row.computed;
      const g = c?.grandTotalWon ?? 0;
      const n = c?.items?.length ?? 0;
      out.push({
        kind: "set",
        id: row.id,
        name: row.name,
        grandTotalWon: g,
        rawMaterialWon: g,
        processingWon: 0,
        rawDetail: [{ label: "포함 단품", value: `${n}종` }],
        procDetail: c?.items?.length
          ? c.items.slice(0, 5).map((it) => ({ label: "·", value: it.name }))
          : [{ label: "내역", value: "—" }],
      });
    }
  }
  while (out.length < 4) out.push(null);
  return { columns: out.slice(0, 4) };
}

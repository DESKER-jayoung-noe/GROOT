import type { PrismaClient } from "@prisma/client";
import { resolveEdgeProfileKey } from "./edgeFromThickness.js";

export type SlotRef = { kind: "material" | "product" | "set"; id: string };

export type CompareColumn = {
  kind: SlotRef["kind"];
  id: string;
  name: string;
  grandTotalWon: number;
  /** 원자재비 (표시용) */
  rawMaterialWon: number;
  /** 가공비 등 (표시용) */
  processingWon: number;
  rawDetail: { label: string; value: string }[];
  procDetail: { label: string; value: string }[];
};

export type ComparisonComputed = {
  columns: (CompareColumn | null)[];
};

function parseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function computeComparison(
  userId: string,
  slots: (SlotRef | null)[],
  prisma: PrismaClient
): Promise<ComparisonComputed> {
  const out: (CompareColumn | null)[] = [];

  for (const slot of slots.slice(0, 4)) {
    if (!slot) {
      out.push(null);
      continue;
    }

    if (slot.kind === "material") {
      const row = await prisma.material.findFirst({
        where: { id: slot.id, userId, status: "SAVED" },
      });
      if (!row) {
        out.push(null);
        continue;
      }
      const p = parseJson<{ computed?: { materialCostWon: number; processingTotalWon: number; grandTotalWon: number }; form?: Record<string, unknown> }>(
        row.payload
      );
      const comp = p?.computed;
      const form = p?.form as
        | { wMm?: number; dMm?: number; hMm?: number; color?: string; edgeProfileKey?: string; boardMaterial?: string }
        | undefined;
      const rawWon = comp?.materialCostWon ?? 0;
      const procWon = comp?.processingTotalWon ?? 0;
      const g = comp?.grandTotalWon ?? rawWon + procWon;
      out.push({
        kind: "material",
        id: row.id,
        name: row.name,
        grandTotalWon: g,
        rawMaterialWon: rawWon,
        processingWon: procWon,
        rawDetail: [
          { label: "사이즈", value: `${form?.wMm ?? 0}×${form?.dMm ?? 0}×${form?.hMm ?? 0}T` },
          {
            label: "엣지",
            value:
              form?.hMm != null && form.hMm > 0
                ? resolveEdgeProfileKey(form.hMm, String(form?.color ?? "WW"))
                : String(form?.edgeProfileKey ?? ""),
          },
          { label: "소재", value: String(form?.boardMaterial ?? "") },
          { label: "색상", value: String(form?.color ?? "") },
        ],
        procDetail: [
          { label: "원자재 소계", value: `${Math.round(rawWon).toLocaleString()}원` },
          { label: "가공 소계", value: `${Math.round(procWon).toLocaleString()}원` },
        ],
      });
      continue;
    }

    if (slot.kind === "product") {
      const row = await prisma.product.findFirst({
        where: { id: slot.id, userId, status: "SAVED" },
      });
      if (!row) {
        out.push(null);
        continue;
      }
      const p = parseJson<{
        computed?: {
          partsCostWon: number;
          packagingTotalWon: number;
          adminWon: number;
          grandTotalWon: number;
          parts?: { name: string; rutaM?: number; boringEa?: number }[];
        };
      }>(row.payload);
      const c = p?.computed;
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
      const row = await prisma.savedSet.findFirst({
        where: { id: slot.id, userId, status: "SAVED" },
      });
      if (!row) {
        out.push(null);
        continue;
      }
      const p = parseJson<{ computed?: { grandTotalWon: number; items?: { name: string }[] } }>(row.payload);
      const c = p?.computed;
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

/** 열별 값이 모두 같으면 false (하이라이트 불필요) */
export function diffHighlights(columns: (CompareColumn | null)[]): {
  raw: boolean;
  proc: boolean;
  total: boolean;
} {
  const nums = columns.filter((c): c is CompareColumn => c !== null);
  if (nums.length < 2) return { raw: false, proc: false, total: false };
  const uniq = <T>(arr: T[]) => new Set(arr).size;
  return {
    raw: uniq(nums.map((c) => Math.round(c.rawMaterialWon))) > 1,
    proc: uniq(nums.map((c) => Math.round(c.processingWon))) > 1,
    total: uniq(nums.map((c) => Math.round(c.grandTotalWon))) > 1,
  };
}

import type { PrismaClient } from "@prisma/client";

export type EntityKind = "material" | "product" | "set" | "comparison";

export type ResolvedEntity = {
  kind: EntityKind;
  id: string;
  name: string;
  grandTotalWon: number;
  summary: string;
  updatedAt: Date;
};

function gtFromPayload(payload: string): number {
  try {
    const p = JSON.parse(payload) as { computed?: { grandTotalWon?: number } };
    return p.computed?.grandTotalWon ?? 0;
  } catch {
    return 0;
  }
}

export async function resolveEntity(
  prisma: PrismaClient,
  userId: string,
  kind: EntityKind,
  id: string
): Promise<ResolvedEntity | null> {
  if (kind === "material") {
    const r = await prisma.material.findFirst({ where: { id, userId } });
    if (!r) return null;
    let summary = "";
    try {
      const p = JSON.parse(r.payload) as { form?: { wMm: number; dMm: number; hMm: number } };
      summary = `${p.form?.wMm ?? 0}×${p.form?.dMm ?? 0}×${p.form?.hMm ?? 0} mm`;
    } catch {
      /* ignore */
    }
    return {
      kind,
      id: r.id,
      name: r.name,
      grandTotalWon: gtFromPayload(r.payload),
      summary,
      updatedAt: r.updatedAt,
    };
  }
  if (kind === "product") {
    const r = await prisma.product.findFirst({ where: { id, userId } });
    if (!r) return null;
    let summary = "";
    try {
      const p = JSON.parse(r.payload) as { form?: { materialIds?: string[] } };
      summary = `부품 ${p.form?.materialIds?.length ?? 0}종`;
    } catch {
      /* ignore */
    }
    return {
      kind,
      id: r.id,
      name: r.name,
      grandTotalWon: gtFromPayload(r.payload),
      summary,
      updatedAt: r.updatedAt,
    };
  }
  if (kind === "set") {
    const r = await prisma.savedSet.findFirst({ where: { id, userId } });
    if (!r) return null;
    let summary = "";
    try {
      const p = JSON.parse(r.payload) as { form?: { productIds?: string[] } };
      summary = `단품 ${p.form?.productIds?.length ?? 0}종`;
    } catch {
      /* ignore */
    }
    return {
      kind,
      id: r.id,
      name: r.name,
      grandTotalWon: gtFromPayload(r.payload),
      summary,
      updatedAt: r.updatedAt,
    };
  }
  const r = await prisma.comparison.findFirst({ where: { id, userId } });
  if (!r) return null;
  let summary = "비교";
  try {
    const p = JSON.parse(r.payload) as { computed?: { columns?: unknown[] } };
    const n = p.computed?.columns?.filter(Boolean).length ?? 0;
    summary = `${n}열 비교`;
  } catch {
    /* ignore */
  }
  return {
    kind: "comparison",
    id: r.id,
    name: r.name,
    grandTotalWon: 0,
    summary,
    updatedAt: r.updatedAt,
  };
}

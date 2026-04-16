import type { PrismaClient } from "@prisma/client";

export type SetFormInput = {
  name: string;
  productIds: string[];
};

export type SetComputed = {
  items: { productId: string; name: string; grandTotalWon: number; materialNames: string[] }[];
  grandTotalWon: number;
};

export async function computeSet(userId: string, form: SetFormInput, prisma: PrismaClient): Promise<SetComputed> {
  const ids = [...new Set(form.productIds.filter(Boolean))];
  if (ids.length === 0) {
    return { items: [], grandTotalWon: 0 };
  }
  const products = await prisma.product.findMany({
    where: { userId, id: { in: ids }, status: "SAVED" },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const items: SetComputed["items"] = [];
  let grandTotalWon = 0;

  for (const pid of form.productIds) {
    const row = byId.get(pid);
    if (!row) continue;
    let g = 0;
    const materialNames: string[] = [];
    try {
      const payload = JSON.parse(row.payload) as {
        computed?: { grandTotalWon: number; parts?: { name?: string }[] };
      };
      g = payload.computed?.grandTotalWon ?? 0;
      const parts = payload.computed?.parts;
      if (parts?.length) {
        for (const pt of parts) {
          if (pt.name) materialNames.push(pt.name);
        }
      }
    } catch {
      /* ignore */
    }
    items.push({
      productId: row.id,
      name: row.name,
      grandTotalWon: g,
      materialNames,
    });
    grandTotalWon += g;
  }

  return { items, grandTotalWon };
}

import type { ProductFormState } from "../product/types";

export type SetComputed = {
  items: { productId: string; name: string; grandTotalWon: number; materialNames: string[] }[];
  grandTotalWon: number;
};

type StoredProductRow = {
  id: string;
  name: string;
  form: ProductFormState;
  computed?: { grandTotalWon?: number; parts?: { name?: string }[] };
};

export function computeSetLocal(
  productIds: string[],
  products: StoredProductRow[]
): SetComputed {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return { items: [], grandTotalWon: 0 };
  const byId = new Map(products.map((p) => [p.id, p]));
  const items: SetComputed["items"] = [];
  let grandTotalWon = 0;
  for (const pid of productIds) {
    const row = byId.get(pid);
    if (!row) continue;
    const g = row.computed?.grandTotalWon ?? 0;
    const materialNames: string[] = [];
    const parts = row.computed?.parts;
    if (parts?.length) {
      for (const pt of parts) {
        if (pt.name) materialNames.push(pt.name);
      }
    }
    items.push({ productId: row.id, name: row.name, grandTotalWon: g, materialNames });
    grandTotalWon += g;
  }
  return { items, grandTotalWon };
}

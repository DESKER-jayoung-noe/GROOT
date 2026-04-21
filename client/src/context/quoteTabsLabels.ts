import {
  enrichProductComputed,
  enrichSetComputed,
  getMaterial,
  getProducts,
  getSets,
  materialListRow,
} from "../offline/stores";
import type { QuoteKind, QuoteTabRow } from "../offline/addQuoteTabs";

export const kindLabel: Record<QuoteKind, string> = {
  material: "자재",
  product: "단품",
  set: "세트",
};

export type TabLabel = { name: string; grandTotalWon: number };

export function labelForTabRow(t: QuoteTabRow): TabLabel {
  if (t.kind === "material") {
    const m = getMaterial(t.entityId);
    if (!m) return { name: "이름 없음", grandTotalWon: 0 };
    const row = materialListRow(m);
    return { name: row.name, grandTotalWon: row.grandTotalWon };
  }
  if (t.kind === "product") {
    const p = getProducts().find((x) => x.id === t.entityId);
    if (!p) return { name: "이름 없음", grandTotalWon: 0 };
    const e = enrichProductComputed(p);
    return { name: p.name || "이름 없음", grandTotalWon: e.grandTotalWon };
  }
  const s = getSets().find((x) => x.id === t.entityId);
  if (!s) return { name: "이름 없음", grandTotalWon: 0 };
  const e = enrichSetComputed(s);
  return { name: s.name || "이름 없음", grandTotalWon: e.grandTotalWon };
}

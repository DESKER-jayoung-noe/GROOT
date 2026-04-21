import type { QuoteKind } from "../offline/addQuoteTabs";

export function quotePathForKind(kind: QuoteKind): string {
  if (kind === "material") return "/material";
  if (kind === "product") return "/product";
  return "/set";
}

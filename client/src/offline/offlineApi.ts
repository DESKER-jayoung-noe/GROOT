import type { ProductFormState } from "../product/types";
import { buildMaterialInput, computeMaterial } from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import { computeComparisonLocal, diffHighlights, type SlotRef } from "../lib/comparisonCalcLocal";
import { computeProductLocal } from "../lib/productCalcLocal";
import { computeSetLocal } from "../lib/setCalcLocal";
import {
  deleteMaterial,
  enrichProductComputed,
  enrichSetComputed,
  getComparisons,
  getMaterials,
  getProducts,
  getSets,
  materialListRow,
  newId,
  putComparison,
  putMaterial,
  putProduct,
  putSet,
  type StoredComparison,
  type StoredMaterial,
  type StoredProduct,
  type StoredSet,
} from "./stores";

function parsePath(path: string): { pathname: string; query: URLSearchParams } {
  const q = path.indexOf("?");
  if (q === -1) return { pathname: path, query: new URLSearchParams() };
  return { pathname: path.slice(0, q), query: new URLSearchParams(path.slice(q + 1)) };
}

function jsonBody(body: BodyInit | null | undefined): unknown {
  if (body == null || typeof body !== "string") return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export async function offlineApi<T>(path: string, opts: RequestInit & { token?: string | null } = {}): Promise<T> {
  const method = (opts.method ?? "GET").toUpperCase();
  const { pathname, query } = parsePath(path);
  const body = jsonBody(opts.body as string | undefined);

  if (method === "GET" && pathname === "/me/home") {
    return { recents: [], recentWork: [], favorites: [], pricingVersion: 1 } as T;
  }
  if (method === "POST" && pathname === "/me/favorites/toggle") return {} as T;
  if (method === "POST" && (pathname === "/visit/recent" || pathname === "/me/recents")) return {} as T;

  // Materials
  if (method === "GET" && pathname === "/materials/list") {
    const st = query.get("status");
    let rows = getMaterials();
    if (st === "SAVED" || st === "DRAFT") rows = rows.filter((m) => m.status === st);
    return rows.map(materialListRow) as T;
  }

  if (method === "POST" && pathname.endsWith("/copy") && pathname.startsWith("/materials/")) {
    const id = pathname.replace("/materials/", "").replace("/copy", "");
    const m = getMaterials().find((x) => x.id === id);
    if (!m) throw new Error("자재를 찾을 수 없습니다.");
    const copy: StoredMaterial = {
      ...m,
      id: newId("m"),
      name: `${m.name} (복사)`,
      updatedAt: new Date().toISOString(),
    };
    putMaterial(copy);
    return { id: copy.id, name: copy.name } as T;
  }

  if (method === "GET" && pathname.startsWith("/materials/") && pathname.split("/").length === 3) {
    const id = pathname.replace("/materials/", "");
    if (!id || id === "list") throw new Error("Not found");
    const m = getMaterials().find((x) => x.id === id);
    if (!m) throw new Error("자재를 찾을 수 없습니다.");
    const input = buildMaterialInput({
      ...m.form,
      sheetPrices: m.form.sheetPrices as Partial<Record<SheetId, number>>,
    });
    const computed = computeMaterial(input, (m.form.selectedSheetId ?? null) as SheetId | null);
    return { id: m.id, name: m.name, status: m.status, form: m.form, computed } as T;
  }

  if (method === "POST" && pathname === "/materials/preview") {
    const form = body as StoredMaterial["form"] & { selectedSheetId?: string | null; sheetPrices?: Record<string, number> };
    const input = buildMaterialInput({
      ...form,
      sheetPrices: (form.sheetPrices ?? {}) as Partial<Record<SheetId, number>>,
    });
    const computed = computeMaterial(input, (form.selectedSheetId ?? null) as SheetId | null);
    return { computed } as T;
  }

  if (method === "DELETE" && pathname.startsWith("/materials/")) {
    deleteMaterial(pathname.replace("/materials/", ""));
    return {} as T;
  }

  // Products
  if (method === "GET" && pathname === "/products/list") {
    const st = query.get("status");
    let rows = getProducts();
    if (st === "SAVED" || st === "DRAFT") rows = rows.filter((p) => p.status === st);
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      grandTotalWon: p.grandTotalWon,
      summary: p.summary,
    })) as T;
  }

  if (method === "POST" && pathname === "/products/preview") {
    const form = JSON.parse(opts.body as string) as ProductFormState;
    const mats = getMaterials().map((m) => ({ id: m.id, name: m.name, form: m.form }));
    return { computed: computeProductLocal(form, mats) } as T;
  }

  if (method === "POST" && pathname === "/products/draft") {
    const form = body as ProductFormState;
    const enriched = enrichProductComputed({
      id: newId("p"),
      name: form.name || "이름 없음",
      status: "DRAFT",
      updatedAt: new Date().toISOString(),
      grandTotalWon: 0,
      summary: "",
      form,
    });
    putProduct(enriched);
    return { id: enriched.id } as T;
  }

  if (method === "POST" && pathname === "/products/save") {
    const form = body as ProductFormState;
    const enriched = enrichProductComputed({
      id: newId("p"),
      name: form.name || "이름 없음",
      status: "SAVED",
      updatedAt: new Date().toISOString(),
      grandTotalWon: 0,
      summary: "",
      form,
    });
    putProduct(enriched);
    return { id: enriched.id } as T;
  }

  if (method === "PUT" && /^\/products\/[^/]+$/.test(pathname)) {
    const id = pathname.slice("/products/".length);
    const form = body as ProductFormState & { name?: string };
    const prev = getProducts().find((p) => p.id === id);
    if (!prev) throw new Error("단품을 찾을 수 없습니다.");
    const merged: StoredProduct = {
      ...prev,
      name: (form as { name?: string }).name ?? prev.name,
      form: { ...prev.form, ...form },
      updatedAt: new Date().toISOString(),
    };
    putProduct(enrichProductComputed(merged));
    return {} as T;
  }

  if (method === "GET" && /^\/products\/[^/]+$/.test(pathname)) {
    const id = pathname.slice("/products/".length);
    const p = getProducts().find((x) => x.id === id);
    if (!p) throw new Error("단품을 찾을 수 없습니다.");
    const enriched = enrichProductComputed(p);
    return { name: enriched.name, form: enriched.form, computed: enriched.computed } as T;
  }

  if (method === "POST" && pathname.endsWith("/copy") && pathname.startsWith("/products/")) {
    const id = pathname.replace("/products/", "").replace("/copy", "");
    const p = getProducts().find((x) => x.id === id);
    if (!p) throw new Error("없음");
    const c = enrichProductComputed({
      ...p,
      id: newId("p"),
      name: `${p.name} (복사)`,
      updatedAt: new Date().toISOString(),
    });
    putProduct(c);
    return { id: c.id, name: c.name } as T;
  }

  // Sets
  if (method === "GET" && pathname === "/sets/list") {
    const st = query.get("status");
    let rows = getSets();
    if (st === "SAVED" || st === "DRAFT") rows = rows.filter((s) => s.status === st);
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      grandTotalWon: s.grandTotalWon,
      summary: s.summary,
    })) as T;
  }

  if (method === "POST" && pathname === "/sets/preview") {
    const form = JSON.parse(opts.body as string) as { name: string; productIds: string[] };
    const prods = getProducts().map((p) => {
      const e = enrichProductComputed(p);
      return { id: p.id, name: p.name, form: p.form, computed: e.computed };
    });
    return { computed: computeSetLocal(form.productIds, prods) } as T;
  }

  if (method === "POST" && pathname === "/sets/draft") {
    const form = body as { name: string; productIds: string[] };
    let s: StoredSet = {
      id: newId("s"),
      name: form.name || "이름 없음",
      status: "DRAFT",
      updatedAt: new Date().toISOString(),
      grandTotalWon: 0,
      summary: "",
      form,
    };
    s = enrichSetComputed(s);
    putSet(s);
    return { id: s.id } as T;
  }

  if (method === "POST" && pathname === "/sets/save") {
    const form = body as { name: string; productIds: string[] };
    let s: StoredSet = {
      id: newId("s"),
      name: form.name || "이름 없음",
      status: "SAVED",
      updatedAt: new Date().toISOString(),
      grandTotalWon: 0,
      summary: "",
      form,
    };
    s = enrichSetComputed(s);
    putSet(s);
    return { id: s.id } as T;
  }

  if (method === "PUT" && /^\/sets\/[^/]+$/.test(pathname)) {
    const id = pathname.slice("/sets/".length);
    const form = body as { name: string; productIds: string[] };
    const prev = getSets().find((s) => s.id === id);
    if (!prev) throw new Error("세트를 찾을 수 없습니다.");
    let next: StoredSet = {
      ...prev,
      name: form.name ?? prev.name,
      form: { ...prev.form, ...form },
      updatedAt: new Date().toISOString(),
    };
    putSet(enrichSetComputed(next));
    return {} as T;
  }

  if (method === "GET" && /^\/sets\/[^/]+$/.test(pathname)) {
    const id = pathname.slice("/sets/".length);
    const s = getSets().find((x) => x.id === id);
    if (!s) throw new Error("세트를 찾을 수 없습니다.");
    const enriched = enrichSetComputed(s);
    return { name: enriched.name, form: enriched.form, computed: enriched.computed } as T;
  }

  if (method === "POST" && pathname.endsWith("/copy") && pathname.startsWith("/sets/")) {
    const id = pathname.replace("/sets/", "").replace("/copy", "");
    const s = getSets().find((x) => x.id === id);
    if (!s) throw new Error("없음");
    let c = enrichSetComputed({
      ...s,
      id: newId("s"),
      name: `${s.name} (복사)`,
      updatedAt: new Date().toISOString(),
    });
    c = enrichSetComputed(c);
    putSet(c);
    return { id: c.id, name: c.name } as T;
  }

  // Comparisons
  if (method === "POST" && pathname === "/comparisons/preview") {
    const parsed = body as { name?: string; slots: unknown[] };
    const slots = (parsed.slots ?? []) as (SlotRef | null)[];
    const mats = new Map(getMaterials().map((m) => [m.id, { id: m.id, name: m.name, form: m.form }]));
    const prods = new Map(
      getProducts().map((p) => {
        const e = enrichProductComputed(p);
        return [p.id, { id: p.id, name: p.name, form: p.form, computed: e.computed }] as const;
      })
    );
    const setMap = new Map(
      getSets().map((s) => {
        const e = enrichSetComputed(s);
        return [s.id, { id: s.id, name: s.name, form: s.form, computed: e.computed }] as const;
      })
    );
    const computed = computeComparisonLocal(slots, mats, prods, setMap);
    return {
      form: { name: parsed.name || "비교", slots: parsed.slots },
      computed,
      highlights: diffHighlights(computed.columns),
    } as T;
  }

  if (method === "GET" && pathname === "/comparisons/list") {
    const st = query.get("status");
    let rows = getComparisons();
    if (st === "SAVED" || st === "DRAFT") rows = rows.filter((c) => c.status === st);
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      updatedAt: c.updatedAt,
      grandTotalWon: 0,
      summary: "비교",
    })) as T;
  }

  if (method === "GET" && pathname.startsWith("/comparisons/") && pathname !== "/comparisons/list") {
    const id = pathname.replace("/comparisons/", "");
    if (!id || id === "list") throw new Error("Not found");
    const c = getComparisons().find((x) => x.id === id);
    if (!c) throw new Error("없음");
    const slots = (c.form.slots ?? []) as SlotRef[];
    const mats = new Map(getMaterials().map((m) => [m.id, { id: m.id, name: m.name, form: m.form }]));
    const prods = new Map(
      getProducts().map((p) => {
        const e = enrichProductComputed(p);
        return [p.id, { id: p.id, name: p.name, form: p.form, computed: e.computed }] as const;
      })
    );
    const setMap = new Map(
      getSets().map((s) => {
        const e = enrichSetComputed(s);
        return [s.id, { id: s.id, name: s.name, form: s.form, computed: e.computed }] as const;
      })
    );
    const computed = computeComparisonLocal(slots, mats, prods, setMap);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      form: { name: c.form.name, slots: c.form.slots },
      computed,
      highlights: diffHighlights(computed.columns),
    } as T;
  }

  if (method === "PUT" && pathname.startsWith("/comparisons/") && pathname !== "/comparisons/list") {
    const id = pathname.replace("/comparisons/", "");
    if (!id || id === "list") throw new Error("Not found");
    const prev = getComparisons().find((x) => x.id === id);
    if (!prev) throw new Error("없음");
    const parsed = body as { name?: string; slots?: unknown[]; finalize?: boolean };
    const slots = (parsed.slots !== undefined ? parsed.slots : prev.form.slots) as (SlotRef | null)[];
    const mats = new Map(getMaterials().map((m) => [m.id, { id: m.id, name: m.name, form: m.form }]));
    const prods = new Map(
      getProducts().map((p) => {
        const e = enrichProductComputed(p);
        return [p.id, { id: p.id, name: p.name, form: p.form, computed: e.computed }] as const;
      })
    );
    const setMap = new Map(
      getSets().map((s) => {
        const e = enrichSetComputed(s);
        return [s.id, { id: s.id, name: s.name, form: s.form, computed: e.computed }] as const;
      })
    );
    const computed = computeComparisonLocal(slots, mats, prods, setMap);
    const highlights = diffHighlights(computed.columns);
    const finalize = Boolean(parsed.finalize);
    const row: StoredComparison = {
      ...prev,
      name: parsed.name ?? prev.name,
      status: finalize ? "SAVED" : prev.status,
      updatedAt: new Date().toISOString(),
      form: { name: parsed.name ?? prev.form.name, slots },
      computed,
      highlights,
    };
    putComparison(row);
    return { id: row.id, status: row.status, computed, highlights } as T;
  }

  if (method === "POST" && (pathname === "/comparisons/draft" || pathname === "/comparisons/save")) {
    const parsed = body as { name: string; slots: unknown[]; id?: string };
    const slots = (parsed.slots ?? []) as (SlotRef | null)[];
    const mats = new Map(getMaterials().map((m) => [m.id, { id: m.id, name: m.name, form: m.form }]));
    const prods = new Map(
      getProducts().map((p) => {
        const e = enrichProductComputed(p);
        return [p.id, { id: p.id, name: p.name, form: p.form, computed: e.computed }] as const;
      })
    );
    const setMap = new Map(
      getSets().map((s) => {
        const e = enrichSetComputed(s);
        return [s.id, { id: s.id, name: s.name, form: s.form, computed: e.computed }] as const;
      })
    );
    const computed = computeComparisonLocal(slots, mats, prods, setMap);
    const highlights = diffHighlights(computed.columns);
    const isDraft = pathname === "/comparisons/draft";
    const prev = parsed.id ? getComparisons().find((x) => x.id === parsed.id) : undefined;
    if (prev && isDraft && prev.status === "DRAFT") {
      const row: StoredComparison = {
        ...prev,
        name: parsed.name,
        status: "DRAFT",
        updatedAt: new Date().toISOString(),
        form: { name: parsed.name, slots: parsed.slots },
        computed,
        highlights,
      };
      putComparison(row);
      return { id: row.id, status: row.status, computed, highlights } as T;
    }
    const row: StoredComparison = {
      id: newId("c"),
      name: parsed.name,
      status: isDraft ? "DRAFT" : "SAVED",
      updatedAt: new Date().toISOString(),
      form: { name: parsed.name, slots: parsed.slots },
      computed,
      highlights,
    };
    putComparison(row);
    return { id: row.id, status: row.status, computed, highlights } as T;
  }

  if (method === "GET" && pathname === "/archive/items") {
    const cat = query.get("category") ?? "all";
    const items: {
      kind: "material" | "product" | "set" | "comparison";
      id: string;
      name: string;
      grandTotalWon: number;
      summary: string;
      updatedAt: string;
      stale: boolean;
    }[] = [];
    for (const m of getMaterials()) {
      if (cat !== "all" && cat !== "material") continue;
      items.push({
        kind: "material",
        id: m.id,
        name: m.name,
        grandTotalWon: materialListRow(m).grandTotalWon,
        summary: m.summary || materialListRow(m).summary,
        updatedAt: m.updatedAt,
        stale: false,
      });
    }
    for (const p of getProducts()) {
      if (cat !== "all" && cat !== "product") continue;
      items.push({
        kind: "product",
        id: p.id,
        name: p.name,
        grandTotalWon: p.grandTotalWon,
        summary: p.summary,
        updatedAt: p.updatedAt,
        stale: false,
      });
    }
    for (const s of getSets()) {
      if (cat !== "all" && cat !== "set") continue;
      items.push({
        kind: "set",
        id: s.id,
        name: s.name,
        grandTotalWon: s.grandTotalWon,
        summary: s.summary,
        updatedAt: s.updatedAt,
        stale: false,
      });
    }
    for (const c of getComparisons()) {
      if (cat !== "all" && cat !== "comparison") continue;
      items.push({
        kind: "comparison",
        id: c.id,
        name: c.name,
        grandTotalWon: 0,
        summary: "비교",
        updatedAt: c.updatedAt,
        stale: false,
      });
    }
    items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { items } as T;
  }

  if (method === "GET" && pathname === "/admin/pricing") {
    return {
      pricingVersion: 1,
      sheetPricesJson: localStorage.getItem("groot_admin_sheet") ?? "{}",
      edgePricesJson: localStorage.getItem("groot_admin_edge") ?? "{}",
      processPricesJson: localStorage.getItem("groot_admin_proc") ?? "{}",
    } as T;
  }

  if (method === "PUT" && pathname === "/admin/pricing") {
    const b = body as { sheetPricesJson?: string; edgePricesJson?: string; processPricesJson?: string; bumpVersion?: boolean };
    if (b.sheetPricesJson != null) localStorage.setItem("groot_admin_sheet", b.sheetPricesJson);
    if (b.edgePricesJson != null) localStorage.setItem("groot_admin_edge", b.edgePricesJson);
    if (b.processPricesJson != null) localStorage.setItem("groot_admin_proc", b.processPricesJson);
    return { pricingVersion: b.bumpVersion ? 2 : 1 } as T;
  }

  if (method === "POST" && pathname === "/admin/recalculate-all") {
    return { materialsUpdated: 0 } as T;
  }

  throw new Error(`오프라인에서 미지원: ${method} ${pathname}`);
}

import { Router } from "express";
import { MaterialStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { getOrCreateSettings } from "../lib/appSettings.js";

export const archiveRouter = Router();

archiveRouter.get("/items", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const cat = (req.query.category as string) || "all";
  const settings = await getOrCreateSettings(prisma);

  type Item = {
    kind: "material" | "product" | "set" | "comparison";
    id: string;
    name: string;
    grandTotalWon: number;
    summary: string;
    updatedAt: Date;
    stale: boolean;
  };

  const items: Item[] = [];

  function staleFrom(payload: string): boolean {
    try {
      const p = JSON.parse(payload) as { _meta?: { pricingVersion?: number } };
      const v = p._meta?.pricingVersion ?? 1;
      return settings.pricingVersion > v;
    } catch {
      return settings.pricingVersion > 1;
    }
  }

  if (cat === "all" || cat === "material") {
    const rows = await prisma.material.findMany({
      where: { userId: u.sub, status: MaterialStatus.SAVED },
      orderBy: { updatedAt: "desc" },
    });
    for (const r of rows) {
      let grandTotalWon = 0;
      let summary = "";
      try {
        const p = JSON.parse(r.payload) as {
          computed?: { grandTotalWon: number };
          form?: { wMm: number; dMm: number; hMm: number; color?: string; edgeProfileKey?: string };
        };
        grandTotalWon = p.computed?.grandTotalWon ?? 0;
        summary = `${p.form?.wMm ?? 0}×${p.form?.dMm ?? 0}×${p.form?.hMm ?? 0}T · ${p.form?.edgeProfileKey ?? ""} · ${p.form?.color ?? ""}`;
      } catch {
        /* ignore */
      }
      items.push({
        kind: "material",
        id: r.id,
        name: r.name,
        grandTotalWon,
        summary,
        updatedAt: r.updatedAt,
        stale: staleFrom(r.payload),
      });
    }
  }

  if (cat === "all" || cat === "product") {
    const rows = await prisma.product.findMany({
      where: { userId: u.sub, status: MaterialStatus.SAVED },
      orderBy: { updatedAt: "desc" },
    });
    for (const r of rows) {
      let grandTotalWon = 0;
      let summary = "";
      try {
        const p = JSON.parse(r.payload) as { computed?: { grandTotalWon: number }; form?: { materialIds?: string[] } };
        grandTotalWon = p.computed?.grandTotalWon ?? 0;
        summary = `부품 ${p.form?.materialIds?.length ?? 0}종`;
      } catch {
        /* ignore */
      }
      items.push({
        kind: "product",
        id: r.id,
        name: r.name,
        grandTotalWon,
        summary,
        updatedAt: r.updatedAt,
        stale: staleFrom(r.payload),
      });
    }
  }

  if (cat === "all" || cat === "set") {
    const rows = await prisma.savedSet.findMany({
      where: { userId: u.sub, status: MaterialStatus.SAVED },
      orderBy: { updatedAt: "desc" },
    });
    for (const r of rows) {
      let grandTotalWon = 0;
      let summary = "";
      try {
        const p = JSON.parse(r.payload) as { computed?: { grandTotalWon: number }; form?: { productIds?: string[] } };
        grandTotalWon = p.computed?.grandTotalWon ?? 0;
        summary = `단품 ${p.form?.productIds?.length ?? 0}종`;
      } catch {
        /* ignore */
      }
      items.push({
        kind: "set",
        id: r.id,
        name: r.name,
        grandTotalWon,
        summary,
        updatedAt: r.updatedAt,
        stale: staleFrom(r.payload),
      });
    }
  }

  if (cat === "all" || cat === "comparison") {
    const rows = await prisma.comparison.findMany({
      where: { userId: u.sub, status: MaterialStatus.SAVED },
      orderBy: { updatedAt: "desc" },
    });
    for (const r of rows) {
      let summary = "비교";
      try {
        const p = JSON.parse(r.payload) as { computed?: { columns?: unknown[] } };
        const n = p.computed?.columns?.filter(Boolean).length ?? 0;
        summary = `${n}열 비교`;
      } catch {
        /* ignore */
      }
      items.push({
        kind: "comparison",
        id: r.id,
        name: r.name,
        grandTotalWon: 0,
        summary,
        updatedAt: r.updatedAt,
        stale: staleFrom(r.payload),
      });
    }
  }

  if (cat === "all") {
    items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  res.json({ items, pricingVersion: settings.pricingVersion });
});

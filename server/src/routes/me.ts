import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { getOrCreateSettings } from "../lib/appSettings.js";
import { resolveEntity, type EntityKind } from "../lib/entityResolve.js";

export const meRouter = Router();

const kindSchema = z.enum(["material", "product", "set", "comparison"]);

meRouter.get("/home", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const settings = await getOrCreateSettings(prisma);

  const recents = await prisma.recentView.findMany({
    where: { userId: u.sub },
    orderBy: { visitedAt: "desc" },
    take: 40,
  });

  const favorites = await prisma.favorite.findMany({
    where: { userId: u.sub },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  const recentItems: Record<string, unknown>[] = [];
  for (const r of recents) {
    const k = r.targetType as EntityKind;
    if (!["material", "product", "set", "comparison"].includes(k)) continue;
    const ent = await resolveEntity(prisma, u.sub, k, r.targetId);
    if (!ent) continue;
    const p = await loadPricingMeta(k, r.targetId, u.sub);
    recentItems.push({
      ...ent,
      visitedAt: r.visitedAt,
      stale: settings.pricingVersion > (p ?? 1),
    });
  }

  const favItems: Record<string, unknown>[] = [];
  for (const f of favorites) {
    const k = f.targetType as EntityKind;
    if (!["material", "product", "set", "comparison"].includes(k)) continue;
    const ent = await resolveEntity(prisma, u.sub, k, f.targetId);
    if (!ent) continue;
    const p = await loadPricingMeta(k, f.targetId, u.sub);
    favItems.push({
      ...ent,
      stale: settings.pricingVersion > (p ?? 1),
    });
  }

  const recentWork = await buildRecentWork(u.sub, settings.pricingVersion);

  res.json({
    recents: recentItems,
    recentWork,
    favorites: favItems,
    pricingVersion: settings.pricingVersion,
  });
});

/** 추가하기(자재·단품·세트) / 비교하기에서 최근 수정된 항목 순 */
async function buildRecentWork(userId: string, pricingVersion: number) {
  const [mats, prods, sets, comps] = await Promise.all([
    prisma.material.findMany({
      where: { userId },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.product.findMany({
      where: { userId },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.savedSet.findMany({
      where: { userId },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.comparison.findMany({
      where: { userId },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
  ]);

  type K = EntityKind;
  const merged = [
    ...mats.map((m) => ({ kind: "material" as K, id: m.id, updatedAt: m.updatedAt })),
    ...prods.map((m) => ({ kind: "product" as K, id: m.id, updatedAt: m.updatedAt })),
    ...sets.map((m) => ({ kind: "set" as K, id: m.id, updatedAt: m.updatedAt })),
    ...comps.map((m) => ({ kind: "comparison" as K, id: m.id, updatedAt: m.updatedAt })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const seen = new Set<string>();
  const out: {
    kind: EntityKind;
    id: string;
    name: string;
    grandTotalWon: number;
    summary: string;
    updatedAt: string;
    workSource: "add" | "compare";
    stale: boolean;
  }[] = [];

  for (const row of merged) {
    const key = `${row.kind}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ent = await resolveEntity(prisma, userId, row.kind, row.id);
    if (!ent) continue;
    const p = await loadPricingMeta(row.kind, row.id, userId);
    out.push({
      kind: ent.kind,
      id: ent.id,
      name: ent.name,
      grandTotalWon: ent.grandTotalWon,
      summary: ent.summary,
      updatedAt: row.updatedAt.toISOString(),
      workSource: row.kind === "comparison" ? "compare" : "add",
      stale: pricingVersion > (p ?? 1),
    });
    if (out.length >= 40) break;
  }

  return out;
}

async function loadPricingMeta(kind: EntityKind, id: string, userId: string): Promise<number | null> {
  let payload = "";
  if (kind === "material") {
    const r = await prisma.material.findFirst({ where: { id, userId } });
    payload = r?.payload ?? "";
  } else if (kind === "product") {
    const r = await prisma.product.findFirst({ where: { id, userId } });
    payload = r?.payload ?? "";
  } else if (kind === "set") {
    const r = await prisma.savedSet.findFirst({ where: { id, userId } });
    payload = r?.payload ?? "";
  } else {
    const r = await prisma.comparison.findFirst({ where: { id, userId } });
    payload = r?.payload ?? "";
  }
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as { _meta?: { pricingVersion?: number } };
    return p._meta?.pricingVersion ?? 1;
  } catch {
    return 1;
  }
}

meRouter.post("/recents", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = z.object({ targetType: kindSchema, targetId: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const { targetType, targetId } = parsed.data;
  await prisma.recentView.upsert({
    where: {
      userId_targetType_targetId: {
        userId: u.sub,
        targetType,
        targetId,
      },
    },
    create: { userId: u.sub, targetType, targetId },
    update: { visitedAt: new Date() },
  });
  res.json({ ok: true });
});

meRouter.post("/favorites/toggle", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = z.object({ targetType: kindSchema, targetId: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const { targetType, targetId } = parsed.data;
  const existing = await prisma.favorite.findUnique({
    where: {
      userId_targetType_targetId: {
        userId: u.sub,
        targetType,
        targetId,
      },
    },
  });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    res.json({ favorited: false });
    return;
  }
  await prisma.favorite.create({
    data: { userId: u.sub, targetType, targetId },
  });
  res.json({ favorited: true });
});

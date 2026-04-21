import { Router } from "express";
import { z } from "zod";
import { MaterialStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../lib/appSettings.js";
import { authMiddleware } from "../middleware/auth.js";
import { computeComparison, diffHighlights, type SlotRef } from "../lib/comparisonCalc.js";

export const comparisonsRouter = Router();

const slotRefSchema = z.object({
  kind: z.enum(["material", "product", "set"]),
  id: z.string().min(1),
});

const slotSchema = z.union([slotRefSchema, z.null()]);

const bodySchema = z.object({
  slots: z.array(slotSchema).length(4),
});

const saveSchema = bodySchema.extend({
  name: z.string().min(1).max(200),
});

const draftCreateSchema = saveSchema.extend({
  id: z.string().min(1).optional(),
});

const putSchema = saveSchema.extend({
  finalize: z.boolean().optional(),
});

const previewSchema = bodySchema.extend({
  name: z.string().max(200).optional().default(""),
});

comparisonsRouter.post("/preview", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const slots = parsed.data.slots.map((s) => s as SlotRef | null);
  const computed = await computeComparison(u.sub, slots, prisma);
  const highlights = diffHighlights(computed.columns);
  res.json({ form: { name: parsed.data.name || "비교", slots: parsed.data.slots }, computed, highlights });
});

comparisonsRouter.post("/draft", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = draftCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const slots = parsed.data.slots.map((s) => s as SlotRef | null);
  const computed = await computeComparison(u.sub, slots, prisma);
  const highlights = diffHighlights(computed.columns);
  const settings = await getOrCreateSettings(prisma);
  const payload = JSON.stringify({
    form: { name: parsed.data.name, slots: parsed.data.slots },
    computed,
    highlights,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  if (parsed.data.id) {
    const existing = await prisma.comparison.findFirst({
      where: { id: parsed.data.id, userId: u.sub, status: MaterialStatus.DRAFT },
    });
    if (existing) {
      const updated = await prisma.comparison.update({
        where: { id: existing.id },
        data: { name: parsed.data.name, payload, status: MaterialStatus.DRAFT },
      });
      res.json({ id: updated.id, status: updated.status, computed, highlights });
      return;
    }
  }
  const row = await prisma.comparison.create({
    data: {
      userId: u.sub,
      name: parsed.data.name,
      status: MaterialStatus.DRAFT,
      payload,
    },
  });
  res.json({ id: row.id, status: row.status, computed, highlights });
});

comparisonsRouter.post("/save", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const slots = parsed.data.slots.map((s) => s as SlotRef | null);
  const computed = await computeComparison(u.sub, slots, prisma);
  const highlights = diffHighlights(computed.columns);
  const settings = await getOrCreateSettings(prisma);
  const payload = JSON.stringify({
    form: { name: parsed.data.name, slots: parsed.data.slots },
    computed,
    highlights,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const row = await prisma.comparison.create({
    data: {
      userId: u.sub,
      name: parsed.data.name,
      status: MaterialStatus.SAVED,
      payload,
    },
  });
  res.json({ id: row.id, status: row.status, computed, highlights });
});

comparisonsRouter.get("/list", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const status = req.query.status as string | undefined;
  const where: { userId: string; status?: MaterialStatus } = { userId: u.sub };
  if (status === "SAVED" || status === "DRAFT") where.status = status;
  const rows = await prisma.comparison.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  const list = rows.map((r) => {
    let grandTotalWon = 0;
    let summary = "";
    try {
      const p = JSON.parse(r.payload) as { computed?: { columns?: unknown[] } };
      const cols = p.computed?.columns?.filter(Boolean) ?? [];
      grandTotalWon = 0;
      summary = `${cols.length}열 비교`;
    } catch {
      /* ignore */
    }
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      updatedAt: r.updatedAt,
      grandTotalWon,
      summary,
    };
  });
  res.json(list);
});

comparisonsRouter.get("/:id", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.comparison.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "비교를 찾을 수 없습니다." });
    return;
  }
  try {
    const data = JSON.parse(row.payload);
    res.json({ id: row.id, name: row.name, status: row.status, ...data });
  } catch {
    res.json({ id: row.id, name: row.name, status: row.status, raw: row.payload });
  }
});

comparisonsRouter.put("/:id", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.comparison.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "비교를 찾을 수 없습니다." });
    return;
  }
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const slots = parsed.data.slots.map((s) => s as SlotRef | null);
  const computed = await computeComparison(u.sub, slots, prisma);
  const highlights = diffHighlights(computed.columns);
  const settings = await getOrCreateSettings(prisma);
  const payload = JSON.stringify({
    form: { name: parsed.data.name, slots: parsed.data.slots },
    computed,
    highlights,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const nextStatus =
    parsed.data.finalize === true
      ? MaterialStatus.SAVED
      : row.status === MaterialStatus.DRAFT
        ? MaterialStatus.DRAFT
        : MaterialStatus.SAVED;
  const updated = await prisma.comparison.update({
    where: { id: row.id },
    data: {
      name: parsed.data.name,
      payload,
      status: nextStatus,
    },
  });
  res.json({ id: updated.id, status: updated.status, computed, highlights });
});

comparisonsRouter.post("/:id/copy", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.comparison.findFirst({
    where: { id: req.params.id, userId: u.sub, status: MaterialStatus.SAVED },
  });
  if (!row) {
    res.status(404).json({ error: "복사할 비교를 찾을 수 없습니다." });
    return;
  }
  const baseName = row.name.replace(/\s*\(\d+\)\s*$/, "");
  const siblings = await prisma.comparison.count({
    where: { userId: u.sub, name: { startsWith: baseName } },
  });
  const newName = `${baseName} (${siblings})`;
  const created = await prisma.comparison.create({
    data: {
      userId: u.sub,
      name: newName,
      status: MaterialStatus.SAVED,
      payload: row.payload,
    },
  });
  res.json({ id: created.id, name: created.name });
});

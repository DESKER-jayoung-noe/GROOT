import { Router } from "express";
import { z } from "zod";
import { MaterialStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../lib/appSettings.js";
import { authMiddleware } from "../middleware/auth.js";
import { computeSet, type SetFormInput } from "../lib/setCalc.js";

export const setsRouter = Router();

const bodySchema = z.object({
  productIds: z.array(z.string()),
});

const saveSchema = bodySchema.extend({
  name: z.string().min(1).max(200),
});

const previewSchema = bodySchema.extend({
  name: z.string().max(200).optional().default(""),
});

function toInput(body: z.infer<typeof bodySchema>, name: string): SetFormInput {
  return { name, productIds: body.productIds };
}

setsRouter.post("/preview", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const name = parsed.data.name || "세트";
  const input = toInput(parsed.data, name);
  const computed = await computeSet(u.sub, input, prisma);
  res.json({ form: { ...parsed.data, name }, computed });
});

setsRouter.post("/draft", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const input = toInput(parsed.data, parsed.data.name);
  const computed = await computeSet(u.sub, input, prisma);
  const settings = await getOrCreateSettings(prisma);
  const payload = JSON.stringify({
    form: { ...parsed.data, name: parsed.data.name },
    computed,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const row = await prisma.savedSet.create({
    data: {
      userId: u.sub,
      name: parsed.data.name,
      status: MaterialStatus.DRAFT,
      payload,
    },
  });
  res.json({ id: row.id, status: row.status, computed });
});

setsRouter.post("/save", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const input = toInput(parsed.data, parsed.data.name);
  const computed = await computeSet(u.sub, input, prisma);
  const settings = await getOrCreateSettings(prisma);
  const payload = JSON.stringify({
    form: { ...parsed.data, name: parsed.data.name },
    computed,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const row = await prisma.savedSet.create({
    data: {
      userId: u.sub,
      name: parsed.data.name,
      status: MaterialStatus.SAVED,
      payload,
    },
  });
  res.json({ id: row.id, status: row.status, computed });
});

setsRouter.get("/list", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const status = req.query.status as string | undefined;
  const where: { userId: string; status?: MaterialStatus } = { userId: u.sub };
  if (status === "SAVED" || status === "DRAFT") where.status = status;
  const rows = await prisma.savedSet.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  const list = rows.map((r) => {
    let grandTotalWon = 0;
    let summary = "";
    try {
      const p = JSON.parse(r.payload) as { computed?: { grandTotalWon: number }; form?: { productIds?: string[] } };
      grandTotalWon = p.computed?.grandTotalWon ?? 0;
      const n = p.form?.productIds?.length ?? 0;
      summary = `단품 ${n}종`;
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

setsRouter.get("/:id", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.savedSet.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "세트를 찾을 수 없습니다." });
    return;
  }
  try {
    const data = JSON.parse(row.payload);
    res.json({ id: row.id, name: row.name, status: row.status, ...data });
  } catch {
    res.json({ id: row.id, name: row.name, status: row.status, raw: row.payload });
  }
});

setsRouter.put("/:id", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.savedSet.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "세트를 찾을 수 없습니다." });
    return;
  }
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const input = toInput(parsed.data, parsed.data.name);
  const computed = await computeSet(u.sub, input, prisma);
  const settings = await getOrCreateSettings(prisma);
  const payload = JSON.stringify({
    form: { ...parsed.data, name: parsed.data.name },
    computed,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const updated = await prisma.savedSet.update({
    where: { id: row.id },
    data: {
      name: parsed.data.name,
      payload,
      status: row.status === MaterialStatus.DRAFT ? MaterialStatus.DRAFT : MaterialStatus.SAVED,
    },
  });
  res.json({ id: updated.id, status: updated.status, computed });
});

setsRouter.post("/:id/copy", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.savedSet.findFirst({
    where: { id: req.params.id, userId: u.sub, status: MaterialStatus.SAVED },
  });
  if (!row) {
    res.status(404).json({ error: "복사할 세트를 찾을 수 없습니다." });
    return;
  }
  const baseName = row.name.replace(/\s*\(\d+\)\s*$/, "");
  const siblings = await prisma.savedSet.count({
    where: { userId: u.sub, name: { startsWith: baseName } },
  });
  const newName = `${baseName} (${siblings})`;
  const created = await prisma.savedSet.create({
    data: {
      userId: u.sub,
      name: newName,
      status: MaterialStatus.SAVED,
      payload: row.payload,
    },
  });
  res.json({ id: created.id, name: created.name });
});

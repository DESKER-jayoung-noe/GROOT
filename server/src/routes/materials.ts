import { Router } from "express";
import { z } from "zod";
import { MaterialStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { getOrCreateSettings } from "../lib/appSettings.js";
import { authMiddleware } from "../middleware/auth.js";
import { buildMaterialInput, computeMaterial } from "../lib/materialCalc.js";
import type { PlacementMode } from "../lib/yield.js";
import type { SheetId } from "../lib/yield.js";
import { parseSheetUnitPrices } from "../lib/sheetPricing.js";
export const materialsRouter = Router();

const edgeCustomSidesSchema = z.object({
  top: z.number().min(0).max(2).default(0),
  bottom: z.number().min(0).max(2).default(0),
  left: z.number().min(0).max(2).default(0),
  right: z.number().min(0).max(2).default(0),
});

const payloadSchema = z.object({
  wMm: z.number().min(0),
  dMm: z.number().min(0),
  hMm: z.number().min(0),
  color: z.string().default("WW"),
  boardMaterial: z.string().default("PB"),
  surfaceMaterial: z.string().default("LPM/O"),
  /** 구버전 호환용 */
  edgeProfileKey: z.string().optional(),
  edgePreset: z.enum(["none", "abs1t", "abs2t", "paint", "custom"]).optional(),
  edgeColor: z.string().default("WW"),
  edgeCustomSides: edgeCustomSidesSchema.optional(),
  placementMode: z.enum(["default", "rotated", "mixed"]),
  sheetPrices: z.record(z.string(), z.number().nonnegative()).optional(),
  selectedSheetId: z.string().nullable().optional(),
  formingM: z.number().nonnegative().default(0),
  rutaM: z.number().nonnegative().default(0),
  assemblyHours: z.number().nonnegative().default(0),
  washM2: z.number().nonnegative().default(0),
  /** 구버전 호환 (boring1Ea fallback) */
  boringEa: z.number().nonnegative().default(0),
  boring1Ea: z.number().nonnegative().default(0),
  boring2Ea: z.number().nonnegative().default(0),
  curvedEdgeM: z.number().nonnegative().default(0),
  curvedEdgeType: z.enum(["machining", "manual", ""]).default("machining"),
  /** 구버전 호환 (edge45TapingM fallback) */
  edge45M: z.number().nonnegative().default(0),
  edge45TapingM: z.number().nonnegative().default(0),
  edge45PaintType: z.string().default(""),
  edge45PaintM: z.number().nonnegative().default(0),
  ruta2M: z.number().nonnegative().default(0),
  unitFormingPerM: z.number().nonnegative().optional(),
  unitAssemblyPerH: z.number().nonnegative().optional(),
  unitWashPerM2: z.number().nonnegative().optional(),
});

function resolvedName(name: string | undefined): string {
  const t = name?.trim();
  return t && t.length > 0 ? t : "(무제)";
}

async function sheetPricesFromDb(): Promise<Record<SheetId, number>> {
  const settings = await getOrCreateSettings(prisma);
  return parseSheetUnitPrices(settings.sheetPricesJson);
}

async function buildInput(body: z.infer<typeof payloadSchema>) {
  // 클라이언트가 두께 기반 단가를 직접 전송한 경우 우선 사용,
  // 없으면 DB 저장 단가(관리자 설정)를 fallback으로 사용
  const bodyPrices = body.sheetPrices && Object.keys(body.sheetPrices).length > 0
    ? body.sheetPrices
    : null;
  const sheetPrices = bodyPrices ?? await sheetPricesFromDb();
  return buildMaterialInput({
    wMm: body.wMm,
    dMm: body.dMm,
    hMm: body.hMm,
    color: body.color,
    boardMaterial: body.boardMaterial,
    placementMode: body.placementMode as PlacementMode,
    edgePreset: body.edgePreset,
    edgeProfileKey: body.edgeProfileKey,
    edgeColor: body.edgeColor,
    edgeCustomSides: body.edgeCustomSides,
    sheetPrices,
    formingM: body.formingM,
    rutaM: body.rutaM,
    assemblyHours: body.assemblyHours,
    washM2: body.washM2,
    boringEa: body.boringEa,
    boring1Ea: body.boring1Ea,
    boring2Ea: body.boring2Ea,
    curvedEdgeM: body.curvedEdgeM,
    curvedEdgeType: body.curvedEdgeType,
    edge45M: body.edge45M,
    edge45TapingM: body.edge45TapingM,
    edge45PaintType: body.edge45PaintType,
    edge45PaintM: body.edge45PaintM,
    ruta2M: body.ruta2M,
    unitFormingPerM: body.unitFormingPerM,
    unitAssemblyPerH: body.unitAssemblyPerH,
    unitWashPerM2: body.unitWashPerM2,
  });
}

/** 저장 payload에는 DB 단가 스냅샷을 넣어 재계산 시 일관되게 사용 */
async function formPayloadForSave(body: z.infer<typeof payloadSchema>) {
  const sheetPrices = await sheetPricesFromDb();
  return { ...body, sheetPrices };
}

materialsRouter.get("/sheet-prices", authMiddleware, async (_req, res) => {
  const unitPrices = await sheetPricesFromDb();
  res.json({ unitPrices });
});

materialsRouter.post("/preview", authMiddleware, async (req, res) => {
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요.", details: parsed.error.flatten() });
    return;
  }
  const input = await buildInput(parsed.data);
  const sel = (parsed.data.selectedSheetId as SheetId | null) ?? null;
  const computed = computeMaterial(input, sel);
  const formOut = await formPayloadForSave(parsed.data);
  res.json({ input: { ...parsed.data, sheetPrices: formOut.sheetPrices }, computed });
});

const saveSchema = payloadSchema.extend({
  name: z.string().max(200).optional(),
});

materialsRouter.post("/draft", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const name = resolvedName(parsed.data.name);
  const input = await buildInput(parsed.data);
  const sel = (parsed.data.selectedSheetId as SheetId | null) ?? null;
  const computed = computeMaterial(input, sel);
  const settings = await getOrCreateSettings(prisma);
  const formSaved = await formPayloadForSave(parsed.data);
  const payload = JSON.stringify({
    form: { ...formSaved, name },
    computed,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const row = await prisma.material.create({
    data: {
      userId: u.sub,
      name,
      status: MaterialStatus.DRAFT,
      payload,
    },
  });
  res.json({ id: row.id, status: row.status, computed });
});

materialsRouter.post("/save", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const name = resolvedName(parsed.data.name);
  const input = await buildInput(parsed.data);
  const sel = (parsed.data.selectedSheetId as SheetId | null) ?? null;
  const computed = computeMaterial(input, sel);
  const settings = await getOrCreateSettings(prisma);
  const formSaved = await formPayloadForSave(parsed.data);
  const payload = JSON.stringify({
    form: { ...formSaved, name },
    computed,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const row = await prisma.material.create({
    data: {
      userId: u.sub,
      name,
      status: MaterialStatus.SAVED,
      payload,
    },
  });
  res.json({ id: row.id, status: row.status, computed });
});

materialsRouter.get("/list", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const status = req.query.status as string | undefined;
  const where: { userId: string; status?: MaterialStatus } = { userId: u.sub };
  if (status === "SAVED" || status === "DRAFT") where.status = status;
  const rows = await prisma.material.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });
  const list = rows.map((r) => {
    let preview = { grandTotalWon: 0, wMm: 0, dMm: 0, hMm: 0 };
    let color = "";
    let edge = "";
    let board = "";
    let sheetLabel = "";
    try {
      const p = JSON.parse(r.payload) as {
        computed?: { grandTotalWon: number; sheets?: { sheetId: string; label: string }[]; selectedSheetId?: string | null };
        form?: { wMm: number; dMm: number; hMm: number; color?: string; edgeProfileKey?: string; boardMaterial?: string };
      };
      preview = {
        grandTotalWon: p.computed?.grandTotalWon ?? 0,
        wMm: p.form?.wMm ?? 0,
        dMm: p.form?.dMm ?? 0,
        hMm: p.form?.hMm ?? 0,
      };
      color = p.form?.color ?? "";
      edge = p.form?.edgeProfileKey ?? "";
      board = p.form?.boardMaterial ?? "";
      const sid = p.computed?.selectedSheetId;
      const hit = p.computed?.sheets?.find((s) => s.sheetId === sid) ?? p.computed?.sheets?.[0];
      sheetLabel = hit?.label ?? "";
    } catch {
      /* ignore */
    }
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      updatedAt: r.updatedAt,
      grandTotalWon: preview.grandTotalWon,
      summary: `${preview.wMm}×${preview.dMm}×${preview.hMm} mm`,
      color,
      edge,
      board,
      sheetLabel,
    };
  });
  res.json(list);
});

materialsRouter.get("/:id", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.material.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "자재를 찾을 수 없습니다." });
    return;
  }
  try {
    const data = JSON.parse(row.payload);
    res.json({ id: row.id, name: row.name, status: row.status, ...data });
  } catch {
    res.json({ id: row.id, name: row.name, status: row.status, raw: row.payload });
  }
});

const putSchema = saveSchema.extend({
  finalize: z.boolean().optional(),
});

materialsRouter.put("/:id", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.material.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "자재를 찾을 수 없습니다." });
    return;
  }
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const name = resolvedName(parsed.data.name);
  const input = await buildInput(parsed.data);
  const sel = (parsed.data.selectedSheetId as SheetId | null) ?? null;
  const computed = computeMaterial(input, sel);
  const settings = await getOrCreateSettings(prisma);
  const formSaved = await formPayloadForSave(parsed.data);
  const payload = JSON.stringify({
    form: { ...formSaved, name },
    computed,
    _meta: { pricingVersion: settings.pricingVersion },
  });
  const nextStatus =
    parsed.data.finalize === true
      ? MaterialStatus.SAVED
      : row.status === MaterialStatus.DRAFT
        ? MaterialStatus.DRAFT
        : MaterialStatus.SAVED;
  const updated = await prisma.material.update({
    where: { id: row.id },
    data: {
      name,
      payload,
      status: nextStatus,
    },
  });
  res.json({ id: updated.id, status: updated.status, computed });
});

materialsRouter.delete("/:id", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.material.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "자재를 찾을 수 없습니다." });
    return;
  }
  await prisma.material.delete({ where: { id: row.id } });
  res.json({ ok: true });
});

materialsRouter.post("/:id/copy", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: { sub: string } }).user;
  const row = await prisma.material.findFirst({
    where: { id: req.params.id, userId: u.sub },
  });
  if (!row) {
    res.status(404).json({ error: "복사할 자재를 찾을 수 없습니다." });
    return;
  }
  const baseName = row.name.replace(/\s*\(\d+\)\s*$/, "");
  const siblings = await prisma.material.count({
    where: { userId: u.sub, name: { startsWith: baseName } },
  });
  const newName = `${baseName} (${siblings})`;
  const created = await prisma.material.create({
    data: {
      userId: u.sub,
      name: newName,
      status: row.status,
      payload: row.payload,
    },
  });
  res.json({ id: created.id, name: created.name });
});

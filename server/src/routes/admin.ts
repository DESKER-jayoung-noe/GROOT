import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import { getOrCreateSettings } from "../lib/appSettings.js";
import { MaterialStatus } from "@prisma/client";
import { buildMaterialInput, computeMaterial } from "../lib/materialCalc.js";
import type { SheetId } from "../lib/yield.js";
import type { PlacementMode } from "../lib/yield.js";
import {
  extractUnitPricesFromExcelRows,
  parseSheetUnitPrices,
  type SheetPricesDoc,
} from "../lib/sheetPricing.js";
export const adminRouter = Router();
adminRouter.use(authMiddleware, adminMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

adminRouter.get("/pricing", async (_req, res) => {
  const s = await getOrCreateSettings(prisma);
  res.json({
    pricingVersion: s.pricingVersion,
    sheetPricesJson: s.sheetPricesJson,
    edgePricesJson: s.edgePricesJson,
    processPricesJson: s.processPricesJson,
  });
});

const putSchema = z.object({
  sheetPricesJson: z.string().optional(),
  edgePricesJson: z.string().optional(),
  processPricesJson: z.string().optional(),
  bumpVersion: z.boolean().optional(),
});

adminRouter.put("/pricing", async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const cur = await getOrCreateSettings(prisma);
  const nextVersion = parsed.data.bumpVersion === false ? cur.pricingVersion : cur.pricingVersion + 1;
  const updated = await prisma.appSettings.update({
    where: { id: "global" },
    data: {
      pricingVersion: nextVersion,
      sheetPricesJson: parsed.data.sheetPricesJson ?? cur.sheetPricesJson,
      edgePricesJson: parsed.data.edgePricesJson ?? cur.edgePricesJson,
      processPricesJson: parsed.data.processPricesJson ?? cur.processPricesJson,
    },
  });
  res.json({
    pricingVersion: updated.pricingVersion,
    sheetPricesJson: updated.sheetPricesJson,
    edgePricesJson: updated.edgePricesJson,
    processPricesJson: updated.processPricesJson,
  });
});

/** 엑셀 업로드: 파일을 서버에 영구 저장하고, 행에서 4x6/4x8/6x8 단가를 추출해 DB에 반영 */
adminRouter.post("/upload-excel", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "파일이 없습니다." });
    return;
  }
  let rows: Record<string, unknown>[] = [];
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  } catch {
    res.status(400).json({ error: "엑셀 파싱에 실패했습니다." });
    return;
  }
  const cur = await getOrCreateSettings(prisma);
  const uploadDir = join(process.cwd(), "data", "uploads");
  mkdirSync(uploadDir, { recursive: true });
  const safeFile = `material-sheet-${Date.now()}.xlsx`;
  const relativePath = join("data", "uploads", safeFile).replace(/\\/g, "/");
  writeFileSync(join(process.cwd(), relativePath), req.file.buffer);

  const extracted = extractUnitPricesFromExcelRows(rows);
  const base = parseSheetUnitPrices(cur.sheetPricesJson);
  const unitPrices = {
    "4x6": extracted["4x6"] ?? base["4x6"],
    "4x8": extracted["4x8"] ?? base["4x8"],
    "6x8": extracted["6x8"] ?? base["6x8"],
  };
  const doc: SheetPricesDoc = {
    unitPrices,
    rows,
    excel: {
      filename: req.file.originalname || safeFile,
      relativePath,
      uploadedAt: new Date().toISOString(),
    },
  };
  const merged = JSON.stringify(doc);
  const updated = await prisma.appSettings.update({
    where: { id: "global" },
    data: {
      pricingVersion: cur.pricingVersion + 1,
      sheetPricesJson: merged,
    },
  });
  res.json({
    ok: true,
    pricingVersion: updated.pricingVersion,
    importedRows: rows.length,
    unitPrices,
    storedPath: relativePath,
  });
});

/** 저장된 자재 견적 재계산 (단가 로직은 기존 computeMaterial — 관리자 표는 향후 연동) */
adminRouter.post("/recalculate-all", async (_req, res) => {
  const settings = await getOrCreateSettings(prisma);
  const mats = await prisma.material.findMany({
    where: { status: MaterialStatus.SAVED },
  });
  let updated = 0;
  for (const m of mats) {
    try {
      const data = JSON.parse(m.payload) as { form?: Record<string, unknown> };
      const form = data.form;
      if (!form) continue;
      const f = form as {
        wMm: number;
        dMm: number;
        hMm: number;
        color: string;
        boardMaterial: string;
        edgeProfileKey?: string;
        edgePreset?: "none" | "abs1t" | "abs2t" | "custom";
        edgeCustomSides?: { top: number; bottom: number; left: number; right: number };
        placementMode: PlacementMode;
        sheetPrices?: Record<string, number>;
        selectedSheetId?: string | null;
        formingM: number;
        rutaM: number;
        assemblyHours: number;
        washM2: number;
        boringEa: number;
        curvedEdgeM: number;
        edge45M: number;
      };
      const liveSheet = parseSheetUnitPrices(settings.sheetPricesJson);
      const sheetPrices = {
        "4x6": liveSheet["4x6"],
        "4x8": liveSheet["4x8"],
        "6x8": liveSheet["6x8"],
      } as Partial<Record<SheetId, number>>;
      const computed = computeMaterial(
        buildMaterialInput({
          wMm: f.wMm,
          dMm: f.dMm,
          hMm: f.hMm,
          color: f.color,
          boardMaterial: f.boardMaterial,
          placementMode: f.placementMode,
          edgePreset: f.edgePreset,
          edgeProfileKey: f.edgeProfileKey,
          edgeCustomSides: f.edgeCustomSides,
          sheetPrices,
          formingM: f.formingM,
          rutaM: f.rutaM,
          assemblyHours: f.assemblyHours,
          washM2: f.washM2,
          boringEa: f.boringEa,
          curvedEdgeM: f.curvedEdgeM,
          edge45M: f.edge45M,
        }),
        (f.selectedSheetId as SheetId | null) ?? null
      );
      const oldG = (data as { computed?: { grandTotalWon?: number } }).computed?.grandTotalWon;
      const newG = computed.grandTotalWon;
      const formNext = {
        ...f,
        sheetPrices: {
          "4x6": liveSheet["4x6"],
          "4x8": liveSheet["4x8"],
          "6x8": liveSheet["6x8"],
        },
      };
      const payload = JSON.stringify({
        form: formNext,
        computed,
        _meta: { pricingVersion: settings.pricingVersion, lastRecalculatedAt: new Date().toISOString() },
        _pricingDelta:
          oldG !== undefined && oldG !== newG ? { before: oldG, after: newG } : undefined,
      });
      await prisma.material.update({ where: { id: m.id }, data: { payload } });
      updated++;
    } catch {
      /* skip */
    }
  }
  res.json({ ok: true, materialsUpdated: updated, pricingVersion: settings.pricingVersion });
});

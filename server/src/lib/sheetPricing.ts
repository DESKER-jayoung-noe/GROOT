import type { SheetId } from "./yield.js";

const IDS: SheetId[] = ["4x6", "4x8", "6x8"];

const DEFAULT_UNIT: Record<SheetId, number> = {
  "4x6": 55302,
  "4x8": 63883,
  "6x8": 71420,
};

/** 엑셀 행에서 원장 단가(4x6/4x8/6x8)를 추출 — 헤더·셀 문자열에 규격 키워드가 있으면 매핑 */
export function extractUnitPricesFromExcelRows(rows: Record<string, unknown>[]): Partial<Record<SheetId, number>> {
  const out: Partial<Record<SheetId, number>> = {};
  const norm = (s: string) => s.replace(/\s/g, "").replace(/×/g, "x").toLowerCase();

  for (const row of rows) {
    for (const [rawK, rawV] of Object.entries(row)) {
      const k = norm(String(rawK));
      const n = typeof rawV === "number" ? rawV : Number(String(rawV).replace(/,/g, ""));
      if (!Number.isFinite(n) || n <= 0) continue;

      if (k.includes("4x6") || k.includes("4×6") || k === "46") out["4x6"] = n;
      if (k.includes("4x8") || k.includes("4×8") || k === "48") out["4x8"] = n;
      if (k.includes("6x8") || k.includes("6×8") || k === "68") out["6x8"] = n;
    }
  }

  // 한 행에 숫자만 3개 있는 경우(순서: 4x6, 4x8, 6x8) 추정
  if (Object.keys(out).length === 0 && rows.length > 0) {
    const nums = rows
      .flatMap((row) => Object.values(row))
      .map((v) => (typeof v === "number" ? v : Number(String(v).replace(/,/g, ""))))
      .filter((n) => Number.isFinite(n) && n > 1000);
    if (nums.length >= 3) {
      out["4x6"] = nums[0]!;
      out["4x8"] = nums[1]!;
      out["6x8"] = nums[2]!;
    }
  }

  return out;
}

export type SheetPricesDoc = {
  unitPrices?: Partial<Record<SheetId, number>>;
  /** 레거시: 엑셀만 업로드된 경우 */
  rows?: unknown[];
  /** 저장된 엑셀 (서버 로컬 경로) */
  excel?: { filename: string; relativePath: string; uploadedAt: string };
};

export function parseSheetUnitPrices(sheetPricesJson: string): Record<SheetId, number> {
  const base = { ...DEFAULT_UNIT };
  if (!sheetPricesJson || sheetPricesJson === "{}") return base;

  try {
    const j = JSON.parse(sheetPricesJson) as SheetPricesDoc | Record<string, unknown>;

    if (j && typeof j === "object" && "unitPrices" in j && j.unitPrices && typeof j.unitPrices === "object") {
      for (const id of IDS) {
        const v = (j.unitPrices as Record<string, number>)[id];
        if (typeof v === "number" && v >= 0) base[id] = v;
      }
      return base;
    }

    // 플랫 { "4x6": n, ... }
    let flat = false;
    for (const id of IDS) {
      const v = (j as Record<string, unknown>)[id];
      if (typeof v === "number" && v >= 0) {
        base[id] = v;
        flat = true;
      }
    }
    if (flat) return base;

    // 레거시: { uploadedAt, rows } 만 있는 경우 rows에서 추출
    if (Array.isArray((j as SheetPricesDoc).rows)) {
      const rows = (j as SheetPricesDoc).rows as Record<string, unknown>[];
      const ext = extractUnitPricesFromExcelRows(rows);
      for (const id of IDS) {
        if (typeof ext[id] === "number") base[id] = ext[id]!;
      }
    }
  } catch {
    /* ignore */
  }

  return base;
}

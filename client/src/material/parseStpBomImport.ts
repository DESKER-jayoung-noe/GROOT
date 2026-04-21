/**
 * BOM(.bom.3 등 텍스트)에서 자재 행 파싱.
 * 지원: TSV/CSV(이름, 코드, W, D, T) 또는 JSON 배열 [{ name, partCode, wMm, dMm, hMm }].
 * STP 기하 파싱은 미구현 — 파일 존재 여부만 검증합니다.
 */
export type BomPartLine = {
  name: string;
  partCode: string;
  wMm: number;
  dMm: number;
  hMm: number;
};

function pushIfValid(out: BomPartLine[], name: string, code: string, w: number, d: number, h: number) {
  if (!name || !Number.isFinite(w) || !Number.isFinite(d) || !Number.isFinite(h)) return;
  if (w <= 0 || d <= 0 || h <= 0) return;
  out.push({ name, partCode: code.trim() || "-", wMm: w, dMm: d, hMm: h });
}

export async function parseStpBomFiles(stp: File, bom: File): Promise<BomPartLine[]> {
  void stp;
  const bomText = await bom.text();
  const lines = bomText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const out: BomPartLine[] = [];

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("//")) continue;
    const parts = line.split(/[\t,;|]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 5) {
      pushIfValid(out, parts[0]!, parts[1] ?? "", Number(parts[2]), Number(parts[3]), Number(parts[4]));
    }
  }
  if (out.length > 0) return out;

  try {
    const j = JSON.parse(bomText) as unknown;
    if (Array.isArray(j)) {
      for (const item of j) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const name = String(o.name ?? o.partName ?? "").trim();
        const partCode = String(o.partCode ?? o.code ?? "").trim();
        const wMm = Number(o.wMm ?? o.w ?? 0);
        const dMm = Number(o.dMm ?? o.d ?? 0);
        const hMm = Number(o.hMm ?? o.h ?? o.t ?? 0);
        pushIfValid(out, name, partCode, wMm, dMm, hMm);
      }
    }
  } catch {
    /* ignore */
  }

  return out;
}

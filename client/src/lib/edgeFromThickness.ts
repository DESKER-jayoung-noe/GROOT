export function resolveEdgeProfileKey(hMm: number, color: string): string {
  if (!Number.isFinite(hMm) || hMm <= 0) return "4면 ABS 1T";
  const bi = color === "BI";
  if (hMm <= 15) return bi ? "ABS2×19_BI" : "ABS1×19_WW";
  if (hMm <= 18) return bi ? "ABS1×21_BI" : "ABS1×21_WW";
  return bi ? "ABS2×26_BI" : "ABS2×26_WW";
}

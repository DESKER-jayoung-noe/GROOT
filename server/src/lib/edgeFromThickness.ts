/**
 * 원자재 두께(H, mm)에 따른 ABS 엣지 단면 자동 선택.
 *
 * 사업부 산출 관례(예: 데스커 DD13R 멀티책상세트 공장판매가·가공비 세부내역 시트)와 동일한 매핑을 쓰도록 맞춤:
 * - 15T 전후 → 1×19 계열
 * - 18T 전후 → 두께 21 엣지
 * - 22T 전후 → 두께 26 엣지
 *
 * 색상: BI는 BI 단가 키, 그 외(WW/OHN/NBK 등)는 WW 엣지 단가 키를 사용합니다.
 */

export function resolveEdgeProfileKey(hMm: number, color: string): string {
  if (!Number.isFinite(hMm) || hMm <= 0) {
    return "4면 ABS 1T";
  }

  const bi = color === "BI";

  if (hMm <= 15) {
    return bi ? "ABS2×19_BI" : "ABS1×19_WW";
  }
  if (hMm <= 18) {
    return bi ? "ABS1×21_BI" : "ABS1×21_WW";
  }
  return bi ? "ABS2×26_BI" : "ABS2×26_WW";
}

/** UI용 짧은 설명 */
export function describeAutoEdge(hMm: number, key: string): string {
  if (!Number.isFinite(hMm) || hMm <= 0) return "두께 입력 후 자동 선택";
  const tier = hMm <= 15 ? "1×19" : hMm <= 18 ? "1×21" : "2×26";
  return `${hMm}T → ${tier} (${key})`;
}

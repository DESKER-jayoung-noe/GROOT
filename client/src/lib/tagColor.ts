/**
 * 태그 이름 → 결정론적 색상 매핑
 * - "공용" 은 항상 그레이 팔레트 고정
 * - 그 외 태그는 이름 해시 기반으로 8개 팔레트 중 선택
 */

export const TAG_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "#E6F1FB", fg: "#0C447C" }, // 0 파랑
  { bg: "#FAECE7", fg: "#993C1D" }, // 1 주황
  { bg: "#E1F5EE", fg: "#085041" }, // 2 초록
  { bg: "#FAEEDA", fg: "#633806" }, // 3 노랑-갈색
  { bg: "#EEEDFE", fg: "#3C3489" }, // 4 보라
  { bg: "#FDE9F0", fg: "#7A1B49" }, // 5 분홍
  { bg: "#E5F0F2", fg: "#0E4F58" }, // 6 청록
  { bg: "#F1EFE8", fg: "#5F5E5A" }, // 7 뉴트럴 (공용 기본)
];

const NEUTRAL = TAG_PALETTE[7];

export function getTagColor(tag: string): { bg: string; fg: string } {
  if (tag === "공용") return NEUTRAL;
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

export function formatWon(n: number) {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

/** 예: 5,564원 (레퍼런스 UI용) */
export function formatWonKorean(n: number) {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

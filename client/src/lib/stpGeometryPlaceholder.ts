/**
 * STP 업로드 후 규격(W×D×H) 자동 입력 — 서버 파싱 API 연동 시 이 함수 본문만 교체하면 됩니다.
 * @returns 치수(mm). 파싱 전/실패 시 null
 */
export async function fetchStpBoundingBoxMm(_file: File): Promise<{ wMm: number; dMm: number; hMm: number } | null> {
  void _file;
  return null;
}

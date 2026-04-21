/** 단일 HTML을 `file://`로 열 때 — fetch(`/api/...`) 대신 로컬 저장소를 사용 */
export function isOfflineFile(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

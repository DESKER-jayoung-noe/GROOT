import { api } from "./api";

export function postRecent(token: string | null, targetType: string, targetId: string) {
  if (!token) return Promise.resolve();
  return api("/me/recents", {
    method: "POST",
    body: JSON.stringify({ targetType, targetId }),
    token,
  });
}

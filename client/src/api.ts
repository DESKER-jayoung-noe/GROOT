import { isOfflineFile } from "./offline/isOffline";
import { offlineApi } from "./offline/offlineApi";

const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts: RequestInit & { token?: string | null } = {}): Promise<T> {
  if (typeof window !== "undefined" && isOfflineFile()) {
    return offlineApi<T>(path, opts);
  }
  const headers = new Headers(opts.headers);
  if (!headers.has("Content-Type") && opts.body && typeof opts.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  const { token, ...rest } = opts;
  const r = await fetch(`${BASE}${path}`, { ...rest, headers });
  const text = await r.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!r.ok) {
    const msg = typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : r.statusText;
    throw new ApiError(msg, r.status);
  }
  return data as T;
}

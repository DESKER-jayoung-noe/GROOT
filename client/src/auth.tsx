import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { isOfflineFile } from "./offline/isOffline";

export type User = { id: string; username: string; role: "USER" | "ADMIN" };

type AuthState = {
  token: string | null;
  user: User | null;
  setAuth: (token: string | null, user: User | null) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "lcc_token";

/** 단일 HTML(file://) 빌드 */
export const OFFLINE_FILE_TOKEN = "__offline_local__";
/** 브라우저에서 서버 로그인 없이 쓰는 기본값 — 로컬 저장소(IndexedDB/LS)만 사용 */
export const LOCAL_PC_TOKEN = "__local_pc__";

/** 서버에 보낼 수 있는 Bearer 토큰인지 */
export function isServerAuthToken(token: string | null | undefined): boolean {
  return !!token && token !== OFFLINE_FILE_TOKEN && token !== LOCAL_PC_TOKEN;
}

function initialToken(): string | null {
  if (typeof window !== "undefined" && isOfflineFile()) return OFFLINE_FILE_TOKEN;
  return localStorage.getItem(STORAGE_KEY) ?? LOCAL_PC_TOKEN;
}

function initialUser(): User | null {
  if (typeof window !== "undefined" && isOfflineFile()) {
    return { id: "local", username: "로컬 PC", role: "ADMIN" };
  }
  const raw = localStorage.getItem("lcc_user");
  if (raw) {
    try {
      return JSON.parse(raw) as User;
    } catch {
      /* fall through */
    }
  }
  return { id: "local", username: "로컬 PC", role: "USER" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<User | null>(initialUser);

  const setAuth = useCallback((t: string | null, u: User | null) => {
    if (!t || !u) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("lcc_user");
      setToken(LOCAL_PC_TOKEN);
      setUser({ id: "local", username: "로컬 PC", role: "USER" });
      return;
    }
    setToken(t);
    setUser(u);
    localStorage.setItem(STORAGE_KEY, t);
    localStorage.setItem("lcc_user", JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("lcc_user");
    setToken(LOCAL_PC_TOKEN);
    setUser({ id: "local", username: "로컬 PC", role: "USER" });
  }, []);

  const value = useMemo(() => ({ token, user, setAuth, logout }), [token, user, setAuth, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

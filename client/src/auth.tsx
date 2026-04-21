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

function initialToken(): string | null {
  if (typeof window !== "undefined" && isOfflineFile()) return "__offline_local__";
  return localStorage.getItem(STORAGE_KEY);
}

function initialUser(): User | null {
  if (typeof window !== "undefined" && isOfflineFile()) {
    return { id: "local", username: "로컬 PC", role: "ADMIN" };
  }
  const raw = localStorage.getItem("lcc_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<User | null>(initialUser);

  const setAuth = useCallback((t: string | null, u: User | null) => {
    setToken(t);
    setUser(u);
    if (t) localStorage.setItem(STORAGE_KEY, t);
    else localStorage.removeItem(STORAGE_KEY);
    if (u) localStorage.setItem("lcc_user", JSON.stringify(u));
    else localStorage.removeItem("lcc_user");
  }, []);

  const logout = useCallback(() => setAuth(null, null), [setAuth]);

  const value = useMemo(() => ({ token, user, setAuth, logout }), [token, user, setAuth, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

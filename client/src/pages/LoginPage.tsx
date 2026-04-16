import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

export function LoginPage() {
  const nav = useNavigate();
  const { setAuth, token } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) nav("/home", { replace: true });
  }, [token, nav]);

  async function submit() {
    setErr(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const res = await api<{ token: string; user: { id: string; username: string; role: "USER" | "ADMIN" } }>(path, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setAuth(res.token, res.user);
      nav("/home", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">목재 견적 계산기</h1>
        <p className="text-sm text-slate-500 mb-6">아이디와 비밀번호로 {mode === "login" ? "로그인" : "회원가입"}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">아이디</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e6fff]/40"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">비밀번호</label>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e6fff]/40"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="w-full rounded-lg bg-[#1e6fff] text-white py-2.5 text-sm font-medium hover:bg-[#185dcc] disabled:opacity-60"
          >
            {loading ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>
          <button
            type="button"
            className="w-full text-sm text-[#1e6fff]"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setErr(null);
            }}
          >
            {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
          </button>
        </div>
      </div>
    </div>
  );
}

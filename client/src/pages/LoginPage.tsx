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
    if (token) nav("/add", { replace: true });
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
      nav("/add", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: "24px",
        fontFamily: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "40px 36px",
          boxShadow: "var(--shadow-md)",
        }}
      >
        {/* Brand */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--text1)", marginBottom: "4px" }}>
            목재 견적 <span style={{ color: "var(--blue)" }}>계산기</span>
          </div>
          <p style={{ fontSize: "14px", color: "var(--text3)", margin: 0 }}>
            {mode === "login" ? "아이디와 비밀번호로 로그인" : "새 계정을 만드세요"}
          </p>
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label
              style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text2)", marginBottom: "6px" }}
            >
              아이디
            </label>
            <input
              className="tds-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              autoComplete="username"
              placeholder="아이디 입력"
            />
          </div>
          <div>
            <label
              style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text2)", marginBottom: "6px" }}
            >
              비밀번호
            </label>
            <input
              type="password"
              className="tds-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="비밀번호 입력"
            />
          </div>

          {err && (
            <div
              style={{
                fontSize: "13px",
                color: "var(--red)",
                background: "var(--red-bg)",
                border: "1px solid rgba(240,68,82,0.2)",
                borderRadius: "var(--radius-xs)",
                padding: "10px 14px",
              }}
            >
              {err}
            </div>
          )}

          <button
            type="button"
            className="tds-btn-primary"
            style={{ width: "100%", marginTop: "4px" }}
            onClick={() => void submit()}
            disabled={loading}
          >
            {loading ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>

          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              color: "var(--text3)",
              padding: "4px",
              fontFamily: "inherit",
              textAlign: "center",
            }}
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); }}
          >
            {mode === "login" ? "계정이 없으신가요? " : "이미 계정이 있으신가요? "}
            <span style={{ color: "var(--blue)", fontWeight: 600 }}>
              {mode === "login" ? "회원가입" : "로그인"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

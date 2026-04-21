import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ProjectProvider } from "../context/ProjectContext";
import { QuoteTabsProvider } from "../context/QuoteTabsContext";
import { isOfflineFile } from "../offline/isOffline";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const QUOTE_PATHS = ["/material", "/product", "/set", "/compare"];

function MainLayoutInner() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const offline = typeof window !== "undefined" && isOfflineFile();
  const loc = useLocation();

  const isQuotePath = QUOTE_PATHS.some((p) => loc.pathname === p || loc.pathname.startsWith(p + "/"));
  const showSidebar = !loc.pathname.startsWith("/admin");

  if (isQuotePath) {
    // Full-viewport 2-column layout: sidebar + content (no top header)
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          overflow: "hidden",
          fontFamily: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
        }}
      >
        {showSidebar && <WorkspaceSidebar />}
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Outlet />
        </main>
      </div>
    );
  }

  // Standard layout with top header (admin, archive, etc.)
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
      <header style={{ height: "56px", flexShrink: 0, borderBottom: "1px solid var(--border)", background: "var(--surface)", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0 20px", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
          {user?.role === "ADMIN" && (
            <NavLink
              to="/admin/db"
              style={({ isActive }) => ({
                fontSize: "13px",
                fontWeight: 500,
                borderRadius: "var(--radius-xs)",
                padding: "5px 10px",
                textDecoration: "none",
                transition: "all 0.15s",
                color: isActive ? "var(--blue)" : "var(--text3)",
                background: isActive ? "var(--blue-bg)" : "transparent",
              })}
            >
              관리자 DB
            </NavLink>
          )}
          {offline && (
            <span style={{ fontSize: "11px", color: "var(--text3)" }} title="단일 HTML 파일 모드">
              로컬 저장
            </span>
          )}
        </div>

        <nav style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NavLink
            to="/material"
            style={({ isActive }) => ({
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              textDecoration: "none",
              transition: "all 0.15s",
              color: isActive ? "var(--blue)" : "var(--text1)",
            })}
          >
            견적내기
          </NavLink>
          <NavLink
            to="/compare"
            style={({ isActive }) => ({
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              textDecoration: "none",
              transition: "all 0.15s",
              color: isActive ? "var(--blue)" : "var(--text1)",
            })}
          >
            견적비교하기
          </NavLink>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "flex-end" }}>
          {!offline && (
            <>
              <span style={{ fontSize: "13px", color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "10rem" }}>{user?.username}</span>
              <button
                type="button"
                style={{ fontSize: "13px", color: "var(--text3)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                onClick={() => { logout(); nav("/login"); }}
              >
                로그아웃
              </button>
            </>
          )}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {showSidebar && <WorkspaceSidebar />}
        <main style={{ display: "flex", minHeight: 0, minWidth: 0, flex: 1, flexDirection: "column", overflowY: "auto", overflowX: "hidden" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function MainLayout() {
  return (
    <ProjectProvider>
      <QuoteTabsProvider>
        <MainLayoutInner />
      </QuoteTabsProvider>
    </ProjectProvider>
  );
}

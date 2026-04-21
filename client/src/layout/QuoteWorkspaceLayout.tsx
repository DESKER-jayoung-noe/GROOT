import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useProject } from "../context/ProjectContext";

export type QuoteOutletContext = {
  setMaterialBanner: (m: string | null) => void;
};

export function QuoteWorkspaceLayout() {
  const { activeProjectId } = useProject();
  const loc = useLocation();

  const [materialBanner, setMaterialBanner] = useState<string | null>(null);

  const isMaterialPath = loc.pathname === "/material" || loc.pathname.endsWith("/material");

  useEffect(() => {
    if (!materialBanner) return;
    const t = window.setTimeout(() => setMaterialBanner(null), 4500);
    return () => clearTimeout(t);
  }, [materialBanner]);

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: "14px 14px",
    fontSize: "13px",
    fontWeight: 500,
    textDecoration: "none",
    display: "inline-block",
    transition: "all 0.15s",
    color: isActive ? "var(--blue)" : "var(--text3)",
    borderBottom: `2px solid ${isActive ? "var(--blue)" : "transparent"}`,
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
  });

  return (
    <div key={activeProjectId} className="relative flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      {/* Shared tab nav */}
      <nav style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "0 24px", display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
        <NavLink to="/material" style={({ isActive }) => tabStyle(isActive)}>견적내기</NavLink>
        <NavLink to="/compare" style={({ isActive }) => tabStyle(isActive)}>견적비교하기</NavLink>
      </nav>

      {isMaterialPath && materialBanner ? (
        <div className="shrink-0 border-b px-4 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <span className="text-sm font-medium tabular-nums" style={{ color: "var(--blue)" }} role="status">
            {materialBanner}
          </span>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet
          context={
            {
              setMaterialBanner,
            } satisfies QuoteOutletContext
          }
        />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ProjectProvider } from "../context/ProjectContext";
import { QuoteTabsProvider } from "../context/QuoteTabsContext";
import { openCompareModal } from "../components/CompareModal";
import { DBModal } from "../components/DBModal";
import { isOfflineFile } from "../offline/isOffline";
import { AppSidebar } from "./AppSidebar";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { TreeProvider, useTree } from "../context/TreeContext";
import { getMaterials } from "../offline/stores";
import {
  computeMaterial,
  buildMaterialInput,
  effectiveYieldPlacementMode,
} from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import { UploadFlow } from "../material/quote/UploadFlow";

const QUOTE_PATHS = ["/material", "/product", "/set", "/compare"];



function QuoteShell() {
  const [dbOpen, setDbOpen] = useState(false);
  const { lastSavedAt, treeNodes } = useTree();
  const [showSaved, setShowSaved] = useState(false);

  /** 헤더 "도면/모델링 업로드" — 어디서든 같은 동작.
   *  업로드/검토 모달은 UploadFlow (이 컴포넌트 하단에 마운트) 가 전역 이벤트 수신해서 띄움 */
  const handleOpenUpload = useCallback(() => {
    window.dispatchEvent(new CustomEvent("groot:open-upload"));
  }, []);

  useEffect(() => {
    if (!lastSavedAt) return;
    setShowSaved(true);
    const t = window.setTimeout(() => setShowSaved(false), 1500);
    return () => clearTimeout(t);
  }, [lastSavedAt]);

  /** 현재 프로젝트 자재 전체를 CSV로 내보내기 */
  const handleExport = useCallback(() => {
    const materials = getMaterials();
    const matMap = new Map(materials.map((m) => [m.id, m]));

    const headers = [
      "세트명", "단품명", "자재명",
      "W", "D", "T",
      "소재", "표면재", "색상",
      "원재료비", "엣지비", "가공비", "합계",
    ];

    const rows: string[][] = [];
    let currentSet  = "";
    let currentItem = "";

    for (const node of treeNodes) {
      if (node.type === "divider") {
        currentSet  = "";
        currentItem = "";
      } else if (node.type === "set") {
        currentSet  = node.name ?? "";
        currentItem = "";
      } else if (node.type === "item") {
        currentItem = node.name ?? "";
      } else if (node.type === "mat" && node.id) {
        const mat = matMap.get(node.id);
        if (!mat) continue;

        const f = mat.form;
        let matCost = 0, edgeCost = 0, procCost = 0, total = 0;
        try {
          const input = buildMaterialInput({
            ...f,
            placementMode: effectiveYieldPlacementMode(f.placementMode, f.cutOrientation),
            sheetPrices: f.sheetPrices as Partial<Record<SheetId, number>>,
          });
          const c = computeMaterial(input, (f.selectedSheetId ?? null) as SheetId | null);
          matCost  = Math.ceil(c.materialCostWon);
          edgeCost = Math.ceil(c.edgeCostWon + c.hotmeltCostWon);
          procCost = Math.ceil(c.processingTotalWon);
          total    = Math.ceil(c.grandTotalWon);
        } catch { /* 계산 오류 무시 */ }

        rows.push([
          currentSet,
          currentItem,
          f.name || "이름 없음",
          String(f.wMm),
          String(f.dMm),
          String(f.hMm),
          f.boardMaterial,
          f.surfaceMaterial,
          f.color,
          String(matCost),
          String(edgeCost),
          String(procCost),
          String(total),
        ]);
      }
    }

    if (rows.length === 0) {
      alert("내보낼 자재가 없습니다.");
      return;
    }

    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `desker_견적_${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [treeNodes]);

  return (
    <div className="desker-shell">
      {/* Global header */}
      <header className="g-header">
        <span className="g-logo">DESKER</span>

        {/* Autosave indicator */}
        <span className="g-autosave" style={{ opacity: showSaved ? 1 : 0, transition: "opacity 0.3s" }}>
          <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M2 6.5L4.5 9L10 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          ✓ 자동 저장됨
        </span>

        {/* Action buttons */}
        <div className="g-header-btns">
          <button
            type="button"
            className="g-btn"
            onClick={() => openCompareModal()}
          >
            비교하기
          </button>
          <button
            type="button"
            className="g-btn"
            onClick={handleOpenUpload}
          >
            도면/모델링 업로드
          </button>
          <button type="button" className="g-btn" onClick={handleExport}>
            내보내기
          </button>
          <button type="button" className="g-btn" onClick={() => setDbOpen(true)}>
            DB
          </button>
        </div>
      </header>

      {/* Body: sidebar + main content */}
      <div className="app">
        <AppSidebar />
        <div className="main">
          <Outlet />
        </div>
      </div>

      {dbOpen && <DBModal onClose={() => setDbOpen(false)} />}

      {/* 업로드/검토 모달 — 라우트 무관, 한 번만 마운트 */}
      <UploadFlow />
    </div>
  );
}

function StandardLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const offline = typeof window !== "undefined" && isOfflineFile();
  const loc = useLocation();
  const showSidebar = !loc.pathname.startsWith("/admin");

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
      <header
        style={{
          height: "56px",
          flexShrink: 0,
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 20px",
          gap: "12px",
        }}
      >
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
          <button
            type="button"
            style={{
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              color: "var(--text1)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            onClick={() => openCompareModal()}
          >
            견적비교하기
          </button>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "flex-end" }}>
          {!offline && (
            <>
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--text2)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "10rem",
                }}
              >
                {user?.username}
              </span>
              <button
                type="button"
                style={{
                  fontSize: "13px",
                  color: "var(--text3)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onClick={() => { logout(); nav("/material"); }}
              >
                로그아웃
              </button>
            </>
          )}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {showSidebar && (
          <WorkspaceSidebar
            wide
            pinned
            onPinnedChange={() => {}}
            onHoverChange={() => {}}
            pinUi={false}
          />
        )}
        <main
          style={{
            display: "flex",
            minHeight: 0,
            minWidth: 0,
            flex: 1,
            flexDirection: "column",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function MainLayoutInner() {
  const loc = useLocation();
  const isQuotePath = QUOTE_PATHS.some(
    (p) => loc.pathname === p || loc.pathname.startsWith(p + "/")
  );

  if (isQuotePath) {
    return <QuoteShell />;
  }

  return <StandardLayout />;
}

export function MainLayout() {
  return (
    <ProjectProvider>
      <QuoteTabsProvider>
        <TreeProvider>
          <MainLayoutInner />
        </TreeProvider>
      </QuoteTabsProvider>
    </ProjectProvider>
  );
}

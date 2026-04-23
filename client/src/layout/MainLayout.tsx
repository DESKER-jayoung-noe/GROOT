import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ProjectProvider } from "../context/ProjectContext";
import { QuoteTabsProvider } from "../context/QuoteTabsContext";
import { openCompareModal } from "../components/CompareModal";
import { isOfflineFile } from "../offline/isOffline";
import { AppSidebar } from "./AppSidebar";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { TreeProvider, useTree } from "../context/TreeContext";

const QUOTE_PATHS = ["/material", "/product", "/set", "/compare"];

const ACCEPTED_EXTENSIONS = ".zip,.stp,.pdf,.dwg";

function UploadModal({ onClose }: { onClose: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...selected]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,.35)",
          zIndex: 400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseDown={onClose}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "10px",
            width: "min(480px, 94vw)",
            boxShadow: "0 16px 48px rgba(0,0,0,.18)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "modalIn .18s ease",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Head */}
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid #f0f0f0",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 700, flex: 1 }}>도면/모델링 업로드</span>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "#aaa",
                fontSize: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                fontFamily: "inherit",
              }}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: "20px" }}>
            {/* Drop zone */}
            <label
              style={{
                display: "block",
                border: dragging ? "2px dashed #1a1a1a" : "2px dashed #d0d0d0",
                borderRadius: "8px",
                padding: "32px 20px",
                textAlign: "center",
                cursor: "pointer",
                background: dragging ? "#f8f8f8" : "#fafafa",
                transition: "all .15s",
                marginBottom: "14px",
              }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <div style={{ fontSize: "28px", marginBottom: "8px", color: "#bbb" }}>&#8679;</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#555", marginBottom: "4px" }}>
                파일을 여기에 드래그하거나 클릭해서 선택하세요
              </div>
              <div style={{ fontSize: "11px", color: "#aaa" }}>
                지원 형식: .zip, .stp, .pdf, .dwg
              </div>
              <input
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                multiple
                style={{ display: "none" }}
                onChange={handleFileInput}
              />
            </label>

            {/* File list */}
            {files.length > 0 && (
              <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {files.map((f, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      background: "#f5f5f5",
                      borderRadius: 5,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#333" }}>
                      {f.name}
                    </span>
                    <span style={{ fontSize: 11, color: "#aaa", flexShrink: 0 }}>
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "#ccc", fontSize: 14, fontFamily: "inherit" }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn-ghost" onClick={onClose}>
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={onClose}
                disabled={files.length === 0}
                style={files.length === 0 ? { opacity: 0.4, cursor: "default" } : undefined}
              >
                업로드
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function QuoteShell() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const { lastSavedAt } = useTree();
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (!lastSavedAt) return;
    setShowSaved(true);
    const t = window.setTimeout(() => setShowSaved(false), 1500);
    return () => clearTimeout(t);
  }, [lastSavedAt]);

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
            onClick={() => setUploadOpen(true)}
          >
            도면/모델링 업로드
          </button>
          <button type="button" className="g-btn">
            내보내기
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

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
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

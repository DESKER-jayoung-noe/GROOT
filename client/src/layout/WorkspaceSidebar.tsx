import { useCallback, useEffect, useRef, useState } from "react";
import { useProject } from "../context/ProjectContext";

export function WorkspaceSidebar() {
  const { projects, activeProjectId, setActiveProjectId, addProject, renameProject } = useProject();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const commitRename = useCallback(() => {
    if (!editingId) return;
    renameProject(editingId, draft);
    setEditingId(null);
  }, [editingId, draft, renameProject]);

  const cancelRename = useCallback(() => setEditingId(null), []);

  return (
    <aside
      style={{
        width: "200px",
        flexShrink: 0,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        fontFamily: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
      }}
    >
      {/* Brand */}
      <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text1)" }}>
          목재 견적 <span style={{ color: "var(--blue)" }}>계산기</span>
        </div>
      </div>

      {/* Projects section */}
      <div style={{ padding: "14px 12px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px", marginBottom: "5px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--text3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            프로젝트
          </div>
          <button
            type="button"
            onClick={addProject}
            title="새 프로젝트"
            style={{ width: "20px", height: "20px", borderRadius: "5px", border: "1px solid var(--border2)", background: "none", cursor: "pointer", color: "var(--text3)", fontSize: "16px", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}
          >
            +
          </button>
        </div>
      </div>

      {/* Project list */}
      <nav style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px" }}>
        {projects.map((p) => {
          const active = p.id === activeProjectId;
          const editing = editingId === p.id;
          return (
            <div key={p.id} style={{ marginBottom: "1px" }}>
              {editing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                    if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                  }}
                  style={{ width: "100%", borderRadius: "8px", border: "1px solid var(--blue)", padding: "8px 10px", fontSize: "13px", color: "var(--text1)", outline: "none", background: "white", fontFamily: "inherit" }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveProjectId(p.id)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setEditingId(p.id);
                    setDraft(p.name);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    background: active ? "var(--blue-bg)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    color: active ? "var(--blue)" : "var(--text2)",
                    fontWeight: active ? 600 : 500,
                    textAlign: "left",
                    transition: "background 0.1s",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                </button>
              )}
            </div>
          );
        })}
      </nav>

    </aside>
  );
}

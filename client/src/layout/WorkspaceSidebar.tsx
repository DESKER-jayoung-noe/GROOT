import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useProject } from "../context/ProjectContext";
import type { ProjectMeta, ProjectTreeGroup } from "../offline/stores";
import { moveGroupAsChild, moveGroupBeforeSibling, moveProjectInTree } from "../offline/stores";

const DRAG_PROJ = "application/x-groot-proj";
const DRAG_GRP = "application/x-groot-grp";
const LS_COLLAPSED = "groot_project_sidebar_collapsed_v1";

function findGroupInTree(nodes: ProjectTreeGroup[], id: string): ProjectTreeGroup | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.groups?.length) {
      const c = findGroupInTree(n.groups, id);
      if (c) return c;
    }
  }
  return null;
}


function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    return p && typeof p === "object" ? (p as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const CTX_MENU_W = 120;
const CTX_MENU_H = 72;

function useContextMenuFixedPosition(
  anchorRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  repositionKey: string | null
) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) {
      setBox(null);
      return;
    }
    const run = () => {
      const node = anchorRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      let top = r.bottom + 2;
      if (top + CTX_MENU_H > window.innerHeight - 8) {
        top = r.top - CTX_MENU_H - 2;
      }
      top = Math.max(6, Math.min(top, window.innerHeight - CTX_MENU_H - 6));
      const left = Math.max(6, Math.min(r.right - CTX_MENU_W, window.innerWidth - CTX_MENU_W - 6));
      setBox({ top, left });
    };
    run();
    const w = () => run();
    window.addEventListener("scroll", w, true);
    window.addEventListener("resize", w);
    const nav = document.querySelector(".quote-side-tree");
    nav?.addEventListener("scroll", w);
    return () => {
      window.removeEventListener("scroll", w, true);
      window.removeEventListener("resize", w);
      nav?.removeEventListener("scroll", w);
    };
  }, [open, anchorRef, repositionKey]);
  return box;
}

type Props = {
  /** 패널이 넓은 상태(핀·호버) */
  wide: boolean;
  /** 핀으로 고정됨(마우스를 떼도 열림 유지) */
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onHoverChange: (open: boolean) => void;
  /** false면 견적 외 레이아웃: 핀 UI 없이 항상 `wide`만 사용 */
  pinUi?: boolean;
  /** 상단에서 슬라이드 오버로 열린 패널 */
  drawerMode?: boolean;
  onCloseDrawer?: () => void;
};

export function WorkspaceSidebar({
  wide,
  pinned,
  onPinnedChange,
  onHoverChange,
  pinUi = true,
  drawerMode = false,
  onCloseDrawer,
}: Props) {
  const {
    projects,
    groups,
    ungroupedProjectIds,
    activeProjectId,
    setActiveProjectId,
    addProject,
    addGroup,
    renameProject,
    renameGroup,
    setGroupsOrder,
    setProjectTree,
    duplicateProject,
    deleteProject,
    duplicateGroup,
    deleteGroup,
  } = useProject();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ kind: "group" | "project"; id: string } | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; name: string } | null>(null);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<{ id: string; name: string } | null>(null);
  const draggingProjectRef = useRef<string | null>(null);
  const draggingGroupRef = useRef<string | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(loadCollapsed);
  const [groupMenuId, setGroupMenuId] = useState<string | null>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const titleClickTimerRef = useRef<number | null>(null);
  const projectClickTimerRef = useRef<number | null>(null);

  const groupMenuPos = useContextMenuFixedPosition(groupMenuRef, groupMenuId !== null, groupMenuId);
  const projectMenuPos = useContextMenuFixedPosition(projectMenuRef, projectMenuId !== null, projectMenuId);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);

  const groupForOpenMenu = useMemo(
    () => (groupMenuId ? findGroupInTree(groups, groupMenuId) : null),
    [groups, groupMenuId]
  );
  const projectForOpenMenu = useMemo(
    () => (projectMenuId ? (projectById.get(projectMenuId) ?? null) : null),
    [projectById, projectMenuId]
  );

  useEffect(() => {
    localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsedMap));
  }, [collapsedMap]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (!groupMenuId && !projectMenuId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (groupMenuId) {
        if (groupMenuRef.current?.contains(t)) return;
        if (t instanceof Element && t.closest("[data-groot-group-context-menu]")) return;
        setGroupMenuId(null);
      }
      if (projectMenuId) {
        if (projectMenuRef.current?.contains(t)) return;
        if (t instanceof Element && t.closest("[data-groot-proj-context-menu]")) return;
        setProjectMenuId(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [groupMenuId, projectMenuId]);

  useEffect(() => {
    if (!pendingDeleteProject && !pendingDeleteGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPendingDeleteProject(null);
        setPendingDeleteGroup(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pendingDeleteProject, pendingDeleteGroup]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    if (editing.kind === "group") renameGroup(editing.id, draft);
    else renameProject(editing.id, draft);
    setEditing(null);
  }, [editing, draft, renameGroup, renameProject]);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedMap((m) => ({ ...m, [id]: !m[id] }));
  }, []);

  const parseDragProj = useCallback((e: React.DragEvent): { projectId: string } | null => {
    try {
      const raw = e.dataTransfer.getData(DRAG_PROJ) || e.dataTransfer.getData("text/plain");
      if (!raw) return null;
      const o = JSON.parse(raw) as { projectId?: string };
      return o.projectId ? { projectId: o.projectId } : null;
    } catch {
      return null;
    }
  }, []);

  const parseDragGrp = useCallback((e: React.DragEvent): { groupId: string } | null => {
    try {
      const raw = e.dataTransfer.getData(DRAG_GRP) || e.dataTransfer.getData("text/plain");
      if (!raw) return null;
      const o = JSON.parse(raw) as { groupId?: string };
      return o.groupId ? { groupId: o.groupId } : null;
    } catch {
      return null;
    }
  }, []);

  const onDragOverProj = useCallback((e: React.DragEvent) => {
    if (draggingProjectRef.current) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const onDragOverGrp = useCallback((e: React.DragEvent) => {
    if (draggingGroupRef.current) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const onDropProjRow = useCallback(
    (targetGroupId: string | null, beforeProjectId: string | null) => (e: React.DragEvent) => {
      e.preventDefault();
      const parsed = parseDragProj(e);
      if (!parsed) return;
      const next = moveProjectInTree({ groups, ungroupedProjectIds }, parsed.projectId, targetGroupId, beforeProjectId);
      setProjectTree(next);
    },
    [groups, ungroupedProjectIds, parseDragProj, setProjectTree]
  );

  const onDropGrpBefore = useCallback(
    (siblingId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      const parsed = parseDragGrp(e);
      if (!parsed) return;
      const next = moveGroupBeforeSibling(groups, parsed.groupId, siblingId);
      if (next) setGroupsOrder(next);
    },
    [groups, parseDragGrp, setGroupsOrder]
  );

  const onDropGrpNest = useCallback(
    (parentId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      const parsed = parseDragGrp(e);
      if (!parsed) return;
      const next = moveGroupAsChild(groups, parsed.groupId, parentId);
      if (next) setGroupsOrder(next);
    },
    [groups, parseDragGrp, setGroupsOrder]
  );

  const renderUngrouped = useCallback(() => {
    if (ungroupedProjectIds.length === 0) {
      if (groups.length === 0) return null;
      return (
        <div key="ungrouped-drop" className="quote-proj-ungrouped" aria-hidden>
          <div
            className="quote-proj-tree quote-proj-tree--empty-leaf"
            onDragOver={onDragOverProj}
            onDrop={onDropProjRow(null, null)}
          />
        </div>
      );
    }
    return (
      <div key="ungrouped" className="quote-proj-ungrouped">
        <div
          className="quote-proj-tree"
          onDragOver={onDragOverProj}
          onDrop={onDropProjRow(null, null)}
        >
          <span className="quote-proj-tree-rail" aria-hidden />
          <div className="quote-proj-tree-list">
            {ungroupedProjectIds.map((pid) => {
              const p = projectById.get(pid);
              if (!p) return null;
              const active = p.id === activeProjectId;
              const editingProj = editing?.kind === "project" && editing.id === p.id;
              return (
                <div
                  key={pid}
                  className={
                    "quote-proj-row" +
                    (active ? " quote-proj-row--active" : "") +
                    (projectMenuId === p.id ? " quote-proj-row--menu-open" : "")
                  }
                  draggable
                  onDragStart={(e) => {
                    draggingProjectRef.current = p.id;
                    e.dataTransfer.effectAllowed = "move";
                    const payload = JSON.stringify({ projectId: p.id });
                    e.dataTransfer.setData(DRAG_PROJ, payload);
                    e.dataTransfer.setData("text/plain", payload);
                  }}
                  onDragEnd={() => {
                    draggingProjectRef.current = null;
                  }}
                  onDragOver={onDragOverProj}
                  onDrop={onDropProjRow(null, p.id)}
                >
                  {editingProj ? (
                    <input
                      ref={inputRef}
                      type="text"
                      className="quote-proj-input quote-proj-input--block"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitEdit();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="quote-proj-row-main"
                        onClick={(e) => {
                          if (e.detail === 1) {
                            if (projectClickTimerRef.current) window.clearTimeout(projectClickTimerRef.current);
                            projectClickTimerRef.current = window.setTimeout(() => {
                              projectClickTimerRef.current = null;
                              setGroupMenuId(null);
                              setProjectMenuId(null);
                              setActiveProjectId(p.id);
                            }, 280);
                          } else if (e.detail === 2) {
                            if (projectClickTimerRef.current) {
                              window.clearTimeout(projectClickTimerRef.current);
                              projectClickTimerRef.current = null;
                            }
                          }
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          if (projectClickTimerRef.current) {
                            window.clearTimeout(projectClickTimerRef.current);
                            projectClickTimerRef.current = null;
                          }
                          setEditing({ kind: "project", id: p.id });
                          setDraft(p.name);
                        }}
                      >
                        <span className="quote-proj-name">{p.name}</span>
                      </button>
                      <div
                        className="quote-proj-row-more"
                        ref={projectMenuId === p.id ? projectMenuRef : undefined}
                      >
                        <button
                          type="button"
                          className="quote-proj-more-btn"
                          aria-label="프로젝트 메뉴"
                          draggable={false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setGroupMenuId(null);
                            setProjectMenuId((id) => (id === p.id ? null : p.id));
                          }}
                        >
                          ⋮
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }, [
    ungroupedProjectIds,
    groups.length,
    projectById,
    activeProjectId,
    editing,
    draft,
    projectMenuId,
    onDragOverProj,
    onDropProjRow,
    commitEdit,
    cancelEdit,
    setActiveProjectId,
  ]);

  const renderGroup = useCallback(
    (g: ProjectTreeGroup, depth: number) => {
      const isCollapsed = collapsedMap[g.id] === true;
      const hasChildren = (g.groups?.length ?? 0) > 0 || g.projectIds.length > 0;

      const onTitleClick = () => {
        setGroupMenuId(null);
        setProjectMenuId(null);
        if (titleClickTimerRef.current) window.clearTimeout(titleClickTimerRef.current);
        titleClickTimerRef.current = window.setTimeout(() => {
          titleClickTimerRef.current = null;
          if (hasChildren) toggleCollapsed(g.id);
        }, 280);
      };

      const onTitleDoubleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (titleClickTimerRef.current) {
          window.clearTimeout(titleClickTimerRef.current);
          titleClickTimerRef.current = null;
        }
        setEditing({ kind: "group", id: g.id });
        setDraft(g.name);
      };

      return (
        <div key={g.id} className="quote-grp-block" style={{ paddingLeft: depth === 0 ? 0 : 10 }}>
          <div
            className="quote-grp-drop-zone"
            onDragOver={onDragOverGrp}
            onDrop={onDropGrpBefore(g.id)}
          />

          <section
            className={
              "quote-proj-group" + (groupMenuId === g.id ? " quote-proj-group--menu-open" : "")
            }
          >
            <div
              className="quote-proj-group-head"
              onDragOver={onDragOverGrp}
              onDrop={onDropGrpNest(g.id)}
            >
              <div
                className="quote-proj-group-title-row"
                draggable={!(editing?.kind === "group" && editing.id === g.id)}
                onDragStart={(e) => {
                  draggingGroupRef.current = g.id;
                  e.dataTransfer.effectAllowed = "move";
                  const payload = JSON.stringify({ groupId: g.id });
                  e.dataTransfer.setData(DRAG_GRP, payload);
                  e.dataTransfer.setData("text/plain", payload);
                }}
                onDragEnd={() => {
                  draggingGroupRef.current = null;
                }}
                onClick={onTitleClick}
                onDoubleClick={onTitleDoubleClick}
              >
                {editing?.kind === "group" && editing.id === g.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    className="quote-proj-input quote-proj-input--inline"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitEdit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="quote-proj-group-title">{g.name}</span>
                )}
              </div>

              <div className="quote-proj-group-more" ref={groupMenuId === g.id ? groupMenuRef : undefined}>
                <button
                  type="button"
                  className="quote-proj-more-btn"
                  aria-label="그룹 메뉴"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjectMenuId(null);
                    setGroupMenuId((id) => (id === g.id ? null : g.id));
                  }}
                >
                  ⋮
                </button>
              </div>
            </div>

            {!isCollapsed ? (
              <>
                {g.projectIds.length > 0 ? (
                <div
                  className="quote-proj-tree"
                  onDragOver={onDragOverProj}
                  onDrop={onDropProjRow(g.id, null)}
                >
                  <span className="quote-proj-tree-rail" aria-hidden />
                  <div className="quote-proj-tree-list">
                    {g.projectIds.map((pid) => {
                      const p = projectById.get(pid);
                      if (!p) return null;
                      const active = p.id === activeProjectId;
                      const editingProj = editing?.kind === "project" && editing.id === p.id;
                      return (
                        <div
                          key={pid}
                          className={
                            "quote-proj-row" +
                            (active ? " quote-proj-row--active" : "") +
                            (projectMenuId === p.id ? " quote-proj-row--menu-open" : "")
                          }
                          draggable
                          onDragStart={(e) => {
                            draggingProjectRef.current = p.id;
                            e.dataTransfer.effectAllowed = "move";
                            const payload = JSON.stringify({ projectId: p.id });
                            e.dataTransfer.setData(DRAG_PROJ, payload);
                            e.dataTransfer.setData("text/plain", payload);
                          }}
                          onDragEnd={() => {
                            draggingProjectRef.current = null;
                          }}
                          onDragOver={onDragOverProj}
                          onDrop={onDropProjRow(g.id, p.id)}
                        >
                          {editingProj ? (
                            <input
                              ref={inputRef}
                              type="text"
                              className="quote-proj-input quote-proj-input--block"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitEdit();
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelEdit();
                                }
                              }}
                            />
                          ) : (
                            <>
                              <button
                                type="button"
                                className="quote-proj-row-main"
                                onClick={(e) => {
                                  if (e.detail === 1) {
                                    if (projectClickTimerRef.current) window.clearTimeout(projectClickTimerRef.current);
                                    projectClickTimerRef.current = window.setTimeout(() => {
                                      projectClickTimerRef.current = null;
                                      setGroupMenuId(null);
                                      setProjectMenuId(null);
                                      setActiveProjectId(p.id);
                                    }, 280);
                                  } else if (e.detail === 2) {
                                    if (projectClickTimerRef.current) {
                                      window.clearTimeout(projectClickTimerRef.current);
                                      projectClickTimerRef.current = null;
                                    }
                                  }
                                }}
                                onDoubleClick={(e) => {
                                  e.preventDefault();
                                  if (projectClickTimerRef.current) {
                                    window.clearTimeout(projectClickTimerRef.current);
                                    projectClickTimerRef.current = null;
                                  }
                                  setEditing({ kind: "project", id: p.id });
                                  setDraft(p.name);
                                }}
                              >
                                <span className="quote-proj-name">{p.name}</span>
                              </button>
                              <div
                                className="quote-proj-row-more"
                                ref={projectMenuId === p.id ? projectMenuRef : undefined}
                              >
                                <button
                                  type="button"
                                  className="quote-proj-more-btn"
                                  aria-label="프로젝트 메뉴"
                                  draggable={false}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setGroupMenuId(null);
                                    setProjectMenuId((id) => (id === p.id ? null : p.id));
                                  }}
                                >
                                  ⋮
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                ) : (g.groups?.length ?? 0) === 0 ? (
                  <div
                    className="quote-proj-tree quote-proj-tree--empty-leaf"
                    onDragOver={onDragOverProj}
                    onDrop={onDropProjRow(g.id, null)}
                    aria-hidden
                  />
                ) : null}

                {(g.groups ?? []).map((child) => renderGroup(child, depth + 1))}
              </>
            ) : null}
          </section>

          <div
            className="quote-grp-drop-zone"
            onDragOver={onDragOverGrp}
            onDrop={onDropGrpBefore(g.id)}
          />
        </div>
      );
    },
    [
      collapsedMap,
      groups,
      editing,
      draft,
      projectById,
      activeProjectId,
      groupMenuId,
      projectMenuId,
      commitEdit,
      cancelEdit,
      renameGroup,
      toggleCollapsed,
      onDragOverProj,
      onDragOverGrp,
      onDropProjRow,
      onDropGrpBefore,
      onDropGrpNest,
      duplicateProject,
      duplicateGroup,
      setActiveProjectId,
    ]
  );

  return (
    <aside
      className={wide || !pinUi ? "quote-sidebar" : "quote-sidebar quote-sidebar--collapsed"}
      onMouseEnter={pinUi ? () => onHoverChange(true) : undefined}
      onMouseLeave={pinUi ? () => onHoverChange(false) : undefined}
      aria-label={pinUi ? "프로젝트: 마우스를 올리면 펼침, 핀으로 왼쪽 고정" : "프로젝트"}
    >
      {wide || !pinUi ? (
        <>
      {drawerMode ? (
        <div className="quote-drawer-chrome">
          <span className="quote-drawer-chrome-title">프로젝트</span>
          <div className="quote-drawer-chrome-trailing">
            <AddProjectMenu
              menuRef={menuRef}
              menuOpen={menuOpen}
              setMenuOpen={setMenuOpen}
              addGroup={addGroup}
              addProject={addProject}
              addButtonClassName="quote-drawer-chrome-add"
              onAfterNewProject={(meta) => {
                setEditing({ kind: "project", id: meta.id });
                setDraft(meta.name);
              }}
            />
            <button
              type="button"
              className="quote-drawer-chrome-close"
              onClick={onCloseDrawer}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      {!drawerMode ? (
      <div className="quote-side-header quote-side-header--brand">
        <span className="quote-side-header-title">프로젝트</span>
        <div className="quote-side-header-actions">
          <AddProjectMenu
            menuRef={menuRef}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            addGroup={addGroup}
            addProject={addProject}
            addButtonClassName=""
            onAfterNewProject={(meta) => {
              setEditing({ kind: "project", id: meta.id });
              setDraft(meta.name);
            }}
          />
          {pinUi ? (
            <button
              type="button"
              className={pinned ? "quote-side-pin-btn quote-side-pin-btn--on" : "quote-side-pin-btn"}
              onClick={() => onPinnedChange(!pinned)}
              title={pinned ? "핀 해제(마우스를 떼면 접힘)" : "핀(패널을 왼쪽에 고정)"}
              aria-pressed={pinned}
              aria-label={pinned ? "핀 해제" : "패널 고정"}
            >
              <img src="/pin-icon.png" alt="" className="quote-side-pin-icon-img" />
            </button>
          ) : null}
        </div>
      </div>
      ) : null}

      <nav className="quote-side-tree">
        {renderUngrouped()}
        {groups.map((g) => renderGroup(g, 0))}
      </nav>
        </>
      ) : (
        <div className="quote-sidebar-rail-cue" aria-hidden>
          &gt;&gt;
        </div>
      )}

      {groupMenuId && groupMenuPos && groupForOpenMenu
        ? createPortal(
            <ul
              className="quote-grp-context-menu"
              data-groot-portal
              data-groot-group-context-menu
              style={{
                position: "fixed",
                top: groupMenuPos.top,
                left: groupMenuPos.left,
                right: "auto",
                margin: 0,
              }}
              role="menu"
            >
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="quote-grp-context-item"
                  onClick={() => {
                    duplicateGroup(groupForOpenMenu.id);
                    setGroupMenuId(null);
                  }}
                >
                  복사
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="quote-grp-context-item quote-grp-context-item--danger"
                  onClick={() => {
                    setGroupMenuId(null);
                    setPendingDeleteGroup({ id: groupForOpenMenu.id, name: groupForOpenMenu.name });
                  }}
                >
                  삭제
                </button>
              </li>
            </ul>,
            document.body
          )
        : null}

      {projectMenuId && projectMenuPos && projectForOpenMenu
        ? createPortal(
            <ul
              className="quote-grp-context-menu"
              data-groot-portal
              data-groot-proj-context-menu
              style={{
                position: "fixed",
                top: projectMenuPos.top,
                left: projectMenuPos.left,
                right: "auto",
                margin: 0,
              }}
              role="menu"
            >
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="quote-grp-context-item"
                  onClick={() => {
                    duplicateProject(projectForOpenMenu.id);
                    setProjectMenuId(null);
                  }}
                >
                  복사
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="quote-grp-context-item quote-grp-context-item--danger"
                  onClick={() => {
                    setProjectMenuId(null);
                    setPendingDeleteProject({ id: projectForOpenMenu.id, name: projectForOpenMenu.name });
                  }}
                >
                  삭제
                </button>
              </li>
            </ul>,
            document.body
          )
        : null}

      {pendingDeleteProject ? (
        <div
          className="quote-modal-backdrop"
          role="presentation"
          onMouseDown={() => setPendingDeleteProject(null)}
        >
          <div
            className="quote-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quote-del-proj"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p id="quote-del-proj" className="quote-modal-text">
              「{pendingDeleteProject.name}」프로젝트를 삭제할까요?
            </p>
            <div className="quote-modal-actions">
              <button type="button" className="quote-modal-btn" onClick={() => setPendingDeleteProject(null)}>
                취소하기
              </button>
              <button
                type="button"
                className="quote-modal-btn quote-modal-btn--danger-solid"
                onClick={() => {
                  deleteProject(pendingDeleteProject.id);
                  setPendingDeleteProject(null);
                }}
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDeleteGroup ? (
        <div
          className="quote-modal-backdrop"
          role="presentation"
          onMouseDown={() => setPendingDeleteGroup(null)}
        >
          <div
            className="quote-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quote-del-grp"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p id="quote-del-grp" className="quote-modal-text">
              「{pendingDeleteGroup.name}」그룹과 안의 모든 프로젝트가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="quote-modal-actions">
              <button type="button" className="quote-modal-btn" onClick={() => setPendingDeleteGroup(null)}>
                취소하기
              </button>
              <button
                type="button"
                className="quote-modal-btn quote-modal-btn--danger-solid"
                onClick={() => {
                  deleteGroup(pendingDeleteGroup.id);
                  setPendingDeleteGroup(null);
                }}
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

type AddProjectMenuProps = {
  menuRef: RefObject<HTMLDivElement | null>;
  menuOpen: boolean;
  setMenuOpen: (v: boolean | ((b: boolean) => boolean)) => void;
  addGroup: () => void;
  addProject: (groupId?: string | null) => ProjectMeta | null;
  addButtonClassName?: string;
  onAfterNewProject?: (p: ProjectMeta) => void;
};

function AddProjectMenu({
  menuRef,
  menuOpen,
  setMenuOpen,
  addGroup,
  addProject,
  addButtonClassName,
  onAfterNewProject,
}: AddProjectMenuProps) {
  return (
    <div className="quote-side-add-wrap" ref={menuRef}>
      <button
        type="button"
        className={["quote-side-label-btn", addButtonClassName].filter(Boolean).join(" ")}
        title="추가"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((o) => !o)}
      >
        +
      </button>
      {menuOpen ? (
        <ul className="quote-side-dropdown" role="menu">
          <li>
            <button
              type="button"
              role="menuitem"
              className="quote-side-dropdown-item"
              onClick={() => {
                addGroup();
                setMenuOpen(false);
              }}
            >
              그룹
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className="quote-side-dropdown-item"
              onClick={() => {
                const m = addProject(null);
                setMenuOpen(false);
                if (m) onAfterNewProject?.(m);
              }}
            >
              새 프로젝트
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}


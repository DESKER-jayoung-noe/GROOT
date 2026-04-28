import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../context/ProjectContext";
import { useQuoteTabs } from "../context/QuoteTabsContext";
import { useTree, type TreeNode, type TreeNodeType } from "../context/TreeContext";
import { newId, ensureEntityByTreeId, cloneEntityToId, deleteEntityById, getMaterial, putProduct, enrichProductComputed } from "../offline/stores";
import type { ProjectMeta, ProjectTreeGroup } from "../offline/stores";
import { getMaterialsForItem } from "../context/TreeContext";
import { getPartTags, calcMaterialAttachmentsCost, calcPartHardwaresCost } from "../offline/partExtras";

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_W = 260;
const MIN_W = 160;
const MAX_W = 420;
const CLOSED_W = 36;

// ── Types ──────────────────────────────────────────────────────────────────

type InlineAdd =
  | { type: "group"; value: string }
  | { type: "project"; groupId: string | null; value: string };

type DotMenu = { id: string; kind: "project" | "group"; top: number; left: number };

// ── Helpers ────────────────────────────────────────────────────────────────

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="#969696" strokeWidth="1.1" />
      <line x1="5" y1="1.5" x2="5" y2="12.5" stroke="#969696" strokeWidth="1.1" />
    </svg>
  );
}

function collectGroupedIds(groups: ProjectTreeGroup[]): Set<string> {
  const set = new Set<string>();
  function walk(g: ProjectTreeGroup) {
    for (const id of g.projectIds) set.add(id);
    for (const child of g.groups ?? []) walk(child);
  }
  for (const g of groups) walk(g);
  return set;
}

function findGroupForProject(
  groups: ProjectTreeGroup[],
  projectId: string
): ProjectTreeGroup | null {
  for (const g of groups) {
    if (g.projectIds.includes(projectId)) return g;
  }
  return null;
}

function getPaddingLeft(type: TreeNodeType): number {
  if (type === "set") return 16;
  if (type === "item") return 26;
  return 40;
}

// ── AppSidebar ─────────────────────────────────────────────────────────────

export function AppSidebar() {
  // ── Sidebar open/width ──────────────────────────────────────────────────
  // 기본은 닫힌 상태. 사용자가 열기 버튼 누를 때만 열림.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const [resizing, setResizing] = useState(false);

  // ── Project dropdown ────────────────────────────────────────────────────
  const [projOpen, setProjOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [inlineAdd, setInlineAdd] = useState<InlineAdd | null>(null);
  const [dotMenu, setDotMenu] = useState<DotMenu | null>(null);
  const [pendingProjDelete, setPendingProjDelete] = useState<{ id: string; name: string } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingProjId, setEditingProjId] = useState<string | null>(null);
  const [editingProjName, setEditingProjName] = useState("");

  // ── Tree ────────────────────────────────────────────────────────────────
  const { treeNodes, setTreeNodes, activeItem, setActiveItem } = useTree();
  const [pendingDelete, setPendingDelete] = useState<{ name: string; idx: number; multi?: number[] } | null>(null);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [addTypeMenuOpen, setAddTypeMenuOpen] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropOverIdx, setDropOverIdx] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<"before" | "after">("after");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  // ── BOM collapse state ───────────────────────────────────────────────────
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("groot_collapsed_bom") ?? "[]") as string[]); }
    catch { return new Set(); }
  });

  // ── Project panel drag state ──────────────────────────────────────────────
  const [pfpDrag, setPfpDrag] = useState<{ type: "group" | "project"; id: string; srcGroupId: string | null } | null>(null);
  const [pfpDropTarget, setPfpDropTarget] = useState<{ id: string; pos: "before" | "after" | "into" } | null>(null);

  // ── Group collapse state ──────────────────────────────────────────────────
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("groot_collapsed_groups") ?? "[]") as string[]); }
    catch { return new Set(); }
  });

  // ── Refs ────────────────────────────────────────────────────────────────
  const sidebarRef = useRef<HTMLDivElement>(null);
  const projRowRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const addTypeBtnRef = useRef<HTMLButtonElement>(null);

  // ── Context ─────────────────────────────────────────────────────────────
  const {
    projects,
    groups,
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
  const { openEntityTab, closeTabsForEntity } = useQuoteTabs();
  const navigate = useNavigate();

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeGroup = activeProject
    ? findGroupForProject(groups, activeProject.id)
    : null;

  // ── Outside click: close dropdown ───────────────────────────────────────
  useEffect(() => {
    if (!projOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (sidebarRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setProjOpen(false);
      setAddMenuOpen(false);
      setInlineAdd(null);
      setDotMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [projOpen]);

  // ── Close dropdown when sidebar closes ──────────────────────────────────
  useEffect(() => {
    if (!sidebarOpen) setProjOpen(false);
  }, [sidebarOpen]);

  // ── Close add-type menu on outside click ────────────────────────────────
  useEffect(() => {
    if (!addTypeMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (addTypeBtnRef.current?.contains(e.target as Node)) return;
      setAddTypeMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addTypeMenuOpen]);

  // ── Close dot context menu on outside click ──────────────────────────────
  useEffect(() => {
    if (!dotMenu) return;
    const onDoc = () => setDotMenu(null);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [dotMenu]);

  // ── BOM collapse helpers ─────────────────────────────────────────────────
  function toggleCollapsedId(id: string) {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("groot_collapsed_bom", JSON.stringify([...next]));
      return next;
    });
  }

  function toggleCollapsedGroupId(id: string) {
    setCollapsedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("groot_collapsed_groups", JSON.stringify([...next]));
      return next;
    });
  }

  // Compute which BOM tree indices are hidden due to collapsed parents
  const hiddenBomIdxs = (() => {
    const hidden = new Set<number>();
    for (let i = 0; i < treeNodes.length; i++) {
      const node = treeNodes[i];
      if (!node || node.type === "divider") continue;
      const nid = node.id;
      if ((node.type === "set" || node.type === "item") && nid && collapsedIds.has(nid)) {
        const parentDepth = node.depth ?? 0;
        for (let j = i + 1; j < treeNodes.length; j++) {
          const child = treeNodes[j];
          if (!child || child.type === "divider") break;
          if ((child.depth ?? 0) <= parentDepth) break;
          hidden.add(j);
        }
      }
    }
    return hidden;
  })();

  // ── Project panel drag handlers ───────────────────────────────────────────
  function handlePfpGroupDragStart(e: React.DragEvent, gId: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("pfp", gId);
    setPfpDrag({ type: "group", id: gId, srcGroupId: null });
  }

  function handlePfpProjectDragStart(e: React.DragEvent, pId: string, srcGroupId: string | null) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("pfp", pId);
    setPfpDrag({ type: "project", id: pId, srcGroupId });
  }

  function handlePfpDragOver(e: React.DragEvent, id: string, pos: "before" | "after" | "into") {
    e.preventDefault();
    e.stopPropagation();
    setPfpDropTarget({ id, pos });
  }

  function handlePfpDragLeave() {
    setPfpDropTarget(null);
  }

  function handlePfpGroupDrop(e: React.DragEvent, targetGId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!pfpDrag) { setPfpDropTarget(null); return; }
    if (pfpDrag.type === "group" && pfpDrag.id !== targetGId) {
      const pos = pfpDropTarget?.pos ?? "after";
      const newGroups = [...groups];
      const fromIdx = newGroups.findIndex(g => g.id === pfpDrag.id);
      const toIdx = newGroups.findIndex(g => g.id === targetGId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [moved] = newGroups.splice(fromIdx, 1);
        const insertAt = pos === "before" ? (fromIdx < toIdx ? toIdx - 1 : toIdx) : (fromIdx < toIdx ? toIdx : toIdx + 1);
        newGroups.splice(Math.max(0, Math.min(insertAt, newGroups.length)), 0, moved);
        setGroupsOrder(newGroups);
      }
    } else if (pfpDrag.type === "project") {
      // Move project into this group
      const pId = pfpDrag.id;
      const newGroups = groups.map(g => {
        if (g.id === pfpDrag.srcGroupId) return { ...g, projectIds: g.projectIds.filter(id => id !== pId) };
        if (g.id === targetGId) return { ...g, projectIds: [...g.projectIds, pId] };
        return g;
      });
      setProjectTree({ ungroupedProjectIds: projects.filter(p => !newGroups.some(g => g.projectIds.includes(p.id)) && p.id !== pId).map(p => p.id), groups: newGroups });
    }
    setPfpDrag(null);
    setPfpDropTarget(null);
  }

  function handlePfpProjectDrop(e: React.DragEvent, targetPId: string, targetGroupId: string | null) {
    e.preventDefault();
    e.stopPropagation();
    if (!pfpDrag || pfpDrag.type !== "project" || pfpDrag.id === targetPId) {
      setPfpDrag(null); setPfpDropTarget(null); return;
    }
    const pId = pfpDrag.id;
    const pos = pfpDropTarget?.pos ?? "after";
    if (pfpDrag.srcGroupId === targetGroupId) {
      // Reorder within same group
      if (targetGroupId === null) {
        const ids = projects.map(p => p.id).filter(id => !groups.some(g => g.projectIds.includes(id)));
        const fromIdx = ids.indexOf(pId);
        const toIdx = ids.indexOf(targetPId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const newIds = [...ids];
          newIds.splice(fromIdx, 1);
          const insertAt = pos === "before" ? (fromIdx < toIdx ? toIdx - 1 : toIdx) : (fromIdx < toIdx ? toIdx : toIdx + 1);
          newIds.splice(Math.max(0, Math.min(insertAt, newIds.length)), 0, pId);
          setProjectTree({ ungroupedProjectIds: newIds, groups });
        }
      } else {
        const newGroups = groups.map(g => {
          if (g.id !== targetGroupId) return g;
          const ids = [...g.projectIds];
          const fromIdx = ids.indexOf(pId);
          const toIdx = ids.indexOf(targetPId);
          if (fromIdx === -1 || toIdx === -1) return g;
          ids.splice(fromIdx, 1);
          const insertAt = pos === "before" ? (fromIdx < toIdx ? toIdx - 1 : toIdx) : (fromIdx < toIdx ? toIdx : toIdx + 1);
          ids.splice(Math.max(0, Math.min(insertAt, ids.length)), 0, pId);
          return { ...g, projectIds: ids };
        });
        setGroupsOrder(newGroups);
      }
    } else {
      // Move to different group
      const newGroups = groups.map(g => {
        if (g.id === pfpDrag.srcGroupId) return { ...g, projectIds: g.projectIds.filter(id => id !== pId) };
        if (g.id === targetGroupId) {
          const ids = [...g.projectIds];
          const toIdx = ids.indexOf(targetPId);
          const insertAt = toIdx !== -1 ? (pos === "before" ? toIdx : toIdx + 1) : ids.length;
          ids.splice(insertAt, 0, pId);
          return { ...g, projectIds: ids };
        }
        return g;
      });
      setProjectTree({ ungroupedProjectIds: projects.filter(p => !newGroups.some(g => g.projectIds.includes(p.id)) && p.id !== pId).map(p => p.id), groups: newGroups });
    }
    setPfpDrag(null);
    setPfpDropTarget(null);
  }

  // ── Right border drag resize ─────────────────────────────────────────────
  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    if (!sidebarOpen) return;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    setResizing(true);

    const onMove = (me: MouseEvent) => {
      const newW = Math.max(MIN_W, Math.min(MAX_W, startWidth + (me.clientX - startX)));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setResizing(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Project handlers ─────────────────────────────────────────────────────
  function commitInlineAdd() {
    if (!inlineAdd) return;
    const name = inlineAdd.value.trim();
    if (inlineAdd.type === "group") {
      addGroup(name || undefined);
    } else {
      const meta = addProject(inlineAdd.groupId ?? null);
      if (meta && name) renameProject(meta.id, name);
    }
    setInlineAdd(null);
  }

  // ── Add type menu ────────────────────────────────────────────────────────
  function handleAddType(type: "set" | "item" | "mat") {
    setAddTypeMenuOpen(false);
    const nodeId = newId("node");
    ensureEntityByTreeId(type, nodeId, "이름 없음");
    let insertAt = treeNodes.length;
    if (activeItem !== null && activeItem < treeNodes.length) {
      const activeNode = treeNodes[activeItem];
      if (activeNode && activeNode.type !== "divider") {
        // Insert mat after the active item (if adding mat under item/set, put it after)
        insertAt = activeItem + 1;
      }
    }
    const newNode = { id: nodeId, type, name: "이름 없음", depth: 0 };
    setTreeNodes((n) => {
      const arr = [...n];
      arr.splice(insertAt, 0, newNode);
      return arr;
    });
    window.setTimeout(() => {
      setEditingIdx(insertAt);
      setEditingName("이름 없음");
      setActiveItem(insertAt);
      if (type === "mat") { openEntityTab("material", nodeId); navigate("/material"); }
      // PR2: 단품 클릭 → 활성 세트 한 페이지 뷰 + 카드 anchor 스크롤
      else if (type === "item") {
        const setId = findSetIdForNode(treeNodes, nodeId);
        if (setId) { openEntityTab("set", setId); navigate(`/set#part-card-${nodeId}`); }
        else { openEntityTab("product", nodeId); navigate(`/parts/${nodeId}`); }
      }
      else { openEntityTab("set", nodeId); navigate("/set"); }
    }, 0);
  }

  // ── Tree click ───────────────────────────────────────────────────────────
  function handleTreeItemClick(node: TreeNode, idx: number, e: React.MouseEvent) {
    if (node.type === "divider") return;
    if (editingIdx === idx) return;

    if (e.ctrlKey || e.metaKey) {
      setSelectedIdxs(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
      });
      setLastSelectedIdx(idx);
      return;
    }
    if (e.shiftKey && lastSelectedIdx !== null) {
      const lo = Math.min(lastSelectedIdx, idx);
      const hi = Math.max(lastSelectedIdx, idx);
      const range = new Set<number>();
      for (let i = lo; i <= hi; i++) {
        const n = treeNodes[i];
        if (n && n.type !== "divider") range.add(i);
      }
      setSelectedIdxs(range);
      return;
    }

    setSelectedIdxs(new Set());
    setLastSelectedIdx(idx);
    setActiveItem(idx);
    const nid = node.id ?? "";
    if (node.type === "mat") { openEntityTab("material", nid); navigate("/material"); }
    // PR2: 단품 클릭 → 활성 세트 한 페이지 뷰 + 카드 anchor 스크롤
    else if (node.type === "item") {
      const setId = findSetIdForNode(treeNodes, nid);
      if (setId) { openEntityTab("set", setId); navigate(`/set#part-card-${nid}`); }
      else { openEntityTab("product", nid); navigate(`/parts/${nid}`); }
    }
    else if (node.type === "set") { openEntityTab("set", nid); navigate("/set"); }
  }

  // 트리에서 노드 nid 의 가장 가까운 위 set 노드 id 찾기
  function findSetIdForNode(nodes: TreeNode[], nid: string): string | null {
    const idx = nodes.findIndex((n) => n.id === nid);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type === "set") return n.id ?? null;
      if (n.type === "divider") return null;
    }
    return null;
  }

  // ── Copy / Delete ────────────────────────────────────────────────────────
  function handleCopy(node: TreeNode, idx: number, e: React.MouseEvent) {
    e.stopPropagation();
    const dstId = newId("node");
    const copyName = `${node.name ?? "이름 없음"} 복사본`;
    const type = node.type as "mat" | "item" | "set";
    cloneEntityToId(type, node.id ?? "", dstId, copyName);
    const newNode: TreeNode = { id: dstId, type: node.type, name: copyName, depth: node.depth };
    setTreeNodes(n => {
      const arr = [...n];
      arr.splice(idx + 1, 0, newNode);
      return arr;
    });
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    const idxsToDelete = pendingDelete.multi
      ? pendingDelete.multi
      : [pendingDelete.idx];
    // Remove from storage + close tabs
    for (const i of idxsToDelete) {
      const node = treeNodes[i];
      if (!node || node.type === "divider") continue;
      const type = node.type as "mat" | "item" | "set";
      deleteEntityById(type, node.id ?? "");
      const kind = type === "mat" ? "material" : type === "item" ? "product" : "set";
      closeTabsForEntity(kind, node.id ?? "");
    }
    // Remove from tree (reverse order to preserve indices)
    const sorted = [...idxsToDelete].sort((a, b) => b - a);
    setTreeNodes(n => {
      const arr = [...n];
      for (const i of sorted) arr.splice(i, 1);
      return arr;
    });
    setActiveItem(0);
    setSelectedIdxs(new Set());
    setPendingDelete(null);
  }

  // ── Drag and drop ────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    window.setTimeout(() => setDraggingIdx(idx), 0);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    if (draggingIdx === null || draggingIdx === idx) return;
    const draggingNode = treeNodes[draggingIdx];
    const targetNode = treeNodes[idx];
    if (!draggingNode || !targetNode) return;
    if (draggingNode.type === "divider" || targetNode.type === "divider") return;
    if (draggingNode.type !== targetNode.type) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: "before" | "after" =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDropOverIdx(idx);
    setDropPos(pos);
  }

  function handleDragLeave() {
    setDropOverIdx(null);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, _idx: number) {
    e.preventDefault();
    if (draggingIdx === null || dropOverIdx === null) {
      setDraggingIdx(null);
      setDropOverIdx(null);
      return;
    }
    if (draggingIdx === dropOverIdx) {
      setDraggingIdx(null);
      setDropOverIdx(null);
      return;
    }
    const nodes = [...treeNodes];
    const [moved] = nodes.splice(draggingIdx, 1);
    let targetIdx = dropOverIdx;
    if (draggingIdx < dropOverIdx) targetIdx--;
    const insertAt = dropPos === "before" ? targetIdx : targetIdx + 1;
    nodes.splice(Math.max(0, Math.min(insertAt, nodes.length)), 0, moved);
    setTreeNodes(nodes);
    setDraggingIdx(null);
    setDropOverIdx(null);
  }

  function handleDragEnd() {
    setDraggingIdx(null);
    setDropOverIdx(null);
  }

  // ── Inline name edit ─────────────────────────────────────────────────────
  function startEdit(idx: number, name: string, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingIdx(idx);
    setEditingName(name ?? "");
  }

  function commitEdit() {
    if (editingIdx === null) return;
    setTreeNodes((nodes) =>
      nodes.map((n, i) => (i === editingIdx ? { ...n, name: editingName } : n))
    );
    setEditingIdx(null);
  }

  // ── Tree render ──────────────────────────────────────────────────────────
  function renderTagBadge(type: string) {
    if (type === "mat")
      return <span className="tree-badge tree-badge--mat">자재</span>;
    if (type === "item")
      return <span className="tree-badge tree-badge--item">단품</span>;
    if (type === "set")
      return <span className="tree-badge tree-badge--set">세트</span>;
    return null;
  }

  function renderTreeItems() {
    return treeNodes.map((node, idx) => {
      if (hiddenBomIdxs.has(idx)) return null;
      // 사이드바에는 세트만 표시 — 단품/자재는 숨김 (세트 한 페이지 뷰에서 관리)
      if (node.type === "item" || node.type === "mat") return null;
      if (node.type === "divider") {
        return <div key={`div-${idx}`} className="tree-divider" />;
      }
      const isActive = activeItem === idx;
      const isSelected = selectedIdxs.has(idx);
      const nid = node.id ?? "";
      const isCollapsed = nid ? collapsedIds.has(nid) : false;
      // Has collapsible children?
      const nodeDepth = node.depth ?? 0;
      let canCollapse = false;
      if (node.type === "set" || node.type === "item") {
        for (let j = idx + 1; j < treeNodes.length; j++) {
          const c = treeNodes[j];
          if (!c || c.type === "divider") break;
          if ((c.depth ?? 0) <= nodeDepth) break;
          canCollapse = true; break;
        }
      }
      const isDragging = draggingIdx === idx;
      const isDropBefore = dropOverIdx === idx && dropPos === "before";
      const isDropAfter = dropOverIdx === idx && dropPos === "after";
      const isEditing = editingIdx === idx;
      const canDrag =
        !isEditing &&
        treeNodes.some((n, i) => i !== idx && n.type === node.type);

      return (
        <div
          key={node.id ?? idx}
          className={[
            "tree-item",
            isActive ? "active" : "",
            isSelected ? "selected" : "",
            isDragging ? "dragging" : "",
            isDropBefore ? "drop-before" : "",
            isDropAfter ? "drop-after" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ paddingLeft: getPaddingLeft(node.type) }}
          role="button"
          tabIndex={0}
          draggable={canDrag}
          onClick={(e) => handleTreeItemClick(node, idx, e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleTreeItemClick(node, idx, e as unknown as React.MouseEvent);
            }
          }}
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
        >
          {canCollapse ? (
            <button
              type="button"
              className="tree-chevron"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); toggleCollapsedId(nid); }}
              aria-label={isCollapsed ? "펼치기" : "접기"}
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : (
            <span className="tree-chevron-spacer" />
          )}
          {renderTagBadge(node.type)}
          {isEditing ? (
            <input
              autoFocus
              className="tree-name-input"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit();
                }
                if (e.key === "Escape") setEditingIdx(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="tree-name"
              onDoubleClick={(e) => startEdit(idx, node.name ?? "", e)}
            >
              {node.name}
            </span>
          )}
          <div className="tree-actions">
            <button
              type="button"
              className="tree-act"
              tabIndex={-1}
              onClick={(e) => handleCopy(node, idx, e)}
              aria-label="복사"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect
                  x="4.5"
                  y="4.5"
                  width="7"
                  height="7"
                  rx="1.2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M3 8.5H2a1 1 0 01-1-1V2a1 1 0 011-1h5.5a1 1 0 011 1v1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="tree-act tree-act-delete"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                if (selectedIdxs.size > 1 && selectedIdxs.has(idx)) {
                  setPendingDelete({ name: `${selectedIdxs.size}개 항목`, idx, multi: [...selectedIdxs] });
                } else {
                  setPendingDelete({ name: node.name ?? "항목", idx });
                }
              }}
              aria-label="삭제"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M2 3.5h9M5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M10.5 3.5l-.5 7a1 1 0 01-1 1h-4a1 1 0 01-1-1l-.5-7"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      );
    });
  }

  // ── Dropdown content ─────────────────────────────────────────────────────
  function renderProjectRow(p: ProjectMeta, nested: boolean, groupId: string | null = null): ReactNode {
    const isActive = p.id === activeProjectId;
    const menuOpen = dotMenu?.id === p.id && dotMenu.kind === "project";
    const isEditingProj = editingProjId === p.id;
    const isDraggingThis = pfpDrag?.type === "project" && pfpDrag.id === p.id;
    const isDropBefore = pfpDropTarget?.id === p.id && pfpDropTarget.pos === "before";
    const isDropAfter = pfpDropTarget?.id === p.id && pfpDropTarget.pos === "after";

    return (
      <div
        key={p.id}
        className={[
          "pfp-project",
          nested ? "pfp-project--nested" : "",
          isActive ? "active" : "",
          isDraggingThis ? "pfp-dragging" : "",
          isDropBefore ? "pfp-drop-before" : "",
          isDropAfter ? "pfp-drop-after" : "",
        ].filter(Boolean).join(" ")}
        draggable
        onDragStart={(e) => { e.stopPropagation(); handlePfpProjectDragStart(e, p.id, groupId); }}
        onDragOver={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
          handlePfpDragOver(e, p.id, pos);
        }}
        onDragLeave={(e) => { e.stopPropagation(); handlePfpDragLeave(); }}
        onDrop={(e) => { e.stopPropagation(); handlePfpProjectDrop(e, p.id, groupId); }}
        onDragEnd={() => { setPfpDrag(null); setPfpDropTarget(null); }}
      >
        <span className="pfp-drag-handle" aria-hidden>⠿</span>
        <button
          type="button"
          className="pfp-proj-btn"
          onClick={() => {
            if (!isEditingProj) {
              setActiveProjectId(p.id);
              setProjOpen(false);
              setDotMenu(null);
            }
          }}
        >
          {isEditingProj ? (
            <input
              autoFocus
              className="pfp-proj-name-input"
              value={editingProjName}
              onChange={(e) => setEditingProjName(e.target.value)}
              onBlur={() => {
                renameProject(p.id, editingProjName || p.name);
                setEditingProjId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  renameProject(p.id, editingProjName || p.name);
                  setEditingProjId(null);
                }
                if (e.key === "Escape") setEditingProjId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="pfp-proj-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingProjId(p.id);
                setEditingProjName(p.name);
              }}
            >
              {p.name}
            </span>
          )}
        </button>
        <div className="pfp-dot-wrap">
          <button
            type="button"
            className={`pfp-dot-btn${menuOpen ? " open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (menuOpen) { setDotMenu(null); return; }
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setDotMenu({ id: p.id, kind: "project", top: rect.bottom + 2, left: rect.left });
            }}
          >
            ⋯
          </button>
        </div>
      </div>
    );
  }

  function renderDropdownContent(): ReactNode {
    const groupedIds = collectGroupedIds(groups);
    const ungrouped = projects.filter((p) => !groupedIds.has(p.id));

    return (
      <>
        <div className="pfp-head">
          <span className="pfp-title">PROJECTS</span>
          <div className="pfp-head-right">
            <button
              type="button"
              className="pfp-add-btn"
              onClick={() => setAddMenuOpen((o) => !o)}
            >
              +
            </button>
            {addMenuOpen && (
              <div className="pfp-add-menu">
                <button
                  type="button"
                  className="pfp-add-menu-item"
                  onClick={() => {
                    setInlineAdd({ type: "group", value: "" });
                    setAddMenuOpen(false);
                  }}
                >
                  그룹 추가
                </button>
                <button
                  type="button"
                  className="pfp-add-menu-item"
                  onClick={() => {
                    setInlineAdd({
                      type: "project",
                      groupId: null,
                      value: "",
                    });
                    setAddMenuOpen(false);
                  }}
                >
                  프로젝트 추가
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="pfp-list">
          {ungrouped.map((p) => renderProjectRow(p, false, null))}
          {inlineAdd?.type === "project" && inlineAdd.groupId === null && (
            <div className="pfp-inline-row">
              <input
                autoFocus
                className="pfp-inline-input"
                value={inlineAdd.value}
                onChange={(e) =>
                  setInlineAdd({ ...inlineAdd, value: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitInlineAdd();
                  if (e.key === "Escape") setInlineAdd(null);
                }}
                placeholder="프로젝트 이름"
              />
            </div>
          )}
          {groups.map((g) => {
            const groupMenuOpen =
              dotMenu?.id === g.id && dotMenu.kind === "group";
            const isEditingGroup = editingGroupId === g.id;
            const isGroupCollapsed = collapsedGroupIds.has(g.id);
            const isDraggingGroup = pfpDrag?.type === "group" && pfpDrag.id === g.id;
            const isGroupDropBefore = pfpDropTarget?.id === g.id && pfpDropTarget.pos === "before";
            const isGroupDropAfter = pfpDropTarget?.id === g.id && pfpDropTarget.pos === "after";
            const isGroupDropInto = pfpDropTarget?.id === g.id && pfpDropTarget.pos === "into";
            return (
              <div
                key={g.id}
                className={[
                  "pfp-group",
                  isDraggingGroup ? "pfp-dragging" : "",
                  isGroupDropBefore ? "pfp-drop-before" : "",
                  isGroupDropAfter ? "pfp-drop-after" : "",
                  isGroupDropInto ? "pfp-drop-into" : "",
                ].filter(Boolean).join(" ")}
                draggable
                onDragStart={(e) => handlePfpGroupDragStart(e, g.id)}
                onDragOver={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relY = e.clientY - rect.top;
                  const pos = relY < 16 ? "before" : relY > rect.height - 16 ? "after" : "into";
                  handlePfpDragOver(e, g.id, pos);
                }}
                onDragLeave={() => handlePfpDragLeave()}
                onDrop={(e) => handlePfpGroupDrop(e, g.id)}
                onDragEnd={() => { setPfpDrag(null); setPfpDropTarget(null); }}
              >
                <div className="pfp-group-head">
                  <span
                    className="pfp-drag-handle pfp-drag-handle--group"
                    aria-hidden
                  >⠿</span>
                  <button
                    type="button"
                    className="pfp-group-chevron"
                    onClick={(e) => { e.stopPropagation(); toggleCollapsedGroupId(g.id); }}
                    aria-label={isGroupCollapsed ? "펼치기" : "접기"}
                  >
                    {isGroupCollapsed ? "▸" : "▾"}
                  </button>
                  {isEditingGroup ? (
                    <input
                      autoFocus
                      className="pfp-group-label-input"
                      value={editingGroupName}
                      onChange={(e) => setEditingGroupName(e.target.value)}
                      onBlur={() => {
                        renameGroup(g.id, editingGroupName || g.name);
                        setEditingGroupId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          renameGroup(g.id, editingGroupName || g.name);
                          setEditingGroupId(null);
                        }
                        if (e.key === "Escape") setEditingGroupId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="pfp-group-label"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingGroupId(g.id);
                        setEditingGroupName(g.name);
                      }}
                    >
                      {g.name}
                    </span>
                  )}
                  <div className="pfp-dot-wrap">
                    <button
                      type="button"
                      className={`pfp-dot-btn${groupMenuOpen ? " open" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (groupMenuOpen) { setDotMenu(null); return; }
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setDotMenu({ id: g.id, kind: "group", top: rect.bottom + 2, left: rect.left });
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                </div>
                <div
                  className={`pfp-group-projects${isGroupCollapsed ? " pfp-group-projects--collapsed" : ""}`}
                  style={{ overflow: "hidden", maxHeight: isGroupCollapsed ? 0 : undefined, transition: "max-height 150ms ease" }}
                >
                {g.projectIds.map((pid) => {
                  const p = projects.find((x) => x.id === pid);
                  return p ? renderProjectRow(p, true, g.id) : null;
                })}
                {inlineAdd?.type === "project" &&
                  inlineAdd.groupId === g.id && (
                    <div className="pfp-inline-row pfp-inline-row--nested">
                      <input
                        autoFocus
                        className="pfp-inline-input"
                        value={inlineAdd.value}
                        onChange={(e) =>
                          setInlineAdd({
                            ...inlineAdd,
                            value: e.target.value,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitInlineAdd();
                          if (e.key === "Escape") setInlineAdd(null);
                        }}
                        placeholder="프로젝트 이름"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {inlineAdd?.type === "group" && (
            <div className="pfp-inline-row">
              <input
                autoFocus
                className="pfp-inline-input"
                value={inlineAdd.value}
                onChange={(e) =>
                  setInlineAdd({ ...inlineAdd, value: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitInlineAdd();
                  if (e.key === "Escape") setInlineAdd(null);
                }}
                placeholder="그룹 이름"
              />
            </div>
          )}
          {projects.length === 0 && !inlineAdd && (
            <div className="pfp-empty">프로젝트 없음</div>
          )}
        </div>
      </>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div
        ref={sidebarRef}
        className="sidebar"
        style={{
          width: sidebarOpen ? sidebarWidth : CLOSED_W,
          transition: resizing ? "none" : "width 180ms ease",
        }}
      >
        {sidebarOpen ? (
          <>
            {/* Project row */}
            <div ref={projRowRef} className="sb-proj-row">
              <div className="sb-proj-texts">
                {activeGroup && (
                  <div className="sb-proj-group-label">
                    {activeGroup.name}
                  </div>
                )}
                <div className="sb-proj-name-row">
                  <span
                    className="sb-proj-name-text"
                    style={
                      !activeProject ? { color: "#B0B0B0" } : undefined
                    }
                  >
                    {activeProject?.name ?? "프로젝트 없음"}
                  </span>
                  <button
                    type="button"
                    className={`sb-chevron-btn${projOpen ? " open" : ""}`}
                    onClick={() => setProjOpen((o) => !o)}
                    aria-label="프로젝트 선택"
                    aria-expanded={projOpen}
                  >
                    {projOpen ? "▴" : "▾"}
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="sb-icon-action-btn"
                onClick={() => setSidebarOpen(false)}
                aria-label="사이드바 닫기"
              >
                <CollapseIcon />
              </button>
            </div>

            {/* BOM section header */}
            <div className="sb-bom-head">
              <span className="sb-bom-label">BOM</span>
              <div style={{ position: "relative" }}>
                <button
                  ref={addTypeBtnRef}
                  type="button"
                  className="sb-icon-btn"
                  title="항목 추가"
                  onClick={() => setAddTypeMenuOpen((o) => !o)}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M6 1v10M1 6h10"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                {addTypeMenuOpen && (
                  <div className="sb-add-menu">
                    <button
                      type="button"
                      className="sb-add-menu-item"
                      onClick={() => handleAddType("set")}
                    >
                      세트 추가
                    </button>
                    <button
                      type="button"
                      className="sb-add-menu-item"
                      onClick={() => handleAddType("item")}
                    >
                      단품 추가
                    </button>
                    <button
                      type="button"
                      className="sb-add-menu-item"
                      onClick={() => handleAddType("mat")}
                    >
                      자재 추가
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Tree */}
            <div className="sb-tree-wrap">
              <div className="sb-tree" role="tree" aria-label="BOM 트리">
                {renderTreeItems()}
              </div>
            </div>
          </>
        ) : (
          /* Closed state: □ icon only */
          <button
            type="button"
            className="sb-open-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="사이드바 열기"
          >
            <CollapseIcon />
          </button>
        )}

        {/* Right border drag resize handle */}
        <div className="sb-resize-edge" onMouseDown={handleResizeMouseDown} />
      </div>

      {/* Project dropdown portal — positioned below proj row */}
      {projOpen &&
        sidebarOpen &&
        (() => {
          const rect = projRowRef.current?.getBoundingClientRect();
          if (!rect) return null;
          return createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: rect.bottom,
                left: rect.left,
                width: rect.width,
                maxHeight: "55vh",
                overflowY: "auto",
                background: "#fff",
                border: "0.5px solid #D6D6D6",
                boxShadow: "0 4px 16px rgba(0,0,0,.12)",
                zIndex: 300,
              }}
            >
              {renderDropdownContent()}
            </div>,
            document.body
          );
        })()}

      {/* Dot context menu portal */}
      {dotMenu && createPortal(
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: dotMenu.top,
            left: dotMenu.left,
            width: 130,
            background: "#fff",
            border: "0.5px solid #D6D6D6",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,.1)",
            zIndex: 9999,
            overflow: "hidden",
          }}
        >
          {dotMenu.kind === "project" && (() => {
            const p = projects.find(x => x.id === dotMenu.id);
            if (!p) return null;
            return (
              <>
                <button
                  type="button"
                  style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, color: "#282828", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F8F8F8"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                  onClick={() => { duplicateProject(p.id); setDotMenu(null); }}
                >
                  복사하기
                </button>
                <button
                  type="button"
                  style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, color: "#FF5948", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F8F8F8"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                  onClick={() => { setDotMenu(null); setPendingProjDelete({ id: p.id, name: p.name }); }}
                >
                  삭제하기
                </button>
              </>
            );
          })()}
          {dotMenu.kind === "group" && (() => {
            const g = groups.find(x => x.id === dotMenu.id);
            if (!g) return null;
            return (
              <>
                <button
                  type="button"
                  style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, color: "#282828", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F8F8F8"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                  onClick={() => { duplicateGroup(g.id); setDotMenu(null); }}
                >
                  복사하기
                </button>
                <button
                  type="button"
                  style={{ display: "block", width: "100%", padding: "8px 12px", fontSize: 12, color: "#FF5948", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F8F8F8"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                  onClick={() => {
                    setDotMenu(null);
                    setProjOpen(false);
                    window.setTimeout(() => {
                      if (window.confirm(`그룹 "${g.name}"을 삭제할까요?`)) deleteGroup(g.id);
                    }, 50);
                  }}
                >
                  삭제하기
                </button>
              </>
            );
          })()}
        </div>,
        document.body
      )}

      {/* Delete confirm: BOM item */}
      {pendingDelete && (
        <div
          className="quote-modal-backdrop"
          role="presentation"
          onMouseDown={() => setPendingDelete(null)}
        >
          <div
            className="quote-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="quote-modal-text">삭제하시겠습니까?</p>
            <div className="quote-modal-actions">
              <button
                type="button"
                className="quote-modal-btn"
                onClick={() => setPendingDelete(null)}
              >
                아니오
              </button>
              <button
                type="button"
                className="quote-modal-btn quote-modal-btn--danger-solid"
                onClick={handleConfirmDelete}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm: project */}
      {pendingProjDelete && (
        <div
          className="quote-modal-backdrop"
          role="presentation"
          onMouseDown={() => setPendingProjDelete(null)}
        >
          <div
            className="quote-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="quote-modal-text">삭제하시겠습니까?</p>
            <div className="quote-modal-actions">
              <button
                type="button"
                className="quote-modal-btn"
                onClick={() => setPendingProjDelete(null)}
              >
                아니오
              </button>
              <button
                type="button"
                className="quote-modal-btn quote-modal-btn--danger-solid"
                onClick={() => {
                  deleteProject(pendingProjDelete.id);
                  setPendingProjDelete(null);
                }}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

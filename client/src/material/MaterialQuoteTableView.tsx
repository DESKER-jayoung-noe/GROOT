import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  buildMaterialInput,
  computeMaterial,
  type ComputedMaterial,
  type MaterialEdgePreset,
  type SheetYieldRow,
} from "../lib/materialCalc";
import { type SheetId } from "../lib/yield";
import { formatWonKorean } from "../util/format";
import { useProject } from "../context/ProjectContext";
import {
  createEmptyMaterialEntity,
  deleteMaterial,
  getMaterial,
  getMaterials,
  newId,
  putMaterial,
  type StoredMaterial,
} from "../offline/stores";
import type { MaterialFormState } from "./MaterialTab";
import { MaterialSheetQuoteStrip } from "./quote/MaterialSheetQuoteStrip";

// ===== Product Group type & storage =====
type ProductGroup = { id: string; name: string; materialIds: string[] };

// ===== STP API types =====
type StpMaterial = {
  id: string;
  name: string;
  assy?: string;
  W: number | null;
  D: number | null;
  T: number | null;
  hole_1st?: number;
  hole_2nd?: number;
  edge?: {
    face_count: number;
    face_label: string;
    edge_T: number;
    edge_length: string;
    faces: Array<"top" | "bottom" | "left" | "right">;
  } | null;
  asm_parts?: Array<{ name: string; qty: number }>;
};
type StpApiResponse = { status: string; count: number; materials: StpMaterial[] };
type ToastItem = { id: number; message: string; ok: boolean };

const STP_API_URL =
  (import.meta.env.VITE_STP_API_URL as string | undefined) ?? "http://localhost:8000";

const GROUPS_PFX = "groot_mat_groups__";

function loadGroups(pid: string): ProductGroup[] {
  try {
    const raw = localStorage.getItem(GROUPS_PFX + pid);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as ProductGroup[]) : [];
  } catch {
    return [];
  }
}
function saveGroups(pid: string, groups: ProductGroup[]) {
  localStorage.setItem(GROUPS_PFX + pid, JSON.stringify(groups));
}

// ===== Sheet price table =====
const SHEET_PRICE_BY_T: Partial<Record<number, Partial<Record<string, number>>>> = {
  12: { "4x8": 16720 },
  15: { "4x6": 14450, "4x8": 19060, "6x8": 27320 },
  18: { "4x6": 16620, "4x8": 21510, "6x8": 30650 },
  22: { "4x8": 24680, "6x8": 35610 },
  25: { "4x8": 6640 },
  28: { "4x8": 29620, "6x8": 42600 },
};
const ALL_SHEET_IDS = ["4x6", "4x8", "6x8"] as const;

const SHEET_ERP_CODE_BY_THICKNESS: Partial<Record<number, Partial<Record<string, string>>>> = {
  12: { "4x8": "WDWP000260-R000" },
  15: { "4x6": "WDWP001205-R000", "4x8": "WDWP000258-R000", "6x8": "WDWP001360-R000" },
  18: { "4x6": "WDPGBL0000550", "4x8": "WDWP000274-R000", "6x8": "WDWPMF0000354" },
  22: { "4x8": "WDWP000266-R000", "6x8": "WDWP000730-R000" },
  25: { "4x8": "WDWP001811-R000" },
  28: { "4x8": "WDWP000262-R000", "6x8": "WDWP000951-R000" },
};

function sheetPricesForT(hMm: number): Record<string, number> {
  const prices = SHEET_PRICE_BY_T[hMm] ?? {};
  const out: Record<string, number> = {};
  for (const id of ALL_SHEET_IDS) {
    const v = prices[id];
    if (v != null) out[id] = v;
  }
  return out;
}

// ===== API → form conversion =====
function matApiToForm(mat: StpMaterial): MaterialFormState {
  const hMm = mat.T != null ? Math.round(mat.T) : 15;
  const sp = sheetPricesForT(hMm);
  const faces = mat.edge?.faces ?? [];
  const edgeT = mat.edge?.edge_T ?? 0;
  let edgePreset: MaterialEdgePreset = "none";
  if (edgeT >= 2) edgePreset = "abs2t";
  else if (edgeT >= 0.5) edgePreset = "abs1t";
  return {
    name: mat.name,
    partCode: mat.assy ?? "",
    wMm: mat.W != null ? Math.round(mat.W) : 0,
    dMm: mat.D != null ? Math.round(mat.D) : 0,
    hMm,
    color: "WW",
    boardMaterial: "PB",
    surfaceMaterial: "LPM/O",
    edgePreset,
    edgeColor: "WW",
    edgeCustomSides: { top: 0, bottom: 0, left: 0, right: 0 },
    edgeSides: {
      top: faces.includes("top"),
      bottom: faces.includes("bottom"),
      left: faces.includes("left"),
      right: faces.includes("right"),
    },
    placementMode: "default",
    sheetPrices: sp,
    selectedSheetId: null,
    formingM: 0,
    rutaM: 0,
    assemblyHours: mat.asm_parts?.length ?? 0,
    washM2: 0,
    boring1Ea: mat.hole_1st ?? 0,
    boring2Ea: mat.hole_2nd ?? 0,
    curvedEdgeM: 0,
    curvedEdgeType: "",
    edge45TapingM: 0,
    edge45PaintType: "",
    edge45PaintM: 0,
    ruta2M: 0,
    tenonerMm: 0,
  };
}

// ===== Helpers =====
function edgeLabel(preset: MaterialEdgePreset): string {
  switch (preset) {
    case "none": return "없음";
    case "abs1t": return "ABS 1T";
    case "abs2t": return "ABS 2T";
    case "paint": return "도장";
    case "custom": return "사용자";
    default: return "—";
  }
}

function fullEdgeLabel(form: MaterialFormState): string {
  if (form.edgePreset === "none") return "없음";
  const sides = form.edgeSides ?? { top: true, bottom: true, left: true, right: true };
  const count = Object.values(sides).filter(Boolean).length;
  const type = edgeLabel(form.edgePreset);
  return `${count}면 ${type}, ${form.edgeColor ?? "WW"}`;
}

function computeRow(m: StoredMaterial) {
  const input = buildMaterialInput({
    ...m.form,
    sheetPrices: m.form.sheetPrices as Partial<Record<SheetId, number>>,
  });
  const c = computeMaterial(input, (m.form.selectedSheetId ?? null) as SheetId | null);
  const hasSize = m.form.hMm > 0;
  const matWon = hasSize ? c.materialCostWon : 0;
  const procWon = c.processingTotalWon;
  const total = hasSize ? c.grandTotalWon : c.processingTotalWon;
  const hit = c.sheets?.find((s) => s.sheetId === c.selectedSheetId) ?? c.sheets?.[0];
  return { c, matWon, procWon, total, hit };
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return "방금";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "1분 미만";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}일 전`;
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

/** 박스 사이즈 행 — 적층 라인 큐브 */
function StackedBoxIcon() {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        border: "1.5px solid #3182f6",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: "#fff",
      }}
      aria-hidden
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <div style={{ height: 4, borderRadius: 1, background: "#3182f6", width: 20 }} />
        <div style={{ height: 4, borderRadius: 1, background: "#90bdf6", width: 20 }} />
        <div style={{ height: 4, borderRadius: 1, background: "#3182f6", width: 20 }} />
        <div style={{ height: 4, borderRadius: 1, background: "#90bdf6", width: 20 }} />
      </div>
    </div>
  );
}

// ===== Shared styles =====
const TH: React.CSSProperties = {
  padding: "9px 14px",
  fontSize: "11px",
  fontWeight: 700,
  color: "#8b95a1",
  textAlign: "left",
  whiteSpace: "nowrap",
  background: "#f8f9fb",
  letterSpacing: "0.03em",
  userSelect: "none",
  borderBottom: "0.5px solid #e8ecf2",
};
const TD: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: "13px",
  color: "#191f28",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
  borderBottom: "0.5px solid #e8ecf2",
};
/** Collapsed row: 규격·사양·엣지·원장 공통 셀 스타일 */
const TD_SPEC: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 400,
  color: "#8b95a1",
};
const BTN_PRIMARY: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px",
  padding: "8px 14px", borderRadius: "8px",
  fontSize: "13px", fontWeight: 600, cursor: "pointer",
  border: "none", background: "#3182f6", color: "#fff", transition: "background 0.15s ease, opacity 0.15s ease",
};
const BTN_OUTLINE: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px",
  padding: "8px 14px", borderRadius: "8px",
  fontSize: "13px", fontWeight: 600, cursor: "pointer",
  background: "#fff", color: "#4e5968", border: "1px solid #dde2ea", transition: "border-color 0.15s ease, color 0.15s ease",
};
const BTN_GHOST: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px",
  padding: "8px 14px", borderRadius: "8px",
  fontSize: "13px", fontWeight: 600, cursor: "pointer",
  background: "transparent", color: "#8b95a1", border: "1px solid #e8ecf2", transition: "color 0.15s ease, border-color 0.15s ease",
};
const CARD_TITLE: React.CSSProperties = {
  fontSize: "10px", fontWeight: 700, color: "var(--text3)",
  textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px",
};
const INPUT_S: React.CSSProperties = {
  width: "62px", height: "32px", background: "white",
  border: "1px solid var(--border)", borderRadius: "6px",
  fontSize: "12px", color: "var(--text1)", padding: "0 8px",
  fontFamily: "inherit",
};
const SELECT_S: React.CSSProperties = {
  width: "62px", height: "32px", background: "white",
  border: "1px solid var(--border)", borderRadius: "6px",
  fontSize: "12px", color: "var(--text1)", padding: "0 6px",
  fontFamily: "inherit",
};
const MENU_ITEM: React.CSSProperties = {
  display: "block", width: "100%", padding: "8px 14px",
  background: "none", border: "none", textAlign: "left",
  fontSize: "13px", color: "var(--text2)", cursor: "pointer",
};

// ===== Props =====
type Props = {
  reloadSignal: number;
  onEditMaterial?: (id: string) => void;
  onAfterChange?: () => void;
  onToolbarTotals?: (p: { count: number; matWon: number; procWon: number; totalWon: number }) => void;
};

// ===== Main Component =====
export function MaterialQuoteTableView({
  reloadSignal,
  onAfterChange,
  onToolbarTotals,
}: Props) {
  const { projects, activeProjectId, renameProject } = useProject();

  const [rows, setRows] = useState<StoredMaterial[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [rowExpanded, setRowExpanded] = useState<Set<string>>(new Set());
  const [groupExpanded, setGroupExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showBomModal, setShowBomModal] = useState(false);
  const [moreMenuId, setMoreMenuId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [uploadingRows, setUploadingRows] = useState(0);

  // Drag-and-drop
  const [draggingMatId, setDraggingMatId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  /** 단품: 그룹+미그룹 / 자재: 전체 평면 목록 */
  const [quoteListMode, setQuoteListMode] = useState<"bundles" | "materials">("bundles");
  const [projectEditActive, setProjectEditActive] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const [deleteBtnHover, setDeleteBtnHover] = useState(false);
  const [timeTick, setTimeTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTimeTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setProjectEditActive(false);
  }, [activeProjectId]);

  useEffect(() => {
    if (projectEditActive && projectTitleInputRef.current) {
      projectTitleInputRef.current.focus();
      projectTitleInputRef.current.select();
    }
  }, [projectEditActive]);

  const handleDropOnGroup = useCallback((gid: string) => {
    if (!draggingMatId) return;
    setDragOverGroupId(null);
    setDraggingMatId(null);
    const updated = groups.map((g) =>
      g.id === gid
        ? { ...g, materialIds: [...new Set([...g.materialIds, draggingMatId])] }
        : g
    );
    setGroups(updated);
    saveGroups(activeProjectId, updated);
    setGroupExpanded((s) => new Set([...s, gid]));
  }, [draggingMatId, groups, activeProjectId]);

  // Inline editing for group names
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const groupNameInputRef = useRef<HTMLInputElement>(null);

  // Inline editing for row part names
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowName, setEditingRowName] = useState("");
  const rowNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingGroupId && groupNameInputRef.current) {
      groupNameInputRef.current.focus();
      groupNameInputRef.current.select();
    }
  }, [editingGroupId]);

  useEffect(() => {
    if (editingRowId && rowNameInputRef.current) {
      rowNameInputRef.current.focus();
      rowNameInputRef.current.select();
    }
  }, [editingRowId]);

  const reload = useCallback(() => {
    setRows(getMaterials());
    setGroups(loadGroups(activeProjectId));
  }, [activeProjectId]);

  useEffect(() => {
    reload();
  }, [reload, reloadSignal]);

  const groupMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      for (const mid of g.materialIds) m.set(mid, g.id);
    }
    return m;
  }, [groups]);

  const totals = useMemo(() => {
    let matWon = 0, procWon = 0, total = 0;
    for (const r of rows) {
      const t = computeRow(r);
      matWon += t.matWon;
      procWon += t.procWon;
      total += t.total;
    }
    return { count: rows.length, matWon, procWon, total };
  }, [rows]);

  useEffect(() => {
    onToolbarTotals?.({
      count: totals.count, matWon: totals.matWon,
      procWon: totals.procWon, totalWon: totals.total,
    });
  }, [totals, onToolbarTotals]);

  const project = projects.find((p) => p.id === activeProjectId);
  const projectName = project?.name ?? "프로젝트";
  const mostRecentUpdatedIso = useMemo(() => {
    if (!rows.length) return null;
    let max = rows[0].updatedAt;
    for (const r of rows) {
      if (r.updatedAt > max) max = r.updatedAt;
    }
    return max;
  }, [rows]);
  const lastRelativeLabel = useMemo(() => {
    void timeTick;
    return mostRecentUpdatedIso ? relativeTime(mostRecentUpdatedIso) : null;
  }, [mostRecentUpdatedIso, timeTick]);

  const commitProjectTitle = useCallback(() => {
    if (!activeProjectId) return;
    renameProject(activeProjectId, projectDraft.trim() || projectName);
    setProjectEditActive(false);
  }, [activeProjectId, projectDraft, projectName, renameProject]);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const at = computeRow(a), bt = computeRow(b);
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name, "ko"); break;
        case "wMm": cmp = a.form.wMm - b.form.wMm; break;
        case "matWon": cmp = at.matWon - bt.matWon; break;
        case "procWon": cmp = at.procWon - bt.procWon; break;
        case "totalWon": cmp = at.total - bt.total; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const tableQuery = tableSearch.trim().toLowerCase();
  const materialMatchesSearch = useCallback(
    (m: StoredMaterial) => {
      if (!tableQuery) return true;
      return m.name.toLowerCase().includes(tableQuery) || (m.form.partCode ?? "").toLowerCase().includes(tableQuery);
    },
    [tableQuery]
  );

  const ungrouped = useMemo(
    () => sorted.filter((r) => !groupMap.has(r.id) && materialMatchesSearch(r)),
    [sorted, groupMap, materialMatchesSearch]
  );

  const flatMaterialsFiltered = useMemo(
    () => sorted.filter((r) => materialMatchesSearch(r)),
    [sorted, materialMatchesSearch]
  );

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const handleAdd = () => {
    const id = createEmptyMaterialEntity();
    reload();
    setRowExpanded((s) => new Set([...s, id]));
    onAfterChange?.();
  };

  const handleDelete = (id: string) => {
    deleteMaterial(id);
    const cleaned = groups.map((g) => ({ ...g, materialIds: g.materialIds.filter((mid) => mid !== id) }));
    setGroups(cleaned);
    saveGroups(activeProjectId, cleaned);
    setChecked((s) => { const ns = new Set(s); ns.delete(id); return ns; });
    setMoreMenuId(null);
    reload();
    onAfterChange?.();
  };

  const handleDeleteChecked = () => {
    const ids = [...checked];
    for (const id of ids) deleteMaterial(id);
    const cleaned = groups.map((g) => ({ ...g, materialIds: g.materialIds.filter((mid) => !checked.has(mid)) }));
    setGroups(cleaned);
    saveGroups(activeProjectId, cleaned);
    setChecked(new Set());
    reload();
    onAfterChange?.();
  };

  const handleDuplicate = (m: StoredMaterial) => {
    const nid = newId("m");
    putMaterial({ ...m, id: nid, name: `${m.name} (복사)`, updatedAt: new Date().toISOString() });
    setMoreMenuId(null);
    reload();
    onAfterChange?.();
  };

  const handleUngroup = (mid: string) => {
    const cleaned = groups.map((g) => ({ ...g, materialIds: g.materialIds.filter((id) => id !== mid) }));
    setGroups(cleaned);
    saveGroups(activeProjectId, cleaned);
    setMoreMenuId(null);
  };

  const handleDeleteGroup = (gid: string) => {
    const cleaned = groups.filter((g) => g.id !== gid);
    setGroups(cleaned);
    saveGroups(activeProjectId, cleaned);
    setMoreMenuId(null);
  };

  const computeBoxSize = (g: ProductGroup) => {
    const members = rows.filter((r) => g.materialIds.includes(r.id));
    if (!members.length) return null;
    return {
      W: Math.max(...members.map((m) => m.form.wMm)),
      D: Math.max(...members.map((m) => m.form.dMm)),
      H: members.reduce((s, m) => s + m.form.hMm, 0),
    };
  };

  // Create group immediately without modal → inline name edit
  const handleCreateGroup = useCallback(() => {
    const checkedIds = [...checked];
    if (!checkedIds.length) return;
    const g: ProductGroup = {
      id: newId("grp"),
      name: `새 단품 ${groups.length + 1}`,
      materialIds: checkedIds,
    };
    const updated = [...groups, g];
    setGroups(updated);
    saveGroups(activeProjectId, updated);
    setChecked(new Set());
    setGroupExpanded((s) => new Set([...s, g.id]));
    setEditingGroupId(g.id);
    setEditingGroupName(g.name);
  }, [checked, groups, activeProjectId]);

  const commitGroupRename = useCallback(() => {
    if (!editingGroupId) return;
    const updated = groups.map((g) =>
      g.id === editingGroupId ? { ...g, name: editingGroupName.trim() || g.name } : g
    );
    setGroups(updated);
    saveGroups(activeProjectId, updated);
    setEditingGroupId(null);
  }, [editingGroupId, editingGroupName, groups, activeProjectId]);

  const commitRowRename = useCallback(() => {
    if (!editingRowId) return;
    const m = getMaterial(editingRowId);
    if (m) {
      putMaterial({ ...m, name: editingRowName.trim() || m.name, updatedAt: new Date().toISOString() });
      reload();
      onAfterChange?.();
    }
    setEditingRowId(null);
  }, [editingRowId, editingRowName, reload, onAfterChange]);

  const showToast = useCallback((message: string, ok = true) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, ok }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const handleApiParsed = useCallback(
    (materials: StpMaterial[]) => {
      for (const mat of materials) {
        const mid = newId("m");
        const form = matApiToForm(mat);
        const input = buildMaterialInput({
          ...form,
          sheetPrices: form.sheetPrices as Partial<Record<SheetId, number>>,
        });
        const c = computeMaterial(input, null);
        putMaterial({
          id: mid,
          name: form.name || "이름 없음",
          status: "DRAFT",
          updatedAt: new Date().toISOString(),
          grandTotalWon: c.grandTotalWon,
          summary: `${form.wMm}×${form.dMm}×${form.hMm} mm`,
          form,
        });
      }
      setShowBomModal(false);
      setUploadingRows(0);
      reload();
      onAfterChange?.();
      showToast(`${materials.length}개 자재가 추가되었습니다`);
    },
    [reload, onAfterChange, showToast]
  );

  const handleExportCsv = () => {
    const hdr = ["이름", "파트코드", "규격", "사양", "엣지", "원장", "원자재비", "가공비", "합계"];
    const body = rows.map((m) => {
      const { matWon, procWon, total, hit } = computeRow(m);
      return [
        m.name, m.form.partCode ?? "",
        `${m.form.wMm}×${m.form.dMm}×${m.form.hMm}`,
        `${m.form.boardMaterial}/${m.form.surfaceMaterial}/${m.form.color}`,
        fullEdgeLabel(m.form),
        hit ? `${hit.label} (${hit.yieldPct.toFixed(0)}%)` : "",
        matWon, procWon, total,
      ].join(",");
    });
    const csv = [hdr.join(","), ...body].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}_견적.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleRow = (id: string) =>
    setRowExpanded((s) => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });
  const toggleGroup = (id: string) =>
    setGroupExpanded((s) => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });
  const toggleCheck = (id: string) =>
    setChecked((s) => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });

  const visibleMaterialIds = useMemo(() => {
    if (quoteListMode === "materials") {
      return new Set(flatMaterialsFiltered.map((m) => m.id));
    }
    const ids = new Set<string>();
    for (const r of ungrouped) ids.add(r.id);
    for (const g of groups) {
      const members = sorted.filter((x) => g.materialIds.includes(x.id));
      const list =
        !tableQuery || g.name.toLowerCase().includes(tableQuery)
          ? members
          : members.filter(materialMatchesSearch);
      for (const m of list) ids.add(m.id);
    }
    return ids;
  }, [quoteListMode, flatMaterialsFiltered, ungrouped, groups, sorted, tableQuery, materialMatchesSearch]);

  const allChecked = visibleMaterialIds.size > 0 && [...visibleMaterialIds].every((id) => checked.has(id));
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set([...visibleMaterialIds]));

  const SI = (key: string) => {
    if (sortKey !== key) return <span style={{ color: "var(--text3)", fontSize: "10px" }}>↕</span>;
    return <span style={{ color: "var(--blue)", fontSize: "10px" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const onSaved = useCallback(() => {
    reload();
    onAfterChange?.();
  }, [reload, onAfterChange]);

  const COL_SPAN_ALL = 10;

  return (
    <div
      style={{
        display: "flex", flexDirection: "column",
        height: "100%", minHeight: 0,
        background: "var(--bg)", overflow: "hidden",
        fontFamily: "'Pretendard Variable', Pretendard, -apple-system, sans-serif",
      }}
    >
      {/* Scrollable body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>

        {/* 대시보드: 헤더 + 툴바 + 검색 + 테이블 단일 카드 */}
        <div
          style={{
            background: "#fff",
            borderRadius: "12px",
            border: "0.5px solid #e8ecf2",
            overflow: "hidden",
            marginBottom: "16px",
          }}
        >
        {/* Header card (TDS) */}
        <div
          style={{
            padding: "18px 22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "0.5px solid #e8ecf2",
          }}
        >
          <div>
            {projectEditActive ? (
              <input
                ref={projectTitleInputRef}
                type="text"
                value={projectDraft}
                onChange={(e) => setProjectDraft(e.target.value)}
                onBlur={commitProjectTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitProjectTitle();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setProjectEditActive(false);
                  }
                }}
                style={{
                  fontSize: "17px",
                  fontWeight: 700,
                  color: "#191f28",
                  marginBottom: "2px",
                  border: "1px solid #3182f6",
                  borderRadius: "8px",
                  padding: "4px 10px",
                  outline: "none",
                  fontFamily: "inherit",
                  minWidth: "200px",
                }}
              />
            ) : (
              <div
                style={{ fontSize: "17px", fontWeight: 700, color: "#191f28", marginBottom: "2px", cursor: "default" }}
                title="프로젝트명 더블클릭하여 수정"
                onDoubleClick={() => {
                  setProjectDraft(projectName);
                  setProjectEditActive(true);
                }}
              >
                {projectName}
              </div>
            )}
            <div style={{ fontSize: "12px", color: "#8b95a1", fontWeight: 400 }}>
              {groups.length > 0 ? `${groups.length}개 단품 · ` : ""}
              {rows.length}개 자재
              {lastRelativeLabel ? ` · ${lastRelativeLabel}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            {[
              { label: "원자재비", value: totals.matWon, big: false },
              { label: "가공비", value: totals.procWon, big: false },
              { label: "합계", value: totals.total, big: true },
            ].map((s, i) => (
              <Fragment key={s.label}>
                {i > 0 && <div style={{ width: "1px", height: "32px", background: "#e8ecf2" }} />}
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "11px", color: "#8b95a1", marginBottom: "1px", fontWeight: 400 }}>{s.label}</div>
                  <div
                    style={{
                      fontSize: s.big ? "19px" : "15px",
                      fontWeight: 700,
                      color: s.big ? "#3182f6" : "#191f28",
                    }}
                  >
                    {formatWonKorean(s.value)}
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "12px 16px", flexWrap: "wrap", borderBottom: "0.5px solid #e8ecf2", background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button style={BTN_PRIMARY} onClick={handleAdd}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            자재 추가
          </button>
          <button
            type="button"
            style={{
              ...BTN_OUTLINE,
              color: checked.size > 0 ? "#3182f6" : "#8b95a1",
              borderColor: checked.size > 0 ? "#3182f6" : "#dde2ea",
              cursor: checked.size > 0 ? "pointer" : "not-allowed",
              opacity: checked.size > 0 ? 1 : 0.55,
            }}
            onClick={handleCreateGroup}
            disabled={checked.size === 0}
          >
            단품 만들기
          </button>
          <button style={BTN_OUTLINE} onClick={() => setShowBomModal(true)}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1v7M4 6l2.5 2.5L9 6M1.5 9.5v1.5a1 1 0 001 1h8a1 1 0 001-1V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            모델링, 도면 업로드
          </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <button type="button" style={BTN_GHOST} onClick={handleExportCsv}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1.5 3.5h10M1.5 6.5h7M1.5 9.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            CSV 내보내기
          </button>
          <button
            type="button"
            style={{
              ...BTN_GHOST,
              color: checked.size === 0 ? "#b0b8c1" : deleteBtnHover ? "#e42939" : "#8b95a1",
              borderColor: "#e8ecf2",
              cursor: checked.size > 0 ? "pointer" : "not-allowed",
            }}
            onMouseEnter={() => setDeleteBtnHover(true)}
            onMouseLeave={() => setDeleteBtnHover(false)}
            onClick={() => checked.size > 0 && handleDeleteChecked()}
            title={checked.size > 0 ? `선택한 ${checked.size}개 삭제` : "삭제할 자재를 선택하세요"}
            disabled={checked.size === 0}
          >
            <svg width="13" height="14" viewBox="0 0 13 14" fill="none">
              <path d="M1 3.5h11M4.5 3.5V2.5a1 1 0 011-1h2a1 1 0 011 1v1M5.5 6.5v4M7.5 6.5v4M2 3.5l.7 8a1 1 0 001 .9h5.6a1 1 0 001-.9l.7-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          </div>
        </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              padding: "10px 16px",
              borderBottom: "0.5px solid #e8ecf2",
              background: "#fff",
            }}
          >
            <div
              role="tablist"
              aria-label="목록 보기"
              style={{
                display: "inline-flex",
                flexShrink: 0,
                gap: 4,
                padding: 4,
                borderRadius: 10,
                background: "#f0f2f5",
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={quoteListMode === "bundles"}
                onClick={() => setQuoteListMode("bundles")}
                style={{
                  border: quoteListMode === "bundles" ? "1px solid #e8ecf2" : "1px solid transparent",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  background: quoteListMode === "bundles" ? "#ebf3fe" : "transparent",
                  color: quoteListMode === "bundles" ? "#3182f6" : "#6f7a87",
                }}
              >
                단품
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={quoteListMode === "materials"}
                onClick={() => setQuoteListMode("materials")}
                style={{
                  border: quoteListMode === "materials" ? "1px solid #e8ecf2" : "1px solid transparent",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  background: quoteListMode === "materials" ? "#fff" : "transparent",
                  color: quoteListMode === "materials" ? "#191f28" : "#6f7a87",
                  boxShadow: quoteListMode === "materials" ? "0 0 0 1px #dde2ea inset" : undefined,
                }}
              >
                자재
              </button>
            </div>
            <div style={{ position: "relative", flex: "1 1 220px", minWidth: "200px" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="6.5" cy="6.5" r="4" stroke="#8b95a1" strokeWidth="1.5" />
                <path d="M10 10l3.5 3.5" stroke="#8b95a1" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="이름 / 파트코드 검색"
                style={{
                  width: "100%",
                  height: "32px",
                  padding: "0 10px 0 34px",
                  border: "1px solid #e8ecf2",
                  borderRadius: "8px",
                  background: "#f8f9fb",
                  fontSize: "12px",
                  color: "#191f28",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <span style={{ fontSize: "12px", color: "#8b95a1", whiteSpace: "nowrap" }}>
              {tableQuery ? `검색 결과 ${visibleMaterialIds.size}건` : `${rows.length}개 자재`}
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: "960px" }}>
              <colgroup>
                <col style={{ width: "4%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "4%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: "center" }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  </th>
                  <th style={{ ...TH, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis" }} onClick={() => handleSort("name")}>
                    이름 {SI("name")}
                  </th>
                  <th style={{ ...TH, cursor: "pointer", textAlign: "right" }} onClick={() => handleSort("wMm")}>
                    규격 {SI("wMm")}
                  </th>
                  <th style={{ ...TH, textAlign: "right" }}>사양</th>
                  <th style={{ ...TH, textAlign: "right" }}>엣지</th>
                  <th style={{ ...TH, textAlign: "right" }}>원장(수율)</th>
                  <th style={{ ...TH, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("matWon")}>
                    원자재비 {SI("matWon")}
                  </th>
                  <th style={{ ...TH, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("procWon")}>
                    가공비 {SI("procWon")}
                  </th>
                  <th style={{ ...TH, textAlign: "right", cursor: "pointer" }} onClick={() => handleSort("totalWon")}>
                    합계 {SI("totalWon")}
                  </th>
                  <th style={{ ...TH, width: "40px" }} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && uploadingRows === 0 && (
                  <tr>
                    <td colSpan={COL_SPAN_ALL} style={{ padding: "40px", textAlign: "center", fontSize: "13px", color: "var(--text3)" }}>
                      자재가 없습니다. 「자재 추가」 또는 모델링·도면 업로드로 추가하세요.
                    </td>
                  </tr>
                )}
                {uploadingRows > 0 &&
                  Array.from({ length: uploadingRows }, (_, i) => (
                    <tr key={`skeleton-${i}`} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={COL_SPAN_ALL} style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                          <div style={{ width: "16px", height: "16px", borderRadius: "3px", background: "var(--border2)", flexShrink: 0 }} />
                          <div style={{ height: "14px", background: "var(--border2)", borderRadius: "4px", flex: 1, maxWidth: "200px", animation: "pulse 1.5s ease-in-out infinite" }} />
                          <div style={{ height: "14px", background: "var(--border2)", borderRadius: "4px", width: "80px", animation: "pulse 1.5s ease-in-out infinite" }} />
                          <div style={{ flex: 1 }} />
                          <div style={{ height: "14px", background: "var(--border2)", borderRadius: "4px", width: "80px", animation: "pulse 1.5s ease-in-out infinite" }} />
                        </div>
                      </td>
                    </tr>
                  ))}

                {/* 단품 모드: 그룹 + 미그룹 */}
                {quoteListMode === "bundles" &&
                  groups.map((g) => {
                  const allMembers = sorted.filter((r) => g.materialIds.includes(r.id));
                  if (!allMembers.length) return null;
                  const members =
                    !tableQuery || g.name.toLowerCase().includes(tableQuery)
                      ? allMembers
                      : allMembers.filter(materialMatchesSearch);
                  if (!members.length) return null;
                  const isGrpOpen = groupExpanded.has(g.id);
                  const box = computeBoxSize(g);
                  const grpTotal = allMembers.reduce((s, r) => s + computeRow(r).total, 0);
                  const grpMat = allMembers.reduce((s, r) => s + computeRow(r).matWon, 0);
                  const grpProc = allMembers.reduce((s, r) => s + computeRow(r).procWon, 0);
                  const allMembChecked = allMembers.length > 0 && allMembers.every((r) => checked.has(r.id));
                  const isEditingName = editingGroupId === g.id;

                  return (
                    <Fragment key={g.id}>
                      {/* 단품 그룹 행 — TDS: chevron만 접기/펼침 */}
                      <tr
                        style={{
                          background: dragOverGroupId === g.id ? "#e8f2ff" : "#f0f4ff",
                          cursor: "pointer",
                          borderBottom: "1px solid #dde2ea",
                          boxShadow: "inset 3px 0 0 #3182f6",
                          outline: dragOverGroupId === g.id ? "2px dashed #3182f6" : undefined,
                          outlineOffset: dragOverGroupId === g.id ? "-2px" : undefined,
                          transition: "background 150ms ease",
                        }}
                        onClick={(e) => {
                          const t = e.target as HTMLElement;
                          if (t.closest("input,button,a,textarea")) return;
                          if (editingGroupId === g.id) return;
                          toggleGroup(g.id);
                        }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverGroupId(g.id); }}
                        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverGroupId(null); }}
                        onDrop={(e) => { e.preventDefault(); handleDropOnGroup(g.id); }}
                      >
                        <td style={{ ...TD, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={allMembChecked}
                            onChange={() =>
                              setChecked((s) => {
                                const ns = new Set(s);
                                allMembers.forEach((r) => (allMembChecked ? ns.delete(r.id) : ns.add(r.id)));
                                return ns;
                              })
                            }
                          />
                        </td>
                        <td colSpan={5} style={{ ...TD, verticalAlign: "middle" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                borderRadius: 100,
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 700,
                                background: "#ebf3fe",
                                color: "#3182f6",
                                flexShrink: 0,
                              }}
                            >
                              단품
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0 }}>
                              {isEditingName ? (
                                <input
                                  ref={groupNameInputRef}
                                  type="text"
                                  value={editingGroupName}
                                  onChange={(e) => setEditingGroupName(e.target.value)}
                                  onBlur={commitGroupRename}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); commitGroupRename(); }
                                    if (e.key === "Escape") { e.preventDefault(); setEditingGroupId(null); }
                                  }}
                                  style={{ border: "1px solid #3182f6", borderRadius: "6px", padding: "4px 8px", fontSize: "14px", fontWeight: 700, outline: "none", background: "white", fontFamily: "inherit", minWidth: "120px" }}
                                />
                              ) : (
                                <span
                                  style={{ fontSize: "14px", fontWeight: 700, color: "#191f28" }}
                                  onDoubleClick={() => {
                                    setEditingGroupId(g.id);
                                    setEditingGroupName(g.name);
                                  }}
                                  title="단품명 더블클릭하여 수정"
                                >
                                  {g.name}
                                </span>
                              )}
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  background: "#dde2ea",
                                  color: "#4e5968",
                                  borderRadius: "100px",
                                  padding: "1px 7px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                }}
                              >
                                {allMembers.length}개
                              </span>
                              {box && (
                                <span style={{ fontSize: "11px", color: "#8b95a1", fontWeight: 400 }}>
                                  · {box.W} × {box.D} × {box.H} mm
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ ...TD, textAlign: "right", fontSize: "13px", fontWeight: 700, color: "#8b95a1" }}>
                          {formatWonKorean(grpMat)}
                        </td>
                        <td style={{ ...TD, textAlign: "right", fontSize: "13px", fontWeight: 700, color: "#8b95a1" }}>
                          {formatWonKorean(grpProc)}
                        </td>
                        <td style={{ ...TD, textAlign: "right", fontSize: "15px", fontWeight: 700, color: "#3182f6" }}>
                          {formatWonKorean(grpTotal)}
                        </td>
                        <td style={{ ...TD, position: "relative" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                            <div style={{ position: "relative" }}>
                              <button
                                type="button"
                                style={{ width: "22px", height: "22px", border: "none", background: "none", cursor: "pointer", color: "#8b95a1", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMoreMenuId(moreMenuId === `g-${g.id}` ? null : `g-${g.id}`);
                                }}
                              >
                                ···
                              </button>
                              {moreMenuId === `g-${g.id}` && (
                                <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 50, background: "white", border: "0.5px solid #e8ecf2", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", minWidth: "130px", overflow: "hidden" }}>
                                  <button style={MENU_ITEM} onClick={(e) => { e.stopPropagation(); setEditingGroupId(g.id); setEditingGroupName(g.name); setMoreMenuId(null); }}>단품명 수정</button>
                                  <button style={MENU_ITEM} onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id); }}>단품 해제</button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Child rows */}
                      {isGrpOpen &&
                        members.map((m) => {
                          const { matWon, procWon, total, hit } = computeRow(m);
                          const isExp = rowExpanded.has(m.id);
                          return (
                            <Fragment key={m.id}>
                              <MatRow
                                m={m} matWon={matWon} procWon={procWon} total={total} hit={hit}
                                isExpanded={isExp} isChecked={checked.has(m.id)} indent
                                moreMenuId={moreMenuId}
                                editingRowId={editingRowId}
                                editingRowName={editingRowName}
                                rowNameInputRef={rowNameInputRef}
                                onEditingRowName={setEditingRowName}
                                onToggle={() => toggleRow(m.id)}
                                onCheck={() => toggleCheck(m.id)}
                                onMoreMenu={(id) => setMoreMenuId(moreMenuId === id ? null : id)}
                                onDuplicate={() => handleDuplicate(m)}
                                onDelete={() => handleDelete(m.id)}
                                onUngroup={() => handleUngroup(m.id)}
                                onStartRename={() => { setEditingRowId(m.id); setEditingRowName(m.name); }}
                                onCommitRename={commitRowRename}
                                onCancelRename={() => setEditingRowId(null)}
                                onDragStart={() => setDraggingMatId(m.id)}
                                onDragEnd={() => setDraggingMatId(null)}
                              />
                              {isExp && (
                                <tr style={{ background: "#f7faff", borderBottom: "0.5px solid #e8ecf2", transition: "background 150ms ease" }}>
                                  <td colSpan={COL_SPAN_ALL} style={{ padding: 0 }}>
                                    <div style={{ overflow: "hidden", transition: "max-height 150ms ease, opacity 150ms ease" }}>
                                      <RowDetailPane materialId={m.id} indent onSaved={onSaved} />
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}

                      {/* 박스 사이즈 카드 (단품 소속 자재 마지막) */}
                      {isGrpOpen && box && (
                        <tr style={{ background: "#fff", borderBottom: "0.5px solid #e8ecf2" }}>
                          <td colSpan={COL_SPAN_ALL} style={{ padding: "8px 14px 8px 56px", background: "#fff" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#ebf3fe", borderRadius: "8px", padding: "8px 14px" }}>
                              <StackedBoxIcon />
                              <span style={{ fontSize: "12px", color: "#185FA5", fontWeight: 500 }}>
                                박스 사이즈 (자재 적층 기준):{" "}
                                <span style={{ fontWeight: 700 }}>
                                  {box.W} × {box.D} × {box.H} mm
                                </span>
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {/* Ungrouped rows (단품 모드만) */}
                {quoteListMode === "bundles" &&
                  ungrouped.map((m) => {
                  const { matWon, procWon, total, hit } = computeRow(m);
                  const isExp = rowExpanded.has(m.id);
                  return (
                    <Fragment key={m.id}>
                      <MatRow
                        m={m} matWon={matWon} procWon={procWon} total={total} hit={hit}
                        isExpanded={isExp} isChecked={checked.has(m.id)} indent={false}
                        moreMenuId={moreMenuId}
                        editingRowId={editingRowId}
                        editingRowName={editingRowName}
                        rowNameInputRef={rowNameInputRef}
                        onEditingRowName={setEditingRowName}
                        onToggle={() => toggleRow(m.id)}
                        onCheck={() => toggleCheck(m.id)}
                        onMoreMenu={(id) => setMoreMenuId(moreMenuId === id ? null : id)}
                        onDuplicate={() => handleDuplicate(m)}
                        onDelete={() => handleDelete(m.id)}
                        onStartRename={() => { setEditingRowId(m.id); setEditingRowName(m.name); }}
                        onCommitRename={commitRowRename}
                        onCancelRename={() => setEditingRowId(null)}
                        onDragStart={() => setDraggingMatId(m.id)}
                        onDragEnd={() => setDraggingMatId(null)}
                      />
                      {isExp && (
                        <tr style={{ background: "#f7faff", borderBottom: "0.5px solid #e8ecf2", transition: "background 150ms ease" }}>
                          <td colSpan={COL_SPAN_ALL} style={{ padding: 0 }}>
                            <div style={{ overflow: "hidden", transition: "max-height 150ms ease, opacity 150ms ease" }}>
                              <RowDetailPane materialId={m.id} indent={false} onSaved={onSaved} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {/* 자재 모드: 전체 평면 */}
                {quoteListMode === "materials" &&
                  flatMaterialsFiltered.map((m) => {
                    const { matWon, procWon, total, hit } = computeRow(m);
                    const isExp = rowExpanded.has(m.id);
                    return (
                      <Fragment key={m.id}>
                        <MatRow
                          m={m} matWon={matWon} procWon={procWon} total={total} hit={hit}
                          isExpanded={isExp} isChecked={checked.has(m.id)} indent={false}
                          moreMenuId={moreMenuId}
                          editingRowId={editingRowId}
                          editingRowName={editingRowName}
                          rowNameInputRef={rowNameInputRef}
                          onEditingRowName={setEditingRowName}
                          onToggle={() => toggleRow(m.id)}
                          onCheck={() => toggleCheck(m.id)}
                          onMoreMenu={(id) => setMoreMenuId(moreMenuId === id ? null : id)}
                          onDuplicate={() => handleDuplicate(m)}
                          onDelete={() => handleDelete(m.id)}
                          onStartRename={() => { setEditingRowId(m.id); setEditingRowName(m.name); }}
                          onCommitRename={commitRowRename}
                          onCancelRename={() => setEditingRowId(null)}
                          onDragStart={() => setDraggingMatId(m.id)}
                          onDragEnd={() => setDraggingMatId(null)}
                        />
                        {isExp && (
                          <tr style={{ background: "#f7faff", borderBottom: "0.5px solid #e8ecf2", transition: "background 150ms ease" }}>
                            <td colSpan={COL_SPAN_ALL} style={{ padding: 0 }}>
                              <div style={{ overflow: "hidden", transition: "max-height 150ms ease, opacity 150ms ease" }}>
                                <RowDetailPane materialId={m.id} indent={false} onSaved={onSaved} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}

                {/* 합계 행 */}
                {rows.length > 0 && (
                  <tr style={{ background: "#f8f9fb", borderTop: "2px solid #dde2ea" }}>
                    <td colSpan={6} style={{ ...TD, fontSize: "12px", color: "#8b95a1", fontWeight: 400, paddingLeft: "14px" }}>
                      {groups.length > 0 ? `${groups.length}개 단품 · ` : ""}
                      {rows.length}개 자재 합계
                    </td>
                    <td style={{ ...TD, textAlign: "right", fontSize: "12px", fontWeight: 700, color: "#4e5968" }}>{formatWonKorean(totals.matWon)}</td>
                    <td style={{ ...TD, textAlign: "right", fontSize: "12px", fontWeight: 700, color: "#4e5968" }}>{formatWonKorean(totals.procWon)}</td>
                    <td style={{ ...TD, textAlign: "right", fontSize: "14px", fontWeight: 700, color: "#3182f6" }}>{formatWonKorean(totals.total)}</td>
                    <td style={TD} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>

      {/* Toast notifications */}
      <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 300, display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "none" }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.ok ? "#0ac67a" : "#ef4444",
              color: "white",
              padding: "11px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
              animation: "fadeInUp 0.25s ease",
            }}
          >
            {t.ok ? "✓ " : "✗ "}{t.message}
          </div>
        ))}
      </div>

      {/* Modals */}
      {showBomModal && (
        <UploadModal
          onClose={() => { setShowBomModal(false); setUploadingRows(0); }}
          onParsed={handleApiParsed}
          onStartLoading={(n) => setUploadingRows(n)}
        />
      )}
      {moreMenuId && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 48 }}
          onClick={() => setMoreMenuId(null)}
        />
      )}
    </div>
  );
}

// ===== MatRow sub-component =====
type MatRowProps = {
  m: StoredMaterial;
  matWon: number; procWon: number; total: number;
  hit: SheetYieldRow | undefined;
  isExpanded: boolean; isChecked: boolean; indent: boolean;
  moreMenuId: string | null;
  editingRowId: string | null;
  editingRowName: string;
  rowNameInputRef: React.RefObject<HTMLInputElement | null>;
  onEditingRowName: (n: string) => void;
  onToggle: () => void;
  onCheck: () => void;
  onMoreMenu: (id: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUngroup?: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

function MatRow({
  m, matWon, procWon, total, hit, isExpanded, isChecked, indent,
  moreMenuId, editingRowId, editingRowName, rowNameInputRef, onEditingRowName,
  onToggle, onCheck, onMoreMenu, onDuplicate, onDelete, onUngroup,
  onStartRename, onCommitRename, onCancelRename, onDragStart, onDragEnd,
}: MatRowProps) {
  const nameTapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (nameTapRef.current != null) clearTimeout(nameTapRef.current);
    },
    []
  );

  const isEditingName = editingRowId === m.id;
  const specLabel = m.form.wMm && m.form.dMm && m.form.hMm
    ? `${m.form.wMm}×${m.form.dMm}×${m.form.hMm}`
    : "—";
  const specSubLabel = `${m.form.boardMaterial}/${m.form.surfaceMaterial}/${m.form.color}`;
  const sheetLabel = hit ? `${hit.label} (${hit.yieldPct.toFixed(0)}%)` : "—";

  const padFirst = indent ? 56 : 14;

  const tdSpecR: CSSProperties = { ...TD, ...TD_SPEC, textAlign: "right" };

  return (
    <tr
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={() => onToggle()}
      style={{
        cursor: "pointer",
        background: isExpanded ? "#f7faff" : "#ffffff",
        borderBottom: "0.5px solid #e8ecf2",
        boxShadow: indent ? "inset 3px 0 0 #c9e0fd" : undefined,
        transition: "background 150ms ease",
      }}
    >
      <td style={{ ...TD, textAlign: "center", paddingLeft: padFirst }} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={isChecked} onChange={onCheck} />
      </td>
      <td
        style={{ ...TD, maxWidth: 0, overflow: "hidden", verticalAlign: "middle" }}
        onClick={(e) => {
          e.stopPropagation();
          if (nameTapRef.current != null) clearTimeout(nameTapRef.current);
          nameTapRef.current = setTimeout(() => {
            nameTapRef.current = null;
            onToggle();
          }, 280);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (nameTapRef.current != null) {
            clearTimeout(nameTapRef.current);
            nameTapRef.current = null;
          }
          onStartRename();
        }}
      >
        {isEditingName ? (
          <input
            ref={rowNameInputRef}
            type="text"
            value={editingRowName}
            onChange={(e) => onEditingRowName(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCommitRename(); }
              if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ border: "1px solid #3182f6", borderRadius: "6px", padding: "3px 8px", fontSize: "13px", fontWeight: 500, outline: "none", background: "white", fontFamily: "inherit", width: "100%", maxWidth: "30ch", boxSizing: "border-box" }}
          />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minWidth: 0 }} title="행 클릭: 상세 · 이름 더블클릭: 수정">
            {indent ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 100,
                  padding: "2px 7px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#f0f2f5",
                  color: "#4e5968",
                  flexShrink: 0,
                }}
              >
                자재
              </span>
            ) : null}
            <span style={{ fontWeight: 500, fontSize: "13px", color: "#191f28", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "30ch" }}>
              {m.name || "이름 없음"}
            </span>
            {m.form.partCode ? (
              <span style={{ display: "inline-flex", background: "#f0f2f5", border: "1px solid #e8ecf2", borderRadius: "3px", padding: "1px 5px", fontSize: "10px", color: "#8b95a1", fontWeight: 500, fontFamily: "monospace", flexShrink: 0 }}>
                {m.form.partCode}
              </span>
            ) : null}
          </div>
        )}
      </td>
      <td style={tdSpecR}>{specLabel}</td>
      <td style={tdSpecR}>{specSubLabel}</td>
      <td style={{ ...TD, textAlign: "right", verticalAlign: "middle" }}>
        {m.form.edgePreset !== "none" ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#ebf3fe",
              color: "#185FA5",
              borderRadius: "100px",
              fontSize: "11px",
              fontWeight: 600,
              padding: "2px 8px",
            }}
          >
            {fullEdgeLabel(m.form)}
          </span>
        ) : (
          <span style={{ ...TD_SPEC, fontSize: "12px" }}>없음</span>
        )}
      </td>
      <td style={tdSpecR}>{sheetLabel}</td>
      <td style={{ ...TD, textAlign: "right", fontSize: "13px", fontWeight: 700, color: matWon > 0 ? "#3182f6" : "#8b95a1" }}>{matWon > 0 ? formatWonKorean(matWon) : "—"}</td>
      <td style={{ ...TD, textAlign: "right", fontSize: "13px", fontWeight: 700, color: procWon > 0 ? "#3182f6" : "#8b95a1" }}>{procWon > 0 ? formatWonKorean(procWon) : "—"}</td>
      <td style={{ ...TD, textAlign: "right", fontSize: "13px", fontWeight: 700, color: "#3182f6" }}>{formatWonKorean(total)}</td>
      <td style={{ ...TD, position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            type="button"
            style={{ width: "22px", height: "22px", border: "none", background: "none", cursor: "pointer", color: "#8b95a1", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px" }}
            onClick={(e) => { e.stopPropagation(); onMoreMenu(m.id); }}
          >
            ···
          </button>
          {moreMenuId === m.id && (
            <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 50, background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", minWidth: "120px", overflow: "hidden" }}>
              <button style={MENU_ITEM} onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>복제</button>
              {onUngroup && (
                <button style={MENU_ITEM} onClick={(e) => { e.stopPropagation(); onUngroup(); }}>단품 해제</button>
              )}
              <button style={{ ...MENU_ITEM, color: "#ef4444" }} onClick={(e) => { e.stopPropagation(); onDelete(); }}>삭제</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ===== RowDetailPane =====
type DetailProps = { materialId: string; indent: boolean; onSaved: () => void };

function RowDetailPane({ materialId, indent, onSaved }: DetailProps) {
  const [form, setForm] = useState<MaterialFormState | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const m = getMaterial(materialId);
    if (m) setForm(m.form);
  }, [materialId]);

  const comp = useMemo<ComputedMaterial | null>(() => {
    if (!form) return null;
    const input = buildMaterialInput({
      ...form,
      sheetPrices: form.sheetPrices as Partial<Record<SheetId, number>>,
    });
    return computeMaterial(input, (form.selectedSheetId ?? null) as SheetId | null);
  }, [form]);

  const update = useCallback(
    <K extends keyof MaterialFormState>(key: K, val: MaterialFormState[K]) => {
      setForm((prev) => {
        if (!prev) return prev;
        const next: MaterialFormState = { ...prev, [key]: val };
        if (key === "hMm") {
          next.sheetPrices = sheetPricesForT(val as number);
          next.selectedSheetId = null;
        }
        clearTimeout(saveRef.current);
        saveRef.current = setTimeout(() => {
          const m = getMaterial(materialId);
          if (!m) return;
          const inp = buildMaterialInput({
            ...next,
            sheetPrices: next.sheetPrices as Partial<Record<SheetId, number>>,
          });
          const c = computeMaterial(inp, (next.selectedSheetId ?? null) as SheetId | null);
          putMaterial({
            ...m,
            name: next.name || m.name,
            form: next,
            grandTotalWon: c.grandTotalWon,
            updatedAt: new Date().toISOString(),
            summary: `${next.wMm}×${next.dMm}×${next.hMm} mm`,
          });
          onSaved();
        }, 500);
        return next;
      });
    },
    [materialId, onSaved]
  );

  const updateMany = useCallback(
    (patch: Partial<MaterialFormState>) => {
      setForm((prev) => {
        if (!prev) return prev;
        let next: MaterialFormState = { ...prev, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, "hMm") && patch.hMm !== undefined) {
          next = {
            ...next,
            sheetPrices: sheetPricesForT(patch.hMm as number),
            selectedSheetId: null,
          };
        }
        clearTimeout(saveRef.current);
        saveRef.current = setTimeout(() => {
          const m = getMaterial(materialId);
          if (!m) return;
          const inp = buildMaterialInput({
            ...next,
            sheetPrices: next.sheetPrices as Partial<Record<SheetId, number>>,
          });
          const c = computeMaterial(inp, (next.selectedSheetId ?? null) as SheetId | null);
          putMaterial({
            ...m,
            name: next.name || m.name,
            form: next,
            grandTotalWon: c.grandTotalWon,
            updatedAt: new Date().toISOString(),
            summary: `${next.wMm}×${next.dMm}×${next.hMm} mm`,
          });
          onSaved();
        }, 500);
        return next;
      });
    },
    [materialId, onSaved]
  );

  const sheetStripProps = useMemo(() => {
    if (!form) return null;
    const sp = form.sheetPrices as Record<string, number>;
    const unavailableSheetIds =
      form.hMm > 0 ? ALL_SHEET_IDS.filter((id) => sp[id] == null) : ALL_SHEET_IDS.slice();
    const unitPriceBySheetId: Record<string, number> = {};
    ALL_SHEET_IDS.forEach((id) => {
      if (sp[id] != null) unitPriceBySheetId[id] = sp[id]!;
    });
    const erpMap = SHEET_ERP_CODE_BY_THICKNESS[form.hMm] ?? {};
    const erpCodeBySheetId: Record<string, string> = {};
    ALL_SHEET_IDS.forEach((id) => {
      const c = erpMap[id as keyof typeof erpMap];
      if (c) erpCodeBySheetId[id] = c;
    });
    return { unavailableSheetIds, unitPriceBySheetId, erpCodeBySheetId };
  }, [form]);

  if (!form || !comp) {
    return (
      <div style={{ padding: "16px", textAlign: "center", color: "var(--text3)", fontSize: "12px" }}>
        로딩 중...
      </div>
    );
  }

  return (
    <div
      style={{
        padding: indent ? "16px 16px 16px 52px" : "16px 16px 16px 36px",
        display: "grid",
        gridTemplateColumns: "1.6fr 1fr 1fr",
        gap: "12px",
      }}
    >
      {/* Col 1: Spec + Edge + Sheet */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* Spec & Edge card */}
        <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* 규격 */}
            <div>
              <div style={CARD_TITLE}>규격</div>
              <div style={{ display: "flex", gap: "6px" }}>
                <SpecField label="W(mm)">
                  <input type="number" value={form.wMm || ""} placeholder="0" style={INPUT_S}
                    onChange={(e) => update("wMm", Number(e.target.value))} onClick={(e) => e.stopPropagation()} />
                </SpecField>
                <SpecField label="D(mm)">
                  <input type="number" value={form.dMm || ""} placeholder="0" style={INPUT_S}
                    onChange={(e) => update("dMm", Number(e.target.value))} onClick={(e) => e.stopPropagation()} />
                </SpecField>
                <SpecField label="H(T)">
                  <select value={form.hMm} style={SELECT_S}
                    onChange={(e) => update("hMm", Number(e.target.value))} onClick={(e) => e.stopPropagation()}>
                    <option value={0}>—</option>
                    {[12, 15, 18, 22, 25, 28].map((t) => <option key={t} value={t}>{t}T</option>)}
                  </select>
                </SpecField>
              </div>
            </div>
            <VDivider />
            {/* 사양 */}
            <div>
              <div style={CARD_TITLE}>사양</div>
              <div style={{ display: "flex", gap: "6px" }}>
                <SpecField label="소재">
                  <select value={form.boardMaterial} style={SELECT_S}
                    onChange={(e) => update("boardMaterial", e.target.value)} onClick={(e) => e.stopPropagation()}>
                    <option>PB</option><option>MDF</option>
                  </select>
                </SpecField>
                <SpecField label="표면재">
                  <select value={form.surfaceMaterial} style={{ ...SELECT_S, width: "72px" }}
                    onChange={(e) => update("surfaceMaterial", e.target.value)} onClick={(e) => e.stopPropagation()}>
                    <option>LPM/O</option><option>PET</option><option>UV</option>
                  </select>
                </SpecField>
                <SpecField label="색상">
                  <select value={form.color} style={SELECT_S}
                    onChange={(e) => update("color", e.target.value)} onClick={(e) => e.stopPropagation()}>
                    <option>WW</option><option>WN</option><option>BI</option>
                  </select>
                </SpecField>
              </div>
            </div>
          </div>

          {/* Edge section */}
          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
            <div style={CARD_TITLE}>엣지</div>
            <EdgePicker form={form} onUpdate={update} />
          </div>

          <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "10px", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
            기본 사양 고정이며, 이 외 자재는 업데이트 예정입니다.
          </div>
        </div>

        {/* Sheet selector — 견적 V2와 동일 스트립 (가로 3열 + 배치모드) */}
        {form.wMm > 0 && form.dMm > 0 && form.hMm > 0 && sheetStripProps && (
          <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px" }}>
            <div style={CARD_TITLE}>원장 선택</div>
            <div style={{ marginTop: "10px" }} onClick={(e) => e.stopPropagation()}>
              <MaterialSheetQuoteStrip
                pieceWMm={form.wMm}
                pieceDMm={form.dMm}
                placementMode={form.placementMode}
                onPlacementModeChange={(m) => updateMany({ placementMode: m })}
                selectedSheetId={form.selectedSheetId}
                computedSelectedId={comp.selectedSheetId}
                recommendedSheetId={comp.recommendedSheetId}
                onSelectSheetOriented={(id, o) => updateMany({ selectedSheetId: id, placementMode: o })}
                onSelectSheet={(id) => updateMany({ selectedSheetId: id })}
                unavailableSheetIds={sheetStripProps.unavailableSheetIds}
                unitPriceBySheetId={sheetStripProps.unitPriceBySheetId}
                erpCodeBySheetId={sheetStripProps.erpCodeBySheetId}
                showPrice={form.hMm > 0}
              />
            </div>
          </div>
        )}
      </div>

      {/* Col 2: Processing */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px" }}>
          <div style={CARD_TITLE}>가공</div>
          <ProcItem label="자재 조립" value={form.assemblyHours} unit="h" price={comp.assemblyCostWon} onChange={(v) => update("assemblyHours", v)} />
          <ProcItem label="일반 보링" value={form.boring1Ea} unit="개" price={comp.boring1CostWon} onChange={(v) => update("boring1Ea", v)} />
          <ProcItem label="2단 보링" value={form.boring2Ea} unit="개" price={comp.boring2CostWon} onChange={(v) => update("boring2Ea", v)} />
          <ProcItem label="루터 가공" value={form.rutaM} unit="mm" price={comp.rutaCostWon} muted={form.rutaM <= 0} onChange={(v) => update("rutaM", v)} />
          <button style={{ width: "100%", padding: "7px", border: "1.5px dashed var(--border2)", borderRadius: "6px", fontSize: "11px", color: "var(--text3)", background: "none", cursor: "pointer", marginTop: "8px" }}>
            + 가공 추가하기
          </button>
        </div>
      </div>

      {/* Col 3: Receipt */}
      <div>
        <ReceiptCard form={form} comp={comp} />
      </div>
    </div>
  );
}

// ===== EdgePicker =====
function EdgePicker({
  form,
  onUpdate,
}: {
  form: MaterialFormState;
  onUpdate: <K extends keyof MaterialFormState>(key: K, val: MaterialFormState[K]) => void;
}) {
  const edgeSides = form.edgeSides ?? { top: true, bottom: true, left: true, right: true };

  // Scale board to max 140×90 px for visualization
  const wMm = form.wMm || 400;
  const dMm = form.dMm || 300;
  const maxBW = 140;
  const maxBH = 90;
  const scale = Math.min(maxBW / wMm, maxBH / dMm);
  const bW = Math.max(40, Math.round(wMm * scale));
  const bH = Math.max(24, Math.round(dMm * scale));
  const ET = 10; // edge thickness px

  const edgeStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--blue)" : "var(--border2)",
    cursor: "pointer",
    transition: "background 0.15s",
    borderRadius: "2px",
    flexShrink: 0,
  });

  return (
    <div style={{ display: "flex", gap: "18px", alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* Controls */}
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <SpecField label="종류">
          <select
            value={form.edgePreset}
            style={{ ...SELECT_S, width: "90px" }}
            onChange={(e) => onUpdate("edgePreset", e.target.value as MaterialEdgePreset)}
            onClick={(e) => e.stopPropagation()}
          >
            <option value="none">없음</option>
            <option value="abs1t">ABS 1T</option>
            <option value="abs2t">ABS 2T</option>
          </select>
        </SpecField>
        {form.edgePreset !== "none" && (
          <SpecField label="색상">
            <select
              value={form.edgeColor}
              style={{ ...SELECT_S, width: "54px" }}
              onChange={(e) => onUpdate("edgeColor", e.target.value as "WW" | "BI")}
              onClick={(e) => e.stopPropagation()}
            >
              <option>WW</option>
              <option>BI</option>
            </select>
          </SpecField>
        )}
      </div>

      {/* Board visualization */}
      {form.edgePreset !== "none" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0, userSelect: "none" }}>
          {/* Top edge */}
          <div
            style={{ ...edgeStyle(!!edgeSides.top), marginLeft: ET, width: bW, height: ET }}
            onClick={(e) => { e.stopPropagation(); onUpdate("edgeSides", { ...edgeSides, top: !edgeSides.top }); }}
            title="상단 엣지"
          />
          <div style={{ display: "flex" }}>
            {/* Left edge */}
            <div
              style={{ ...edgeStyle(!!edgeSides.left), width: ET, height: bH }}
              onClick={(e) => { e.stopPropagation(); onUpdate("edgeSides", { ...edgeSides, left: !edgeSides.left }); }}
              title="좌측 엣지"
            />
            {/* Board */}
            <div style={{ width: bW, height: bH, background: "var(--surface2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "var(--text3)", fontWeight: 500 }}>
              {form.wMm && form.dMm ? `${form.wMm}×${form.dMm}` : "보드"}
            </div>
            {/* Right edge */}
            <div
              style={{ ...edgeStyle(!!edgeSides.right), width: ET, height: bH }}
              onClick={(e) => { e.stopPropagation(); onUpdate("edgeSides", { ...edgeSides, right: !edgeSides.right }); }}
              title="우측 엣지"
            />
          </div>
          {/* Bottom edge */}
          <div
            style={{ ...edgeStyle(!!edgeSides.bottom), marginLeft: ET, width: bW, height: ET }}
            onClick={(e) => { e.stopPropagation(); onUpdate("edgeSides", { ...edgeSides, bottom: !edgeSides.bottom }); }}
            title="하단 엣지"
          />
          <div style={{ fontSize: "9px", color: "var(--text3)", marginTop: "4px", marginLeft: ET }}>
            클릭해서 면 선택
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Small UI components =====
function SpecField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      <div style={{ fontSize: "10px", color: "var(--text3)", fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

function VDivider() {
  return <div style={{ width: "1px", height: "48px", background: "var(--border)", alignSelf: "flex-end", marginBottom: "2px" }} />;
}

function ProcItem({ label, value, unit, price, muted, onChange }: {
  label: string; value: number; unit: string; price: number; muted?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ flex: 1, fontSize: "12px", color: muted ? "var(--text3)" : "var(--text2)", fontWeight: 500 }}>{label}</span>
      <input type="number" value={value || ""} placeholder="0"
        style={{ width: "56px", height: "30px", textAlign: "center", padding: "0 6px", background: "white", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12px", color: "var(--text1)", fontFamily: "inherit" }}
        onChange={(e) => onChange(Number(e.target.value))} onClick={(e) => e.stopPropagation()} />
      <span style={{ fontSize: "11px", color: "var(--text3)", width: "20px" }}>{unit}</span>
      <span style={{ fontSize: "12px", fontWeight: price > 0 ? 700 : 400, color: price > 0 ? "var(--text1)" : "var(--text3)", minWidth: "56px", textAlign: "right" }}>
        {price > 0 ? formatWonKorean(price) : "0원"}
      </span>
    </div>
  );
}

function RcptRow({ label, sub, value }: { label: string; sub: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "3px 0", fontSize: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <span style={{ color: "var(--text2)" }}>{label}</span>
        <span style={{ fontSize: "10px", color: "var(--text3)" }}>{sub}</span>
      </div>
      <span style={{ fontWeight: 600, color: "var(--text1)", flexShrink: 0, marginLeft: "8px" }}>{formatWonKorean(value)}</span>
    </div>
  );
}

function ReceiptCard({ form, comp }: { form: MaterialFormState; comp: ComputedMaterial }) {
  const hasSize = form.hMm > 0 && form.wMm > 0;
  const total = hasSize ? comp.grandTotalWon : comp.processingTotalWon;
  const matSub = comp.materialCostWon + comp.edgeCostWon + comp.hotmeltCostWon;
  return (
    <div style={{ background: "white", border: "1px solid #d0d0d0", borderRadius: "8px", overflow: "hidden" }}>
      <div style={{ background: "#f8f8f8", borderBottom: "1px dashed #d0d0d0", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#333" }}>{form.name || "이름 없음"}</span>
        <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--blue)" }}>{formatWonKorean(total)}</span>
      </div>
      <div style={{ padding: "12px 16px" }}>
        {hasSize && (
          <>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", marginBottom: "5px" }}>원자재비</div>
            <RcptRow label="목재 자재비" sub={`${form.wMm}×${form.dMm}×${form.hMm}T · ${form.boardMaterial}`} value={comp.materialCostWon} />
            {comp.edgeCostWon > 0 && <RcptRow label="엣지 자재비" sub={`${edgeLabel(form.edgePreset)} · ${comp.edgeLengthM.toFixed(1)}m`} value={comp.edgeCostWon} />}
            {comp.hotmeltCostWon > 0 && <RcptRow label="핫멜트" sub={`${form.hMm}T · ${comp.edgeLengthM.toFixed(1)}m`} value={comp.hotmeltCostWon} />}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "4px 0 8px", borderBottom: "1px dashed #e0e0e0", marginBottom: "8px" }}>
              <span style={{ color: "#aaa" }}>원자재비 소계</span>
              <span style={{ fontWeight: 600, color: "#555" }}>{formatWonKorean(matSub)}</span>
            </div>
          </>
        )}
        <div style={{ fontSize: "10px", fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", marginBottom: "5px" }}>가공비</div>
        {comp.cuttingCostWon > 0 && <RcptRow label="재단" sub={`${comp.sheetCount}매`} value={comp.cuttingCostWon} />}
        {comp.edgeCostWon > 0 && comp.cuttingCostWon > 0 && <RcptRow label="엣지 접착비" sub={`${comp.edgeLengthM.toFixed(1)}m`} value={comp.edgeCostWon} />}
        {comp.boring1CostWon > 0 && <RcptRow label="일반 보링" sub={`${form.boring1Ea}개`} value={comp.boring1CostWon} />}
        {comp.boring2CostWon > 0 && <RcptRow label="2단 보링" sub={`${form.boring2Ea}개`} value={comp.boring2CostWon} />}
        {comp.rutaCostWon > 0 && <RcptRow label="루터 가공" sub={`${form.rutaM}mm`} value={comp.rutaCostWon} />}
        {comp.assemblyCostWon > 0 && <RcptRow label="자재 조립" sub={`${form.assemblyHours}h`} value={comp.assemblyCostWon} />}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", paddingTop: "4px" }}>
          <span style={{ color: "#aaa" }}>가공비 소계</span>
          <span style={{ fontWeight: 600, color: "#555" }}>{formatWonKorean(comp.processingTotalWon)}</span>
        </div>
      </div>
    </div>
  );
}

// ===== UploadModal =====
function UploadModal({
  onClose,
  onParsed,
  onStartLoading,
}: {
  onClose: () => void;
  onParsed: (mats: StpMaterial[]) => void;
  onStartLoading: (estimatedCount: number) => void;
}) {
  const [stpFile, setStpFile] = useState<File | null>(null);
  const [bomFile, setBomFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stpDrag, setStpDrag] = useState(false);
  const [bomDrag, setBomDrag] = useState(false);

  const submit = async () => {
    if (!stpFile && !bomFile) { setError("파일을 하나 이상 선택해주세요."); return; }
    setLoading(true);
    setError(null);
    onStartLoading(3);
    try {
      if (stpFile) {
        setProgress("STP 파싱 중... (수십 초 소요될 수 있습니다)");
        const fd = new FormData();
        fd.append("file", stpFile);
        if (bomFile) fd.append("bom", bomFile);
        const res = await fetch(`${STP_API_URL}/api/parse/stp-zip`, { method: "POST", body: fd });
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(`서버 오류 (${res.status})${msg ? `: ${msg.slice(0, 80)}` : ""}`);
        }
        const data = (await res.json()) as StpApiResponse;
        if (!data.materials?.length) { setError("파싱된 자재가 없습니다. STP/BOM 파일을 확인해주세요."); setLoading(false); onStartLoading(0); return; }
        onParsed(data.materials);
      } else if (bomFile) {
        setProgress("BOM 파싱 중...");
        const fd = new FormData();
        fd.append("bom", bomFile);
        const res = await fetch(`${STP_API_URL}/api/parse/bom-only`, { method: "POST", body: fd });
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(`서버 오류 (${res.status})${msg ? `: ${msg.slice(0, 80)}` : ""}`);
        }
        const data = (await res.json()) as StpApiResponse;
        if (!data.materials?.length) { setError("BOM 파일에서 자재를 찾을 수 없습니다."); setLoading(false); onStartLoading(0); return; }
        onParsed(data.materials);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 중 오류가 발생했습니다.");
      setLoading(false);
      onStartLoading(0);
    }
  };

  const dropZoneBase: React.CSSProperties = {
    border: "2px dashed var(--border2)",
    borderRadius: "var(--radius-sm)",
    padding: "20px 16px",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.15s",
    position: "relative",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: "var(--radius)", padding: "28px 32px", width: "460px", maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "22px" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text1)" }}>모델링, 도면 업로드</div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text3)", fontSize: "18px", lineHeight: 1 }}>×</button>
        </div>

        <label
          style={{ ...dropZoneBase, marginBottom: "12px", borderColor: stpDrag ? "var(--blue)" : stpFile ? "var(--green)" : "var(--border2)", background: stpDrag ? "var(--blue-bg)" : stpFile ? "var(--green-bg)" : "var(--surface2)" }}
          onDragEnter={(e) => { e.preventDefault(); setStpDrag(true); }}
          onDragLeave={() => setStpDrag(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); setStpDrag(false); const f = e.dataTransfer.files[0]; if (f) setStpFile(f); }}
        >
          <input type="file" accept=".zip" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => setStpFile(e.target.files?.[0] ?? null)} />
          <div style={{ fontSize: "22px", marginBottom: "6px" }}>{stpFile ? "✓" : "📦"}</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: stpFile ? "var(--green)" : "var(--text2)", marginBottom: "3px" }}>
            {stpFile ? stpFile.name : "STP ZIP 드래그 or 클릭"}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text3)" }}>Separate Parts로 내보낸 ZIP 파일</div>
        </label>

        <label
          style={{ ...dropZoneBase, marginBottom: "16px", borderColor: bomDrag ? "var(--blue)" : bomFile ? "var(--green)" : "var(--border2)", background: bomDrag ? "var(--blue-bg)" : bomFile ? "var(--green-bg)" : "var(--surface2)" }}
          onDragEnter={(e) => { e.preventDefault(); setBomDrag(true); }}
          onDragLeave={() => setBomDrag(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); setBomDrag(false); const f = e.dataTransfer.files[0]; if (f) setBomFile(f); }}
        >
          <input type="file" accept=".bom.3,.bom,.txt" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => setBomFile(e.target.files?.[0] ?? null)} />
          <div style={{ fontSize: "22px", marginBottom: "6px" }}>{bomFile ? "✓" : "📄"}</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: bomFile ? "var(--green)" : "var(--text2)", marginBottom: "3px" }}>
            {bomFile ? bomFile.name : "BOM 파일 드래그 or 클릭"} <span style={{ color: "var(--text3)", fontWeight: 400 }}>(선택)</span>
          </div>
          <div style={{ fontSize: "11px", color: "var(--text3)" }}>.bom.3 파일 (Creo BOM)</div>
        </label>

        <div style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "16px", lineHeight: 1.6, background: "var(--surface2)", borderRadius: "6px", padding: "10px 12px" }}>
          ※ STP만 올리면 치수만 추출<br />
          ※ BOM 같이 올리면 이름도 자동 입력<br />
          ※ BOM만 올리면 이름/조립부품만 추출 (치수 없음)
        </div>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--blue)", marginBottom: "12px", fontWeight: 500 }}>
            <span style={{ display: "inline-block", width: "14px", height: "14px", border: "2px solid var(--blue-light)", borderTopColor: "var(--blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
            {progress}
          </div>
        )}

        {error && (
          <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "12px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: "6px", padding: "9px 12px" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button style={{ ...BTN_OUTLINE, padding: "9px 18px" }} onClick={onClose} disabled={loading}>취소</button>
          <button
            style={{ ...BTN_PRIMARY, padding: "9px 18px", opacity: loading || (!stpFile && !bomFile) ? 0.6 : 1 }}
            onClick={submit}
            disabled={loading || (!stpFile && !bomFile)}
          >
            {loading ? "처리 중..." : "업로드 시작"}
          </button>
        </div>
      </div>
    </div>
  );
}

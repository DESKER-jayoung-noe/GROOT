import type { MaterialFormState } from "../material/MaterialTab";
import type { ProductFormState, ProductComputed, ProductLineItem } from "../product/types";
import { buildMaterialInput, computeMaterial } from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import { computeProductLocal } from "../lib/productCalcLocal";
import { computeSetLocal } from "../lib/setCalcLocal";
import type { SetComputed } from "../lib/setCalcLocal";

/** @deprecated 마이그레이션 식별용 — 스코프 키 사용 */
export const KEY_MAT = "groot_materials";
export const KEY_PROD = "groot_products";
export const KEY_SET = "groot_sets";
export const KEY_COMP = "groot_comparisons";

const STORAGE_PROJECTS = "groot_projects_v1";
const STORAGE_PROJECT_GROUPS = "groot_project_groups_v1";
const STORAGE_ACTIVE_PROJECT = "groot_active_project_id";

const LEGACY_MAT = "groot_materials";
const LEGACY_PROD = "groot_products";
const LEGACY_SET = "groot_sets";
const LEGACY_COMP = "groot_comparisons";

export function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function keyMat(pid: string) {
  return `groot_materials__${pid}`;
}
function keyProd(pid: string) {
  return `groot_products__${pid}`;
}
function keySet(pid: string) {
  return `groot_sets__${pid}`;
}
function keyComp(pid: string) {
  return `groot_comparisons__${pid}`;
}
function keyMatGroups(pid: string) {
  return `groot_mat_groups__${pid}`;
}

let activeProjectId: string | null = null;

export function setActiveStorageProjectId(id: string | null) {
  activeProjectId = id;
}

export function getActiveStorageProjectId(): string | null {
  return activeProjectId;
}

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: string;
};

/** 사이드바 트리 — 그룹 아래 프로젝트 id 순서, `groups`로 하위 그룹 */
export type ProjectTreeGroup = {
  id: string;
  name: string;
  projectIds: string[];
  groups: ProjectTreeGroup[];
};

/** 루트: 그룹에 넣지 않은 프로젝트 id들 + 그룹 트리 (localStorage v2) */
export type ProjectTreeState = {
  ungroupedProjectIds: string[];
  groups: ProjectTreeGroup[];
};

export type StoredMaterial = {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  grandTotalWon: number;
  summary: string;
  form: MaterialFormState;
};

export type StoredProduct = {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  grandTotalWon: number;
  summary: string;
  form: ProductFormState;
  computed?: ProductComputed;
};

export type StoredSet = {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  grandTotalWon: number;
  summary: string;
  form: { name: string; productIds: string[] };
  computed?: SetComputed;
};

export type StoredComparison = {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  form: { name: string; slots: unknown[] };
  computed?: unknown;
  highlights?: unknown;
};

function readArr<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as T[]) : [];
  } catch {
    return [];
  }
}

function writeArr<T>(key: string, rows: T[]) {
  localStorage.setItem(key, JSON.stringify(rows));
}

function readProjectsJson(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? (p as ProjectMeta[]) : [];
  } catch {
    return [];
  }
}

function writeProjectsJson(list: ProjectMeta[]) {
  localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(list));
}

function normalizeGroupNode(x: unknown): ProjectTreeGroup | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  const projectIds = Array.isArray(o.projectIds)
    ? o.projectIds.filter((id): id is string => typeof id === "string")
    : [];
  const childRaw = o.groups;
  const groups = Array.isArray(childRaw)
    ? childRaw.map(normalizeGroupNode).filter((g): g is ProjectTreeGroup => g != null)
    : [];
  return { id: o.id, name: o.name, projectIds, groups };
}

/** v2: { v:2, u, g } / v1(레거시): groups 배열만 */
export function readProjectTreeState(): ProjectTreeState {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECT_GROUPS);
    if (!raw) return { ungroupedProjectIds: [], groups: [] };
    const p = JSON.parse(raw) as unknown;
    if (Array.isArray(p)) {
      return { ungroupedProjectIds: [], groups: p.map(normalizeGroupNode).filter((g): g is ProjectTreeGroup => g != null) };
    }
    if (p && typeof p === "object" && p !== null) {
      const o = p as Record<string, unknown>;
      const g = Array.isArray(o.g) ? o.g.map(normalizeGroupNode).filter((x): x is ProjectTreeGroup => x != null) : [];
      const u = Array.isArray(o.u) ? o.u.filter((id): id is string => typeof id === "string") : [];
      return { ungroupedProjectIds: u, groups: g };
    }
  } catch {
    /* */
  }
  return { ungroupedProjectIds: [], groups: [] };
}

function readGroupsJson(): ProjectTreeGroup[] {
  return readProjectTreeState().groups;
}

function writeProjectTreeData(state: ProjectTreeState) {
  localStorage.setItem(STORAGE_PROJECT_GROUPS, JSON.stringify({ v: 2, u: state.ungroupedProjectIds, g: state.groups }));
}

/** 프로젝트 목록과 동기화 — 그룹 트리 + 루트 미분류(ungrouped), 누락 id는 ungrouped에 */
function reconcileProjectTree(projects: ProjectMeta[], state: ProjectTreeState): ProjectTreeState {
  const validIds = new Set(projects.map((p) => p.id));
  const consumed = new Set<string>();

  function recurse(nodes: ProjectTreeGroup[]): ProjectTreeGroup[] {
    return nodes.map((g) => {
      const child = recurse(g.groups ?? []);
      let projectIds = g.projectIds.filter((id) => validIds.has(id));
      projectIds = projectIds.filter((id) => {
        if (consumed.has(id)) return false;
        consumed.add(id);
        return true;
      });
      return { ...g, projectIds, groups: child };
    });
  }

  const groups = recurse(state.groups);
  let ungrouped = state.ungroupedProjectIds.filter((id) => {
    if (!validIds.has(id)) return false;
    if (consumed.has(id)) return false;
    consumed.add(id);
    return true;
  });
  for (const p of projects) {
    if (!consumed.has(p.id)) {
      ungrouped = [...ungrouped, p.id];
      consumed.add(p.id);
    }
  }
  return { ungroupedProjectIds: ungrouped, groups };
}

export function persistProjectTree(state: ProjectTreeState): ProjectTreeState {
  const projects = readProjectsJson();
  const r = reconcileProjectTree(projects, state);
  writeProjectTreeData(r);
  return r;
}

function findNodeById(nodes: ProjectTreeGroup[], id: string): ProjectTreeGroup | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNodeById(n.groups ?? [], id);
    if (f) return f;
  }
  return null;
}

export function findGroupInTree(nodes: ProjectTreeGroup[], id: string): ProjectTreeGroup | null {
  return findNodeById(nodes, id);
}

function insertProjectUngrouped(ungrouped: string[], projectId: string, beforeId: string | null): string[] {
  const without = ungrouped.filter((id) => id !== projectId);
  if (beforeId == null) return [...without, projectId];
  const i = without.indexOf(beforeId);
  if (i === -1) return [...without, projectId];
  return [...without.slice(0, i), projectId, ...without.slice(i)];
}

function insertProjectAfterInState(state: ProjectTreeState, sourceId: string, newPid: string): ProjectTreeState {
  const ui = state.ungroupedProjectIds.indexOf(sourceId);
  if (ui !== -1) {
    const u = [...state.ungroupedProjectIds];
    u.splice(ui + 1, 0, newPid);
    return { ...state, ungroupedProjectIds: u };
  }
  return { ...state, groups: insertProjectAfterInTree(state.groups, sourceId, newPid) };
}

function addProjectToGroupInTree(nodes: ProjectTreeGroup[], groupId: string, projectId: string): ProjectTreeGroup[] {
  return nodes.map((n) => {
    if (n.id === groupId) return { ...n, projectIds: [...n.projectIds, projectId] };
    return { ...n, groups: addProjectToGroupInTree(n.groups ?? [], groupId, projectId) };
  });
}

function removeProjectFromTree(nodes: ProjectTreeGroup[], projectId: string): ProjectTreeGroup[] {
  return nodes.map((n) => ({
    ...n,
    projectIds: n.projectIds.filter((id) => id !== projectId),
    groups: removeProjectFromTree(n.groups ?? [], projectId),
  }));
}

function injectProjectIntoGroup(
  nodes: ProjectTreeGroup[],
  targetGroupId: string,
  projectId: string,
  beforeProjectId: string | null
): ProjectTreeGroup[] {
  return nodes.map((n) => {
    if (n.id === targetGroupId) {
      const ids = [...n.projectIds];
      if (beforeProjectId == null) return { ...n, projectIds: [...ids, projectId] };
      const pos = ids.indexOf(beforeProjectId);
      if (pos === -1) return { ...n, projectIds: [...ids, projectId] };
      return { ...n, projectIds: [...ids.slice(0, pos), projectId, ...ids.slice(pos)] };
    }
    return { ...n, groups: injectProjectIntoGroup(n.groups ?? [], targetGroupId, projectId, beforeProjectId) };
  });
}

/** `targetGroupId`가 `null`이면 그룹 밖(루트 미분류)로 이동 */
export function moveProjectInTree(
  state: ProjectTreeState,
  projectId: string,
  targetGroupId: string | null,
  beforeProjectId: string | null
): ProjectTreeState {
  const u = state.ungroupedProjectIds.filter((id) => id !== projectId);
  const g = removeProjectFromTree(state.groups, projectId);
  if (targetGroupId === null) {
    return { ungroupedProjectIds: insertProjectUngrouped(u, projectId, beforeProjectId), groups: g };
  }
  return { ungroupedProjectIds: u, groups: injectProjectIntoGroup(g, targetGroupId, projectId, beforeProjectId) };
}

function insertProjectAfterInTree(nodes: ProjectTreeGroup[], sourceId: string, newPid: string): ProjectTreeGroup[] {
  return nodes.map((n) => {
    const idx = n.projectIds.indexOf(sourceId);
    if (idx !== -1) {
      const ids = [...n.projectIds];
      ids.splice(idx + 1, 0, newPid);
      return { ...n, projectIds: ids };
    }
    return { ...n, groups: insertProjectAfterInTree(n.groups ?? [], sourceId, newPid) };
  });
}

function updateGroupNameInTree(nodes: ProjectTreeGroup[], id: string, newName: string): ProjectTreeGroup[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, name: newName.length > 0 ? newName : n.name };
    return { ...n, groups: updateGroupNameInTree(n.groups ?? [], id, newName) };
  });
}

function removeGroupReturnTree(
  nodes: ProjectTreeGroup[],
  id: string
): { tree: ProjectTreeGroup[]; removed: ProjectTreeGroup | null } {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    const removed = nodes[idx];
    return { tree: [...nodes.slice(0, idx), ...nodes.slice(idx + 1)], removed };
  }
  for (let i = 0; i < nodes.length; i++) {
    const sub = removeGroupReturnTree(nodes[i].groups ?? [], id);
    if (sub.removed) {
      return {
        tree: nodes.map((n, j) => (j === i ? { ...n, groups: sub.tree } : n)),
        removed: sub.removed,
      };
    }
  }
  return { tree: nodes, removed: null };
}

function appendChildToGroup(nodes: ProjectTreeGroup[], parentId: string, child: ProjectTreeGroup): ProjectTreeGroup[] {
  return nodes.map((n) => {
    if (n.id === parentId) return { ...n, groups: [...(n.groups ?? []), child] };
    return { ...n, groups: appendChildToGroup(n.groups ?? [], parentId, child) };
  });
}

function insertGroupBeforeSibling(
  nodes: ProjectTreeGroup[],
  siblingId: string,
  node: ProjectTreeGroup
): ProjectTreeGroup[] | null {
  const idx = nodes.findIndex((n) => n.id === siblingId);
  if (idx !== -1) {
    return [...nodes.slice(0, idx), node, ...nodes.slice(idx)];
  }
  for (let i = 0; i < nodes.length; i++) {
    const ch = insertGroupBeforeSibling(nodes[i].groups ?? [], siblingId, node);
    if (ch) {
      return nodes.map((n, j) => (j === i ? { ...n, groups: ch } : n));
    }
  }
  return null;
}

function insertGroupAfter(nodes: ProjectTreeGroup[], afterId: string, newNode: ProjectTreeGroup): ProjectTreeGroup[] | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === afterId) {
      return [...nodes.slice(0, i + 1), newNode, ...nodes.slice(i + 1)];
    }
    const ch = insertGroupAfter(nodes[i].groups ?? [], afterId, newNode);
    if (ch) {
      return nodes.map((n, j) => (j === i ? { ...n, groups: ch } : n));
    }
  }
  return null;
}

function containsGroupIdInSubtree(node: ProjectTreeGroup, id: string): boolean {
  if (node.id === id) return true;
  return (node.groups ?? []).some((g) => containsGroupIdInSubtree(g, id));
}

/** 그룹을 다른 그룹 안(맨 아래 자식)으로 이동 */
export function moveGroupAsChild(tree: ProjectTreeGroup[], draggedId: string, newParentId: string): ProjectTreeGroup[] | null {
  if (draggedId === newParentId) return null;
  const draggedRoot = findNodeById(tree, draggedId);
  if (!draggedRoot || !findNodeById(tree, newParentId)) return null;
  if (containsGroupIdInSubtree(draggedRoot, newParentId)) return null;
  const { tree: t1, removed } = removeGroupReturnTree(tree, draggedId);
  if (!removed) return null;
  return appendChildToGroup(t1, newParentId, removed);
}

/** 같은 레벨에서 형제 앞으로 순서 이동 */
export function moveGroupBeforeSibling(tree: ProjectTreeGroup[], draggedId: string, siblingId: string): ProjectTreeGroup[] | null {
  if (draggedId === siblingId) return null;
  const { tree: t1, removed } = removeGroupReturnTree(tree, draggedId);
  if (!removed) return null;
  return insertGroupBeforeSibling(t1, siblingId, removed);
}

function removeGroupNodeFromTree(nodes: ProjectTreeGroup[], id: string): ProjectTreeGroup[] {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    return [...nodes.slice(0, idx), ...nodes.slice(idx + 1)];
  }
  return nodes.map((n) => ({
    ...n,
    groups: removeGroupNodeFromTree(n.groups ?? [], id),
  }));
}

function collectAllProjectIdsInSubtree(node: ProjectTreeGroup): string[] {
  const ids = [...node.projectIds];
  for (const c of node.groups ?? []) {
    ids.push(...collectAllProjectIdsInSubtree(c));
  }
  return ids;
}

function cloneProjectDataReturnsNewId(sourceId: string): string {
  const projects = readProjectsJson();
  const src = projects.find((p) => p.id === sourceId);
  if (!src) throw new Error("[stores] cloneProjectData");
  const newPid = newId("proj");
  const newMeta: ProjectMeta = {
    ...src,
    id: newPid,
    name: `${src.name} 복사`,
    createdAt: new Date().toISOString(),
  };
  writeProjectsJson([...projects, newMeta]);
  const keyFns = [keyMat, keyProd, keySet, keyComp, keyMatGroups] as const;
  for (const keyFn of keyFns) {
    const v = localStorage.getItem(keyFn(sourceId));
    if (v) localStorage.setItem(keyFn(newPid), v);
  }
  return newPid;
}

function cloneGroupSubtreeDeep(node: ProjectTreeGroup): ProjectTreeGroup {
  const newProjectIds = node.projectIds.map((pid) => cloneProjectDataReturnsNewId(pid));
  const newChildGroups = (node.groups ?? []).map((c) => cloneGroupSubtreeDeep(c));
  return {
    id: newId("grp"),
    name: `${node.name} 복사`,
    projectIds: newProjectIds,
    groups: newChildGroups,
  };
}

export function duplicateGroupById(groupId: string): ProjectTreeGroup[] | null {
  const s0 = readProjectTreeState();
  const tree = s0.groups;
  const node = findNodeById(tree, groupId);
  if (!node) return null;
  const cloned = cloneGroupSubtreeDeep(node);
  const inserted = insertGroupAfter(tree, groupId, cloned);
  if (!inserted) return null;
  const projects = readProjectsJson();
  const r = reconcileProjectTree(projects, { ...s0, groups: inserted });
  writeProjectTreeData(r);
  return r.groups;
}

export function deleteGroupById(groupId: string): {
  projects: ProjectMeta[];
  groups: ProjectTreeGroup[];
  ungroupedProjectIds: string[];
  activeId: string;
} | null {
  const sInit = readProjectTreeState();
  const tree = sInit.groups;
  const node = findNodeById(tree, groupId);
  if (!node) return null;
  const pids = collectAllProjectIdsInSubtree(node);
  let projects = readProjectsJson();
  for (const pid of pids) {
    projects = projects.filter((p) => p.id !== pid);
    removeScopedStorageForProject(pid);
  }
  writeProjectsJson(projects);
  const s0 = readProjectTreeState();
  const groups = removeGroupNodeFromTree(s0.groups, groupId);
  const removedIds = new Set(pids);
  const re = reconcileProjectTree(projects, {
    ungroupedProjectIds: s0.ungroupedProjectIds.filter((id) => !removedIds.has(id)),
    groups,
  });
  writeProjectTreeData(re);
  let activeId = localStorage.getItem(STORAGE_ACTIVE_PROJECT) ?? "";
  if (!projects.some((p) => p.id === activeId)) {
    activeId = projects[0]?.id ?? "";
  }
  localStorage.setItem(STORAGE_ACTIVE_PROJECT, activeId);
  setActiveStorageProjectId(activeId || null);
  return { projects, groups: re.groups, ungroupedProjectIds: re.ungroupedProjectIds, activeId };
}

function removeScopedStorageForProject(pid: string) {
  localStorage.removeItem(keyMat(pid));
  localStorage.removeItem(keyProd(pid));
  localStorage.removeItem(keySet(pid));
  localStorage.removeItem(keyComp(pid));
  localStorage.removeItem(keyMatGroups(pid));
}

function hasLegacyData(): boolean {
  return !!(
    localStorage.getItem(LEGACY_MAT) ||
    localStorage.getItem(LEGACY_PROD) ||
    localStorage.getItem(LEGACY_SET) ||
    localStorage.getItem(LEGACY_COMP)
  );
}

function copyLegacyIntoProject(pid: string) {
  const pairs: [string, string][] = [
    [LEGACY_MAT, keyMat(pid)],
    [LEGACY_PROD, keyProd(pid)],
    [LEGACY_SET, keySet(pid)],
    [LEGACY_COMP, keyComp(pid)],
  ];
  for (const [legacy, scoped] of pairs) {
    const v = localStorage.getItem(legacy);
    if (v && !localStorage.getItem(scoped)) localStorage.setItem(scoped, v);
  }
  for (const [legacy] of pairs) {
    localStorage.removeItem(legacy);
  }
}

function pidOrNull(): string | null {
  return activeProjectId;
}

function pidOrThrow(): string {
  const p = activeProjectId;
  if (!p) throw new Error("[stores] 활성 프로젝트가 없습니다.");
  return p;
}

/**
 * 앱 부트 시 한 번 호출 — 프로젝트 목록 생성·레거시 마이그레이션·활성 ID 설정
 */
export function initializeProjectsState(): {
  projects: ProjectMeta[];
  activeId: string;
  groups: ProjectTreeGroup[];
  ungroupedProjectIds: string[];
} {
  let projects = readProjectsJson();
  if (projects.length === 0) {
    const id = newId("proj");
    if (hasLegacyData()) {
      copyLegacyIntoProject(id);
      projects = [{ id, name: "프로젝트 1", createdAt: new Date().toISOString() }];
    } else {
      projects = [{ id, name: "프로젝트 1", createdAt: new Date().toISOString() }];
    }
    writeProjectsJson(projects);
  }
  const s0 = readProjectTreeState();
  const r = reconcileProjectTree(projects, s0);
  writeProjectTreeData(r);
  let activeId = localStorage.getItem(STORAGE_ACTIVE_PROJECT) ?? "";
  if (!projects.some((p) => p.id === activeId)) activeId = projects[0].id;
  localStorage.setItem(STORAGE_ACTIVE_PROJECT, activeId);
  setActiveStorageProjectId(activeId);
  return { projects, activeId, groups: r.groups, ungroupedProjectIds: r.ungroupedProjectIds };
}

export function persistActiveProjectId(id: string) {
  localStorage.setItem(STORAGE_ACTIVE_PROJECT, id);
}

/**
 * 새 프로젝트 — `groupId`가 있고 트리에 있으면 해당 그룹 끝에, 아니면 그룹 없이(루트)에 둡니다.
 */
export function createNewProject(name: string, groupId?: string | null): ProjectMeta {
  const projects = readProjectsJson();
  const p: ProjectMeta = { id: newId("proj"), name, createdAt: new Date().toISOString() };
  const nextProjects = [...projects, p];
  writeProjectsJson(nextProjects);
  const s0 = readProjectTreeState();
  let { ungroupedProjectIds, groups } = s0;
  if (groupId && findGroupInTree(groups, groupId)) {
    groups = addProjectToGroupInTree(groups, groupId, p.id);
  } else {
    ungroupedProjectIds = [...ungroupedProjectIds, p.id];
  }
  persistProjectTree({ ungroupedProjectIds, groups });
  return p;
}

export function createNewGroup(name: string): ProjectTreeGroup {
  const g: ProjectTreeGroup = { id: newId("grp"), name, projectIds: [], groups: [] };
  const s0 = readProjectTreeState();
  persistProjectTree({ ...s0, groups: [...s0.groups, g] });
  return g;
}

export function updateGroupName(id: string, name: string) {
  const trimmed = name.trim();
  const s0 = readProjectTreeState();
  persistProjectTree({
    ...s0,
    groups: updateGroupNameInTree(s0.groups, id, trimmed.length > 0 ? trimmed : ""),
  });
}

export function persistProjectGroups(nextGroups: ProjectTreeGroup[]) {
  const s0 = readProjectTreeState();
  return persistProjectTree({ ...s0, groups: nextGroups });
}

export function loadProjectTreeGroups(): ProjectTreeGroup[] {
  return readGroupsJson();
}

export function loadProjectsMeta(): ProjectMeta[] {
  return readProjectsJson();
}

export function deleteProjectById(projectId: string): {
  projects: ProjectMeta[];
  groups: ProjectTreeGroup[];
  ungroupedProjectIds: string[];
  activeId: string;
} {
  const projects = readProjectsJson().filter((p) => p.id !== projectId);
  writeProjectsJson(projects);
  const s0 = readProjectTreeState();
  const r = persistProjectTree({
    ungroupedProjectIds: s0.ungroupedProjectIds.filter((id) => id !== projectId),
    groups: removeProjectFromTree(s0.groups, projectId),
  });
  removeScopedStorageForProject(projectId);
  let activeId = localStorage.getItem(STORAGE_ACTIVE_PROJECT) ?? "";
  if (activeId === projectId || !projects.some((p) => p.id === activeId)) {
    activeId = projects[0]?.id ?? "";
  }
  localStorage.setItem(STORAGE_ACTIVE_PROJECT, activeId);
  setActiveStorageProjectId(activeId || null);
  return { projects, groups: r.groups, ungroupedProjectIds: r.ungroupedProjectIds, activeId };
}

export function duplicateProjectById(sourceId: string): {
  newMeta: ProjectMeta;
  projects: ProjectMeta[];
  groups: ProjectTreeGroup[];
  ungroupedProjectIds: string[];
} | null {
  const projects = readProjectsJson();
  const src = projects.find((p) => p.id === sourceId);
  if (!src) return null;
  const newPid = newId("proj");
  const newMeta: ProjectMeta = {
    id: newPid,
    name: `${src.name} 복사`,
    createdAt: new Date().toISOString(),
  };
  const nextProjects = [...projects, newMeta];
  writeProjectsJson(nextProjects);
  const keyFns = [keyMat, keyProd, keySet, keyComp, keyMatGroups] as const;
  for (const keyFn of keyFns) {
    const v = localStorage.getItem(keyFn(sourceId));
    if (v) localStorage.setItem(keyFn(newPid), v);
  }
  const s0 = readProjectTreeState();
  const withInsert = insertProjectAfterInState(s0, sourceId, newPid);
  const r = persistProjectTree(withInsert);
  return { newMeta, projects: nextProjects, groups: r.groups, ungroupedProjectIds: r.ungroupedProjectIds };
}

export function updateProjectName(id: string, name: string) {
  const trimmed = name.trim();
  const list = readProjectsJson().map((x) =>
    x.id === id ? { ...x, name: trimmed.length > 0 ? trimmed : x.name } : x
  );
  writeProjectsJson(list);
}

export function getMaterials(): StoredMaterial[] {
  const pid = pidOrNull();
  if (!pid) return [];
  return readArr<StoredMaterial>(keyMat(pid));
}

export function getMaterial(id: string): StoredMaterial | undefined {
  return getMaterials().find((m) => m.id === id);
}

export function putMaterial(m: StoredMaterial) {
  const pid = pidOrThrow();
  const all = getMaterials().filter((x) => x.id !== m.id);
  writeArr(keyMat(pid), [m, ...all]);
}

export function deleteMaterial(id: string) {
  const pid = pidOrThrow();
  writeArr(
    keyMat(pid),
    getMaterials().filter((m) => m.id !== id)
  );
}

type ProductGroup = { id: string; name: string; materialIds: string[] };

function stripMaterialIdFromAllProducts(materialId: string) {
  for (const p of getProducts()) {
    const li = p.form.lineItems;
    if (li && li.length > 0) {
      const next = li.filter((x) => x.materialId !== materialId);
      if (next.length === li.length) continue;
      putProduct(
        enrichProductComputed({
          ...p,
          form: { ...p.form, lineItems: next },
          updatedAt: new Date().toISOString(),
        })
      );
      continue;
    }
    const raw = p.form.materialIds;
    if (raw && raw.length > 0) {
      const next = raw.filter((x) => x !== materialId);
      if (next.length === raw.length) continue;
      putProduct(
        enrichProductComputed({
          ...p,
          form: { ...p.form, materialIds: next },
          updatedAt: new Date().toISOString(),
        })
      );
    }
  }
}

function removeProductIdFromAllSets(productId: string) {
  for (const s of getSets()) {
    if (!s.form.productIds.includes(productId)) continue;
    const next = s.form.productIds.filter((x) => x !== productId);
    putSet(
      enrichSetComputed({
        ...s,
        form: { ...s.form, productIds: next },
        updatedAt: new Date().toISOString(),
      })
    );
  }
}

function removeMaterialIdFromMaterialTableGroups(materialId: string) {
  const pid = pidOrNull();
  if (!pid) return;
  try {
    const raw = localStorage.getItem(keyMatGroups(pid));
    if (!raw) return;
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return;
    const groups = p as ProductGroup[];
    const next: ProductGroup[] = groups.map((g) => ({
      ...g,
      materialIds: g.materialIds.filter((m) => m !== materialId),
    }));
    localStorage.setItem(keyMatGroups(pid), JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** 자재 + 단품·자재 견적 그룹에서도 제거한 뒤 데이터 삭제 */
export function deleteMaterialCompletely(materialId: string) {
  stripMaterialIdFromAllProducts(materialId);
  removeMaterialIdFromMaterialTableGroups(materialId);
  deleteMaterial(materialId);
}

export function deleteProductEntity(productId: string) {
  removeProductIdFromAllSets(productId);
  const pid = pidOrThrow();
  writeArr(
    keyProd(pid),
    getProducts().filter((p) => p.id !== productId)
  );
}

export function deleteSetEntity(setId: string) {
  const pid = pidOrThrow();
  writeArr(
    keySet(pid),
    getSets().filter((s) => s.id !== setId)
  );
}

export function duplicateMaterialById(materialId: string): string | null {
  const m = getMaterial(materialId);
  if (!m) return null;
  const nid = newId("m");
  const baseName = m.name || m.form.name || "이름 없음";
  const copy: StoredMaterial = {
    ...m,
    id: nid,
    name: `${baseName} (복사)`,
    form: { ...m.form, name: `${(m.form.name || baseName).replace(/\s*\(복사\)\s*$/g, "")} (복사)` },
    status: m.status,
    updatedAt: new Date().toISOString(),
  };
  putMaterial(copy);
  return nid;
}

export function duplicateProductById(productId: string): string | null {
  const p = getProducts().find((x) => x.id === productId);
  if (!p) return null;
  const nid = newId("p");
  const baseName = p.name || p.form.name || "이름 없음";
  const next: StoredProduct = {
    ...p,
    id: nid,
    name: `${baseName} (복사)`,
    form: {
      ...p.form,
      name: `${(p.form.name || baseName).replace(/\s*\(복사\)\s*$/g, "")} (복사)`,
    },
    status: p.status,
    updatedAt: new Date().toISOString(),
  };
  putProduct(enrichProductComputed(next));
  return nid;
}

/** 세트 — 단품·자재 ID를 딥 복제한 새 세트 */
export function duplicateSetById(setId: string): string | null {
  const s = getSets().find((x) => x.id === setId);
  if (!s) return null;
  const newProductIds: string[] = [];
  for (const pid of s.form.productIds) {
    const n = duplicateProductById(pid);
    if (n) newProductIds.push(n);
  }
  const sid = newId("s");
  const base = s.name || s.form.name || "이름 없음";
  const nextName = `${base.replace(/\s*\(복사\)\s*$/g, "")} (복사)`;
  const next: StoredSet = {
    ...s,
    id: sid,
    name: nextName,
    form: { ...s.form, name: nextName, productIds: newProductIds },
    updatedAt: new Date().toISOString(),
  };
  putSet(enrichSetComputed(next));
  return sid;
}

/** 견적 엔터티 이름 변경 — 탭/트리/편집기 공통 */
export function applyQuoteEntityName(kind: "material" | "product" | "set", entityId: string, rawName: string) {
  const name = rawName.trim() || "이름 없음";
  if (kind === "material") {
    const m = getMaterial(entityId);
    if (!m) return;
    putMaterial({
      ...m,
      name,
      form: { ...m.form, name },
      updatedAt: new Date().toISOString(),
    });
  } else if (kind === "product") {
    const p = getProducts().find((x) => x.id === entityId);
    if (!p) return;
    putProduct(
      enrichProductComputed({
        ...p,
        name,
        form: { ...p.form, name },
        updatedAt: new Date().toISOString(),
      })
    );
  } else {
    const s = getSets().find((x) => x.id === entityId);
    if (!s) return;
    putSet(
      enrichSetComputed({
        ...s,
        name,
        form: { ...s.form, name },
        updatedAt: new Date().toISOString(),
      })
    );
  }
}

// --- 견적 트리: 드래그로 세트/단품/자재 순서·소속 변경 ---

function productInSetIdSet(): Set<string> {
  const acc = new Set<string>();
  for (const s of getSets()) {
    for (const id of s.form.productIds) acc.add(id);
  }
  return acc;
}

function writeAllProducts(ordered: StoredProduct[]) {
  const pid = pidOrThrow();
  writeArr(keyProd(pid), ordered);
}

function writeAllSets(ordered: StoredSet[]) {
  const pid = pidOrThrow();
  writeArr(keySet(pid), ordered);
}

export function findSetIdForProduct(productId: string): string | null {
  for (const s of getSets()) {
    if (s.form.productIds.includes(productId)) return s.id;
  }
  return null;
}

/** 세트 A를 앵커 앞/뒤로 옮깁니다. */
export function moveSetRelative(movedId: string, anchorId: string, place: "before" | "after") {
  if (movedId === anchorId) return;
  const all = getSets();
  const by = new Map(all.map((s) => [s.id, s] as const));
  const order = all.map((s) => s.id);
  if (!order.includes(anchorId) || !order.includes(movedId)) return;
  const without = order.filter((id) => id !== movedId);
  const ai = without.indexOf(anchorId);
  if (ai < 0) return;
  const ins = place === "before" ? ai : ai + 1;
  const next = [...without.slice(0, ins), movedId, ...without.slice(ins)];
  const out = next.map((id) => by.get(id)).filter((s): s is StoredSet => s != null);
  writeAllSets(out);
}

/** 단품을 세트에 넣을 때: 맨 앞 또는 맨 뒤. */
export function moveProductIntoSet(movingId: string, setId: string, where: "first" | "last") {
  removeProductIdFromAllSets(movingId);
  const s0 = getSets().find((x) => x.id === setId);
  if (!s0) return;
  const pids = s0.form.productIds.filter((x) => x !== movingId);
  const nextPids = where === "first" ? [movingId, ...pids] : [...pids, movingId];
  putSet(
    enrichSetComputed({
      ...s0,
      form: { ...s0.form, productIds: nextPids },
      updatedAt: new Date().toISOString(),
    })
  );
}

function moveOrphanProductRelative(moverId: string, anchorId: string, place: "before" | "after") {
  if (moverId === anchorId) return;
  const inSet = productInSetIdSet();
  const all = getProducts();
  const by = new Map(all.map((p) => [p.id, p] as const));
  const oseq = all.filter((p) => !inSet.has(p.id)).map((p) => p.id);
  if (!oseq.includes(anchorId) || !oseq.includes(moverId)) return;
  const without = oseq.filter((x) => x !== moverId);
  const ax = without.indexOf(anchorId);
  const ins = place === "before" ? (ax < 0 ? 0 : ax) : (ax < 0 ? without.length : ax + 1);
  const nseq = [...without.slice(0, ins), moverId, ...without.slice(ins)];
  const out: StoredProduct[] = [];
  let qi = 0;
  for (const p of all) {
    if (inSet.has(p.id)) out.push(p);
    else {
      out.push(by.get(nseq[qi++])!);
    }
  }
  writeAllProducts(out);
}

function moveProductInSetRel(movingId: string, setId: string, anchorId: string, place: "before" | "after") {
  if (movingId === anchorId) return;
  removeProductIdFromAllSets(movingId);
  const s0 = getSets().find((x) => x.id === setId);
  if (!s0) return;
  let pids = s0.form.productIds.filter((x) => x !== movingId);
  const ai = pids.indexOf(anchorId);
  if (ai < 0) {
    pids = place === "before" ? [movingId, ...pids] : [...pids, movingId];
  } else {
    const ins = place === "before" ? ai : ai + 1;
    pids = [...pids.slice(0, ins), movingId, ...pids.slice(ins)];
  }
  putSet(
    enrichSetComputed({
      ...s0,
      form: { ...s0.form, productIds: pids },
      updatedAt: new Date().toISOString(),
    })
  );
}

/**
 * 단품을 다른 단품(앵커) 앞/뒤로 — 세트·비세트(고아) 모두.
 * 앵커는 세트에 속한 단품이어야 `move`가 정의됨; 고아끼리는 저장 순서만 조정.
 */
export function moveProductRelativeToAnchor(movingId: string, anchorId: string, place: "before" | "after") {
  if (movingId === anchorId) return;
  const anchorSet = findSetIdForProduct(anchorId);
  if (anchorSet) {
    moveProductInSetRel(movingId, anchorSet, anchorId, place);
    return;
  }
  removeProductIdFromAllSets(movingId);
  moveOrphanProductRelative(movingId, anchorId, place);
}

function insertProductLineItemForm(
  p: StoredProduct,
  materialId: string,
  where: "first" | "last"
): StoredProduct {
  const li = p.form.lineItems;
  const hasLi = li && li.length > 0;
  if (hasLi) {
    const items = [...(li as ProductLineItem[])].filter((x) => x.materialId !== materialId);
    const ni: ProductLineItem = { materialId, qty: 1 };
    const next = where === "first" ? [ni, ...items] : [...items, ni];
    return { ...p, form: { ...p.form, lineItems: next } };
  }
  const raw = [...(p.form.materialIds ?? [])].filter((m) => m !== materialId);
  const nextM = where === "first" ? [materialId, ...raw] : [...raw, materialId];
  return { ...p, form: { ...p.form, materialIds: nextM } };
}

/** 자재를 단품 끝/처음(해당 단품의 자재 리스트)으로 이동·추가 */
export function moveMaterialToProduct(materialId: string, productId: string, where: "first" | "last") {
  stripMaterialIdFromAllProducts(materialId);
  const p0 = getProducts().find((x) => x.id === productId);
  if (!p0) return;
  putProduct(
    enrichProductComputed({
      ...insertProductLineItemForm(p0, materialId, where),
      updatedAt: new Date().toISOString(),
    })
  );
}

export function moveMaterialRelativeToAnchor(
  materialId: string,
  productId: string,
  anchorMaterialId: string,
  place: "before" | "after"
) {
  if (materialId === anchorMaterialId) return;
  stripMaterialIdFromAllProducts(materialId);
  const p0 = getProducts().find((x) => x.id === productId);
  if (!p0) return;
  const p = p0;
  const li = p.form.lineItems;
  const hasLi = li && li.length > 0;
  if (hasLi) {
    const items = [...(li as ProductLineItem[])].filter((x) => x.materialId !== materialId);
    const anchorIdx = items.findIndex((x) => x.materialId === anchorMaterialId);
    const newItem: ProductLineItem = { materialId, qty: 1 };
    let out: ProductLineItem[];
    if (anchorIdx < 0) {
      out = place === "before" ? [newItem, ...items] : [...items, newItem];
    } else {
      const ins = place === "before" ? anchorIdx : anchorIdx + 1;
      out = [...items.slice(0, ins), newItem, ...items.slice(ins)];
    }
    putProduct(
      enrichProductComputed({
        ...p,
        form: { ...p.form, lineItems: out },
        updatedAt: new Date().toISOString(),
      })
    );
    return;
  }
  const raw = [...(p.form.materialIds ?? [])].filter((m) => m !== materialId);
  const ax = raw.indexOf(anchorMaterialId);
  const ins = place === "before" ? (ax < 0 ? 0 : ax) : (ax < 0 ? raw.length : ax + 1);
  const nextM = [...raw.slice(0, ins), materialId, ...raw.slice(ins)];
  putProduct(
    enrichProductComputed({
      ...p,
      form: { ...p.form, materialIds: nextM },
      updatedAt: new Date().toISOString(),
    })
  );
}

export const QUOTE_TREE_DND_MIME = "application/x-groot-quote-dnd+json";

export function getProducts(): StoredProduct[] {
  const pid = pidOrNull();
  if (!pid) return [];
  return readArr<StoredProduct>(keyProd(pid));
}

export function putProduct(p: StoredProduct) {
  const pid = pidOrThrow();
  const all = getProducts().filter((x) => x.id !== p.id);
  writeArr(keyProd(pid), [p, ...all]);
}

export function getSets(): StoredSet[] {
  const pid = pidOrNull();
  if (!pid) return [];
  return readArr<StoredSet>(keySet(pid));
}

export function putSet(s: StoredSet) {
  const pid = pidOrThrow();
  const all = getSets().filter((x) => x.id !== s.id);
  writeArr(keySet(pid), [s, ...all]);
}

export function getComparisons(): StoredComparison[] {
  const pid = pidOrNull();
  if (!pid) return [];
  return readArr<StoredComparison>(keyComp(pid));
}

export function putComparison(c: StoredComparison) {
  const pid = pidOrThrow();
  const all = getComparisons().filter((x) => x.id !== c.id);
  writeArr(keyComp(pid), [c, ...all]);
}

export function materialListRow(m: StoredMaterial) {
  const input = buildMaterialInput({
    ...m.form,
    sheetPrices: m.form.sheetPrices as Partial<Record<SheetId, number>>,
  });
  const comp = computeMaterial(input, (m.form.selectedSheetId ?? null) as SheetId | null);
  const preview = {
    grandTotalWon: comp.grandTotalWon,
    wMm: m.form.wMm,
    dMm: m.form.dMm,
    hMm: m.form.hMm,
  };
  const sid = comp.selectedSheetId;
  const hit = comp.sheets?.find((s) => s.sheetId === sid) ?? comp.sheets?.[0];
  return {
    id: m.id,
    name: m.name,
    status: m.status,
    updatedAt: m.updatedAt,
    grandTotalWon: preview.grandTotalWon,
    summary: `${preview.wMm}×${preview.dMm}×${preview.hMm} mm`,
    color: m.form.color,
    edge: comp.resolvedEdgeProfileKey ?? "",
    board: m.form.boardMaterial,
    sheetLabel: hit?.label ?? "",
  };
}

export function enrichProductComputed(p: StoredProduct): StoredProduct {
  const mats = getMaterials().map((m) => ({ id: m.id, name: m.name, form: m.form }));
  const computed = computeProductLocal(p.form, mats);
  return {
    ...p,
    grandTotalWon: computed.grandTotalWon,
    summary: `${computed.parts.length}개 부품`,
    computed,
  };
}

export function enrichSetComputed(s: StoredSet): StoredSet {
  const prods = getProducts().map((p) => ({
    id: p.id,
    name: p.name,
    form: p.form,
    computed: p.computed,
  }));
  const computed = computeSetLocal(
    s.form.productIds,
    prods.map((p) => ({
      id: p.id,
      name: p.name,
      form: p.form,
      computed: p.computed,
    }))
  );
  return {
    ...s,
    grandTotalWon: computed.grandTotalWon,
    summary: `${computed.items.length}개 단품`,
    computed,
  };
}

/** 견적 탭용 빈 자재 폼 (MaterialTab defaultForm과 동일) */
function emptyMaterialForm(): MaterialFormState {
  return {
    name: "",
    partCode: "",
    wMm: 0,
    dMm: 0,
    hMm: 0,
    color: "WW",
    boardMaterial: "PB",
    surfaceMaterial: "LPM/O",
    edgePreset: "abs1t",
    edgeColor: "WW",
    edgeCustomSides: { top: 0, bottom: 0, left: 0, right: 0 },
    edgeSides: { top: true, bottom: true, left: true, right: true },
    placementMode: "default",
    cutOrientation: "default",
    showDefault: true,
    showRotated: true,
    sheetPrices: {},
    selectedSheetId: null,
    formingM: 0,
    rutaM: 0,
    assemblyHours: 0,
    washM2: 0,
    boring1Ea: 0,
    boring2Ea: 0,
    curvedEdgeM: 0,
    curvedEdgeType: "",
    edge45TapingM: 0,
    edge45PaintType: "",
    edge45PaintM: 0,
    ruta2M: 0,
    tenonerMm: 0,
  };
}

export function createEmptyMaterialEntity(): string {
  const id = newId("m");
  putMaterial({
    id,
    name: "이름 없음",
    status: "DRAFT",
    updatedAt: new Date().toISOString(),
    grandTotalWon: 0,
    summary: "",
    form: emptyMaterialForm(),
  });
  return id;
}

export function createEmptyProductEntity(): string {
  const id = newId("p");
  const form: ProductFormState = {
    name: "이름 없음",
    lineItems: [],
    hardwareEa: 0,
    stickerEa: 1,
    adminRate: 0.05,
  };
  putProduct(
    enrichProductComputed({
      id,
      name: form.name,
      status: "DRAFT",
      updatedAt: new Date().toISOString(),
      grandTotalWon: 0,
      summary: "",
      form,
    })
  );
  return id;
}

export function createEmptySetEntity(): string {
  const id = newId("s");
  putSet(
    enrichSetComputed({
      id,
      name: "이름 없음",
      status: "DRAFT",
      updatedAt: new Date().toISOString(),
      grandTotalWon: 0,
      summary: "",
      form: { name: "이름 없음", productIds: [] },
    })
  );
  return id;
}

// --- Entity helpers for BOM tree nodes ---

export function ensureEntityByTreeId(type: "mat" | "item" | "set", id: string, name = "이름 없음"): void {
  if (type === "mat") {
    if (!getMaterial(id)) {
      putMaterial({ id, name, status: "DRAFT", updatedAt: new Date().toISOString(), grandTotalWon: 0, summary: "", form: { ...emptyMaterialForm(), name } });
    }
  } else if (type === "item") {
    if (!getProducts().find(p => p.id === id)) {
      const form: ProductFormState = { name, lineItems: [], hardwareEa: 0, stickerEa: 1, adminRate: 0.05 };
      putProduct(enrichProductComputed({ id, name, status: "DRAFT", updatedAt: new Date().toISOString(), grandTotalWon: 0, summary: "", form }));
    }
  } else if (type === "set") {
    if (!getSets().find(s => s.id === id)) {
      putSet(enrichSetComputed({ id, name, status: "DRAFT", updatedAt: new Date().toISOString(), grandTotalWon: 0, summary: "", form: { name, productIds: [] } }));
    }
  }
}

export function cloneEntityToId(type: "mat" | "item" | "set", srcId: string, dstId: string, overrideName?: string): void {
  if (type === "mat") {
    const src = getMaterial(srcId);
    const name = overrideName ?? (src ? `${src.name} 복사본` : "이름 없음 복사본");
    if (src) putMaterial({ ...src, id: dstId, name, form: { ...src.form, name }, updatedAt: new Date().toISOString() });
    else putMaterial({ id: dstId, name, status: "DRAFT", updatedAt: new Date().toISOString(), grandTotalWon: 0, summary: "", form: { ...emptyMaterialForm(), name } });
  } else if (type === "item") {
    const src = getProducts().find(p => p.id === srcId);
    const name = overrideName ?? (src ? `${src.name} 복사본` : "이름 없음 복사본");
    if (src) putProduct(enrichProductComputed({ ...src, id: dstId, name, form: { ...src.form, name }, updatedAt: new Date().toISOString() }));
    else { const form: ProductFormState = { name, lineItems: [], hardwareEa: 0, stickerEa: 1, adminRate: 0.05 }; putProduct(enrichProductComputed({ id: dstId, name, status: "DRAFT", updatedAt: new Date().toISOString(), grandTotalWon: 0, summary: "", form })); }
  } else if (type === "set") {
    const src = getSets().find(s => s.id === srcId);
    const name = overrideName ?? (src ? `${src.name} 복사본` : "이름 없음 복사본");
    if (src) putSet(enrichSetComputed({ ...src, id: dstId, name, form: { ...src.form, name }, updatedAt: new Date().toISOString() }));
    else putSet(enrichSetComputed({ id: dstId, name, status: "DRAFT", updatedAt: new Date().toISOString(), grandTotalWon: 0, summary: "", form: { name, productIds: [] } }));
  }
}

export function deleteEntityById(type: "mat" | "item" | "set", id: string): void {
  if (type === "mat") deleteMaterialCompletely(id);
  else if (type === "item") deleteProductEntity(id);
  else if (type === "set") deleteSetEntity(id);
}

// --- groot_bom: BOM tree per project ---

export type BomMaterialData = {
  w: number;
  d: number;
  t: number;
  material: string;
  surface: string;
  color: string;
  edgeType: string;
  edgeSetting: string;
  edgeCustom: { top: number; bottom: number; left: number; right: number };
  processes: string[];
};

type BomStore = Record<string, unknown[]>;

const KEY_BOM = "groot_bom";

function readBomStore(): BomStore {
  try {
    const raw = localStorage.getItem(KEY_BOM);
    if (!raw) return {};
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && !Array.isArray(p)) return p as BomStore;
    return {};
  } catch { return {}; }
}

export function getBomTree(projectId: string): unknown[] {
  return readBomStore()[projectId] ?? [];
}

export function putBomTree(projectId: string, nodes: unknown[]) {
  try {
    const store = readBomStore();
    store[projectId] = nodes;
    localStorage.setItem(KEY_BOM, JSON.stringify(store));
  } catch (e) {
    console.error("[groot_bom] save failed", e);
  }
}

export function getBomNodeData(nodeId: string): BomMaterialData | undefined {
  const store = readBomStore();
  for (const nodes of Object.values(store)) {
    if (!Array.isArray(nodes)) continue;
    const node = (nodes as Record<string, unknown>[]).find(
      (n) => n.id === nodeId && n.type === "mat"
    );
    if (node?.data) return node.data as BomMaterialData;
  }
  return undefined;
}

export function putBomNodeData(nodeId: string, data: BomMaterialData) {
  const pid = activeProjectId;
  if (!pid) return;
  try {
    const store = readBomStore();
    const nodes = store[pid] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(nodes)) return;
    const idx = nodes.findIndex((n) => n.id === nodeId && n.type === "mat");
    if (idx < 0) return;
    nodes[idx] = { ...nodes[idx], data };
    store[pid] = nodes;
    localStorage.setItem(KEY_BOM, JSON.stringify(store));
  } catch (e) {
    console.error("[groot_bom] node data save failed", e);
  }
}

// --- groot_projects: unified projects format ---

export type GrootProjectEntry = { id: string; name: string };
export type GrootGroupEntry = { id: string; name: string; projects: GrootProjectEntry[] };
export type GrootProjectsData = {
  currentProjectId: string;
  groups: GrootGroupEntry[];
};

const KEY_GROOT_PROJECTS = "groot_projects";

export function saveGrootProjects(data: GrootProjectsData) {
  try {
    localStorage.setItem(KEY_GROOT_PROJECTS, JSON.stringify(data));
  } catch (e) {
    console.error("[groot_projects] save failed", e);
  }
}

export function loadGrootProjects(): GrootProjectsData | null {
  try {
    const raw = localStorage.getItem(KEY_GROOT_PROJECTS);
    if (!raw) return null;
    return JSON.parse(raw) as GrootProjectsData;
  } catch { return null; }
}

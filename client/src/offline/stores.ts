import type { MaterialFormState } from "../material/MaterialTab";
import type { ProductFormState, ProductComputed } from "../product/types";
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
const STORAGE_ACTIVE_PROJECT = "groot_active_project_id";

const LEGACY_MAT = "groot_materials";
const LEGACY_PROD = "groot_products";
const LEGACY_SET = "groot_sets";
const LEGACY_COMP = "groot_comparisons";

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
export function initializeProjectsState(): { projects: ProjectMeta[]; activeId: string } {
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
  let activeId = localStorage.getItem(STORAGE_ACTIVE_PROJECT) ?? "";
  if (!projects.some((p) => p.id === activeId)) activeId = projects[0].id;
  localStorage.setItem(STORAGE_ACTIVE_PROJECT, activeId);
  setActiveStorageProjectId(activeId);
  return { projects, activeId };
}

export function persistActiveProjectId(id: string) {
  localStorage.setItem(STORAGE_ACTIVE_PROJECT, id);
}

export function createNewProject(name: string): ProjectMeta {
  const p: ProjectMeta = { id: newId("proj"), name, createdAt: new Date().toISOString() };
  writeProjectsJson([...readProjectsJson(), p]);
  return p;
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

export function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

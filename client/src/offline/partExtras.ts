/**
 * 단품(Part) / 자재(Material) 확장 데이터 — 1단계 리팩토링
 * ============================================================
 *
 * 기존 ProductFormState / MaterialFormState 를 건드리지 않고
 * 별도 localStorage 키로 추가 데이터 관리:
 *
 *   groot_part_tags__{pid}    : Record<partId, string[]>
 *   groot_hardwares__{pid}    : Record<partId, Hardware[]>
 *   groot_attachments__{pid}  : Record<materialId, Attachment[]>
 *
 * - 단품 태그: 자유형 문자열 배열 (예: ["5단", "1200폭"])
 * - 자재 종속 부속(attachments): 케이싱, 도어 락 등 자재에 붙는 부품
 * - 단품 직속 철물(hardwares): 다보·나사 등 단품 조립에 들어가는 부속
 *
 * 모든 함수는 동기. 활성 프로젝트가 없으면 read=빈값/write=무시.
 *
 * ⚠️ UI 변경 없음. 데이터 모델 / 마이그레이션 / 계산만 추가.
 */

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export type Attachment = {
  id: string;
  materialId: string;
  name: string;        // 예: "케이싱"
  itemCode: string;    // 예: "ETFS001264"
  quantity: number;
  unitPrice: number;   // 원/개
  color?: string;
  note?: string;
};

export type Hardware = {
  id: string;
  partId: string;
  name: string;        // 예: "다보 A"
  itemCode: string;    // 예: "NSNW000961"
  quantity: number;
  unitPrice: number;   // 원/개
  note?: string;
};

// ─────────────────────────────────────────────────────────────
// 키 / 활성 프로젝트
// ─────────────────────────────────────────────────────────────

const KEY_TAGS_PFX = "groot_part_tags__";
const KEY_HW_PFX = "groot_hardwares__";
const KEY_ATT_PFX = "groot_attachments__";
const KEY_PART_ENABLED_PFX = "groot_part_enabled__";  // Record<partId, boolean>  (default: true)
const KEY_MAT_ENABLED_PFX = "groot_mat_enabled__";    // Record<materialId, boolean> (default: true)
const KEY_ACTIVE_PID = "groot_active_project_id";

function activePid(): string | null {
  try {
    return localStorage.getItem(KEY_ACTIVE_PID);
  } catch {
    return null;
  }
}

function readMap<V>(fullKey: string): Record<string, V> {
  try {
    const raw = localStorage.getItem(fullKey);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, V>) : {};
  } catch {
    return {};
  }
}

function writeMap<V>(fullKey: string, map: Record<string, V>): void {
  try {
    localStorage.setItem(fullKey, JSON.stringify(map));
  } catch (e) {
    console.error("[partExtras] write failed", fullKey, e);
  }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─────────────────────────────────────────────────────────────
// 단품 태그
// ─────────────────────────────────────────────────────────────

export function getPartTags(partId: string): string[] {
  const pid = activePid();
  if (!pid || !partId) return [];
  const map = readMap<string[]>(KEY_TAGS_PFX + pid);
  return Array.isArray(map[partId]) ? map[partId] : [];
}

export function setPartTags(partId: string, tags: string[]): void {
  const pid = activePid();
  if (!pid || !partId) return;
  const map = readMap<string[]>(KEY_TAGS_PFX + pid);
  // 중복 제거 + 빈 문자열 거르기 + trim
  const cleaned = Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean)));
  map[partId] = cleaned;
  writeMap(KEY_TAGS_PFX + pid, map);
}

export function addPartTag(partId: string, tag: string): string[] {
  const cur = getPartTags(partId);
  const next = Array.from(new Set([...cur, String(tag).trim()].filter(Boolean)));
  setPartTags(partId, next);
  return next;
}

export function removePartTag(partId: string, tag: string): string[] {
  const cur = getPartTags(partId);
  const next = cur.filter((t) => t !== tag);
  setPartTags(partId, next);
  return next;
}

// ─────────────────────────────────────────────────────────────
// 단품/자재 활성 토글 (enabled on/off)
// - 기본값 true. 명시적 false 가 저장된 경우만 OFF.
// - OFF 인 항목은 단품/세트 합계에 포함되지 않음.
// ─────────────────────────────────────────────────────────────

export function getPartEnabled(partId: string): boolean {
  const pid = activePid();
  if (!pid || !partId) return true;
  const map = readMap<boolean>(KEY_PART_ENABLED_PFX + pid);
  return map[partId] === false ? false : true;
}

export function setPartEnabled(partId: string, val: boolean): void {
  const pid = activePid();
  if (!pid || !partId) return;
  const map = readMap<boolean>(KEY_PART_ENABLED_PFX + pid);
  if (val) {
    delete map[partId]; // 기본값(true) — 키 제거해 저장 공간 절약
  } else {
    map[partId] = false;
  }
  writeMap(KEY_PART_ENABLED_PFX + pid, map);
}

export function getMaterialEnabled(materialId: string): boolean {
  const pid = activePid();
  if (!pid || !materialId) return true;
  const map = readMap<boolean>(KEY_MAT_ENABLED_PFX + pid);
  return map[materialId] === false ? false : true;
}

export function setMaterialEnabled(materialId: string, val: boolean): void {
  const pid = activePid();
  if (!pid || !materialId) return;
  const map = readMap<boolean>(KEY_MAT_ENABLED_PFX + pid);
  if (val) {
    delete map[materialId];
  } else {
    map[materialId] = false;
  }
  writeMap(KEY_MAT_ENABLED_PFX + pid, map);
}

// ─────────────────────────────────────────────────────────────
// 단품 직속 철물 (Hardware) — 단품 조립에 들어가는 부속
// ─────────────────────────────────────────────────────────────

export function getHardwares(partId: string): Hardware[] {
  const pid = activePid();
  if (!pid || !partId) return [];
  const map = readMap<Hardware[]>(KEY_HW_PFX + pid);
  return Array.isArray(map[partId]) ? map[partId] : [];
}

export function getAllHardwaresInProject(): Hardware[] {
  const pid = activePid();
  if (!pid) return [];
  const map = readMap<Hardware[]>(KEY_HW_PFX + pid);
  return Object.values(map).flat();
}

export function addHardware(
  partId: string,
  data: Omit<Hardware, "id" | "partId">,
): Hardware {
  const pid = activePid();
  if (!pid || !partId) {
    throw new Error("[partExtras] no active project or partId");
  }
  const hw: Hardware = {
    id: newId("hw"),
    partId,
    name: data.name,
    itemCode: data.itemCode ?? "",
    quantity: Math.max(0, Number(data.quantity) || 0),
    unitPrice: Math.max(0, Number(data.unitPrice) || 0),
    note: data.note,
  };
  const map = readMap<Hardware[]>(KEY_HW_PFX + pid);
  map[partId] = [...(map[partId] ?? []), hw];
  writeMap(KEY_HW_PFX + pid, map);
  return hw;
}

export function updateHardware(hardwareId: string, patch: Partial<Omit<Hardware, "id" | "partId">>): Hardware | null {
  const pid = activePid();
  if (!pid) return null;
  const map = readMap<Hardware[]>(KEY_HW_PFX + pid);
  for (const partId of Object.keys(map)) {
    const list = map[partId];
    const idx = list.findIndex((h) => h.id === hardwareId);
    if (idx >= 0) {
      const next: Hardware = {
        ...list[idx],
        ...patch,
        id: list[idx].id,
        partId: list[idx].partId,
        quantity: patch.quantity != null ? Math.max(0, Number(patch.quantity) || 0) : list[idx].quantity,
        unitPrice: patch.unitPrice != null ? Math.max(0, Number(patch.unitPrice) || 0) : list[idx].unitPrice,
      };
      list[idx] = next;
      map[partId] = list;
      writeMap(KEY_HW_PFX + pid, map);
      return next;
    }
  }
  return null;
}

export function deleteHardware(hardwareId: string): boolean {
  const pid = activePid();
  if (!pid) return false;
  const map = readMap<Hardware[]>(KEY_HW_PFX + pid);
  let removed = false;
  for (const partId of Object.keys(map)) {
    const before = map[partId].length;
    map[partId] = map[partId].filter((h) => h.id !== hardwareId);
    if (map[partId].length !== before) removed = true;
  }
  if (removed) writeMap(KEY_HW_PFX + pid, map);
  return removed;
}

// ─────────────────────────────────────────────────────────────
// 자재 종속 부속 (Attachment)
// ─────────────────────────────────────────────────────────────

export function getAttachments(materialId: string): Attachment[] {
  const pid = activePid();
  if (!pid || !materialId) return [];
  const map = readMap<Attachment[]>(KEY_ATT_PFX + pid);
  return Array.isArray(map[materialId]) ? map[materialId] : [];
}

export function addAttachment(
  materialId: string,
  data: Omit<Attachment, "id" | "materialId">,
): Attachment {
  const pid = activePid();
  if (!pid || !materialId) {
    throw new Error("[partExtras] no active project or materialId");
  }
  const att: Attachment = {
    id: newId("att"),
    materialId,
    name: data.name,
    itemCode: data.itemCode ?? "",
    quantity: Math.max(0, Number(data.quantity) || 0),
    unitPrice: Math.max(0, Number(data.unitPrice) || 0),
    color: data.color,
    note: data.note,
  };
  const map = readMap<Attachment[]>(KEY_ATT_PFX + pid);
  map[materialId] = [...(map[materialId] ?? []), att];
  writeMap(KEY_ATT_PFX + pid, map);
  return att;
}

export function updateAttachment(attachmentId: string, patch: Partial<Omit<Attachment, "id" | "materialId">>): Attachment | null {
  const pid = activePid();
  if (!pid) return null;
  const map = readMap<Attachment[]>(KEY_ATT_PFX + pid);
  for (const matId of Object.keys(map)) {
    const list = map[matId];
    const idx = list.findIndex((a) => a.id === attachmentId);
    if (idx >= 0) {
      const next: Attachment = {
        ...list[idx],
        ...patch,
        id: list[idx].id,
        materialId: list[idx].materialId,
        quantity: patch.quantity != null ? Math.max(0, Number(patch.quantity) || 0) : list[idx].quantity,
        unitPrice: patch.unitPrice != null ? Math.max(0, Number(patch.unitPrice) || 0) : list[idx].unitPrice,
      };
      list[idx] = next;
      map[matId] = list;
      writeMap(KEY_ATT_PFX + pid, map);
      return next;
    }
  }
  return null;
}

export function deleteAttachment(attachmentId: string): boolean {
  const pid = activePid();
  if (!pid) return false;
  const map = readMap<Attachment[]>(KEY_ATT_PFX + pid);
  let removed = false;
  for (const matId of Object.keys(map)) {
    const before = map[matId].length;
    map[matId] = map[matId].filter((a) => a.id !== attachmentId);
    if (map[matId].length !== before) removed = true;
  }
  if (removed) writeMap(KEY_ATT_PFX + pid, map);
  return removed;
}

// ─────────────────────────────────────────────────────────────
// 계산 — 새 함수 (기존 원재료비/가공비/엣지비 함수는 절대 안 건드림)
// ─────────────────────────────────────────────────────────────

/** 단일 부속 비용 = quantity × unitPrice */
export function attachmentCost(att: Pick<Attachment, "quantity" | "unitPrice">): number {
  return Math.round((att.quantity || 0) * (att.unitPrice || 0));
}

/** 단일 철물 비용 = quantity × unitPrice */
export function hardwareCost(hw: Pick<Hardware, "quantity" | "unitPrice">): number {
  return Math.round((hw.quantity || 0) * (hw.unitPrice || 0));
}

/** 자재의 모든 부속 비용 합 */
export function calcMaterialAttachmentsCost(materialId: string): number {
  return getAttachments(materialId).reduce((sum, a) => sum + attachmentCost(a), 0);
}

/**
 * 자재 총비용 = 자재 고유 비용(원재료+가공+엣지) + 부속 합
 * @param materialId
 * @param materialIntrinsicCost 기존 계산 함수 결과 (그대로 받기 — 재계산 안 함)
 */
export function calcMaterialTotal(materialId: string, materialIntrinsicCost: number): number {
  return Math.round(materialIntrinsicCost + calcMaterialAttachmentsCost(materialId));
}

/** 단품의 모든 철물 비용 합 */
export function calcPartHardwaresCost(partId: string): number {
  return getHardwares(partId).reduce((sum, h) => sum + hardwareCost(h), 0);
}

/**
 * 단품 합계 = sum(자재 총비용) + sum(철물 비용)
 *
 * @param partId
 * @param materialTotals 단품에 속한 자재들의 calcMaterialTotal 결과 배열
 *                       (호출자가 ResolvedMaterialPart 등에서 계산해 넘김)
 */
export function calcPartTotal(partId: string, materialTotals: number[]): number {
  const matSum = materialTotals.reduce((s, v) => s + (v || 0), 0);
  return Math.round(matSum + calcPartHardwaresCost(partId));
}

// ─────────────────────────────────────────────────────────────
// 마이그레이션 — 활성 프로젝트의 모든 기존 단품/자재에 빈 배열 보장
// ─────────────────────────────────────────────────────────────

/** 호출 시 누락된 키 (tags/hardwares/attachments 맵) 가 있으면 빈 객체 생성. */
export function ensureMigrated(): void {
  const pid = activePid();
  if (!pid) return;
  for (const k of [KEY_TAGS_PFX, KEY_HW_PFX, KEY_ATT_PFX]) {
    if (localStorage.getItem(k + pid) == null) {
      writeMap(k + pid, {});
    }
  }
}

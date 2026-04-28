/**
 * 세트 한 페이지 뷰 — PR3 (PR2 + 자재 풀 + 드래그앤드롭 + ⋯ 메뉴 + 픽커)
 * ====================================================================
 * 라우트: /set
 *
 * 좌: 단품 카드 세로 쌓임 / 우: 자재 풀 sticky (220px)
 * 드래그: HTML5 native. 라이브러리 추가 X.
 *
 * ⚠️ 계산 함수 0 변경 — 모두 이미 계산된 grandTotalWon 그대로 읽기.
 * ⚠️ 트리 단일 진실 — 모든 이동은 moveMaterialToPart 헬퍼.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuoteTabs } from "../context/QuoteTabsContext";
import {
  useTree, type TreeNode,
  getMaterialsForPart, getMaterialsInPool, moveMaterialToPart,
} from "../context/TreeContext";
import {
  getMaterial, getProducts, putProduct, enrichProductComputed,
  getSets, putSet, type StoredProduct,
  duplicateMaterialById, duplicateProductById,
  deleteMaterialCompletely, deleteProductEntity,
} from "../offline/stores";
import {
  calcPartHardwaresCost, getHardwares, getPartTags, setPartTags,
  calcMaterialAttachmentsCost, getAttachments, addAttachment, updateAttachment, deleteAttachment,
  addHardware, updateHardware, deleteHardware,
  getPartEnabled, setPartEnabled, getMaterialEnabled, setMaterialEnabled,
} from "../offline/partExtras";
import { sumAttachmentsForPart, sumMaterialsForPart, calcPartFees, type PartFees } from "../lib/partExtrasCalc";
import { TagChip } from "../components/TagChip";
import { TagAddPopover } from "../components/TagAddPopover";
import { VariantToggleBar } from "../components/VariantToggleBar";
import { InlineItemSection, type InlineItem } from "../components/InlineItemSection";
import { MaterialEditDialog } from "../components/MaterialEditDialog";

// PR4: 활성 단품 판정 (변형 필터 + 공용/태그없음 룰)
function isPartActive(partId: string, activeFilters: string[]): boolean {
  if (activeFilters.length === 0) return true;
  const tags = getPartTags(partId);
  if (tags.length === 0) return true;
  if (tags.includes("공용")) return true;
  return tags.some((t) => activeFilters.includes(t));
}

const POOL_W = 220;
const DND_MIME = "application/x-mat-id";

function fmtWon(n: number): string {
  return `₩${Math.max(0, Math.round(n)).toLocaleString()}`;
}

function getPartsForSet(nodes: TreeNode[], setIdx: number): TreeNode[] {
  if (setIdx < 0) return [];
  const parts: TreeNode[] = [];
  for (let i = setIdx + 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "divider" || n.type === "set") break;
    if (n.type === "item") parts.push(n);
  }
  return parts;
}

// ─────────────────────────────────────────────────────────────
// SetOnePagePage
// ─────────────────────────────────────────────────────────────

export function SetOnePagePage() {
  const { activeTabId, tabs, updateTabLabel, openEntityTab } = useQuoteTabs();
  const { treeNodes, setTreeNodes } = useTree();
  const nav = useNavigate();
  const location = useLocation();

  const active = activeTabId ? tabs.find((t) => t.tabId === activeTabId) : undefined;
  const setEntityId = active?.kind === "set" ? active.entityId : null;

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  void tick;

  const setIdx = useMemo(
    () => (setEntityId ? treeNodes.findIndex((n) => n.id === setEntityId && n.type === "set") : -1),
    [treeNodes, setEntityId],
  );
  const setNode = setIdx >= 0 ? treeNodes[setIdx] : null;

  const partNodes = useMemo(() => getPartsForSet(treeNodes, setIdx), [treeNodes, setIdx]);
  const poolNodes = useMemo(() => getMaterialsInPool(treeNodes, setIdx), [treeNodes, setIdx]);

  // PR4: 변형 필터 상태 — sessionStorage 로 세트별 독립 유지
  const filterStorageKey = setEntityId ? `groot_active_filters__${setEntityId}` : null;
  const [activeFilters, setActiveFilters] = useState<string[]>(() => {
    if (!filterStorageKey) return [];
    try {
      const raw = sessionStorage.getItem(filterStorageKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  });
  // 세트가 바뀌면 그 세트의 필터로 갈아끼움
  useEffect(() => {
    if (!filterStorageKey) { setActiveFilters([]); return; }
    try {
      const raw = sessionStorage.getItem(filterStorageKey);
      setActiveFilters(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { setActiveFilters([]); }
  }, [filterStorageKey]);
  // activeFilters 변경 시 sessionStorage 동기
  useEffect(() => {
    if (!filterStorageKey) return;
    try { sessionStorage.setItem(filterStorageKey, JSON.stringify(activeFilters)); } catch {}
  }, [activeFilters, filterStorageKey]);

  const toggleFilter = useCallback((tag: string) => {
    setActiveFilters((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }, []);
  const clearFilters = useCallback(() => setActiveFilters([]), []);

  // 단품별 합계 + 활성 여부 + 태그
  // PR5: 자재 종속 부속 + 단품 직속 철물 합산. (기존 productComputed 는 0 변경)
  // 단품 비용 = 자재들(grandTotalWon + 종속 부속) + 별도철물 + 단품추가비용(세척+포장+관리)
  // ※ stale 한 StoredProduct.grandTotalWon 대신 트리에서 직접 합산
  // ※ enabled OFF 인 자재는 partExtrasCalc 단에서 자동 제외
  const partTotals = useMemo(() => {
    return partNodes.map((p) => {
      const id = p.id ?? "";
      const materialsTotal = sumMaterialsForPart(treeNodes, id);
      const attCost = sumAttachmentsForPart(treeNodes, id);
      const hwCost = calcPartHardwaresCost(id);
      const fees = calcPartFees(treeNodes, id);
      const tags = getPartTags(id);
      const tagActive = isPartActive(id, activeFilters);  // 변형 태그 필터
      const enabled = getPartEnabled(id);                  // on/off 토글
      const active = enabled && tagActive;                 // 둘 다 만족해야 합계 포함
      return {
        id, name: p.name ?? "이름 없음",
        materialsTotal, attCost, hwCost, fees,
        total: materialsTotal + attCost + hwCost + fees.total,
        tags, active, enabled, tagActive,
      };
    });
  }, [partNodes, treeNodes, tick, activeFilters]);

  // 활성(enabled + tag-active) 단품만 합계에 포함
  const setTotal = partTotals.filter((p) => p.active).reduce((s, p) => s + p.total, 0);
  const activeCount = partTotals.filter((p) => p.active).length;

  // 단품/자재 on/off 토글 핸들러
  const onTogglePartEnabled = useCallback((partId: string) => {
    setPartEnabled(partId, !getPartEnabled(partId));
    refresh();
  }, [refresh]);

  const onToggleMaterialEnabled = useCallback((matId: string) => {
    setMaterialEnabled(matId, !getMaterialEnabled(matId));
    refresh();
  }, [refresh]);

  // 세트 안의 모든 고유 태그 (이름순)
  const allTagsInSet = useMemo(() => {
    const set = new Set<string>();
    for (const p of partNodes) {
      const t = getPartTags(p.id ?? "");
      for (const x of t) set.add(x);
    }
    return Array.from(set).sort();
  }, [partNodes, tick]);

  // 단품의 태그 변경 핸들러 (PartCard 에서 호출)
  const onChangePartTags = useCallback((partId: string, nextTags: string[]) => {
    setPartTags(partId, nextTags);
    refresh();
  }, [refresh]);

  // 드래그 대상 mat ID (시각 피드백용)
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // ─── 핸들러 ───
  const [editingSetName, setEditingSetName] = useState(false);
  const onRenameSet = useCallback((newName: string) => {
    if (!setEntityId) return;
    const finalName = newName.trim() || "이름 없음";
    setTreeNodes((nodes) => nodes.map((n) => (n.id === setEntityId ? { ...n, name: finalName } : n)));
    const sets = getSets();
    const s = sets.find((x) => x.id === setEntityId);
    if (s) putSet({ ...s, name: finalName, form: { ...s.form, name: finalName }, updatedAt: new Date().toISOString() });
    if (activeTabId) updateTabLabel(activeTabId, { name: finalName, grandTotalWon: setTotal });
    setEditingSetName(false);
  }, [setEntityId, setTreeNodes, activeTabId, updateTabLabel, setTotal]);

  const onAddPart = useCallback(() => {
    if (!setEntityId || setIdx < 0) return;
    const newPartId = "node_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const newPartNode: TreeNode = { id: newPartId, type: "item", name: "새 단품", depth: 0 };
    let insertAt = treeNodes.length;
    for (let i = setIdx + 1; i < treeNodes.length; i++) {
      const n = treeNodes[i];
      if (n.type === "divider" || n.type === "set") { insertAt = i; break; }
    }
    setTreeNodes((nodes) => [...nodes.slice(0, insertAt), newPartNode, ...nodes.slice(insertAt)]);
    putProduct(enrichProductComputed({
      id: newPartId, name: "새 단품", status: "DRAFT", updatedAt: new Date().toISOString(),
      grandTotalWon: 0, summary: "",
      form: { name: "새 단품", lineItems: [], hardwareEa: 0, stickerEa: 1, adminRate: 0.05 },
    } as StoredProduct));
    refresh();
  }, [setEntityId, setIdx, treeNodes, setTreeNodes, refresh]);

  const onRenamePart = useCallback((partId: string, newName: string) => {
    const finalName = newName.trim() || "이름 없음";
    setTreeNodes((nodes) => nodes.map((n) => (n.id === partId ? { ...n, name: finalName } : n)));
    const products = getProducts();
    const p = products.find((x) => x.id === partId);
    if (p) putProduct(enrichProductComputed({ ...p, name: finalName, form: { ...p.form, name: finalName }, updatedAt: new Date().toISOString() }));
    refresh();
  }, [setTreeNodes, refresh]);

  const onMaterialOpenEditor = useCallback((matId: string) => {
    openEntityTab("material", matId);
    nav("/material");
  }, [openEntityTab, nav]);

  // 자재 이동 — 같은 세트 내 검증 포함
  const moveMatWithCheck = useCallback((matId: string, targetPartId: string | null) => {
    if (!setEntityId) return;
    // targetPartId 가 같은 세트의 단품인지 검증 (null 은 풀이라 항상 OK)
    if (targetPartId) {
      const valid = partNodes.some((p) => p.id === targetPartId);
      if (!valid) {
        alert("같은 세트 내에서만 이동 가능합니다.");
        return;
      }
    }
    setTreeNodes((nodes) => moveMaterialToPart(nodes, matId, targetPartId));
    refresh();
  }, [setEntityId, partNodes, setTreeNodes, refresh]);

  // 자재 복사 — StoredMaterial 복제 + 같은 위치(원본 다음)에 트리 노드 추가
  const onCopyMaterial = useCallback((matId: string) => {
    const newMatId = duplicateMaterialById(matId);
    if (!newMatId) return;
    const orig = getMaterial(newMatId);
    setTreeNodes((nodes) => {
      const idx = nodes.findIndex((n) => n.id === matId);
      if (idx < 0) return nodes;
      const original = nodes[idx];
      const newNode: TreeNode = {
        id: newMatId,
        type: "mat",
        name: orig?.name ?? `${original.name ?? ""} (복사)`,
        depth: original.depth ?? 1,
      };
      return [...nodes.slice(0, idx + 1), newNode, ...nodes.slice(idx + 1)];
    });
    refresh();
  }, [setTreeNodes, refresh]);

  // 자재 삭제 — 트리 노드 + StoredMaterial 둘 다 제거
  const onDeleteMaterial = useCallback((matId: string) => {
    const m = getMaterial(matId);
    const name = m?.name ?? "이 자재";
    if (!window.confirm(`'${name}' 자재를 삭제하시겠습니까?\n(단품/세트 합계에서도 빠집니다)`)) return;
    setTreeNodes((nodes) => nodes.filter((n) => n.id !== matId));
    deleteMaterialCompletely(matId);
    refresh();
  }, [setTreeNodes, refresh]);

  // 단품 복사 — 단품 + 자식 자재 모두 복제 + 트리 서브트리 삽입
  const onCopyPart = useCallback((partId: string) => {
    const newPartId = duplicateProductById(partId);
    if (!newPartId) return;
    const newProd = getProducts().find((p) => p.id === newPartId);

    // 원본의 자식 자재 노드들 (트리 기반)
    const childMats = getMaterialsForPart(treeNodes, partId);
    const newMatIds: string[] = [];
    const newMatNodes: TreeNode[] = [];
    for (const m of childMats) {
      const nid = duplicateMaterialById(m.id ?? "");
      if (!nid) continue;
      const stored = getMaterial(nid);
      newMatIds.push(nid);
      newMatNodes.push({
        id: nid,
        type: "mat",
        name: stored?.name ?? `${m.name ?? ""} (복사)`,
        depth: m.depth ?? 1,
      });
    }

    setTreeNodes((nodes) => {
      const partIdx = nodes.findIndex((n) => n.id === partId);
      if (partIdx < 0) return nodes;
      // 원본 단품 + 자식 자재들이 끝나는 지점 찾기
      let endIdx = partIdx + 1;
      while (endIdx < nodes.length) {
        const n = nodes[endIdx];
        if (n.type === "divider" || n.type === "set" || n.type === "item") break;
        endIdx++;
      }
      const origPart = nodes[partIdx];
      const newPartNode: TreeNode = {
        id: newPartId,
        type: "item",
        name: newProd?.name ?? `${origPart.name ?? ""} (복사)`,
        depth: origPart.depth ?? 0,
      };
      return [
        ...nodes.slice(0, endIdx),
        newPartNode,
        ...newMatNodes,
        ...nodes.slice(endIdx),
      ];
    });
    void newMatIds;
    refresh();
  }, [treeNodes, setTreeNodes, refresh]);

  // 단품 삭제 — 단품 + 자식 자재 모두 트리/스토어에서 제거
  const onDeletePart = useCallback((partId: string) => {
    const p = getProducts().find((x) => x.id === partId);
    const name = p?.name ?? "이 단품";
    const childMats = getMaterialsForPart(treeNodes, partId);
    const matCount = childMats.length;
    const msg = matCount > 0
      ? `'${name}' 단품과 자식 자재 ${matCount}개를 모두 삭제하시겠습니까?\n(되돌릴 수 없습니다)`
      : `'${name}' 단품을 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;

    const childIds = new Set(childMats.map((m) => m.id ?? ""));
    setTreeNodes((nodes) => nodes.filter((n) => n.id !== partId && !(n.id && childIds.has(n.id))));
    for (const cid of childIds) {
      if (cid) deleteMaterialCompletely(cid);
    }
    deleteProductEntity(partId);
    refresh();
  }, [treeNodes, setTreeNodes, refresh]);

  // ─── DnD: 페이지 전체에서 ondragend 정리 ───
  useEffect(() => {
    const onDragEnd = () => setDraggingId(null);
    document.addEventListener("dragend", onDragEnd);
    return () => document.removeEventListener("dragend", onDragEnd);
  }, []);

  // anchor scroll
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const hash = location.hash || window.location.hash;
    const m = hash.match(/^#part-card-(.+)$/);
    if (!m) return;
    const partId = m[1];
    const tid = window.setTimeout(() => {
      const el = document.getElementById(`part-card-${partId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setHighlightId(partId);
        window.setTimeout(() => setHighlightId(null), 2000);
      }
    }, 100);
    return () => window.clearTimeout(tid);
  }, [location.hash, partNodes.length]);

  // 픽커 다이얼로그 상태
  const [pickerForPartId, setPickerForPartId] = useState<string | null>(null);

  // 자재 편집 다이얼로그 상태
  const [editingMatId, setEditingMatId] = useState<string | null>(null);

  if (!active || active.kind !== "set" || !setNode) {
    return (
      <div style={{ padding: 32, color: "#7E7E7E", fontSize: 13 }}>
        세트를 선택해주세요. 사이드바에서 세트 노드를 클릭하면 한 페이지 뷰가 열립니다.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#FAFAFA" }}>
      <div style={{
        maxWidth: 1320, margin: "0 auto", padding: "24px 28px",
        fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1", letterSpacing: "-0.01em", color: "#282828",
      }}>
        {/* 세트 헤더 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingSetName ? (
              <input
                autoFocus defaultValue={setNode.name ?? ""}
                onBlur={(e) => onRenameSet(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingSetName(false);
                }}
                style={{ fontSize: 20, fontWeight: 700, border: "1px solid #282828", borderRadius: 4, padding: "6px 10px", width: "100%", outline: "none" }}
              />
            ) : (
              <div onClick={() => setEditingSetName(true)} style={{ fontSize: 20, fontWeight: 700, cursor: "text", padding: "4px 0" }}>
                {setNode.name?.trim() ? setNode.name : <span style={{ color: "#B3B3B3" }}>이름 없음 (클릭 편집)</span>}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#7E7E7E", marginTop: 4 }}>
              단품 {partNodes.length}개
              {activeFilters.length > 0 ? (
                <> · 활성 <strong style={{ color: "#282828" }}>{activeCount}</strong> / {partNodes.length}</>
              ) : null}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#7E7E7E" }}>세트 합계</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtWon(setTotal)}</div>
          </div>
        </div>

        {/* 변형 토글 바 */}
        <VariantToggleBar
          allTags={allTagsInSet}
          activeFilters={activeFilters}
          onToggle={toggleFilter}
          onClearAll={clearFilters}
        />

        {/* 좌: 단품 카드 / 우: 자재 풀 */}
        <div style={{ display: "grid", gridTemplateColumns: `1fr ${POOL_W}px`, gap: 12, alignItems: "start" }}>
          {/* 좌측 */}
          <div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {partTotals.length === 0 ? (
                <div style={{ padding: "40px 0", textAlign: "center", color: "#B3B3B3", fontSize: 12 }}>
                  아직 단품이 없습니다. 자재 풀에서 자재를 드래그해 단품을 만들거나 [+ 단품 추가] 클릭.
                </div>
              ) : (
                partTotals.map((pt) => (
                  <PartCard
                    key={pt.id}
                    partId={pt.id}
                    name={pt.name}
                    attCost={pt.attCost}
                    hwCost={pt.hwCost}
                    fees={pt.fees}
                    total={pt.total}
                    highlighted={highlightId === pt.id}
                    onRename={(n) => onRenamePart(pt.id, n)}
                    onMaterialOpenEditor={onMaterialOpenEditor}
                    onMoveMaterial={moveMatWithCheck}
                    onAddMaterialClick={() => setPickerForPartId(pt.id)}
                    otherParts={partTotals.filter((q) => q.id !== pt.id)}
                    draggingId={draggingId}
                    setDraggingId={setDraggingId}
                    tags={pt.tags}
                    active={pt.active}
                    enabled={pt.enabled}
                    onToggleEnabled={() => onTogglePartEnabled(pt.id)}
                    onToggleMaterialEnabled={onToggleMaterialEnabled}
                    onCopyPart={() => onCopyPart(pt.id)}
                    onDeletePart={() => onDeletePart(pt.id)}
                    onCopyMaterial={onCopyMaterial}
                    onDeleteMaterial={onDeleteMaterial}
                    onEditMaterial={(matId) => setEditingMatId(matId)}
                    allTagsInSet={allTagsInSet}
                    onChangeTags={(next) => onChangePartTags(pt.id, next)}
                    onMutate={refresh}
                  />
                ))
              )}
            </div>
            <button
              type="button" onClick={onAddPart}
              style={{
                marginTop: 12, width: "100%", padding: "16px",
                background: "transparent", border: "1.5px dashed #D6D6D6", borderRadius: 8,
                fontSize: 12, color: "#7E7E7E", cursor: "pointer",
              }}
            >
              + 단품 추가
            </button>
          </div>

          {/* 우측 자재 풀 (sticky) */}
          <div style={{ position: "sticky", top: 16, alignSelf: "start" }}>
            <MaterialPoolPanel
              poolNodes={poolNodes}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              onDropToPool={(matId) => moveMatWithCheck(matId, null)}
              onUploadClick={() => {
                // UploadFlow 가 MainLayout 에 마운트되어 있어 라우트 이동 없이 모달이 뜸
                window.dispatchEvent(new Event("groot:open-upload"));
              }}
            />
          </div>
        </div>
      </div>

      {/* 자재 편집 다이얼로그 */}
      {editingMatId ? (
        <MaterialEditDialog
          materialId={editingMatId}
          onClose={() => setEditingMatId(null)}
          onSaved={refresh}
        />
      ) : null}

      {/* + 자재 추가 픽커 */}
      {pickerForPartId ? (
        <MaterialPickerDialog
          poolNodes={poolNodes}
          targetPartName={partTotals.find((p) => p.id === pickerForPartId)?.name ?? ""}
          onCancel={() => setPickerForPartId(null)}
          onConfirm={(matIds) => {
            for (const mid of matIds) moveMatWithCheck(mid, pickerForPartId);
            setPickerForPartId(null);
          }}
          onUploadClick={() => {
            setPickerForPartId(null);
            window.dispatchEvent(new Event("groot:open-upload"));
          }}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ToggleSwitch — 단품/자재 활성 on/off 토글 (합계 포함 여부)
// ─────────────────────────────────────────────────────────────

function ToggleSwitch({
  on,
  onClick,
  title,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        position: "relative",
        width: 30,
        height: 16,
        padding: 0,
        border: "none",
        borderRadius: 999,
        background: on ? "#282828" : "#D6D6D6",
        cursor: "pointer",
        transition: "background .15s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 16 : 2,
          width: 12,
          height: 12,
          background: "#fff",
          borderRadius: "50%",
          transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.2)",
        }}
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// PartCard
// ─────────────────────────────────────────────────────────────

function PartCard({
  partId, name, attCost, hwCost, fees, total, highlighted,
  onRename, onMaterialOpenEditor, onMoveMaterial, onAddMaterialClick,
  otherParts, draggingId, setDraggingId,
  tags, active, enabled, onToggleEnabled, onToggleMaterialEnabled,
  onCopyPart, onDeletePart, onCopyMaterial, onDeleteMaterial, onEditMaterial,
  allTagsInSet, onChangeTags, onMutate,
}: {
  partId: string; name: string; attCost: number; hwCost: number; fees: PartFees; total: number; highlighted: boolean;
  onRename: (n: string) => void;
  onMaterialOpenEditor: (matId: string) => void;
  onMoveMaterial: (matId: string, targetPartId: string | null) => void;
  onAddMaterialClick: () => void;
  otherParts: Array<{ id: string; name: string }>;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  tags: string[];
  active: boolean;
  enabled: boolean;
  onToggleEnabled: () => void;
  onToggleMaterialEnabled: (matId: string) => void;
  onCopyPart: () => void;
  onDeletePart: () => void;
  onCopyMaterial: (matId: string) => void;
  onDeleteMaterial: (matId: string) => void;
  onEditMaterial: (matId: string) => void;
  allTagsInSet: string[];
  onChangeTags: (next: string[]) => void;
  onMutate: () => void;
}) {
  const { treeNodes } = useTree();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [headerHover, setHeaderHover] = useState(false);
  const [partMenuOpen, setPartMenuOpen] = useState(false);
  useEffect(() => {
    if (!partMenuOpen) return;
    const onDoc = () => setPartMenuOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [partMenuOpen]);

  const mats = useMemo(() => getMaterialsForPart(treeNodes, partId), [treeNodes, partId]);
  const hardwares = getHardwares(partId);
  const hardwareItems: InlineItem[] = hardwares.map((h) => ({
    id: h.id, name: h.name, itemCode: h.itemCode, quantity: h.quantity, unitPrice: h.unitPrice,
  }));

  const onAddHardware = (data: Omit<InlineItem, "id">) => {
    addHardware(partId, data);
    onMutate();
  };
  const onUpdateHardware = (id: string, patch: Partial<Omit<InlineItem, "id">>) => {
    updateHardware(id, patch);
    onMutate();
  };
  const onDeleteHardware = (id: string) => {
    deleteHardware(id);
    onMutate();
  };

  const borderColor = highlighted ? "#282828" : "#E0E0E0";
  const boxShadow = highlighted ? "0 0 0 3px rgba(40,40,40,0.08)" : "none";

  const handleAddTag = (newTag: string) => {
    if (!newTag || tags.includes(newTag)) return;
    onChangeTags([...tags, newTag]);
  };
  const handleRemoveTag = (tag: string) => {
    onChangeTags(tags.filter((t) => t !== tag));
  };

  // 드롭존 핸들러
  const onDropZoneOver = (e: React.DragEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dropOver) setDropOver(true);
  };
  const onDropZoneLeave = () => setDropOver(false);
  const onDropZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const matId = e.dataTransfer.getData(DND_MIME) || draggingId;
    if (matId) onMoveMaterial(matId, partId);
    setDraggingId(null);
  };

  return (
    <div
      id={`part-card-${partId}`}
      style={{
        background: enabled ? "#fff" : "#FAFAFA",
        border: `1px solid ${borderColor}`, borderRadius: 8,
        boxShadow, transition: "border-color .2s, box-shadow .2s, opacity .2s, background .2s",
        opacity: active ? 1 : 0.45,
      }}
    >
      {/* 헤더 */}
      <div
        onMouseEnter={() => setHeaderHover(true)}
        onMouseLeave={() => setHeaderHover(false)}
        style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 10, flexWrap: "wrap", position: "relative" }}
      >
        <button type="button" onClick={() => setOpen((v) => !v)}
          style={{ width: 22, height: 22, padding: 0, border: "none", background: "transparent", cursor: "pointer", color: "#7E7E7E", fontSize: 11 }}
          title={open ? "접기" : "펼치기"}
        >{open ? "▼" : "▶"}</button>
        <ToggleSwitch
          on={enabled}
          onClick={onToggleEnabled}
          title={enabled ? "OFF 로 토글 (합계 제외)" : "ON 으로 토글 (합계 포함)"}
        />

        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {editing ? (
            <input autoFocus defaultValue={name}
              onBlur={(e) => { onRename(e.target.value); setEditing(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(false);
              }}
              style={{ fontSize: 14, fontWeight: 600, border: "1px solid #282828", borderRadius: 4, padding: "4px 8px", flex: 1, minWidth: 120, outline: "none" }}
            />
          ) : (
            <div onClick={() => setEditing(true)} style={{ fontSize: 14, fontWeight: 600, cursor: "text", padding: "2px 0" }}>
              {name?.trim() ? name : <span style={{ color: "#B3B3B3" }}>이름 없음 (클릭 편집)</span>}
            </div>
          )}

          {/* 태그 칩들 */}
          {tags.map((t) => (
            <TagChip key={t} tag={t} onRemove={handleRemoveTag} />
          ))}

          {/* +태그 버튼 + 팝오버 */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setTagPopoverOpen((v) => !v); }}
              style={{
                padding: "2px 8px", fontSize: 10, color: "#7E7E7E",
                background: "transparent", border: "1px dashed #D6D6D6",
                borderRadius: 999, cursor: "pointer", height: 20,
                fontFamily: "inherit",
              }}
            >+ 태그</button>
            {tagPopoverOpen ? (
              <TagAddPopover
                existingTags={allTagsInSet}
                currentPartTags={tags}
                onAdd={handleAddTag}
                onClose={() => setTagPopoverOpen(false)}
              />
            ) : null}
          </div>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", color: enabled ? "#282828" : "#B3B3B3", textDecoration: enabled ? "none" : "line-through" }}>{fmtWon(total)}</div>

        {/* ⋯ 메뉴 — 호버 시 또는 메뉴 열려있을 때 표시 */}
        <div
          style={{ position: "relative", visibility: (headerHover || partMenuOpen) ? "visible" : "hidden" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setPartMenuOpen((v) => !v)}
            style={{ width: 24, height: 24, padding: 0, border: "none", background: "transparent", color: "#7E7E7E", cursor: "pointer", fontSize: 16, lineHeight: 1, borderRadius: 4 }}
            title="더보기"
          >⋯</button>
          {partMenuOpen ? (
            <div style={{ position: "absolute", right: 0, top: 26, minWidth: 140, background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.10)", zIndex: 10 }}>
              <MenuItem label="복사하기" onClick={() => { onCopyPart(); setPartMenuOpen(false); }} />
              <MenuItem label="삭제하기" onClick={() => { onDeletePart(); setPartMenuOpen(false); }} danger />
            </div>
          ) : null}
        </div>
      </div>

      {/* 카드 메타 (펼쳤을 때만) */}
      {open ? (
        <div style={{ padding: "0 16px 6px 50px", fontSize: 10, color: "#7E7E7E" }}>
          자재 {mats.length}
          {attCost > 0 ? ` · 종속 부속 ${fmtWon(attCost)}` : ""}
          {hwCost > 0 ? ` · 별도 철물 ${hardwares.length}종 ${fmtWon(hwCost)}` : ""}
          {fees.total > 0 ? ` · 추가비용 ${fmtWon(fees.total)}` : ""}
        </div>
      ) : null}

      {/* 바디 */}
      {open ? (
        <div style={{ borderTop: "1px solid #F0F0F0", padding: "8px 0" }}>
          {mats.length === 0 ? (
            <div style={{ padding: "20px 24px", textAlign: "center", color: "#B3B3B3", fontSize: 11 }}>
              아직 자재가 없습니다.
            </div>
          ) : (
            mats.map((m) => (
              <PartCardMaterialRow
                key={m.id}
                materialId={m.id ?? ""}
                name={m.name ?? "이름 없음"}
                onClickName={onMaterialOpenEditor}
                onMoveToPool={(mid) => onMoveMaterial(mid, null)}
                onMoveToPart={(mid, pid) => onMoveMaterial(mid, pid)}
                otherParts={otherParts}
                draggingId={draggingId}
                setDraggingId={setDraggingId}
                onToggleEnabled={onToggleMaterialEnabled}
                onCopy={onCopyMaterial}
                onDelete={onDeleteMaterial}
                onEdit={onEditMaterial}
                onMutate={onMutate}
              />
            ))
          )}

          {/* 활성 드롭존 */}
          <div
            onDragOver={onDropZoneOver}
            onDragLeave={onDropZoneLeave}
            onDrop={onDropZoneDrop}
            style={{
              margin: "8px 24px 4px", padding: dropOver ? "16px" : "10px",
              border: `1.5px ${dropOver ? "solid" : "dashed"} ${dropOver ? "#282828" : "#E0E0E0"}`,
              borderRadius: 6, fontSize: 11, color: dropOver ? "#282828" : "#B3B3B3", textAlign: "center",
              background: dropOver ? "#F0F0F0" : "transparent", transition: "all .15s",
            }}
          >
            {dropOver ? "여기에 떨어뜨리세요" : "자재 풀에서 드래그 또는 [+ 자재 추가]"}
          </div>

          {/* 푸터 */}
          <div style={{ display: "flex", gap: 8, padding: "8px 24px 4px" }}>
            <button type="button" onClick={onAddMaterialClick}
              style={{ padding: "6px 12px", fontSize: 11, color: "#282828", background: "#fff", border: "1px solid #D6D6D6", borderRadius: 4, cursor: "pointer" }}
            >+ 자재 추가</button>
          </div>

          {/* 단품 직속 철물 (자재에 종속되지 않음) */}
          <div style={{ padding: "4px 24px 8px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#7E7E7E", marginBottom: 4, letterSpacing: "0.04em" }}>
              별도 철물
            </div>
            <InlineItemSection
              variant="hardware"
              items={hardwareItems}
              onAdd={onAddHardware}
              onUpdate={onUpdateHardware}
              onDelete={onDeleteHardware}
            />
          </div>

          {/* 단품 추가비용 — 세척비 / 포장비 / 일반관리비 (자재 기반 자동 계산) */}
          <div style={{ padding: "4px 24px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#7E7E7E", marginBottom: 4, letterSpacing: "0.04em" }}>
              단품 추가비용
            </div>
            <div style={{ background: "#FAFAFA", borderRadius: 6, padding: "8px 12px", fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1" }}>
              <FeeRow label="세척비" value={fees.cleaning} hint="표면적 × 500원/m²" />
              <FeeRow label="포장비" value={fees.packaging} hint="박스 + 테이프 + 스티커 + 철물보호" />
              <FeeRow label="일반관리비" value={fees.admin} hint="(자재비 + 포장비) × 5%" />
              <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 11, fontWeight: 600, padding: "6px 0 2px", borderTop: "1px solid #EFEFEF", marginTop: 4 }}>
                소계 ₩{fees.total.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 단품 추가비용 한 줄 (라벨 + 금액 + 힌트)
function FeeRow({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11 }}>
      <div style={{ color: "#282828", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 9, color: "#B3B3B3" }}>{hint}</div>
      <div style={{ color: value > 0 ? "#282828" : "#B3B3B3", fontWeight: 500, fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }}>
        ₩{value.toLocaleString()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 자재 행 + ⋯ 메뉴
// ─────────────────────────────────────────────────────────────

function PartCardMaterialRow({
  materialId, name, onClickName, onMoveToPool, onMoveToPart, otherParts, draggingId, setDraggingId, onToggleEnabled, onCopy, onDelete, onEdit, onMutate,
}: {
  materialId: string; name: string;
  onClickName: (id: string) => void;
  onMoveToPool: (id: string) => void;
  onMoveToPart: (id: string, partId: string) => void;
  otherParts: Array<{ id: string; name: string }>;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onToggleEnabled: (matId: string) => void;
  onCopy: (matId: string) => void;
  onDelete: (matId: string) => void;
  onEdit: (matId: string) => void;
  onMutate: () => void;
}) {
  const stored = getMaterial(materialId);
  const w = stored?.form?.wMm ?? 0;
  const d = stored?.form?.dMm ?? 0;
  const t = stored?.form?.hMm ?? 0;
  const color = stored?.form?.color ?? "WW";
  const baseGrand = stored?.grandTotalWon ?? 0;
  const attCost = calcMaterialAttachmentsCost(materialId);
  const totalGrand = baseGrand + attCost;
  const enabled = getMaterialEnabled(materialId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rowHover, setRowHover] = useState(false);

  // 종속 부속
  const attachments = getAttachments(materialId);
  const attachmentItems: InlineItem[] = attachments.map((a) => ({
    id: a.id, name: a.name, itemCode: a.itemCode, quantity: a.quantity, unitPrice: a.unitPrice,
  }));

  const onAddAtt = (data: Omit<InlineItem, "id">) => {
    addAttachment(materialId, data);
    onMutate();
  };
  const onUpdateAtt = (id: string, patch: Partial<Omit<InlineItem, "id">>) => {
    updateAttachment(id, patch);
    onMutate();
  };
  const onDeleteAtt = (id: string) => {
    deleteAttachment(id);
    onMutate();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = () => { setMenuOpen(false); setSubmenuOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_MIME, materialId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(materialId);
  };
  const isDragging = draggingId === materialId;

  return (
    <div
      style={{ borderBottom: "1px solid #F8F8F8" }}
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => setRowHover(false)}
    >
      <div
        draggable
        onDragStart={onDragStart}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 24px",
          opacity: isDragging ? 0.5 : enabled ? 1 : 0.45,
          cursor: "grab",
          background: enabled ? "transparent" : "#FAFAFA",
        }}
      >
        <ToggleSwitch
          on={enabled}
          onClick={() => onToggleEnabled(materialId)}
          title={enabled ? "OFF — 단품 합계에서 제외" : "ON — 단품 합계 포함"}
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ width: 18, height: 18, padding: 0, border: "none", background: "transparent", color: attachments.length > 0 ? "#282828" : "#7E7E7E", fontSize: 10, cursor: "pointer" }}
          title={expanded ? "종속 부속 접기" : "종속 부속 펼치기"}
        >{expanded ? "▼" : "▶"}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button type="button" onClick={() => onClickName(materialId)}
            style={{ background: "transparent", border: "none", padding: 0, fontSize: 12, fontWeight: 500, color: enabled ? "#282828" : "#B3B3B3", cursor: "pointer", textAlign: "left", textDecoration: enabled ? "none" : "line-through" }}
            title="자재 편집창 열기"
          >{name}</button>
          <div style={{ fontSize: 10, color: "#7E7E7E", marginTop: 2 }}>
            {w}×{d}×{t}T · {color}
            {attachments.length > 0 ? ` · 부속 ${attachments.length}개` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: enabled ? "#282828" : "#B3B3B3", textDecoration: enabled ? "none" : "line-through" }}>{fmtWon(totalGrand)}</div>
          {attCost > 0 ? (
            <div style={{ fontSize: 9, color: "#7E7E7E", marginTop: 1 }}>
              고유 {fmtWon(baseGrand)} + 부속 {fmtWon(attCost)}
            </div>
          ) : null}
        </div>

        {/* ⋯ 메뉴 — 호버 시 또는 메뉴 열려있을 때만 표시 */}
        <div
          style={{ position: "relative", visibility: (rowHover || menuOpen) ? "visible" : "hidden" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button"
            onClick={() => setMenuOpen((v) => !v)}
            style={{ width: 24, padding: 0, border: "none", background: "transparent", color: "#7E7E7E", cursor: "pointer", fontSize: 14 }}
            title="더보기"
          >⋯</button>
          {menuOpen ? (
            <div style={{ position: "absolute", right: 0, top: 24, minWidth: 160, background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.10)", zIndex: 10 }}>
              <MenuItem label="자재 편집하기" onClick={() => { onEdit(materialId); setMenuOpen(false); }} />
              <MenuItem label="복사하기" onClick={() => { onCopy(materialId); setMenuOpen(false); }} />
              <MenuItem label="자재 풀로 이동" onClick={() => { onMoveToPool(materialId); setMenuOpen(false); }} />
              <div
                onMouseEnter={() => setSubmenuOpen(true)}
                onMouseLeave={() => setSubmenuOpen(false)}
                style={{ position: "relative" }}
              >
                <MenuItem label={`다른 단품으로 ▶${otherParts.length === 0 ? " (없음)" : ""}`} onClick={() => {}} disabled={otherParts.length === 0} />
                {submenuOpen && otherParts.length > 0 ? (
                  <div style={{ position: "absolute", left: "100%", top: 0, minWidth: 180, background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.10)" }}>
                    {otherParts.map((p) => (
                      <MenuItem key={p.id} label={p.name || "이름 없음"} onClick={() => { onMoveToPart(materialId, p.id); setMenuOpen(false); }} />
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ height: 1, background: "#F0F0F0", margin: "4px 0" }} />
              <MenuItem label="삭제하기" onClick={() => { onDelete(materialId); setMenuOpen(false); }} danger />
            </div>
          ) : null}
        </div>
      </div>

      {/* 종속 부속 영역 */}
      {expanded ? (
        <div style={{ padding: "0 24px 10px 56px" }}>
          <InlineItemSection
            variant="attachment"
            items={attachmentItems}
            onAdd={onAddAtt}
            onUpdate={onUpdateAtt}
            onDelete={onDeleteAtt}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ label, onClick, disabled, danger }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  const baseColor = disabled ? "#B3B3B3" : danger ? "#DC2626" : "#282828";
  const hoverBg = danger ? "#FFF1F0" : "#F5F5F5";
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "8px 12px", fontSize: 12,
        color: baseColor,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLDivElement).style.background = hoverBg; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >{label}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// 자재 풀 패널
// ─────────────────────────────────────────────────────────────

function MaterialPoolPanel({
  poolNodes, draggingId, setDraggingId, onDropToPool, onUploadClick,
}: {
  poolNodes: TreeNode[];
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onDropToPool: (matId: string) => void;
  onUploadClick: () => void;
}) {
  const [search, setSearch] = useState("");
  const [dropOver, setDropOver] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return poolNodes;
    return poolNodes.filter((n) => {
      const stored = getMaterial(n.id ?? "");
      const dimText = stored?.form ? `${stored.form.wMm}x${stored.form.dMm}x${stored.form.hMm}` : "";
      return (n.name ?? "").toLowerCase().includes(q) || dimText.includes(q);
    });
  }, [poolNodes, search]);

  const onDragOver = (e: React.DragEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dropOver) setDropOver(true);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const matId = e.dataTransfer.getData(DND_MIME) || draggingId;
    if (matId) {
      // 풀의 자재가 풀로 다시 떨어지는 경우 — 이미 풀에 있으면 무동작
      const isAlreadyInPool = poolNodes.some((n) => n.id === matId);
      if (!isAlreadyInPool) onDropToPool(matId);
    }
    setDraggingId(null);
  };
  const onDragLeave = () => setDropOver(false);

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      style={{
        background: "#fff", border: `1px solid ${dropOver ? "#282828" : "#E0E0E0"}`, borderRadius: 8, padding: 12,
        transition: "border-color .15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>자재 풀</div>
        <span style={{ fontSize: 10, color: "#7E7E7E", padding: "2px 6px", background: "#F0F0F0", borderRadius: 10 }}>미배치 {poolNodes.length}</span>
      </div>
      <div style={{ fontSize: 10, color: "#B3B3B3", marginBottom: 8 }}>단품 카드로 드래그</div>

      <input
        value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="검색…"
        style={{ width: "100%", height: 26, padding: "0 8px", fontSize: 11, border: "1px solid #E0E0E0", borderRadius: 4, outline: "none", marginBottom: 8 }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 480, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "20px 8px", textAlign: "center", color: "#B3B3B3", fontSize: 11 }}>
            {poolNodes.length === 0 ? "모든 자재가 단품에 배치되어 있습니다" : "검색 결과 없음"}
          </div>
        ) : (
          filtered.map((n) => (
            <MaterialPoolCard key={n.id} node={n} isDragging={draggingId === n.id} setDraggingId={setDraggingId} />
          ))
        )}
      </div>

      <button
        type="button" onClick={onUploadClick}
        style={{
          width: "100%", marginTop: 10, padding: "8px",
          background: "transparent", border: "1px dashed #D6D6D6", borderRadius: 4,
          fontSize: 11, color: "#7E7E7E", cursor: "pointer",
        }}
      >+ 도면/모델링 업로드</button>
    </div>
  );
}

function MaterialPoolCard({ node, isDragging, setDraggingId }: { node: TreeNode; isDragging: boolean; setDraggingId: (id: string | null) => void }) {
  const matId = node.id ?? "";
  const stored = getMaterial(matId);
  const w = stored?.form?.wMm ?? 0;
  const d = stored?.form?.dMm ?? 0;
  const t = stored?.form?.hMm ?? 0;
  const color = stored?.form?.color ?? "WW";
  const grand = stored?.grandTotalWon ?? 0;

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_MIME, matId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(matId);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 10px", border: "1px solid #E8E8E8", borderRadius: 6, background: "#fff",
        opacity: isDragging ? 0.5 : 1, cursor: "grab",
      }}
    >
      <span style={{ color: "#B3B3B3", fontSize: 11, lineHeight: 1, marginRight: 2 }}>⋮⋮</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "#282828", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name ?? "이름 없음"}</div>
        <div style={{ fontSize: 9, color: "#7E7E7E", marginTop: 1 }}>{w}×{d}×{t} · {color}</div>
        <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>{fmtWon(grand)}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// + 자재 추가 픽커
// ─────────────────────────────────────────────────────────────

function MaterialPickerDialog({
  poolNodes, targetPartName, onCancel, onConfirm, onUploadClick,
}: {
  poolNodes: TreeNode[]; targetPartName: string;
  onCancel: () => void; onConfirm: (matIds: string[]) => void;
  onUploadClick: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.35)" }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: "80vh", background: "#fff", borderRadius: 8, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Pretendard, system-ui" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #F0F0F0" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>자재 풀에서 선택</div>
          <div style={{ fontSize: 11, color: "#7E7E7E", marginTop: 4 }}>{targetPartName} 에 추가 · {selected.size}개 선택</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {poolNodes.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: "#B3B3B3", fontSize: 12 }}>
              자재 풀이 비어 있습니다.
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={onUploadClick} style={{ padding: "8px 14px", fontSize: 11, color: "#fff", background: "#282828", border: "none", borderRadius: 4, cursor: "pointer" }}>
                  + 도면/모델링 업로드
                </button>
              </div>
            </div>
          ) : poolNodes.map((n) => {
            const id = n.id ?? "";
            const stored = getMaterial(id);
            const w = stored?.form?.wMm ?? 0;
            const d = stored?.form?.dMm ?? 0;
            const t = stored?.form?.hMm ?? 0;
            const grand = stored?.grandTotalWon ?? 0;
            const checked = selected.has(id);
            return (
              <div key={id} onClick={() => toggle(id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", cursor: "pointer", background: checked ? "#F5F5F5" : "transparent", borderLeft: checked ? "3px solid #282828" : "3px solid transparent" }}
              >
                <input type="checkbox" checked={checked} readOnly style={{ width: 14, height: 14 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{n.name ?? "이름 없음"}</div>
                  <div style={{ fontSize: 10, color: "#7E7E7E", marginTop: 2 }}>{w}×{d}×{t}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>{fmtWon(grand)}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 20px", borderTop: "1px solid #F0F0F0", justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} style={{ padding: "8px 14px", fontSize: 12, color: "#616161", background: "transparent", border: "1px solid #D6D6D6", borderRadius: 4, cursor: "pointer" }}>취소</button>
          <button type="button" disabled={selected.size === 0}
            onClick={() => onConfirm(Array.from(selected))}
            style={{ padding: "8px 14px", fontSize: 12, color: "#fff", background: selected.size === 0 ? "#D6D6D6" : "#282828", border: "none", borderRadius: 4, cursor: selected.size === 0 ? "not-allowed" : "pointer", fontWeight: 600 }}
          >{selected.size > 0 ? `${selected.size}개 추가` : "선택"}</button>
        </div>
      </div>
    </div>
  );
}

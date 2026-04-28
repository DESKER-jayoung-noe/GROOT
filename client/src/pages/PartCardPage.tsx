/**
 * 단품 카드 페이지 — 2단계 리팩토링
 * ===================================
 * 라우트: /parts/:partId
 *
 * 단품 1개 = 자재 N개 + 부속(M) + 직속 철물(K) 묶음
 * - 카드 헤더: 이름 인라인 편집 + 태그 칩 + 합계
 * - 자재 행: ▶ 펼침 → 종속 부속 인라인 테이블, ⋯ 메뉴 → 자세히 편집/삭제
 * - 단품 직속 철물: 자재 리스트 아래 별도 섹션
 *
 * 기존 자재 편집창(MaterialTab)은 손대지 않음 — ⋯ "자세히 편집" 시 /material 라우트로 이동.
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTree, type TreeNode, getMaterialsForItem } from "../context/TreeContext";
import { useQuoteTabs } from "../context/QuoteTabsContext";
import { getMaterial, getProducts, putProduct, enrichProductComputed } from "../offline/stores";
import {
  getPartTags, addPartTag, removePartTag,
  getAttachments, addAttachment, updateAttachment, deleteAttachment,
  getHardwares, addHardware, updateHardware, deleteHardware,
  attachmentCost, hardwareCost,
  calcMaterialAttachmentsCost,
  type Attachment, type Hardware,
} from "../offline/partExtras";

function fmtWon(n: number): string {
  return `₩${Math.max(0, Math.round(n)).toLocaleString()}`;
}

/** 단품 트리 노드 인덱스 → 그 아래 자재 노드 목록 (TreeContext.getMaterialsForItem) */
function useMaterialsOfPart(partId: string): { itemIdx: number; mats: TreeNode[] } {
  const { treeNodes } = useTree();
  return useMemo(() => {
    const itemIdx = treeNodes.findIndex((n) => n.id === partId && n.type === "item");
    if (itemIdx < 0) return { itemIdx: -1, mats: [] };
    return { itemIdx, mats: getMaterialsForItem(treeNodes, itemIdx) };
  }, [treeNodes, partId]);
}

export function PartCardPage() {
  const { partId } = useParams<{ partId: string }>();
  const nav = useNavigate();
  const { treeNodes, setTreeNodes } = useTree();
  const { openEntityTab } = useQuoteTabs();
  const { itemIdx, mats } = useMaterialsOfPart(partId ?? "");

  const partNode = itemIdx >= 0 ? treeNodes[itemIdx] : null;

  // 강제 리렌더링 (localStorage 변경 후 카운터 증가)
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // 펼친 자재 ID set
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 태그 입력 임시값
  const [tagInput, setTagInput] = useState("");

  // 단품 이름 편집
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  if (!partId || !partNode) {
    return (
      <div style={{ padding: 32, color: "#7E7E7E", fontSize: 13 }}>
        단품을 찾을 수 없습니다. 사이드바에서 다른 단품을 선택해주세요.
      </div>
    );
  }

  // 자재별 고유 비용 (StoredMaterial.grandTotalWon)
  const matCosts = mats.map((m) => {
    const stored = getMaterial(m.id ?? "");
    return {
      node: m,
      stored,
      intrinsicCost: stored?.grandTotalWon ?? 0,
    };
  });

  // 부속/철물 합계 (refreshTick 으로 재읽기 보장)
  void refreshTick;
  const materialTotals = matCosts.map(({ node, intrinsicCost }) => {
    const mid = node.id ?? "";
    const att = calcMaterialAttachmentsCost(mid);
    return { id: mid, name: node.name ?? "이름 없음", node, intrinsicCost, attachmentsCost: att, total: intrinsicCost + att };
  });
  const partHwSum = getHardwares(partId).reduce((s, h) => s + hardwareCost(h), 0);
  const partTotal = materialTotals.reduce((s, m) => s + m.total, 0) + partHwSum;

  // ─── 핸들러 ───
  const onRenamePart = (newName: string) => {
    const finalName = newName.trim() || "이름 없음";
    setTreeNodes((nodes) =>
      nodes.map((n) => (n.id === partId ? { ...n, name: finalName } : n))
    );
    // StoredProduct 도 동기
    const products = getProducts();
    const prod = products.find((p) => p.id === partId);
    if (prod) {
      putProduct(enrichProductComputed({ ...prod, name: finalName, form: { ...prod.form, name: finalName }, updatedAt: new Date().toISOString() }));
    }
    setEditingName(false);
  };

  const tags = getPartTags(partId);
  const onAddTag = () => {
    const v = tagInput.trim();
    if (!v) return;
    addPartTag(partId, v);
    setTagInput("");
    refresh();
  };
  const onRemoveTag = (t: string) => {
    removePartTag(partId, t);
    refresh();
  };

  const toggleExpand = (mid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(mid)) next.delete(mid);
      else next.add(mid);
      return next;
    });
  };

  const onMaterialEdit = (mid: string) => {
    openEntityTab("material", mid);
    nav("/material");
  };

  // ─── 부속 핸들러 ───
  const onAddAttachment = (mid: string) => {
    addAttachment(mid, { name: "새 부속", itemCode: "", quantity: 1, unitPrice: 0 });
    setExpanded((prev) => new Set(prev).add(mid));
    refresh();
  };
  const onUpdateAttachment = (attId: string, patch: Partial<Attachment>) => {
    updateAttachment(attId, patch);
    refresh();
  };
  const onDeleteAttachment = (attId: string) => {
    deleteAttachment(attId);
    refresh();
  };

  // ─── 철물 핸들러 ───
  const onAddHardware = () => {
    addHardware(partId, { name: "새 철물", itemCode: "", quantity: 1, unitPrice: 0 });
    refresh();
  };
  const onUpdateHardware = (hwId: string, patch: Partial<Hardware>) => {
    updateHardware(hwId, patch);
    refresh();
  };
  const onDeleteHardware = (hwId: string) => {
    deleteHardware(hwId);
    refresh();
  };

  const hardwares = getHardwares(partId);
  const totalAttachmentsCount = materialTotals.reduce((s, m) => s + getAttachments(m.id).length, 0);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto", fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1", letterSpacing: "-0.01em", color: "#282828" }}>
      {/* 브레드크럼 */}
      <div style={{ fontSize: 12, color: "#7E7E7E", marginBottom: 6 }}>
        단품 편집 · {partNode.name || "이름 없음"}
      </div>

      {/* 카드 */}
      <div style={{ border: "1px solid #E0E0E0", borderRadius: 8, background: "#fff" }}>
        {/* 헤더 */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #F0F0F0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingName ? (
                <input
                  autoFocus
                  defaultValue={nameDraft || partNode.name || ""}
                  onBlur={(e) => onRenamePart(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  style={{ fontSize: 18, fontWeight: 600, border: "1px solid #282828", borderRadius: 4, padding: "6px 10px", width: "100%", outline: "none", letterSpacing: "-0.01em" }}
                />
              ) : (
                <div
                  onClick={() => { setNameDraft(partNode.name ?? ""); setEditingName(true); }}
                  style={{ fontSize: 18, fontWeight: 600, cursor: "text", padding: "6px 0", borderRadius: 4 }}
                >
                  {partNode.name?.trim() ? partNode.name : <span style={{ color: "#B3B3B3" }}>이름 없음 (클릭 편집)</span>}
                </div>
              )}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{fmtWon(partTotal)}</div>
          </div>

          {/* 태그 칩 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {tags.map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11, fontWeight: 500, color: "#282828", background: "#F0F0F0", borderRadius: 12 }}>
                {t}
                <button type="button" onClick={() => onRemoveTag(t)} style={{ width: 14, height: 14, padding: 0, border: "none", background: "transparent", color: "#7E7E7E", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onAddTag(); }}
              placeholder="+태그 (Enter)"
              style={{ width: 110, height: 22, padding: "0 8px", fontSize: 11, border: "1px dashed #D6D6D6", borderRadius: 12, outline: "none" }}
            />
          </div>
        </div>

        {/* 자재 리스트 */}
        <div style={{ padding: "8px 0" }}>
          {materialTotals.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#B3B3B3", fontSize: 12 }}>
              아직 등록된 자재가 없습니다. 도면/모델링 업로드 후 자재를 단품으로 묶어주세요.
            </div>
          ) : (
            materialTotals.map((m) => {
              const isOpen = expanded.has(m.id);
              const stored = getMaterial(m.id);
              const wMm = stored?.form?.wMm ?? 0;
              const dMm = stored?.form?.dMm ?? 0;
              const atts = getAttachments(m.id);
              return (
                <div key={m.id} style={{ borderBottom: "1px solid #F5F5F5" }}>
                  {/* 자재 헤더 행 */}
                  <div style={{ display: "flex", alignItems: "center", padding: "12px 24px", gap: 10 }}>
                    <button type="button"
                      onClick={() => toggleExpand(m.id)}
                      style={{ width: 18, height: 18, padding: 0, border: "none", background: "transparent", cursor: "pointer", color: "#7E7E7E", fontSize: 10 }}
                      title={isOpen ? "접기" : "펼치기"}
                    >
                      {isOpen ? "▼" : "▶"}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#282828" }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: "#7E7E7E", marginTop: 2 }}>
                        {wMm}×{dMm}
                        {atts.length > 0 ? <span style={{ marginLeft: 8 }}>· 부속 {atts.length}</span> : null}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#282828", whiteSpace: "nowrap" }}>{fmtWon(m.total)}</div>
                    <button type="button"
                      onClick={() => onMaterialEdit(m.id)}
                      style={{ padding: "4px 10px", fontSize: 11, color: "#616161", background: "transparent", border: "1px solid #D6D6D6", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}
                      title="자재 편집창 열기"
                    >
                      자세히 편집
                    </button>
                    <button type="button"
                      onClick={() => onAddAttachment(m.id)}
                      style={{ padding: "4px 10px", fontSize: 11, color: "#7E7E7E", background: "transparent", border: "1px dashed #D6D6D6", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      + 부속
                    </button>
                  </div>

                  {/* 종속 부속 펼침 */}
                  {isOpen && atts.length > 0 ? (
                    <div style={{ padding: "0 24px 16px 60px", background: "#FAFAF8" }}>
                      <div style={{ paddingTop: 8, fontSize: 10, color: "#7E7E7E", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                        종속 부속 {atts.length}개
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 80px 100px 90px 24px", gap: 8, fontSize: 11 }}>
                        <div style={{ color: "#7E7E7E", fontSize: 10 }}>이름</div>
                        <div style={{ color: "#7E7E7E", fontSize: 10 }}>아이템코드</div>
                        <div style={{ color: "#7E7E7E", fontSize: 10, textAlign: "right" }}>수량</div>
                        <div style={{ color: "#7E7E7E", fontSize: 10, textAlign: "right" }}>단가</div>
                        <div style={{ color: "#7E7E7E", fontSize: 10, textAlign: "right" }}>합계</div>
                        <div />
                        {atts.map((a) => (
                          <AttachmentRow key={a.id} att={a} onChange={(p) => onUpdateAttachment(a.id, p)} onDelete={() => onDeleteAttachment(a.id)} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* 단품 직속 철물 섹션 */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid #F0F0F0", background: "#FAFAF8" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              단품 직속 철물 {hardwares.length > 0 ? `${hardwares.length}개` : ""}
            </div>
            <button type="button"
              onClick={onAddHardware}
              style={{ padding: "4px 10px", fontSize: 11, color: "#7E7E7E", background: "#fff", border: "1px dashed #D6D6D6", borderRadius: 4, cursor: "pointer" }}
            >
              + 단품 직속 철물
            </button>
          </div>
          {hardwares.length === 0 ? (
            <div style={{ fontSize: 11, color: "#B3B3B3" }}>다보·나사 등 단품 조립용 부품 (자재에 종속되지 않음)</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 80px 100px 90px 24px", gap: 8, fontSize: 11 }}>
              <div style={{ color: "#7E7E7E", fontSize: 10 }}>이름</div>
              <div style={{ color: "#7E7E7E", fontSize: 10 }}>아이템코드</div>
              <div style={{ color: "#7E7E7E", fontSize: 10, textAlign: "right" }}>수량</div>
              <div style={{ color: "#7E7E7E", fontSize: 10, textAlign: "right" }}>단가</div>
              <div style={{ color: "#7E7E7E", fontSize: 10, textAlign: "right" }}>합계</div>
              <div />
              {hardwares.map((h) => (
                <HardwareRow key={h.id} hw={h} onChange={(p) => onUpdateHardware(h.id, p)} onDelete={() => onDeleteHardware(h.id)} />
              ))}
            </div>
          )}
        </div>

        {/* 푸터 요약 */}
        <div style={{ padding: "10px 24px", borderTop: "1px solid #F0F0F0", fontSize: 11, color: "#7E7E7E", display: "flex", justifyContent: "space-between" }}>
          <span>자재 {materialTotals.length} · 종속 부속 {totalAttachmentsCount} · 직속 철물 {hardwares.length}</span>
          <span>합계 <strong style={{ color: "#282828", fontSize: 13 }}>{fmtWon(partTotal)}</strong></span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 인라인 행 컴포넌트
// ─────────────────────────────────────────────────────────────

function AttachmentRow({ att, onChange, onDelete }: { att: Attachment; onChange: (p: Partial<Attachment>) => void; onDelete: () => void }) {
  const cost = attachmentCost(att);
  return (
    <>
      <input value={att.name} onChange={(e) => onChange({ name: e.target.value })} style={inputStyle} />
      <input value={att.itemCode} onChange={(e) => onChange({ itemCode: e.target.value })} style={inputStyle} placeholder="ITEM_CODE" />
      <input type="number" min={0} value={att.quantity} onChange={(e) => onChange({ quantity: Number(e.target.value) || 0 })} style={{ ...inputStyle, textAlign: "right" }} />
      <input type="number" min={0} value={att.unitPrice} onChange={(e) => onChange({ unitPrice: Number(e.target.value) || 0 })} style={{ ...inputStyle, textAlign: "right" }} />
      <div style={{ textAlign: "right", padding: "4px 0", color: "#282828", fontWeight: 500 }}>{fmtWon(cost)}</div>
      <button type="button" onClick={onDelete} style={delBtnStyle} title="삭제">×</button>
    </>
  );
}

function HardwareRow({ hw, onChange, onDelete }: { hw: Hardware; onChange: (p: Partial<Hardware>) => void; onDelete: () => void }) {
  const cost = hardwareCost(hw);
  return (
    <>
      <input value={hw.name} onChange={(e) => onChange({ name: e.target.value })} style={inputStyle} />
      <input value={hw.itemCode} onChange={(e) => onChange({ itemCode: e.target.value })} style={inputStyle} placeholder="ITEM_CODE" />
      <input type="number" min={0} value={hw.quantity} onChange={(e) => onChange({ quantity: Number(e.target.value) || 0 })} style={{ ...inputStyle, textAlign: "right" }} />
      <input type="number" min={0} value={hw.unitPrice} onChange={(e) => onChange({ unitPrice: Number(e.target.value) || 0 })} style={{ ...inputStyle, textAlign: "right" }} />
      <div style={{ textAlign: "right", padding: "4px 0", color: "#282828", fontWeight: 500 }}>{fmtWon(cost)}</div>
      <button type="button" onClick={onDelete} style={delBtnStyle} title="삭제">×</button>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  height: 24, padding: "0 8px", fontSize: 11, border: "1px solid #E0E0E0", borderRadius: 3, outline: "none",
  fontFamily: "inherit", fontFeatureSettings: "'tnum' 1", color: "#282828", background: "#fff",
};

const delBtnStyle: React.CSSProperties = {
  width: 22, height: 22, padding: 0, border: "none", background: "transparent",
  color: "#B3B3B3", cursor: "pointer", fontSize: 14,
};

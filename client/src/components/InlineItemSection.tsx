/**
 * 부속/철물 공용 인라인 섹션
 * - Attachment(자재 종속 부속)와 Hardware(단품 직속 철물) 가 거의 동일 필드라 1개 컴포넌트로 통합.
 * - 행: 이름 / 아이템코드 / 수량 / 단가 / 합계 / ×
 * - 인라인 편집 (블러 시 저장)
 * - + 추가 인라인 입력 (Enter 로 저장 후 입력 초기화 — 연속 추가 용이)
 */
import { useState } from "react";

export type InlineItem = {
  id: string;
  name: string;
  itemCode: string;
  quantity: number;
  unitPrice: number;
};

export type InlineItemPatch = Partial<Omit<InlineItem, "id">>;

function fmtWon(n: number): string {
  return `${Math.max(0, Math.round(n)).toLocaleString()}원`;
}

const GRID_COLS = "1fr 110px 50px 80px 90px 22px";

export function InlineItemSection({
  items, onAdd, onUpdate, onDelete,
  variant = "attachment",
  showSubtotal = true,
}: {
  items: InlineItem[];
  onAdd: (data: Omit<InlineItem, "id">) => void;
  onUpdate: (id: string, patch: InlineItemPatch) => void;
  onDelete: (id: string) => void;
  variant?: "attachment" | "hardware";
  showSubtotal?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; itemCode: string; quantity: string; unitPrice: string }>(
    { name: "", itemCode: "", quantity: "", unitPrice: "" }
  );

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);

  const commitAdd = () => {
    const q = Number(draft.quantity) || 0;
    const u = Number(draft.unitPrice) || 0;
    if (!draft.name.trim() || q <= 0 || u < 0) {
      return;
    }
    onAdd({ name: draft.name.trim(), itemCode: draft.itemCode.trim(), quantity: q, unitPrice: u });
    setDraft({ name: "", itemCode: "", quantity: "", unitPrice: "" });
    // 입력 행 유지 (연속 추가)
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraft({ name: "", itemCode: "", quantity: "", unitPrice: "" });
  };

  const sectionStyle: React.CSSProperties = {
    background: "#FAFAFA", borderRadius: 6, padding: "8px 12px",
    fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1",
  };

  return (
    <div style={sectionStyle}>
      {items.length > 0 ? (
        <>
          {/* 헤더 행 */}
          <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 6, fontSize: 9, color: "#7E7E7E", padding: "2px 0", borderBottom: "1px solid #EFEFEF" }}>
            <div>이름</div>
            <div>아이템코드</div>
            <div style={{ textAlign: "right" }}>수량</div>
            <div style={{ textAlign: "right" }}>단가</div>
            <div style={{ textAlign: "right" }}>합계</div>
            <div />
          </div>
          {items.map((it) => (
            <ItemRow key={it.id} item={it} onUpdate={(p) => onUpdate(it.id, p)} onDelete={() => onDelete(it.id)} />
          ))}
          {showSubtotal && subtotal > 0 ? (
            <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 11, fontWeight: 600, padding: "6px 0 2px", borderTop: "1px solid #EFEFEF", marginTop: 4 }}>
              소계 {fmtWon(subtotal)}
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ fontSize: 11, color: "#B3B3B3", padding: "4px 0" }}>
          {variant === "hardware" ? "다보·나사 등 단품 조립용 철물 (자재에 종속되지 않음)" : "이 자재에 딸린 부속이 없습니다"}
        </div>
      )}

      {/* + 추가 인라인 입력 */}
      {adding ? (
        <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 6, marginTop: 6, alignItems: "center" }}>
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") cancelAdd();
            }}
            placeholder="이름"
            style={inputStyle}
          />
          <input
            value={draft.itemCode}
            onChange={(e) => setDraft((d) => ({ ...d, itemCode: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") cancelAdd(); }}
            placeholder="ITEM_CODE"
            style={inputStyle}
          />
          <input
            type="number" min={0}
            value={draft.quantity}
            onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") cancelAdd(); }}
            placeholder="수량"
            style={{ ...inputStyle, textAlign: "right" }}
          />
          <input
            type="number" min={0}
            value={draft.unitPrice}
            onChange={(e) => setDraft((d) => ({ ...d, unitPrice: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") cancelAdd(); }}
            placeholder="단가"
            style={{ ...inputStyle, textAlign: "right" }}
          />
          <button
            type="button" onClick={commitAdd}
            style={{ height: 24, padding: "0 8px", fontSize: 10, color: "#fff", background: "#282828", border: "none", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}
          >추가</button>
          <button
            type="button" onClick={cancelAdd} title="닫기"
            style={{ width: 22, height: 22, padding: 0, color: "#B3B3B3", background: "transparent", border: "none", cursor: "pointer", fontSize: 12 }}
          >×</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{
            marginTop: 6, padding: "4px 10px", fontSize: 10, color: "#7E7E7E",
            background: "transparent", border: "1px dashed #D6D6D6", borderRadius: 4,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >+ {variant === "hardware" ? "철물 추가" : "부속 추가"}</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 행 (인라인 편집)
// ─────────────────────────────────────────────────────────────

function ItemRow({ item, onUpdate, onDelete }: { item: InlineItem; onUpdate: (p: InlineItemPatch) => void; onDelete: () => void }) {
  const [name, setName] = useState(item.name);
  const [code, setCode] = useState(item.itemCode);
  const [qty, setQty] = useState(String(item.quantity));
  const [unit, setUnit] = useState(String(item.unitPrice));
  const total = item.quantity * item.unitPrice;

  return (
    <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 6, alignItems: "center", padding: "3px 0" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name !== item.name) onUpdate({ name }); }}
        style={inputStyle}
      />
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => { if (code !== item.itemCode) onUpdate({ itemCode: code }); }}
        style={inputStyle}
      />
      <input
        type="number" min={0}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={() => {
          const n = Number(qty) || 0;
          if (n !== item.quantity) onUpdate({ quantity: n });
        }}
        style={{ ...inputStyle, textAlign: "right" }}
      />
      <input
        type="number" min={0}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => {
          const n = Number(unit) || 0;
          if (n !== item.unitPrice) onUpdate({ unitPrice: n });
        }}
        style={{ ...inputStyle, textAlign: "right" }}
      />
      <div style={{ textAlign: "right", fontSize: 11, fontWeight: 500, color: "#282828" }}>{fmtWon(total)}</div>
      <button
        type="button" onClick={onDelete} title="삭제"
        style={{ width: 22, height: 22, padding: 0, color: "#B3B3B3", background: "transparent", border: "none", cursor: "pointer", fontSize: 12 }}
      >×</button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 22, padding: "0 6px", fontSize: 10,
  border: "1px solid #E8E8E8", borderRadius: 3, outline: "none",
  fontFamily: "inherit", fontFeatureSettings: "'tnum' 1", color: "#282828",
  background: "#fff", minWidth: 0,
};

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { useTree, getMaterialsForItem } from "../context/TreeContext";
import { computeMaterial, buildMaterialInput, effectiveYieldPlacementMode } from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import { getMaterial, type BomMaterialData } from "../offline/stores";
import type { MaterialFormState } from "../material/MaterialTab";

export type ProductTabHandle = {
  saveDraft: () => Promise<void>;
  save: () => Promise<void>;
  createNew: () => void;
  openLibrary: () => void;
  loadFromVault: (id: string) => Promise<void>;
};

const SHEET_PRICE_BY_T: Partial<Record<number, Partial<Record<string, number>>>> = {
  12: { "4x8": 16720 },
  15: { "4x6": 14450, "4x8": 19060, "6x8": 27320 },
  18: { "4x6": 16620, "4x8": 21510, "6x8": 30650 },
  22: { "4x8": 24680, "6x8": 35610 },
  25: { "4x8": 6640 },
  28: { "4x8": 29620, "6x8": 42600 },
};

function bomPreset(et: string, es: string): "none" | "abs1t" | "abs2t" | "paint" {
  if (et === "ABS") return es === "4면 2T" ? "abs2t" : "abs1t";
  if (et === "도장") return "paint";
  return "none";
}

function calcMatCost(data: BomMaterialData): number {
  if (data.w <= 0 || data.d <= 0 || data.t <= 0) return 0;
  const prices = SHEET_PRICE_BY_T[data.t] ?? {};
  const sp: Partial<Record<SheetId, number>> = {};
  for (const sid of ["4x6", "4x8", "6x8"] as SheetId[]) {
    if (prices[sid] != null) sp[sid] = prices[sid]!;
  }
  const input = buildMaterialInput({
    wMm: data.w, dMm: data.d, hMm: data.t,
    color: data.color, boardMaterial: data.material,
    placementMode: "default",
    edgePreset: bomPreset(data.edgeType, data.edgeSetting),
    edgeCustomSides: data.edgeCustom ?? { top: 0, bottom: 0, left: 0, right: 0 },
    sheetPrices: sp,
    formingM: 0, rutaM: 0, assemblyHours: 0, washM2: 0,
    boring1Ea: 0, boring2Ea: 0, curvedEdgeM: 0, ruta2M: 0, tenonerMm: 0,
  });
  return computeMaterial(input, null).grandTotalWon;
}

/** StoredMaterial.form 전체로 원가 계산 (보링·가공 포함) */
function calcMatCostFromForm(form: MaterialFormState): number {
  if (form.wMm <= 0 || form.dMm <= 0 || form.hMm <= 0) return 0;
  const input = buildMaterialInput({
    ...form,
    sheetPrices: form.sheetPrices as Partial<Record<SheetId, number>>,
    placementMode: effectiveYieldPlacementMode(
      form.placementMode,
      form.cutOrientation ?? "default",
    ),
  });
  return computeMaterial(
    input,
    (form.selectedSheetId ?? null) as SheetId | null,
  ).grandTotalWon;
}

/** MaterialFormState → BomMaterialData (ProductTab 표시용) */
function formToBomData(form: MaterialFormState): BomMaterialData {
  const presetMap: Record<string, { edgeType: string; edgeSetting: string }> = {
    abs1t:  { edgeType: "ABS",   edgeSetting: "4면 1T" },
    abs2t:  { edgeType: "ABS",   edgeSetting: "4면 2T" },
    paint:  { edgeType: "도장",   edgeSetting: "" },
    custom: { edgeType: "ABS",   edgeSetting: "사용자" },
    none:   { edgeType: "없음",   edgeSetting: "" },
  };
  const { edgeType, edgeSetting } = presetMap[form.edgePreset] ?? presetMap.none;
  return {
    w: form.wMm, d: form.dMm, t: form.hMm,
    material: form.boardMaterial ?? "PB",
    surface:  form.surfaceMaterial ?? "LPM/O",
    color:    form.color ?? "WW",
    edgeType, edgeSetting,
    edgeCustom: form.edgeCustomSides ?? { top: 0, bottom: 0, left: 0, right: 0 },
    processes: [],
  };
}

function roundup5(v: number) {
  return Math.ceil((v * 0.05) / 100) * 100;
}

type HardwareItem = {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  enabled: boolean;
};

export const ProductTab = forwardRef<
  ProductTabHandle,
  {
    active?: boolean;
    quoteBindEntityId?: string | null;
    onQuoteMeta?: (meta: { name: string; grandTotalWon: number }) => void;
    onQuoteEntityRebind?: (entityId: string) => void;
    stripRenameEpoch?: number;
  }
>(function ProductTab({ active = true, onQuoteMeta }, ref) {
  // Hardware items list
  const [hwItems, setHwItems] = useState<HardwareItem[]>([
    { id: "hw_0", name: "별도 철물", qty: 12, unitPrice: 21, enabled: true },
  ]);
  // Add-hardware mini-form state
  const [hwAddName, setHwAddName] = useState("");
  const [hwAddQty, setHwAddQty] = useState(1);
  const [hwAddPrice, setHwAddPrice] = useState(500);
  // Packaging block open/closed
  const [packOpen, setPackOpen] = useState(true);
  // Disabled material IDs (unchecked rows)
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const [, setMsg] = useState<string | null>(null);

  const { treeNodes, activeItem } = useTree();
  const materials = useMemo(() => getMaterialsForItem(treeNodes, activeItem), [treeNodes, activeItem]);
  const name = treeNodes[activeItem]?.name ?? "이름 없음";

  /** 노드의 BomMaterialData 취득 — 없으면 localStorage fallback */
  const resolveMatData = (m: ReturnType<typeof getMaterialsForItem>[number]): BomMaterialData | null => {
    if (m.data) return m.data;
    if (m.id) {
      const stored = getMaterial(m.id);
      if (stored?.form) return formToBomData(stored.form);
    }
    return null;
  };

  // Box dimensions from material data
  const boxDims = useMemo(() => {
    const dims = materials
      .map(resolveMatData)
      .filter((d): d is BomMaterialData => !!d);
    if (dims.length === 0) return { bw: 1220, bd: 620, bh: 50 };
    const bw = Math.max(...dims.map(m => m.w)) + 20;
    const bd = Math.max(...dims.map(m => m.d)) + 20;
    const bh = dims.reduce((s, m) => s + m.t, 0) + 30;
    return { bw, bd, bh };
  }, [materials]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-material costs (보링·가공 포함 전액 계산)
  const matCosts = useMemo(
    () => materials.map(m => {
      const data = resolveMatData(m);
      let cost = 0;
      if (m.id) {
        const stored = getMaterial(m.id);
        if (stored?.form) cost = calcMatCostFromForm(stored.form);
        else if (data) cost = calcMatCost(data);
      } else if (data) {
        cost = calcMatCost(data);
      }
      return { id: m.id ?? "", name: m.name ?? "이름 없음", data, cost };
    }),
    [materials], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Only sum enabled (checked) materials
  const matTotal = useMemo(
    () => matCosts
      .filter(m => !disabledIds.has(m.id))
      .reduce((s, m) => s + m.cost, 0),
    [matCosts, disabledIds]
  );

  // Hardware totals (derived from hwItems)
  const hwCostTotal = useMemo(
    () => hwItems.filter(h => h.enabled).reduce((s, h) => s + h.qty * h.unitPrice, 0),
    [hwItems]
  );
  // hwN kept for right-panel compatibility (shows total qty in "N개 × 21원" label)
  const hwN = useMemo(
    () => hwItems.filter(h => h.enabled).reduce((s, h) => s + h.qty, 0),
    [hwItems]
  );

  // Auto packaging tier based on material count
  const nkVal = useMemo((): number => {
    const n = materials.length;
    if (n <= 2) return 500;
    if (n <= 5) return 1000;
    if (n <= 8) return 1500;
    return 2000;
  }, [materials.length]);

  const boxTierLabel = nkVal === 500 ? "소형 (1~2개)" : nkVal === 1000 ? "중형 (3~5개)" : nkVal === 1500 ? "대형 (6~8개)" : "특대 (9개+)";

  const calc = useMemo(() => {
    const { bw, bd } = boxDims;
    const wash = Math.round(bw * bd / 1e6 * 2 * 250);
    const tape = Math.round(((bw + 100) + (bd + 100) * 2) / 1000 * 15.42);
    const sticker = 6;
    const hwCost = hwCostTotal;
    const nkCost = nkVal;
    const packSub = wash + hwCost + nkCost + tape + sticker;
    const base = matTotal + packSub;
    const overhead = roundup5(base);
    const factory = base + overhead;
    return { hwCost, nkCost, packSub, overhead, factory, wash, tape, sticker };
  }, [hwCostTotal, nkVal, boxDims, matTotal]);

  useEffect(() => {
    onQuoteMeta?.({ name, grandTotalWon: calc.factory });
  }, [name, calc.factory, onQuoteMeta]);

  useImperativeHandle(ref, () => ({
    saveDraft: async () => setMsg("임시저장되었습니다."),
    save: async () => setMsg("저장되었습니다."),
    createNew: () => setMsg(null),
    openLibrary: () => {},
    loadFromVault: async () => setMsg("보관함 불러오기는 새 화면에서 미구현입니다."),
  }), []);

  if (!active) return null;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleMat = (id: string) => {
    setDisabledIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleHw = (id: string) => {
    setHwItems(prev => prev.map(h => h.id === id ? { ...h, enabled: !h.enabled } : h));
  };

  const removeHw = (id: string) => {
    setHwItems(prev => prev.filter(h => h.id !== id));
  };

  const addHw = () => {
    if (!hwAddName.trim()) return;
    setHwItems(prev => [...prev, {
      id: `hw_${Date.now()}`,
      name: hwAddName.trim(),
      qty: hwAddQty,
      unitPrice: hwAddPrice,
      enabled: true,
    }]);
    setHwAddName("");
    setHwAddQty(1);
    setHwAddPrice(500);
  };

  // ── Shared sub-styles ──────────────────────────────────────────────────────
  const sectionLabelStyle: React.CSSProperties = {
    fontSize: "11px", fontWeight: 700, color: "#aaa",
    textTransform: "uppercase", letterSpacing: ".1em",
  };

  return (
    <div className="page active" style={{ display: "flex" }}>
      <div className="item-body">

        {/* ── Left panel — new single-scroll layout ───────────────────────── */}
        <div className="item-left" style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>

          {/* Header */}
          <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
            <div style={{ fontSize: "13px", color: "#888", marginBottom: "4px" }}>{name}</div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: "#1a1a1a", letterSpacing: "-0.02em", lineHeight: 1.15 }}>
              {calc.factory.toLocaleString()}원
            </div>
            <div style={{ fontSize: "11px", color: "#aaa", marginTop: "3px" }}>공장판매가 (자동 계산)</div>
          </div>

          {/* ── Materials table ─────────────────────────────────────────────── */}
          <section style={{ padding: "16px 20px 14px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
            <div style={{ ...sectionLabelStyle, marginBottom: "10px" }}>
              자재{" "}
              <span style={{ color: "#ccc", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                {materials.length}개
              </span>
            </div>

            {matCosts.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#ccc", padding: "10px 0", textAlign: "center" }}>
                등록된 자재가 없습니다
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  <tr style={{ color: "#bbb", borderBottom: "1px solid #f0f0f0" }}>
                    <th style={{ width: "20px", textAlign: "left", paddingBottom: "6px", fontWeight: 500 }}></th>
                    <th style={{ textAlign: "left", paddingBottom: "6px", fontWeight: 500 }}>자재명</th>
                    <th style={{ textAlign: "right", paddingBottom: "6px", fontWeight: 500 }}>규격</th>
                    <th style={{ textAlign: "right", paddingBottom: "6px", fontWeight: 500 }}>소재</th>
                    <th style={{ textAlign: "right", paddingBottom: "6px", fontWeight: 500 }}>가격</th>
                  </tr>
                </thead>
                <tbody>
                  {matCosts.map((m, i) => {
                    const isOff = disabledIds.has(m.id);
                    return (
                      <tr key={i} style={{ opacity: isOff ? 0.35 : 1, transition: "opacity 0.15s" }}>
                        <td style={{ paddingTop: "7px", paddingBottom: "7px", verticalAlign: "middle" }}>
                          <input
                            type="checkbox"
                            checked={!isOff}
                            onChange={() => toggleMat(m.id)}
                            style={{ width: "13px", height: "13px", cursor: "pointer", accentColor: "#1a1a1a" }}
                          />
                        </td>
                        <td style={{ paddingTop: "7px", paddingBottom: "7px", verticalAlign: "middle", fontWeight: 500, color: "#333", fontSize: "12px", maxWidth: "120px" }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                          {m.data?.edgeType && m.data.edgeType !== "없음" && (
                            <div style={{ fontSize: "10px", color: "#bbb", marginTop: "1px" }}>
                              {m.data.edgeType} {m.data.edgeSetting}
                            </div>
                          )}
                        </td>
                        <td style={{ paddingTop: "7px", paddingBottom: "7px", verticalAlign: "middle", textAlign: "right", color: "#888", whiteSpace: "nowrap" }}>
                          {m.data ? `${m.data.w}×${m.data.d}×${m.data.t}T` : "—"}
                        </td>
                        <td style={{ paddingTop: "7px", paddingBottom: "7px", verticalAlign: "middle", textAlign: "right", color: "#888" }}>
                          {m.data?.material ?? "—"}
                        </td>
                        <td style={{ paddingTop: "7px", paddingBottom: "7px", verticalAlign: "middle", textAlign: "right", fontWeight: 600, color: "#1a1a1a", whiteSpace: "nowrap" }}>
                          {m.cost > 0 ? m.cost.toLocaleString() + "원" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* ── Hardware section ─────────────────────────────────────────────── */}
          <section style={{ padding: "16px 20px 14px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
            <div style={{ ...sectionLabelStyle, marginBottom: "10px" }}>철물</div>

            {/* Item list */}
            {hwItems.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "10px" }}>
                {hwItems.map(h => (
                  <div
                    key={h.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      fontSize: "12px", padding: "5px 0",
                      opacity: h.enabled ? 1 : 0.35, transition: "opacity 0.15s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={h.enabled}
                      onChange={() => toggleHw(h.id)}
                      style={{ width: "13px", height: "13px", cursor: "pointer", accentColor: "#1a1a1a", flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.name}
                    </span>
                    <span style={{ color: "#888", flexShrink: 0, fontSize: "11px" }}>
                      {h.qty}개 × ₩{h.unitPrice.toLocaleString()} ={" "}
                      <strong style={{ color: "#555" }}>₩{(h.qty * h.unitPrice).toLocaleString()}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeHw(h.id)}
                      title="삭제"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "#ccc", padding: "0 1px", fontSize: "15px", lineHeight: 1,
                        flexShrink: 0, display: "flex", alignItems: "center",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add hardware mini-form */}
            <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
              <input
                type="text"
                placeholder="철물명"
                value={hwAddName}
                onChange={e => setHwAddName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addHw(); }}
                style={{
                  flex: 2, minWidth: 0, fontSize: "11px",
                  border: "1px solid #e8e8e8", borderRadius: "4px",
                  padding: "4px 7px", outline: "none", background: "#fafafa",
                  fontFamily: "inherit",
                }}
              />
              <input
                type="number"
                value={hwAddQty}
                min={1}
                onChange={e => setHwAddQty(Math.max(1, Number(e.target.value) || 1))}
                title="수량"
                style={{
                  width: "42px", fontSize: "11px",
                  border: "1px solid #e8e8e8", borderRadius: "4px",
                  padding: "4px 4px", outline: "none", background: "#fafafa",
                  textAlign: "center", fontFamily: "inherit",
                }}
              />
              <span style={{ fontSize: "11px", color: "#aaa", flexShrink: 0 }}>×</span>
              <input
                type="number"
                value={hwAddPrice}
                min={0}
                onChange={e => setHwAddPrice(Math.max(0, Number(e.target.value) || 0))}
                title="단가 (원)"
                style={{
                  width: "54px", fontSize: "11px",
                  border: "1px solid #e8e8e8", borderRadius: "4px",
                  padding: "4px 5px", outline: "none", background: "#fafafa",
                  textAlign: "right", fontFamily: "inherit",
                }}
              />
              <span style={{ fontSize: "11px", color: "#aaa", flexShrink: 0 }}>원</span>
              <button
                type="button"
                onClick={addHw}
                style={{
                  fontSize: "11px", fontWeight: 600, color: "#1a1a1a",
                  background: "#f0f0f0", border: "none", borderRadius: "4px",
                  padding: "4px 10px", cursor: "pointer", flexShrink: 0,
                  fontFamily: "inherit",
                }}
              >
                추가
              </button>
            </div>
          </section>

          {/* ── Packaging block (collapsible) ───────────────────────────────── */}
          <section style={{ padding: "0 20px", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setPackOpen(v => !v)}
              style={{
                width: "100%", display: "flex", alignItems: "center",
                justifyContent: "space-between", padding: "14px 0",
                background: "none", border: "none", cursor: "pointer",
                borderBottom: packOpen ? "1px solid #f0f0f0" : "none",
              }}
            >
              <span style={sectionLabelStyle}>포장비</span>
              <svg
                width="8" height="8" viewBox="0 0 8 8" fill="none"
                style={{ transform: packOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", color: "#ccc" }}
              >
                <path d="M2 1L6 4L2 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {packOpen && (
              <div style={{ paddingBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                  <span style={{ color: "#555" }}>
                    세척비
                    <span style={{ fontSize: "10px", color: "#bbb", marginLeft: "4px" }}>자동 계산</span>
                  </span>
                  <span style={{ fontWeight: 500, color: "#333" }}>{calc.wash.toLocaleString()}원</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                  <span style={{ color: "#555" }}>
                    박스 포장
                    <span style={{ fontSize: "10px", color: "#bbb", marginLeft: "4px" }}>{boxTierLabel}</span>
                  </span>
                  <span style={{ fontWeight: 500, color: "#333" }}>{calc.nkCost.toLocaleString()}원</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                  <span style={{ color: "#555" }}>테이프</span>
                  <span style={{ fontWeight: 500, color: "#333" }}>{calc.tape.toLocaleString()}원</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                  <span style={{ color: "#555" }}>스티커</span>
                  <span style={{ fontWeight: 500, color: "#333" }}>{calc.sticker.toLocaleString()}원</span>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ── Right panel: receipt (DO NOT MODIFY) ────────────────────────── */}
        <div className="item-right">
          <div className="rcpt-name">{name}</div>
          <div className="rcpt-total">{calc.factory.toLocaleString()}원</div>

          <div className="rsec">자재별 비용 (자재비+가공비)</div>
          {matCosts.length > 0 ? (
            matCosts.map((m, i) => (
              <div key={i} className="rrow bold">
                <span className="l">{m.name}</span>
                <span className="r">{m.cost.toLocaleString()}원</span>
              </div>
            ))
          ) : (
            <div className="rrow"><span className="l" style={{ color: "#ccc" }}>자재 없음</span><span className="r">0원</span></div>
          )}
          <div className="rsub" style={{ color: "#FF5948" }}>
            <span>자재비 합계</span><span>{matTotal.toLocaleString()}원</span>
          </div>

          <div className="rsec">포장비</div>
          <div className="rrow">
            <span className="l">세척비<small>자동 계산</small></span>
            <span className="r">{calc.wash.toLocaleString()}원</span>
          </div>
          <div className="rrow">
            <span className="l">철물 포장비<small>{hwN}개 × 21원</small></span>
            <span className="r">{calc.hwCost.toLocaleString()}원</span>
          </div>
          <div className="rrow">
            <span className="l">테이프</span>
            <span className="r">{calc.tape.toLocaleString()}원</span>
          </div>
          <div className="rrow">
            <span className="l">스티커</span>
            <span className="r">{calc.sticker.toLocaleString()}원</span>
          </div>
          <div className="rsub" style={{ color: "#FF5948" }}>
            <span>포장비 합계</span><span>{calc.packSub.toLocaleString()}원</span>
          </div>

          <div className="rsec">일반관리비</div>
          <div className="rrow">
            <span className="l">관리비<small>ROUNDUP(합계×5%, -2)</small></span>
            <span className="r">{calc.overhead.toLocaleString()}원</span>
          </div>

          <div className="rdiv" />
          <div className="rsum" style={{ color: "#FF5948" }}>
            <span>공장판매가</span><span>{calc.factory.toLocaleString()}원</span>
          </div>
        </div>
      </div>
    </div>
  );
});

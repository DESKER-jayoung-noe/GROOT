/**
 * 자재 편집 팝업 — 세트편집창에서 ⋯ → '자재 편집하기' 로 진입.
 *
 * 검토하기(ReviewModal) 의 1자재 편집 UI 와 동일한 레이아웃 사용:
 *  - 좌측: 미리보기 (uploadFile 가 있어야만 표시. 없으면 우측 폼이 전체 너비)
 *  - 우측: 치수 / 원장 선택 / 엣지 / 보링 / 가공
 *
 * 저장 시 MaterialFormState 갱신 + computeMaterial 로 grandTotalWon 재산출.
 */
import { useEffect, useMemo, useState } from "react";
import { getMaterial, putMaterial } from "../offline/stores";
import { computeMaterial, buildMaterialInput, effectiveYieldPlacementMode } from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import type { MaterialFormState, MaterialEdgePreset } from "../material/MaterialTab";
import { getSheetPricesForT } from "../lib/sheetPrices";
import { SheetSelector } from "./SheetSelector";

type Props = {
  materialId: string;
  onClose: () => void;
  onSaved: () => void;
};

type ExtraProcType = "forming" | "router" | "ruta2" | "tenoner" | "curvedge" | "custom";

const PROC_TYPES: { key: ExtraProcType; label: string; rate: number }[] = [
  { key: "forming",  label: "포밍",           rate: 1 },
  { key: "router",   label: "일반 루타",       rate: 2 },
  { key: "ruta2",    label: "2차 루타",        rate: 1 },
  { key: "tenoner",  label: "테노너",          rate: 0.8 },
  { key: "curvedge", label: "곡면엣지 머시닝", rate: 3 },
];

const PROC_COLORS: Record<string, string> = {
  forming:  "bg-[#fdf4ff] text-[#9333ea]",
  router:   "bg-[#f0fdf4] text-[#16a34a]",
  curvedge: "bg-[#fff7ed] text-[#ea580c]",
  custom:   "bg-[#eff6ff] text-[#2563eb]",
};

/** 엣지 면 수 (1~4) — edgeSides count */
function countEdgeSides(form: MaterialFormState): number {
  const s = form.edgeSides ?? { top: false, bottom: false, left: false, right: false };
  return [s.top, s.bottom, s.left, s.right].filter(Boolean).length;
}
function edgeStringFromCount(count: number): "없음" | "1면" | "2면" | "3면" | "4면" {
  if (count >= 4) return "4면";
  if (count === 3) return "3면";
  if (count === 2) return "2면";
  if (count === 1) return "1면";
  return "없음";
}
function edgeSidesFromCount(count: number) {
  return {
    top:    count >= 1,
    bottom: count >= 2,
    left:   count >= 3,
    right:  count >= 4,
  };
}
function presetFromEdge(edge: string, edgeT: number): MaterialEdgePreset {
  if (edge === "없음") return "none";
  if (edge === "4면" && edgeT >= 2) return "abs2t";
  if (edge === "4면") return "abs1t";
  return "custom";
}

function fmtWon(n: number): string {
  return `₩${Math.max(0, Math.round(n)).toLocaleString()}`;
}

export function MaterialEditDialog({ materialId, onClose, onSaved }: Props) {
  const stored = getMaterial(materialId);
  const [form, setForm] = useState<MaterialFormState | null>(stored?.form ?? null);

  // 처음 마운트할 때 sheetPrices 가 비어있으면 두께 기준으로 자동 채움
  useEffect(() => {
    if (!form) return;
    if (form.sheetPrices && Object.keys(form.sheetPrices).length > 0) return;
    const auto = getSheetPricesForT(form.hMm || 0);
    if (Object.keys(auto).length > 0) {
      setForm((f) => f ? { ...f, sheetPrices: auto } : f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 실시간 계산
  const computed = useMemo(() => {
    if (!form) return { grandTotalWon: 0, materialCostWon: 0, edgeCostWon: 0, processingTotalWon: 0 };
    try {
      const input = buildMaterialInput({
        ...form,
        placementMode: effectiveYieldPlacementMode(form.placementMode, form.cutOrientation),
        sheetPrices: form.sheetPrices,
      });
      const c = computeMaterial(input, (form.selectedSheetId ?? null) as SheetId | null);
      return {
        grandTotalWon: Math.round(c.grandTotalWon),
        materialCostWon: Math.round(c.materialCostWon),
        edgeCostWon: Math.round(c.edgeCostWon + (c.hotmeltCostWon ?? 0)),
        processingTotalWon: Math.round(c.processingTotalWon),
      };
    } catch {
      return { grandTotalWon: 0, materialCostWon: 0, edgeCostWon: 0, processingTotalWon: 0 };
    }
  }, [form]);

  if (!stored || !form) {
    return (
      <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal>
        <div className="rounded-[8px] bg-white px-6 py-4 text-[12px] text-[#616161]">
          자재를 찾을 수 없습니다.
          <button onClick={onClose} className="ml-3 underline">닫기</button>
        </div>
      </div>
    );
  }

  const edgeCount = countEdgeSides(form);
  const edge = edgeStringFromCount(edgeCount);
  const edgeT = Math.max(form.edgeCustomSides?.top ?? 0, form.edgeCustomSides?.bottom ?? 0, form.edgeCustomSides?.left ?? 0, form.edgeCustomSides?.right ?? 0) || 0;

  const update = (patch: Partial<MaterialFormState>) => {
    setForm((f) => f ? { ...f, ...patch } : f);
  };

  const onChangeEdge = (next: "없음" | "1면" | "2면" | "3면" | "4면") => {
    const count = next === "없음" ? 0 : next === "1면" ? 1 : next === "2면" ? 2 : next === "3면" ? 3 : 4;
    const sides = edgeSidesFromCount(count);
    const _et = edgeT > 0 ? edgeT : count > 0 ? 1 : 0;
    update({
      edgeSides: sides,
      edgeCustomSides: {
        top:    sides.top    ? _et : 0,
        bottom: sides.bottom ? _et : 0,
        left:   sides.left   ? _et : 0,
        right:  sides.right  ? _et : 0,
      },
      edgePreset: presetFromEdge(next, _et),
    });
  };

  const onChangeEdgeT = (t: number) => {
    const sides = form.edgeSides ?? edgeSidesFromCount(edgeCount);
    update({
      edgeCustomSides: {
        top:    sides.top    ? t : 0,
        bottom: sides.bottom ? t : 0,
        left:   sides.left   ? t : 0,
        right:  sides.right  ? t : 0,
      },
      edgePreset: presetFromEdge(edge, t),
    });
  };

  // 추가 가공: extraProcs 같은 배열이 form에 직접 없으니 mm 단위 필드들로 매핑
  // formingM (m), rutaM (m), ruta2M (m), tenonerMm (mm), curvedEdgeM (m)
  const extraProcs: { key: ExtraProcType; label: string; mm: number }[] = (
    [
      { key: "forming"  as const, label: "포밍",           mm: Math.round((form.formingM    ?? 0) * 1000) },
      { key: "router"   as const, label: "일반 루타",       mm: Math.round((form.rutaM       ?? 0) * 1000) },
      { key: "ruta2"    as const, label: "2차 루타",        mm: Math.round((form.ruta2M      ?? 0) * 1000) },
      { key: "tenoner"  as const, label: "테노너",          mm: Math.round(form.tenonerMm    ?? 0) },
      { key: "curvedge" as const, label: "곡면엣지 머시닝", mm: Math.round((form.curvedEdgeM ?? 0) * 1000) },
    ]
  ).filter((p) => p.mm > 0);

  const setProcMm = (key: ExtraProcType, mm: number) => {
    const v = Math.max(0, mm);
    if (key === "forming")  update({ formingM: v / 1000 });
    if (key === "router")   update({ rutaM: v / 1000 });
    if (key === "ruta2")    update({ ruta2M: v / 1000 });
    if (key === "tenoner")  update({ tenonerMm: v });
    if (key === "curvedge") update({ curvedEdgeM: v / 1000 });
  };

  const removeProc = (key: ExtraProcType) => setProcMm(key, 0);

  const [procDropOpen, setProcDropOpen] = useState(false);
  const procOptions = PROC_TYPES.filter((p) => {
    const cur =
      p.key === "forming" ? form.formingM ?? 0
      : p.key === "router" ? form.rutaM ?? 0
      : p.key === "ruta2" ? form.ruta2M ?? 0
      : p.key === "tenoner" ? (form.tenonerMm ?? 0) / 1000
      : p.key === "curvedge" ? form.curvedEdgeM ?? 0
      : 0;
    return cur === 0;
  });

  // 저장
  const onSave = () => {
    if (!form) return;
    let newGrand = 0;
    try {
      const input = buildMaterialInput({
        ...form,
        placementMode: effectiveYieldPlacementMode(form.placementMode, form.cutOrientation),
        sheetPrices: form.sheetPrices,
      });
      const c = computeMaterial(input, (form.selectedSheetId ?? null) as SheetId | null);
      newGrand = Math.round(c.grandTotalWon);
    } catch (e) {
      console.warn("[MaterialEditDialog] compute failed", e);
    }
    putMaterial({
      ...stored,
      name: form.name,
      form,
      grandTotalWon: newGrand,
      summary: `${form.wMm}×${form.dMm}×${form.hMm} mm${newGrand > 0 ? ` · ₩${newGrand.toLocaleString()}` : ""}`,
      updatedAt: new Date().toISOString(),
    });
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/35 p-4 font-['Pretendard',system-ui]"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] flex-col overflow-hidden rounded-[12px] bg-[#fff] shadow-[0_8px_40px_rgba(0,0,0,.13)]"
        style={{ width: "min(720px, 96vw)", fontFamily: "Pretendard, system-ui", fontFeatureSettings: "'tnum' 1" }}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 border-b border-[#f0f0f0] bg-[#FAFAF8] px-[22px] py-3 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <input
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              className="text-[15px] font-semibold text-[#282828] bg-transparent border-none outline-none w-full"
              style={{ letterSpacing: "-0.01em" }}
              placeholder="자재 이름"
            />
            <div className="mt-[2px] text-[11px]" style={{ color: "#7E7E7E", fontFeatureSettings: "'tnum' 1" }}>
              {form.wMm}×{form.dMm}×{form.hMm}T · {edge}{edgeT > 0 ? ` ${edgeT}T` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#7E7E7E" }}>합계</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#282828" }}>{fmtWon(computed.grandTotalWon)}</div>
          </div>
          <button
            type="button"
            className="h-7 w-7 rounded-[4px] text-[20px] leading-none text-[#bbb] hover:bg-[#f5f5f5] hover:text-[#444]"
            onClick={onClose}
          >×</button>
        </div>

        {/* 본문 — 미리보기 없음(stored 자재) → 우측 폼 전체 너비 */}
        <div className="flex-1 overflow-y-auto" style={{ padding: "20px 24px" }}>
          {/* 치수 */}
          <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>치수</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            {(["wMm", "dMm", "hMm"] as const).map((field) => (
              <div key={field} style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, color: "#616161", marginBottom: 6 }}>
                  {field === "wMm" ? "W (mm)" : field === "dMm" ? "D (mm)" : "T (mm)"}
                </label>
                <input
                  type="number"
                  step={field === "hMm" ? 0.5 : 1}
                  value={form[field] || ""}
                  placeholder="0"
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value) || 0;
                    if (field === "hMm") {
                      // 두께 변경 시 sheetPrices 자동 갱신
                      const newPrices = getSheetPricesForT(v);
                      update({ hMm: v, sheetPrices: newPrices, selectedSheetId: null });
                    } else {
                      update({ [field]: v } as Partial<MaterialFormState>);
                    }
                  }}
                  style={{ width: "100%", height: 36, padding: "0 12px", fontSize: 14, color: "#282828", border: "1px solid #D6D6D6", borderRadius: 4, outline: "none", fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }}
                />
              </div>
            ))}
          </div>

          {/* 원장 선택 */}
          <div style={{ marginBottom: 18 }}>
            <SheetSelector
              wMm={form.wMm}
              dMm={form.dMm}
              hMm={form.hMm}
              sheetPrices={form.sheetPrices as Partial<Record<SheetId, number>>}
              selectedSheetId={(form.selectedSheetId ?? null) as SheetId | null}
              placementMode={effectiveYieldPlacementMode(form.placementMode, form.cutOrientation) as "default" | "rotated" | "mixed"}
              onChange={(id) => update({ selectedSheetId: id })}
            />
          </div>

          {/* 엣지 */}
          <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>엣지</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {(["없음", "1면", "2면", "3면", "4면"] as const).map((opt) => {
              const active = edge === opt;
              return (
                <button key={opt} type="button" onClick={() => onChangeEdge(opt)}
                  style={{ flex: 1, height: 32, fontSize: 12, color: active ? "#fff" : "#616161", background: active ? "#282828" : "#fff", border: `1px solid ${active ? "#282828" : "#D6D6D6"}`, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>
                  {opt}
                </button>
              );
            })}
          </div>
          {edge !== "없음" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {[1, 2].map((t) => {
                const active = edgeT === t;
                return (
                  <button key={t} type="button" onClick={() => onChangeEdgeT(t)}
                    style={{ flex: 1, height: 32, fontSize: 12, color: active ? "#fff" : "#616161", background: active ? "#282828" : "#fff", border: `1px solid ${active ? "#282828" : "#D6D6D6"}`, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>
                    {t}T
                  </button>
                );
              })}
            </div>
          )}

          {/* 보링 */}
          <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>보링</div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #F0F0F0" }}>
            <div style={{ fontSize: 13, color: "#282828", fontWeight: 500 }}>일반 보링</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
              <input type="number" min={0} value={form.boring1Ea ?? 0} onChange={(e) => update({ boring1Ea: Number(e.target.value) || 0 })}
                style={{ width: 70, height: 32, padding: "0 10px", fontSize: 13, textAlign: "right", border: "1px solid #D6D6D6", borderRadius: 4, outline: "none", fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }} />
              <span style={{ fontSize: 12, color: "#7E7E7E" }}>개</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #F0F0F0", marginBottom: 18 }}>
            <div style={{ fontSize: 13, color: "#282828", fontWeight: 500 }}>2단 보링</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
              <input type="number" min={0} value={form.boring2Ea ?? 0} onChange={(e) => update({ boring2Ea: Number(e.target.value) || 0 })}
                style={{ width: 70, height: 32, padding: "0 10px", fontSize: 13, textAlign: "right", border: "1px solid #D6D6D6", borderRadius: 4, outline: "none", fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }} />
              <span style={{ fontSize: 12, color: "#7E7E7E" }}>개</span>
            </div>
          </div>

          {/* 추가 가공 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase" }}>추가 가공</div>
            <div style={{ position: "relative" }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); setProcDropOpen((v) => !v); }}
                style={{ padding: "5px 10px", fontSize: 11, color: "#7E7E7E", background: "transparent", border: "1px dashed #D6D6D6", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>
                + 가공 추가
              </button>
              {procDropOpen && (
                <div onClick={(e) => e.stopPropagation()}
                  style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, minWidth: 220, background: "#fff", border: "1px solid #E0E0E0", borderRadius: 6, boxShadow: "0 6px 20px rgba(0,0,0,.10)", zIndex: 10 }}>
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid #F0F0F0", fontSize: 10, fontWeight: 700, color: "#7E7E7E", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    가공 종류 선택
                  </div>
                  {procOptions.length === 0 ? (
                    <div style={{ padding: "10px 14px", fontSize: 11, color: "#B3B3B3" }}>모든 가공이 이미 추가됨</div>
                  ) : procOptions.map((pt) => (
                    <div key={pt.key}
                      onClick={() => { setProcMm(pt.key, 0); setProcDropOpen(false); /* placeholder mm=0; 사용자가 입력 */ }}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", fontSize: 11, color: "#282828", cursor: "pointer" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#F5F5F5"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}>
                      <span style={{ fontWeight: 500 }}>{pt.label}</span>
                      <span style={{ fontSize: 10, color: "#aaa" }}>{pt.rate * 1000}원/m</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 0 18px" }}>
            {extraProcs.length === 0 ? (
              <div style={{ fontSize: 11, color: "#B3B3B3", padding: "4px 0" }}>추가된 가공 없음</div>
            ) : (
              extraProcs.map((ep) => {
                const cls = PROC_COLORS[ep.key] ?? PROC_COLORS.custom;
                return (
                  <span key={ep.key} className={`inline-flex items-center gap-1 rounded-[3px] px-[8px] py-[3px] text-[11px] font-medium ${cls}`}>
                    {ep.label}
                    <input type="number" min={0} value={ep.mm}
                      onChange={(e) => setProcMm(ep.key, Number(e.target.value) || 0)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 50, height: 18, border: "none", borderBottom: "1px solid rgba(0,0,0,.2)", background: "transparent", fontSize: 10, textAlign: "center", outline: "none", margin: "0 4px", fontFamily: "inherit", fontFeatureSettings: "'tnum' 1" }}
                    />
                    <span style={{ fontSize: 9, opacity: 0.7 }}>{ep.key === "tenoner" ? "mm" : "mm"}</span>
                    <button type="button" onClick={() => removeProc(ep.key)}
                      style={{ width: 14, height: 14, border: "none", background: "transparent", padding: 0, marginLeft: 2, fontSize: 11, color: "currentColor", opacity: 0.6, cursor: "pointer" }}
                      title="삭제">×</button>
                  </span>
                );
              })
            )}
          </div>

          {/* 가격 요약 */}
          <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>가격</div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#282828" }}>
            <span>원재료비</span><span>{fmtWon(computed.materialCostWon)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#282828" }}>
            <span>엣지비</span><span>{fmtWon(computed.edgeCostWon)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#282828", borderBottom: "1px solid #F0F0F0", marginBottom: 6 }}>
            <span>가공비</span><span>{fmtWon(computed.processingTotalWon)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", borderTop: "2px solid #282828", fontSize: 14, fontWeight: 700, color: "#282828" }}>
            <span>합계</span><span>{fmtWon(computed.grandTotalWon)}</span>
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 border-t border-[#f0f0f0] bg-[#FAFAF8] px-[22px] py-3 flex-shrink-0">
          <button type="button" onClick={onClose}
            style={{ padding: "7px 14px", fontSize: 12, color: "#616161", background: "transparent", border: "1px solid #D6D6D6", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>
            취소
          </button>
          <button type="button" onClick={onSave}
            style={{ padding: "7px 14px", fontSize: 12, fontWeight: 500, color: "#fff", background: "#282828", border: "1px solid #282828", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * UploadFlow — 도면/모델링 업로드 + 검토 모달 통합 흐름.
 *
 * MainLayout 의 QuoteShell 에 한 번만 마운트되어, 어느 라우트(/material, /set, /product, /parts/...)
 * 에서든 동일한 업로드 동작이 가능하게 한다.
 *
 * 트리거: window.dispatchEvent(new CustomEvent("groot:open-upload"))
 *  - 헤더 [도면/모델링 업로드] 버튼
 *  - SetOnePagePage 자재 풀 패널의 [+ 도면/모델링 업로드]
 *  - MaterialPickerDialog 비어있을 때의 업로드 버튼
 *
 * 등록 완료 후: 첫 번째 자재 탭을 열면서 /material 로 이동 — 사용자가 바로 상세 편집 가능.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuoteTabs } from "../../context/QuoteTabsContext";
import { useTree, type TreeNode } from "../../context/TreeContext";
import {
  type MaterialFormState,
  type MaterialEdgePreset,
} from "../MaterialTab";
import { ReviewModal, type ParsedReviewRow } from "./ReviewModal";
import { UploadModal } from "./UploadModal";
import { putMaterial, newId, type BomMaterialData } from "../../offline/stores";
import { piecesPerSheet, SHEET_SPECS } from "../../lib/yield";
import type { SheetId } from "../../lib/yield";
import {
  computeMaterial,
  buildMaterialInput,
  effectiveYieldPlacementMode,
} from "../../lib/materialCalc";

/** 두께(T) × 원장 사이즈별 장당 단가 — 등록 시 pre-fill 용 (MaterialTab과 동일한 값) */
const _PB_15  = { "4x6": 23270, "4x8": 32800, "6x8": 23270 };
const _PB_18  = { "4x6": 16620, "4x8": 23270, "6x8": 23770 };
const _PB_22  = { "4x8": 19460, "6x8": 23270 };
const _PB_25  = { "4x8": 23270 };
const _PB_28  = { "4x8": 23270, "6x8": 23270 };
const SHEET_PRICES_BY_T: Partial<Record<number, Record<string, number>>> = {
  12: { "4x8": 19460 },
  15: _PB_15,    15.5: _PB_15,
  18: _PB_18,    18.5: _PB_18,
  22: _PB_22,    22.5: _PB_22,
  25: _PB_25,
  28: _PB_28,    28.5: _PB_28,
};

function edgePresetFromRow(row: ParsedReviewRow): MaterialEdgePreset {
  if (row.edge === "없음") return "none";
  if (row.edge === "4면" && row.edgeT >= 2) return "abs2t";
  if (row.edge === "4면") return "abs1t";
  if (row.edge === "3면" || row.edge === "2면" || row.edge === "1면") return "custom";
  return "none";
}

function edgeToBom(edge: ParsedReviewRow["edge"], edgeT: number): { edgeType: string; edgeSetting: string } {
  if (edge === "없음") return { edgeType: "없음", edgeSetting: "" };
  if (edge === "4면") return { edgeType: "ABS", edgeSetting: edgeT >= 2 ? "4면 2T" : "4면 1T" };
  return { edgeType: "ABS", edgeSetting: edge === "3면" ? "3면" : "사용자" };
}

function procMmOfType(row: ParsedReviewRow, type: string): number {
  return row.extraProcs?.find((p) => p.type === type)?.mm ?? 0;
}

/** WW 기준 최저 원가 원장 선택: price / piecesPerSheet 최소값 */
function cheapestSheetId(wMm: number, dMm: number, sheetPrices: Record<string, number>): string | null {
  let bestId: string | null = null;
  let bestCpp = Infinity;
  for (const [id, price] of Object.entries(sheetPrices)) {
    const spec = SHEET_SPECS.find(s => s.id === id);
    if (!spec) continue;
    const n = piecesPerSheet(spec.widthMm, spec.heightMm, wMm, dMm, "default");
    if (n <= 0) continue;
    const cpp = price / n;
    if (cpp < bestCpp) { bestCpp = cpp; bestId = id; }
  }
  return bestId;
}

export function UploadFlow() {
  const { openEntityTab } = useQuoteTabs();
  const { treeNodes, setTreeNodes, setActiveItem } = useTree();
  const nav = useNavigate();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState<ParsedReviewRow[]>([]);
  const [reviewSourceLabel, setReviewSourceLabel] = useState("");

  // 전역 'groot:open-upload' 이벤트 수신 — 어느 라우트에서든 동일하게 모달이 뜬다
  useEffect(() => {
    const handler = () => setUploadOpen(true);
    window.addEventListener("groot:open-upload", handler);
    return () => window.removeEventListener("groot:open-upload", handler);
  }, []);

  /** 검토 모달 [등록] → 트리에 새 세트 + 자재 풀 자재들 추가 */
  const handleRegisterRows = useCallback(
    (rows: ParsedReviewRow[]) => {
      if (rows.length === 0) {
        setReviewOpen(false);
        return;
      }

      const setName = reviewSourceLabel
        ? reviewSourceLabel.replace(/\.[^.]+$/, "").slice(0, 30)
        : `업로드 ${new Date().toLocaleDateString("ko-KR")}`;

      const setId = newId("node");
      const setNode: TreeNode = { id: setId, type: "set", name: setName, depth: 0 };

      const matNodes: TreeNode[] = rows.map((row) => {
        const matId = newId("node");
        const edgePreset = edgePresetFromRow(row);
        const sheetPrices: Record<string, number> = SHEET_PRICES_BY_T[row.T] ?? {};
        // 사용자가 검토 모달에서 원장을 선택했으면 그 값을, 아니면 자동 최저가 픽
        const selectedSheetId = row.selectedSheetId ?? cheapestSheetId(row.W, row.D, sheetPrices);

        const edgeSides =
          row.edge === "1면" ? { top: true,  bottom: false, left: false, right: false }
          : row.edge === "2면" ? { top: true,  bottom: true,  left: false, right: false }
          : row.edge === "3면" ? { top: true,  bottom: true,  left: true,  right: false }
                               : { top: true,  bottom: true,  left: true,  right: true };

        const _et = row.edgeT > 0 ? row.edgeT : 1;
        const edgeCustomSides = {
          top:    edgeSides.top    ? _et : 0,
          bottom: edgeSides.bottom ? _et : 0,
          left:   edgeSides.left   ? _et : 0,
          right:  edgeSides.right  ? _et : 0,
        };

        const { edgeType, edgeSetting } = edgeToBom(row.edge, row.edgeT);

        const procLabels: Record<string, string> = {
          forming: "포밍", router: "일반 루타", ruta2: "2차 루타",
          tenoner: "테노너", curvedge: "곡면엣지 머시닝",
        };
        const processes = row.extraProcs
          .filter((p) => p.mm > 0)
          .map((p) => p.label ?? procLabels[p.type] ?? p.type);

        const form: MaterialFormState = {
          name:            row.name.trim() || "이름 없음",
          partCode:        "",
          wMm:             row.W,
          dMm:             row.D,
          hMm:             row.T,
          color:           "WW",
          boardMaterial:   "PB",
          surfaceMaterial: "LPM/O",
          edgePreset,
          edgeColor:       "WW",
          edgeCustomSides,
          edgeSides,
          placementMode:   "default",
          cutOrientation:  "default",
          showDefault:     true,
          showRotated:     true,
          sheetPrices: sheetPrices as Partial<Record<SheetId, number>>,
          selectedSheetId: selectedSheetId as SheetId | null,
          formingM:        procMmOfType(row, "forming")  / 1000,
          rutaM:           procMmOfType(row, "router")   / 1000,
          assemblyHours:   0,
          washM2:          0,
          boring1Ea:       row.hole1,
          boring2Ea:       row.hole2,
          curvedEdgeM:     procMmOfType(row, "curvedge") / 1000,
          curvedEdgeType:  "",
          edge45TapingM:   0,
          edge45PaintType: "",
          edge45PaintM:    0,
          ruta2M:          procMmOfType(row, "ruta2")    / 1000,
          tenonerMm:       procMmOfType(row, "tenoner"),
          curvedManualMm:  0,
        };

        const data: BomMaterialData = {
          w: row.W, d: row.D, t: row.T,
          material: "PB", surface: "LPM/O", color: "WW",
          edgeType, edgeSetting,
          edgeCustom: edgeCustomSides,
          processes,
        };

        // 등록 시점에 자재비/엣지비/가공비 계산해서 grandTotalWon 채워둠
        // (없으면 자재 풀/단품 카드에서 ₩0 으로 보임)
        let computedGrand = 0;
        try {
          const input = buildMaterialInput({
            ...form,
            placementMode: effectiveYieldPlacementMode(form.placementMode, form.cutOrientation),
            sheetPrices: form.sheetPrices,
          });
          const c = computeMaterial(input, (form.selectedSheetId ?? null) as SheetId | null);
          computedGrand = Math.round(c.grandTotalWon);
        } catch (e) {
          console.warn("[UploadFlow] computeMaterial 실패", row.name, e);
        }

        putMaterial({
          id:            matId,
          name:          form.name,
          status:        "DRAFT",
          updatedAt:     new Date().toISOString(),
          grandTotalWon: computedGrand,
          summary:       `${row.W}×${row.D}×${row.T} mm${computedGrand > 0 ? ` · ₩${computedGrand.toLocaleString()}` : ""}`,
          form,
        });

        return { id: matId, type: "mat" as const, name: form.name, depth: 1, data };
      });

      const divider: TreeNode = { id: newId("node"), type: "divider" };
      const newNodes: TreeNode[] = [...treeNodes, divider, setNode, ...matNodes];
      setTreeNodes(newNodes);

      // 등록 완료 → 새로 만든 세트 탭 + /set (한 페이지 뷰) 로 바로 이동
      const setIdx = newNodes.findIndex((n) => n.id === setId);
      if (setIdx >= 0) setActiveItem(setIdx);
      openEntityTab("set", setId);
      nav("/set");

      setReviewOpen(false);
    },
    [treeNodes, setTreeNodes, setActiveItem, openEntityTab, nav, reviewSourceLabel],
  );

  return (
    <>
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onParsedDone={(rows, sourceLabel) => {
          setReviewRows(rows);
          setReviewSourceLabel(sourceLabel);
          setReviewOpen(true);
        }}
      />
      <ReviewModal
        open={reviewOpen}
        sourceLabel={reviewSourceLabel}
        rows={reviewRows}
        onClose={() => setReviewOpen(false)}
        onBack={() => {
          setReviewOpen(false);
          setUploadOpen(true);
        }}
        onRegister={handleRegisterRows}
      />
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useQuoteTabs } from "../context/QuoteTabsContext";
import { useTree, type TreeNode } from "../context/TreeContext";
import type { QuoteOutletContext } from "../layout/QuoteWorkspaceLayout";
import {
  MaterialTab,
  type MaterialTabHandle,
  type MaterialFormState,
  type MaterialEdgePreset,
} from "../material/MaterialTab";
import { ReviewModal, type ParsedReviewRow } from "../material/quote/ReviewModal";
import { UploadModal } from "../material/quote/UploadModal";
import { putMaterial, newId, type BomMaterialData } from "../offline/stores";
import { piecesPerSheet, SHEET_SPECS } from "../lib/yield";

/** 두께(T) × 원장 사이즈별 장당 단가 — 등록 시 pre-fill 용 (MaterialTab과 동일한 값) */
const SHEET_PRICES_BY_T: Partial<Record<number, Record<string, number>>> = {
  12: { "4x8": 19460 },
  15: { "4x6": 23270, "4x8": 32800, "6x8": 23270 },
  18: { "4x6": 16620, "4x8": 23270, "6x8": 23770 },
  22: { "4x8": 19460, "6x8": 23270 },
  25: { "4x8": 23270 },
  28: { "4x8": 23270, "6x8": 23270 },
};

function edgePresetFromRow(row: ParsedReviewRow): MaterialEdgePreset {
  if (row.edge === "없음") return "none";
  if (row.edge === "4면" && row.edgeT >= 2) return "abs2t";
  if (row.edge === "4면") return "abs1t";
  if (row.edge === "2면" || row.edge === "1면") return "custom";
  return "none";
}

function edgeToBom(edge: ParsedReviewRow["edge"], edgeT: number): { edgeType: string; edgeSetting: string } {
  if (edge === "없음") return { edgeType: "없음", edgeSetting: "" };
  if (edge === "4면") return { edgeType: "ABS", edgeSetting: edgeT >= 2 ? "4면 2T" : "4면 1T" };
  return { edgeType: "ABS", edgeSetting: "사용자" };
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

export function MaterialQuotePage() {
  const { setMaterialBanner } = useOutletContext<QuoteOutletContext>();
  const { tabs, activeTabId, stripRenameEpoch, openEntityTab } = useQuoteTabs();
  const { treeNodes, setTreeNodes, setActiveItem } = useTree();
  const nav = useNavigate();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRows, setReviewRows] = useState<ParsedReviewRow[]>([]);
  const [reviewSourceLabel, setReviewSourceLabel] = useState("");
  const matRef = useRef<MaterialTabHandle>(null);

  const activeRow = useMemo(
    () => (activeTabId ? tabs.find((t) => t.tabId === activeTabId) : null),
    [tabs, activeTabId]
  );
  const materialEntityId = activeRow?.kind === "material" ? activeRow.entityId : null;

  // 헤더의 "도면/모델링 업로드" 버튼이 발행하는 전역 이벤트 수신
  useEffect(() => {
    const handler = () => setUploadOpen(true);
    window.addEventListener("groot:open-upload", handler);
    return () => window.removeEventListener("groot:open-upload", handler);
  }, []);

  /** 검토 모달에서 [선택 항목 등록하기] 클릭 → 사이드바 트리에 세트 > 단품 > 자재 추가 */
  const handleRegisterRows = useCallback(
    (rows: ParsedReviewRow[]) => {
      if (rows.length === 0) {
        setReviewOpen(false);
        return;
      }

      // 세트 이름: 소스 파일명 기반 (확장자 제거, 최대 30자)
      const setName = reviewSourceLabel
        ? reviewSourceLabel.replace(/\.[^.]+$/, "").slice(0, 30)
        : `업로드 ${new Date().toLocaleDateString("ko-KR")}`;

      const setId  = newId("node");
      const itemId = newId("node");

      const setNode:  TreeNode = { id: setId,  type: "set",  name: setName,         depth: 0 };
      const itemNode: TreeNode = { id: itemId, type: "item", name: "단품 (미분류)", depth: 0 };

      // 각 파싱 행 → StoredMaterial 생성 + TreeNode
      const matNodes: TreeNode[] = rows.map((row) => {
        const matId      = newId("node");
        const edgePreset = edgePresetFromRow(row);
        const sheetPrices: Record<string, number> = SHEET_PRICES_BY_T[row.T] ?? {};
        // WW 기준 최저가 원장 자동 선택
        const selectedSheetId = cheapestSheetId(row.W, row.D, sheetPrices);

        // 2면/1면 엣지는 custom preset으로 side 정보 세팅
        const edgeSides = row.edge === "2면"
          ? { top: true, bottom: true, left: false, right: false }
          : { top: true, bottom: true, left: true, right: true };

        const { edgeType, edgeSetting } = edgeToBom(row.edge, row.edgeT);

        // extraProcs → 가공명 목록
        const procLabels: Record<string, string> = {
          forming: "포밍", router: "일반 루타", ruta2: "2차 루타",
          tenoner: "테노너", curvedge: "곡면엣지 머시닝",
        };
        const processes = row.extraProcs
          .filter(p => p.mm > 0)
          .map(p => p.label ?? procLabels[p.type] ?? p.type);

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
          edgeCustomSides: { top: 0, bottom: 0, left: 0, right: 0 },
          edgeSides,
          placementMode:   "default",
          cutOrientation:  "default",
          showDefault:     true,
          showRotated:     true,
          sheetPrices,
          selectedSheetId,
          // 가공: extraProcs mm값 → 폼 m 단위 (tenonerMm만 mm 단위 유지)
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

        // BomMaterialData — ProductTab / 세트뷰에서 즉시 사용
        const data: BomMaterialData = {
          w: row.W, d: row.D, t: row.T,
          material: "PB", surface: "LPM/O", color: "WW",
          edgeType, edgeSetting,
          edgeCustom: { top: 0, bottom: 0, left: 0, right: 0 },
          processes,
        };

        putMaterial({
          id:            matId,
          name:          form.name,
          status:        "DRAFT",
          updatedAt:     new Date().toISOString(),
          grandTotalWon: 0,
          summary:       `${row.W}×${row.D}×${row.T} mm`,
          form,
        });

        return { id: matId, type: "mat" as const, name: form.name, depth: 1, data };
      });

      // 구분선 + 새 세트 + 단품 + 자재들을 트리 끝에 추가
      const divider: TreeNode  = { id: newId("node"), type: "divider" };
      const newNodes: TreeNode[] = [...treeNodes, divider, setNode, itemNode, ...matNodes];
      setTreeNodes(newNodes);

      // 첫 번째 자재를 사이드바에서 선택 + 탭으로 열기
      const firstMat = matNodes[0];
      if (firstMat?.id) {
        const firstIdx = newNodes.findIndex((n) => n.id === firstMat.id);
        if (firstIdx >= 0) setActiveItem(firstIdx);
        openEntityTab("material", firstMat.id);
        nav("/material");
      }

      setReviewOpen(false);
    },
    [treeNodes, setTreeNodes, setActiveItem, openEntityTab, nav, reviewSourceLabel]
  );

  return (
    <>
      <div className="quote-mat-editor-root flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#F6F7F9]">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-row justify-start overflow-hidden">
          <aside className="quote-edit-pane quote-mat-editor-solo flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              <MaterialTab
                ref={matRef}
                key={materialEntityId}
                stripRenameEpoch={stripRenameEpoch}
                active
                quoteBindEntityId={materialEntityId}
                quoteHideRightPanel
                quoteEditorChrome
                onBannerMessage={setMaterialBanner}
              />
            </div>
          </aside>
        </div>
      </div>

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

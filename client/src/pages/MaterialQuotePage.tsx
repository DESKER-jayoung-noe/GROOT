import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuoteTabs } from "../context/QuoteTabsContext";
import type { QuoteOutletContext } from "../layout/QuoteWorkspaceLayout";
import { MaterialQuoteTableView } from "../material/MaterialQuoteTableView";
import { MaterialTab, type MaterialTabHandle } from "../material/MaterialTab";
import { ReviewModal, type ParsedReviewRow } from "../material/quote/ReviewModal";
import { UploadModal } from "../material/quote/UploadModal";

export function MaterialQuotePage() {
  const { setMaterialBanner } = useOutletContext<QuoteOutletContext>();
  const { tabs, activeTabId, openEntityTab } = useQuoteTabs();
  const [listMode, setListMode] = useState(false);
  const [reloadSignal, setReloadSignal] = useState(0);
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

  /** 왼쪽에서 자재/탭을 바꾸면 항상 편집기로(요약이 아닌) */
  useEffect(() => {
    if (activeRow?.kind === "material") setListMode(false);
  }, [activeTabId, activeRow?.entityId, activeRow?.kind]);

  const goEditMaterial = useCallback(
    (id: string) => {
      openEntityTab("material", id);
      setListMode(false);
    },
    [openEntityTab]
  );

  const showTable =
    listMode || materialEntityId == null;

  const handleRegisterRows = useCallback((rows: ParsedReviewRow[]) => {
    if (rows.length === 0) {
      setReviewOpen(false);
      return;
    }
    const first = rows[0];
    matRef.current?.applyDimensionsMm(first.W, first.D, first.T);
    if (first.name.trim()) {
      matRef.current?.setMaterialName(first.name.trim());
    }
    setReviewOpen(false);
  }, []);

  if (showTable) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
        {materialEntityId ? (
          <div
            className="flex shrink-0 items-center justify-end gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <button type="button" className="quote-btn-sm quote-btn-sm--primary" onClick={() => setListMode(false)}>
              자재 편집으로
            </button>
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <MaterialQuoteTableView
            reloadSignal={reloadSignal}
            hideInlineMaterialDetail
            selectedMaterialId={activeRow?.kind === "material" ? activeRow.entityId : null}
            onEditMaterial={goEditMaterial}
            onAfterChange={() => setReloadSignal((n) => n + 1)}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="quote-mat-editor-root flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#F6F7F9]">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-row justify-start overflow-hidden">
          <aside className="quote-edit-pane quote-mat-editor-solo flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              <MaterialTab
                ref={matRef}
                key={materialEntityId}
                stripRenameEpoch={0}
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

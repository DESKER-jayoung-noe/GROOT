import { useCallback, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { QuoteOutletContext } from "../layout/QuoteWorkspaceLayout";
import { MaterialQuoteTableView } from "../material/MaterialQuoteTableView";
import { MaterialTab } from "../material/MaterialTab";

export function MaterialQuotePage() {
  const { setMaterialBanner } = useOutletContext<QuoteOutletContext>();
  const [editorId, setEditorId] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);

  const noop = useCallback(() => {}, []);

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
        <MaterialQuoteTableView
          reloadSignal={reloadSignal}
          onEditMaterial={(id) => setEditorId(id)}
          onAfterChange={() => setReloadSignal((n) => n + 1)}
        />
      </div>

      {editorId ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditorId(null);
              setReloadSignal((n) => n + 1);
            }
          }}
        >
          <div
            className="flex h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden"
            style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)" }}
            role="dialog"
            aria-modal
            aria-labelledby="mat-editor-title"
          >
            <div
              className="flex shrink-0 items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
            >
              <span id="mat-editor-title" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text1)" }}>
                자재 수정
              </span>
              <button
                type="button"
                style={{ padding: "6px 14px", borderRadius: "var(--radius-sm)", fontSize: "13px", fontWeight: 500, border: "1px solid var(--border2)", background: "white", cursor: "pointer", color: "var(--text2)" }}
                onClick={() => {
                  setEditorId(null);
                  setReloadSignal((n) => n + 1);
                }}
              >
                닫기
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MaterialTab
                key={editorId}
                stripRenameEpoch={0}
                active
                quoteBindEntityId={editorId}
                quoteHideRightPanel
                onQuoteMeta={noop}
                onBannerMessage={setMaterialBanner}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

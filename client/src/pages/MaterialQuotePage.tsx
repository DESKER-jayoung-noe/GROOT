/**
 * MaterialQuotePage — /material 라우트.
 *
 * 자재 편집기(MaterialTab) 만 렌더. 업로드/검토 흐름은 MainLayout 의 UploadFlow 가
 * 담당하므로 여기서는 더 이상 모달/이벤트 리스너를 가지지 않는다.
 * (도면/모델링 업로드를 어떤 라우트에서 트리거하든 같은 모달이 열림)
 */
import { useMemo, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuoteTabs } from "../context/QuoteTabsContext";
import type { QuoteOutletContext } from "../layout/QuoteWorkspaceLayout";
import {
  MaterialTab,
  type MaterialTabHandle,
} from "../material/MaterialTab";

export function MaterialQuotePage() {
  const { setMaterialBanner } = useOutletContext<QuoteOutletContext>();
  const { tabs, activeTabId, stripRenameEpoch } = useQuoteTabs();
  const matRef = useRef<MaterialTabHandle>(null);

  const activeRow = useMemo(
    () => (activeTabId ? tabs.find((t) => t.tabId === activeTabId) : null),
    [tabs, activeTabId],
  );
  const materialEntityId = activeRow?.kind === "material" ? activeRow.entityId : null;

  return (
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
  );
}

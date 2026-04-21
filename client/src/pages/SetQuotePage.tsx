import { useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useQuoteTabs } from "../context/QuoteTabsContext";
import { SetTab } from "../set/SetTab";
import { quotePathForKind } from "../quote/quotePaths";

export function SetQuotePage() {
  const { activeTabId, tabs, handleQuoteEntityRebind, updateTabLabel, stripRenameEpoch } = useQuoteTabs();
  const active = activeTabId ? tabs.find((t) => t.tabId === activeTabId) : undefined;

  const onQuoteMeta = useCallback(
    (meta: { name: string; grandTotalWon: number }) => {
      if (activeTabId) updateTabLabel(activeTabId, meta);
    },
    [activeTabId, updateTabLabel]
  );

  if (!active) return null;
  if (active.kind !== "set") {
    return <Navigate to={quotePathForKind(active.kind)} replace />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetTab
        key={active.tabId}
        stripRenameEpoch={stripRenameEpoch}
        active
        quoteBindEntityId={active.entityId}
        onQuoteEntityRebind={handleQuoteEntityRebind}
        onQuoteMeta={onQuoteMeta}
      />
    </div>
  );
}

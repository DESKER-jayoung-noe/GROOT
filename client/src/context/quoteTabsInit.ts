import {
  createEmptyMaterialEntity,
  createEmptyProductEntity,
  createEmptySetEntity,
} from "../offline/stores";
import { loadQuoteTabs, newTabId, saveQuoteTabs, type QuoteKind, type QuoteTabRow } from "../offline/addQuoteTabs";
import { labelForTabRow, type TabLabel } from "./quoteTabsLabels";

export function initialQuotePack(projectId: string): {
  tabs: QuoteTabRow[];
  activeTabId: string;
  tabLabels: Record<string, TabLabel>;
} {
  const existing = loadQuoteTabs(projectId);
  if (existing && existing.tabs.length > 0) {
    const active =
      existing.activeTabId && existing.tabs.some((t) => t.tabId === existing.activeTabId)
        ? existing.activeTabId
        : existing.tabs[0].tabId;
    const tabLabels: Record<string, TabLabel> = {};
    for (const t of existing.tabs) {
      tabLabels[t.tabId] = labelForTabRow(t);
    }
    saveQuoteTabs(projectId, { tabs: existing.tabs, activeTabId: active });
    return { tabs: existing.tabs, activeTabId: active, tabLabels };
  }
  const entityId = createEmptyMaterialEntity();
  const tabId = newTabId();
  const tabs: QuoteTabRow[] = [{ tabId, kind: "material", entityId }];
  const tabLabels: Record<string, TabLabel> = {};
  for (const t of tabs) {
    tabLabels[t.tabId] = labelForTabRow(t);
  }
  saveQuoteTabs(projectId, { tabs, activeTabId: tabId });
  return { tabs, activeTabId: tabId, tabLabels };
}

export function defaultTabRow(kind: QuoteKind = "material"): QuoteTabRow {
  let entityId: string;
  if (kind === "material") entityId = createEmptyMaterialEntity();
  else if (kind === "product") entityId = createEmptyProductEntity();
  else entityId = createEmptySetEntity();
  return { tabId: newTabId(), kind, entityId };
}

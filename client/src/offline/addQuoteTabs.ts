import { newId } from "./stores";

export type QuoteKind = "material" | "product" | "set";

export type QuoteTabRow = {
  tabId: string;
  kind: QuoteKind;
  entityId: string;
};

export function storageKeyAddTabs(projectId: string) {
  return `groot_add_tabs__${projectId}`;
}

export function loadQuoteTabs(projectId: string): { tabs: QuoteTabRow[]; activeTabId: string | null } | null {
  try {
    const raw = localStorage.getItem(storageKeyAddTabs(projectId));
    if (!raw) return null;
    const p = JSON.parse(raw) as { tabs?: QuoteTabRow[]; activeTabId?: string | null };
    if (!p.tabs || !Array.isArray(p.tabs) || p.tabs.length === 0) return null;
    return { tabs: p.tabs, activeTabId: p.activeTabId ?? null };
  } catch {
    return null;
  }
}

export function saveQuoteTabs(projectId: string, state: { tabs: QuoteTabRow[]; activeTabId: string | null }) {
  localStorage.setItem(storageKeyAddTabs(projectId), JSON.stringify(state));
}

export function newTabId() {
  return newId("tab");
}

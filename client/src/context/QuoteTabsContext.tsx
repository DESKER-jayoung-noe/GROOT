import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useProject } from "./ProjectContext";
import {
  applyQuoteEntityName,
  createEmptyMaterialEntity,
} from "../offline/stores";
import { newTabId, saveQuoteTabs, type QuoteKind, type QuoteTabRow } from "../offline/addQuoteTabs";
import { labelForTabRow, type TabLabel } from "./quoteTabsLabels";
import { defaultTabRow, initialQuotePack } from "./quoteTabsInit";

export type { QuoteKind, QuoteTabRow };
export type { TabLabel };
export { kindLabel } from "./quoteTabsLabels";

function persistState(projectId: string, tabs: QuoteTabRow[], activeTabId: string | null) {
  saveQuoteTabs(projectId, { tabs, activeTabId });
}

function applyEntityName(kind: QuoteKind, entityId: string, rawName: string) {
  applyQuoteEntityName(kind, entityId, rawName);
}

type Ctx = {
  tabs: QuoteTabRow[];
  activeTabId: string | null;
  tabLabels: Record<string, TabLabel>;
  /** 견적 리스트에서 활성 탭 이름을 바꿀 때 MaterialTab 등이 폼 이름과 동기화 */
  stripRenameEpoch: number;
  setActiveTabId: (id: string) => void;
  addTab: (kind?: QuoteKind) => void;
  closeTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  renameTabEntity: (tabId: string, name: string) => void;
  updateTabLabel: (tabId: string, meta: TabLabel) => void;
  handleQuoteEntityRebind: (entityId: string) => void;
  /** 기존 탭이 있으면 활성화만, 없으면 해당 entityId로 탭을 추가 */
  openEntityTab: (kind: QuoteKind, entityId: string) => void;
  /** 해당 entity를 연 탭을 모두 닫기(삭제 시) */
  closeTabsForEntity: (kind: QuoteKind, entityId: string) => void;
  refreshLabels: () => void;
};

const QuoteTabsContext = createContext<Ctx | null>(null);

function QuoteTabsStateProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [tabs, setTabs] = useState<QuoteTabRow[]>(() => initialQuotePack(projectId).tabs);
  const [activeTabId, setActiveTabIdState] = useState<string | null>(() => initialQuotePack(projectId).activeTabId);
  const [tabLabels, setTabLabels] = useState<Record<string, TabLabel>>(() => initialQuotePack(projectId).tabLabels);
  const [stripRenameEpoch, setStripRenameEpoch] = useState(0);

  // key={projectId}로 래퍼를 리마운트하지 않고 동기화 — 그렇지 않으면 activeProjectId 변경 시 전체가 리마운트되어 QuoteShell(프로젝트 패널 열림)이 초기화됨
  useEffect(() => {
    const pack = initialQuotePack(projectId);
    setTabs(pack.tabs);
    setActiveTabIdState(pack.activeTabId);
    setTabLabels(pack.tabLabels);
    setStripRenameEpoch(0);
  }, [projectId]);

  const hydrateLabels = useCallback((rows: QuoteTabRow[]) => {
    const next: Record<string, TabLabel> = {};
    for (const t of rows) {
      next[t.tabId] = labelForTabRow(t);
    }
    setTabLabels(next);
  }, []);

  const setActiveTabId = useCallback(
    (id: string) => {
      setActiveTabIdState(id);
      setTabs((prev) => {
        persistState(projectId, prev, id);
        return prev;
      });
    },
    [projectId]
  );

  const addTab = useCallback(
    (kind: QuoteKind = "material") => {
      const row = defaultTabRow(kind);
      setTabs((prev) => {
        const next = [...prev, row];
        persistState(projectId, next, row.tabId);
        hydrateLabels(next);
        return next;
      });
      setActiveTabIdState(row.tabId);
    },
    [projectId, hydrateLabels]
  );

  const openEntityTab = useCallback(
    (kind: QuoteKind, entityId: string) => {
      setTabs((prev) => {
        const hit = prev.find((t) => t.kind === kind && t.entityId === entityId);
        if (hit) {
          persistState(projectId, prev, hit.tabId);
          setActiveTabIdState(hit.tabId);
          return prev;
        }
        const row: QuoteTabRow = { tabId: newTabId(), kind, entityId };
        const next = [...prev, row];
        persistState(projectId, next, row.tabId);
        hydrateLabels(next);
        setActiveTabIdState(row.tabId);
        return next;
      });
    },
    [projectId, hydrateLabels]
  );

  const closeTabsForEntity = useCallback(
    (kind: QuoteKind, entityId: string) => {
      setTabs((prev) => {
        const toClose = prev
          .filter((t) => t.kind === kind && t.entityId === entityId)
          .map((t) => t.tabId);
        if (toClose.length === 0) return prev;
        const next = prev.filter((t) => t.kind !== kind || t.entityId !== entityId);
        if (next.length === 0) {
          const eid = createEmptyMaterialEntity();
          const tid = newTabId();
          const row: QuoteTabRow[] = [{ tabId: tid, kind: "material", entityId: eid }];
          persistState(projectId, row, tid);
          setActiveTabIdState(tid);
          hydrateLabels(row);
          return row;
        }
        const closedActive = activeTabId != null && toClose.includes(activeTabId);
        let newActive = activeTabId;
        if (closedActive) {
          const i = prev.findIndex((t) => t.tabId === activeTabId);
          const adj = next[Math.max(0, i - 1)] ?? next[0];
          newActive = adj.tabId;
          setActiveTabIdState(adj.tabId);
        }
        persistState(projectId, next, closedActive ? newActive! : activeTabId!);
        hydrateLabels(next);
        return next;
      });
    },
    [projectId, activeTabId, hydrateLabels]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.tabId !== tabId);
        if (next.length === 0) {
          const entityId = createEmptyMaterialEntity();
          const tid = newTabId();
          const row: QuoteTabRow[] = [{ tabId: tid, kind: "material", entityId }];
          persistState(projectId, row, tid);
          setActiveTabIdState(tid);
          hydrateLabels(row);
          return row;
        }
        const closingActive = activeTabId === tabId;
        let newActive = activeTabId;
        if (closingActive) {
          const i = prev.findIndex((t) => t.tabId === tabId);
          const adj = next[Math.max(0, i - 1)] ?? next[0];
          newActive = adj.tabId;
          setActiveTabIdState(adj.tabId);
        }
        persistState(projectId, next, closingActive ? newActive! : activeTabId!);
        hydrateLabels(next);
        return next;
      });
    },
    [projectId, activeTabId, hydrateLabels]
  );

  const reorderTabs = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      setTabs((prev) => {
        const next = [...prev];
        const [m] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, m);
        persistState(projectId, next, activeTabId);
        return next;
      });
    },
    [projectId, activeTabId]
  );

  const renameTabEntity = useCallback(
    (tabId: string, name: string) => {
      const t = tabs.find((x) => x.tabId === tabId);
      if (!t) return;
      applyEntityName(t.kind, t.entityId, name);
      const lab = labelForTabRow(t);
      setTabLabels((prev) => ({ ...prev, [tabId]: lab }));
      if (tabId === activeTabId) setStripRenameEpoch((n) => n + 1);
    },
    [tabs, activeTabId]
  );

  const updateTabLabel = useCallback((tabId: string, meta: TabLabel) => {
    setTabLabels((prev) => ({ ...prev, [tabId]: meta }));
  }, []);

  const handleQuoteEntityRebind = useCallback(
    (entityId: string) => {
      if (!activeTabId) return;
      setTabs((prev) => {
        const next = prev.map((t) => (t.tabId === activeTabId ? { ...t, entityId } : t));
        persistState(projectId, next, activeTabId);
        hydrateLabels(next);
        return next;
      });
    },
    [projectId, activeTabId, hydrateLabels]
  );

  const refreshLabels = useCallback(() => {
    hydrateLabels(tabs);
  }, [tabs, hydrateLabels]);

  const value = useMemo<Ctx>(
    () => ({
      tabs,
      activeTabId,
      tabLabels,
      stripRenameEpoch,
      setActiveTabId,
      addTab,
      closeTab,
      reorderTabs,
      renameTabEntity,
      updateTabLabel,
      handleQuoteEntityRebind,
      openEntityTab,
      closeTabsForEntity,
      refreshLabels,
    }),
    [
      tabs,
      activeTabId,
      tabLabels,
      stripRenameEpoch,
      setActiveTabId,
      addTab,
      openEntityTab,
      closeTabsForEntity,
      closeTab,
      reorderTabs,
      renameTabEntity,
      updateTabLabel,
      handleQuoteEntityRebind,
      refreshLabels,
    ]
  );

  return <QuoteTabsContext.Provider value={value}>{children}</QuoteTabsContext.Provider>;
}

export function QuoteTabsProvider({ children }: { children: ReactNode }) {
  const { activeProjectId } = useProject();
  return <QuoteTabsStateProvider projectId={activeProjectId}>{children}</QuoteTabsStateProvider>;
}

export function useQuoteTabs() {
  const c = useContext(QuoteTabsContext);
  if (!c) throw new Error("useQuoteTabs requires QuoteTabsProvider");
  return c;
}

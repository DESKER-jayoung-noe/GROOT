import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Ctx = {
  /** 탭 줄에 경로(프로젝트/…) 표시: 드로어를 쓰는 레이아웃에선 true */
  quoteSidebarCollapsed: boolean;
  openProjectPanel: () => void;
  closeProjectPanel: () => void;
  projectPanelOpen: boolean;
};

const QuoteShellContext = createContext<Ctx | null>(null);

export function QuoteShellProvider({
  children,
  quoteSidebarCollapsed: _quoteSidebarCollapsed,
}: {
  children: ReactNode;
  quoteSidebarCollapsed: boolean;
}) {
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const value = useMemo<Ctx>(
    () => ({
      quoteSidebarCollapsed: true,
      projectPanelOpen,
      openProjectPanel: () => setProjectPanelOpen(true),
      closeProjectPanel: () => setProjectPanelOpen(false),
    }),
    [projectPanelOpen]
  );
  return <QuoteShellContext.Provider value={value}>{children}</QuoteShellContext.Provider>;
}

export function useQuoteShell(): Ctx | null {
  return useContext(QuoteShellContext);
}

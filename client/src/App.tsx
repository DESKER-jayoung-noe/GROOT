import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider } from "./auth";
import { CompareModalRoot, openCompareModal } from "./components/CompareModal";
import { MainLayout } from "./layout/MainLayout";
import { QuoteWorkspaceLayout } from "./layout/QuoteWorkspaceLayout";
import { AddPage } from "./pages/AddPage";
import { MaterialQuotePage } from "./pages/MaterialQuotePage";
import { ProductQuotePage } from "./pages/ProductQuotePage";
// PR2: SetQuotePage → SetOnePagePage 로 교체. 기존 컴포넌트는 .backup-pr2-start/SetQuotePage.tsx 보존.
import { SetOnePagePage } from "./pages/SetOnePagePage";
import { ArchivePage } from "./pages/ArchivePage";
import { AdminDbPage } from "./pages/AdminDbPage";
import { PartCardPage } from "./pages/PartCardPage";

function LegacyCompareRoute() {
  const nav = useNavigate();
  useEffect(() => {
    openCompareModal();
    nav("/material", { replace: true });
  }, [nav]);
  return null;
}

export function App() {
  return (
    <AuthProvider>
      <CompareModalRoot />
      <Routes>
        <Route path="/login" element={<Navigate to="/material" replace />} />
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/material" replace />} />
          <Route path="add" element={<AddPage />} />
          <Route element={<QuoteWorkspaceLayout />}>
            <Route path="material" element={<MaterialQuotePage />} />
            <Route path="product" element={<ProductQuotePage />} />
            <Route path="set" element={<SetOnePagePage />} />
            <Route path="parts/:partId" element={<PartCardPage />} />
            <Route path="compare" element={<LegacyCompareRoute />} />
          </Route>
          <Route path="archive" element={<ArchivePage />} />
          <Route path="admin/db" element={<AdminDbPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/material" replace />} />
      </Routes>
    </AuthProvider>
  );
}

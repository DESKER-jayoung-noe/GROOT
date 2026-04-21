import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { MainLayout } from "./layout/MainLayout";
import { QuoteWorkspaceLayout } from "./layout/QuoteWorkspaceLayout";
import { AddPage } from "./pages/AddPage";
import { MaterialQuotePage } from "./pages/MaterialQuotePage";
import { ProductQuotePage } from "./pages/ProductQuotePage";
import { SetQuotePage } from "./pages/SetQuotePage";
import { ComparePage } from "./pages/ComparePage";
import { ArchivePage } from "./pages/ArchivePage";
import { AdminDbPage } from "./pages/AdminDbPage";

function Protected({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <MainLayout />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/material" replace />} />
          <Route path="add" element={<AddPage />} />
          <Route element={<QuoteWorkspaceLayout />}>
            <Route path="material" element={<MaterialQuotePage />} />
            <Route path="product" element={<ProductQuotePage />} />
            <Route path="set" element={<SetQuotePage />} />
            <Route path="compare" element={<ComparePage />} />
          </Route>
          <Route path="archive" element={<ArchivePage />} />
          <Route path="admin/db" element={<AdminDbPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/material" replace />} />
      </Routes>
    </AuthProvider>
  );
}

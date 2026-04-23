import { Outlet, useLocation } from "react-router-dom";

export type QuoteOutletContext = {
  setMaterialBanner: (m: string | null) => void;
};

function getBreadcrumb(pathname: string): string {
  if (pathname === "/material" || pathname.startsWith("/material/")) return "자재 편집";
  if (pathname === "/product" || pathname.startsWith("/product/")) return "단품 편집";
  if (pathname === "/set" || pathname.startsWith("/set/")) return "세트 대시보드";
  return "편집";
}

export function QuoteWorkspaceLayout() {
  const loc = useLocation();
  const breadcrumb = getBreadcrumb(loc.pathname);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Sub-header */}
      <div className="sub-header">
        <span className="sub-breadcrumb">{breadcrumb}</span>
        <span className="sub-sep">/</span>
        <span className="sub-title">이름 없음</span>
      </div>

      {/* Page content */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Outlet
          context={
            {
              setMaterialBanner: () => {},
            } satisfies QuoteOutletContext
          }
        />
      </div>
    </div>
  );
}

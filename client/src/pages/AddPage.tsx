import { Navigate } from "react-router-dom";

/** 예전 `/add` 링크 호환 */
export function AddPage() {
  return <Navigate to="/material" replace />;
}

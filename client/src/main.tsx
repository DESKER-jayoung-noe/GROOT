import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter as BrowserRouter } from "react-router-dom";
import "./index.css";
import { App } from "./App";

class RootErrorBoundary extends Component<{ children: ReactNode }, { msg: string | null }> {
  state: { msg: string | null } = { msg: null };

  static getDerivedStateFromError(err: unknown): { msg: string } {
    return { msg: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(err, info.componentStack);
  }

  render() {
    if (this.state.msg) {
      return (
        <div style={{ padding: 28, fontFamily: "system-ui, sans-serif", maxWidth: 560, lineHeight: 1.55, color: "#191f28" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 10px" }}>실행 중 오류</h1>
          <p style={{ margin: "0 0 12px", wordBreak: "break-word" }}>{this.state.msg}</p>
          <p style={{ margin: 0, fontSize: 14, color: "#4e5968" }}>
            개발 모드라면 <code>npm run dev</code>로 서버를 연 뒤 다시 열어 주세요. 단일 HTML은 <code>file://</code>보다 <code>npm run preview</code> 등 HTTP로 여는 것을 권장합니다.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

const el = document.getElementById("root");
if (!el) throw new Error("#root 요소가 없습니다.");

createRoot(el).render(
  <StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>
);
el.setAttribute("data-groot-mounted", "1");

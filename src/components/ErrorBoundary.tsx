import { Button } from "./Button";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

// 渲染与路由加载异常的独立恢复页，不依赖可能已失败的业务上下文。
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught React render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const english = document.documentElement.lang.toLowerCase().startsWith("en");
    return (
      <main className="status-page fatal-error" role="alert">
        <span className="status-kicker">YINGWU · RECOVERY</span>
        <h1>{english ? "This page cannot be displayed" : "页面暂时无法显示"}</h1>
        <p>{english
          ? "The interface encountered an error. Reload this page or return home and try again."
          : "界面加载时遇到异常。你可以重新载入，或返回主页后再试。"}</p>
        <div className="button-row">
          <Button type="button" onClick={() => window.location.reload()}>{english ? "Reload" : "重新载入"}</Button>
          <a className="button" href={import.meta.env.BASE_URL}>{english ? "Return home" : "回到首页"}</a>
        </div>
        {import.meta.env.DEV ? (
          <details>
            <summary>{english ? "Technical details" : "技术详情"}</summary>
            <pre className="fatal-error-detail">{this.state.error.stack ?? this.state.error.message}</pre>
          </details>
        ) : null}
      </main>
    );
  }
}

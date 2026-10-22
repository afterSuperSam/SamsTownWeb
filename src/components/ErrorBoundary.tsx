import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

// Root safety net for render errors and rejected lazy-route chunks. Data-layer
// errors remain handled by their local loading/error states.
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
      <main className="fatal-error" role="alert">
        <span>YINGWU · RECOVERY</span>
        <h1>{english ? "This page cannot be displayed" : "页面暂时无法显示"}</h1>
        <p>{english
          ? "The interface encountered an error. Reload this page or return home and try again."
          : "界面加载时遇到异常。你可以重新载入，或返回主页后再试。"}</p>
        {import.meta.env.DEV ? <pre className="fatal-error-detail">{this.state.error.stack ?? this.state.error.message}</pre> : null}
        <div className="button-row">
          <button type="button" className="button primary" onClick={() => window.location.reload()}>{english ? "Reload" : "重新载入"}</button>
          <a className="button secondary" href={import.meta.env.BASE_URL}>{english ? "Return home" : "返回主页"}</a>
        </div>
      </main>
    );
  }
}

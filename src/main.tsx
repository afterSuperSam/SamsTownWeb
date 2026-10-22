import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { InitialHomeLoading } from "./components/TerrainLoading";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { I18nProvider } from "./i18n/I18nContext";
import { AuthProvider } from "./state/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { preloadSiteBundle } from "./services/siteRepository";
import "./styles/polish.css";

// 外部字体加载完成后再启用，避免字体服务阻塞本地及生产首屏。
const fontStyles = document.getElementById("site-fonts") as HTMLLinkElement;
if (fontStyles.sheet) fontStyles.media = "all";
else fontStyles.addEventListener("load", () => { fontStyles.media = "all"; }, { once: true });

// 首页数据与会话、文案并行读取；页面挂载时复用这一次读取。
if (window.location.pathname === import.meta.env.BASE_URL) preloadSiteBundle();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ThemeProvider>
          <InitialHomeLoading>
            <AuthProvider>
              <I18nProvider><App /></I18nProvider>
            </AuthProvider>
          </InitialHomeLoading>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

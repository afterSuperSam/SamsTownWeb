import { lazy, Suspense, useEffect } from "react";
import { Link, Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PageLoading } from "./components/TerrainLoading";
import { useI18n } from "./i18n/I18nContext";
import { HomePage } from "./pages/HomePage";

const HistoryPage = lazy(() => import("./pages/HistoryPage").then(module => ({ default: module.HistoryPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then(module => ({ default: module.AdminPage })));
const AtlasPage = lazy(() => import("./pages/AtlasPage").then(module => ({ default: module.AtlasPage })));
const AccountPage = lazy(() => import("./pages/AccountPage").then(module => ({ default: module.AccountPage })));

function RouteLoading() {
  const { t } = useI18n();
  return <PageLoading label={t("app.loading.terrain")} />;
}

function NotFoundPage() {
  const { t } = useI18n();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${t("app.notFound.title")} · ${t("app.brand")}`;
    return () => { document.title = previousTitle; };
  }, [t]);

  return <main className="status-page">
    <p className="status-code">404 <span>Not Found</span></p>
    <h1>{t("app.notFound.title")}</h1>
    <p>{t("app.notFound.body")}<br />{t("app.notFound.continue")}</p>
    <Link className="button text-action" to="/">{t("app.notFound.home")}</Link>
  </main>;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="history" element={<Suspense fallback={<RouteLoading />}><HistoryPage /></Suspense>} />
        <Route path="login" element={<Navigate to="/account" replace />} />
        <Route path="account" element={<Suspense fallback={<RouteLoading />}><AccountPage /></Suspense>} />
        <Route path="map" element={<Suspense fallback={<RouteLoading />}><AtlasPage /></Suspense>} />
        <Route element={<ProtectedRoute capability="admin" />}>
          <Route path="admin" element={<Suspense fallback={<RouteLoading />}><AdminPage /></Suspense>} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

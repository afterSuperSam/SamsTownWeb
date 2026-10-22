import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PageLoading } from "./components/TerrainLoading";
import { useI18n } from "./i18n/I18nContext";
import { useAuth } from "./state/AuthContext";
import { HomePage } from "./pages/HomePage";

const HistoryPage = lazy(() => import("./pages/HistoryPage").then(module => ({ default: module.HistoryPage })));
const ResourcesPage = lazy(() => import("./pages/ResourcesPage").then(module => ({ default: module.ResourcesPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then(module => ({ default: module.AdminPage })));
const AtlasPage = lazy(() => import("./pages/AtlasPage").then(module => ({ default: module.AtlasPage })));
const MaterialPage = lazy(() => import("./pages/MaterialPage").then(module => ({ default: module.MaterialPage })));
const ForumPage = lazy(() => import("./pages/ForumPage").then(module => ({ default: module.ForumPage })));
const AccountPage = lazy(() => import("./pages/AccountPage").then(module => ({ default: module.AccountPage })));

function RouteLoading() {
  const { t } = useI18n();
  return <PageLoading label={t("app.loading.terrain")} />;
}

export function App() {
  const { loading: authLoading } = useAuth();
  const { t } = useI18n();
  const [minimumReady, setMinimumReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumReady(true), 320);
    return () => window.clearTimeout(timer);
  }, []);

  if (authLoading || !minimumReady) return <PageLoading label={t("app.loading.terrain")} />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="history" element={<Suspense fallback={<RouteLoading />}><HistoryPage /></Suspense>} />
        <Route path="login" element={<Navigate to="/account" replace />} />
        <Route path="account" element={<Suspense fallback={<RouteLoading />}><AccountPage /></Suspense>} />
        <Route path="map" element={<Suspense fallback={<RouteLoading />}><AtlasPage /></Suspense>} />
        <Route element={<ProtectedRoute capability="resources" />}>
          <Route path="resources" element={<Suspense fallback={<RouteLoading />}><ResourcesPage /></Suspense>} />
        </Route>
        <Route element={<ProtectedRoute capability="materials:view" />}>
          <Route path="materials" element={<Suspense fallback={<RouteLoading />}><MaterialPage /></Suspense>} />
        </Route>
        <Route element={<ProtectedRoute capability="forum:view" />}>
          <Route path="forum" element={<Suspense fallback={<RouteLoading />}><ForumPage /></Suspense>} />
        </Route>
        <Route element={<ProtectedRoute capability="admin" />}>
          <Route path="admin" element={<Suspense fallback={<RouteLoading />}><AdminPage /></Suspense>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

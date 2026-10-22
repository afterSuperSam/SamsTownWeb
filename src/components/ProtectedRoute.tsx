import { Link, Navigate, Outlet, useLocation } from "react-router";
import { can, type Capability } from "../domain/permissions";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../state/AuthContext";

// Capability guards keep route access independent from role ordering.
export function ProtectedRoute({ capability }: { capability: Capability }) {
  const { user, profile, loading } = useAuth();
  const { t } = useI18n();
  const location = useLocation();

  if (loading) return <div className="screen-message">{t("app.loading.auth")}</div>;
  if (!user) return <Navigate to="/account" state={{ from: location.pathname }} replace />;
  if (profile?.mustChangePassword) {
    return <div className="screen-message">{t("error.passwordChangeRequired")}</div>;
  }
  if (!can(profile?.role, capability)) {
    return (
      <div className="screen-message" role="alert">
        <p>{t("auth.denied")}</p>
        <Link className="button secondary small" to="/">{t("app.nav.home")}</Link>
      </div>
    );
  }
  return <Outlet />;
}

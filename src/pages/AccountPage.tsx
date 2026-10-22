import { LockKeyhole, LogIn, LogOut, UserPlus, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { QqBindingPanel } from "../features/auth/QqBindingPanel";
import { QqRegistrationForm } from "../features/auth/QqRegistrationForm";
import { MemberAvatar } from "../components/MemberDirectory";
import { PageLoading } from "../components/TerrainLoading";
import { defaultAuthenticatedPath, roleLabels } from "../domain/permissions";
import type { TownMember } from "../domain/types";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { getCurrentProfile, signIn, signOut } from "../services/authService";
import { getTownArchive } from "../services/siteRepository";
import { useAuth } from "../state/AuthContext";

export function AccountPage() {
  const { user, profile, loading, refreshSession } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof getErrorTranslationKey> | null>(null);
  const [linkedMember, setLinkedMember] = useState<TownMember | null>(null);
  const routeState = location.state as { from?: string; reason?: "permission" } | null;

  useEffect(() => {
    let active = true;
    if (!user?.id || !profile?.username) {
      setLinkedMember(null);
      return () => { active = false; };
    }
    void getTownArchive()
      .then(bundle => {
        if (!active) return;
        const username = profile.username.trim().toLowerCase();
        setLinkedMember(bundle.members.find(member => member.username.trim().toLowerCase() === username) ?? null);
      })
      .catch(() => { if (active) setLinkedMember(null); });
    return () => { active = false; };
  }, [profile?.username, user?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorKey(null);
    try {
      await signIn(username, password);
      const nextProfile = await refreshSession() ?? await getCurrentProfile();
      navigate(routeState?.from ?? defaultAuthenticatedPath(nextProfile?.role), { replace: true });
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function finishRegistration() {
    const nextProfile = await refreshSession() ?? await getCurrentProfile();
    navigate(routeState?.from ?? defaultAuthenticatedPath(nextProfile?.role), { replace: true });
  }

  if (loading) return <PageLoading label={t("app.loading.terrain")} />;
  if (!user) return (
    <main className="page narrow-page auth-entry-page">
      <section className={`auth-card ${mode === "register" ? "registration-mode" : ""}`}>
        <div className="eyebrow"><LockKeyhole size={16} />{t("auth.eyebrow")}</div>
        <h1>{t(mode === "login" ? "auth.title" : "auth.register.title")}</h1>
        <p className="muted">{t(mode === "login" ? "auth.body" : "auth.register.body")}</p>
        <div className="segmented-control auth-mode-switch" role="tablist" aria-label={t("auth.mode")}>
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}><LogIn size={15} />{t("auth.mode.login")}</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}><UserPlus size={15} />{t("auth.mode.register")}</button>
        </div>
        {routeState?.reason === "permission" ? <div className="notice error" role="alert">{t("auth.denied")}</div> : null}
        {!isSupabaseConfigured ? <div className="notice error" role="alert">{t("auth.notConfigured")}</div> : null}
        {mode === "login" ? <form className="form-stack" onSubmit={submit}>
          <label>{t("auth.username")}<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>
          <label>{t("auth.password")}<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
          {errorKey ? <div className="notice error" role="alert">{t(errorKey)}</div> : null}
          <button type="submit" className="button primary" disabled={busy || !isSupabaseConfigured}><LogIn size={17} />{t(busy ? "auth.submitting" : "auth.submit")}</button>
        </form> : <QqRegistrationForm onRegistered={finishRegistration} />}
      </section>
    </main>
  );

  return (
    <main className="page account-page">
      <header className="account-page-heading">
        <div className="eyebrow"><UserRound size={16} />{t("account.eyebrow")}</div>
        <h1>{t("account.title")}</h1>
        <p>{t("account.body", { username: profile?.username ?? "" })}</p>
        <button type="button" className="button secondary small" onClick={() => void signOut()}><LogOut size={16} />{t("auth.signOut")}</button>
      </header>
      <section className="account-identity" aria-label={t("account.player.title")}>
        <div className="account-identity-avatar">
          {linkedMember ? <MemberAvatar member={linkedMember} /> : <div className="account-avatar-placeholder" aria-hidden="true"><UserRound size={32} /></div>}
        </div>
        <div className="account-identity-copy">
          <span className="eyebrow">{t("account.player.title")}</span>
          <h2>{linkedMember?.username ?? profile?.username ?? ""}</h2>
          <div className="account-identity-details">
            <span><small>{t("app.role")}</small><strong>{profile?.role ? roleLabels[profile.role] : "—"}</strong></span>
            <span><small>{t("account.player.minecraft")}</small><strong>{linkedMember?.username ?? profile?.username ?? "—"}</strong></span>
            {linkedMember && (linkedMember.roleZh || linkedMember.roleEn) ? <span><small>{t("account.player.position")}</small><strong>{language === "zh-CN" ? linkedMember.roleZh : linkedMember.roleEn}</strong></span> : null}
          </div>
        </div>
      </section>
      <QqBindingPanel />
    </main>
  );
}

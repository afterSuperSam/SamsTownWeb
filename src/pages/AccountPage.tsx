import { Notice } from "../components/RetryNotice";
import { Button } from "../components/Button";
import { LockKeyhole, LogIn, LogOut, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { MemberAvatar } from "../components/MemberDirectory";
import { PageLoading } from "../components/TerrainLoading";
import { roleLabels } from "../domain/permissions";
import type { TownMember } from "../domain/types";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { signIn, signOut } from "../services/authService";
import { getTownMembers } from "../services/siteRepository";
import { useAuth } from "../state/AuthContext";

export function AccountPage() {
  const { user, profile, loading, refreshSession } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    void getTownMembers()
      .then(members => {
        if (!active) return;
        const username = profile.username.trim().toLowerCase();
        setLinkedMember(members.find(member => member.username.trim().toLowerCase() === username) ?? null);
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
      await refreshSession();
      navigate("/", { replace: true });
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }


  async function logout() {
    setBusy(true);
    setErrorKey(null);
    try {
      await signOut();
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoading label={t("app.loading.terrain")} />;
  if (!user) return (
    <main className="page narrow-page auth-entry-page">
      <section className="auth-card">
        <div className="eyebrow"><LockKeyhole size={16} />{t("auth.eyebrow")}</div>
        <h1>{t("auth.title")}</h1>
        <p className="muted">{t("auth.signInHelp")}</p>
        {routeState?.reason === "permission" ? <Notice>{t("auth.denied")}</Notice> : null}
        {!isSupabaseConfigured ? <Notice>{t("auth.notConfigured")}</Notice> : null}
        <form className="form-stack" onSubmit={submit}>
          <label>{t("auth.username")}<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>
          <label>{t("auth.password")}<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
          {errorKey ? <Notice>{t(errorKey)}</Notice> : null}
          <Button type="submit" className="primary" disabled={busy || !isSupabaseConfigured}><LogIn size={17} />{t(busy ? "auth.submitting" : "auth.submit")}</Button>
        </form>
      </section>
    </main>
  );

  return (
    <main className="page account-page">
      <header className="account-page-heading">
        <div className="eyebrow"><UserRound size={16} />{t("account.eyebrow")}</div>
        <h1>{t("account.title")}</h1>
        <p>{t("account.body", { username: profile?.username ?? "" })}</p>
        <Button type="button" className="secondary small" disabled={busy} onClick={() => void logout()}><LogOut size={16} />{t("auth.signOut")}</Button>
        {errorKey ? <Notice>{t(errorKey)}</Notice> : null}
      </header>
      <section className="account-identity" aria-label={t("account.player.title")}>
        <div className="account-identity-avatar">
          {linkedMember ? <MemberAvatar member={linkedMember} /> : <div className="account-avatar-placeholder" aria-hidden="true"><UserRound size={32} /></div>}
        </div>
        <div className="account-identity-copy">
          <span className="eyebrow">{t("account.player.title")}</span>
          <h2>{linkedMember?.username ?? profile?.username ?? ""}</h2>
          <div className="account-identity-details">
            <span><small>{t("app.role")}</small><strong>{t(profile?.role ? roleLabels[profile.role] : "app.roles.guest")}</strong></span>
            <span><small>{t("account.player.minecraft")}</small><strong>{linkedMember?.username ?? profile?.username ?? "—"}</strong></span>
            {linkedMember && (linkedMember.roleZh || linkedMember.roleEn) ? <span><small>{t("account.player.position")}</small><strong>{language === "zh-CN" ? linkedMember.roleZh : linkedMember.roleEn}</strong></span> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

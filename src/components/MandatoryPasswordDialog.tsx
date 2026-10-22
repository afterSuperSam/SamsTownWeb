import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import type { TranslationKey } from "../i18n/translations";
import { changeOwnPassword } from "../services/authService";
import { useAuth } from "../state/AuthContext";
import { Dialog } from "./Dialog";

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 256;

// This non-dismissible gate is mounted above every route. A temporary-password
// account cannot interact with the application until both entries match and
// Supabase has cleared must_change_password.
export function MandatoryPasswordDialog() {
  const { profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);

  if (!profile?.mustChangePassword) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorKey("auth.passwordChange.tooShort");
      return;
    }
    if (password !== confirmation) {
      setErrorKey("auth.passwordChange.mismatch");
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await changeOwnPassword(password, confirmation);
      await refreshProfile();
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("auth.passwordChange.title")}
      onClose={() => undefined}
      className="password-change-dialog"
      dismissible={false}
    >
      <div className="password-change-intro">
        <KeyRound size={22} />
        <p>{t("auth.passwordChange.body")}</p>
      </div>
      <form className="form-stack" onSubmit={submit}>
        <label>
          {t("auth.passwordChange.new")}
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={password}
            onChange={event => setPassword(event.target.value)}
            disabled={busy}
            required
          />
        </label>
        <label>
          {t("auth.passwordChange.confirm")}
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={confirmation}
            onChange={event => setConfirmation(event.target.value)}
            disabled={busy}
            required
          />
        </label>
        {errorKey ? <div className="notice error" role="alert">{t(errorKey)}</div> : null}
        <button type="submit" className="button primary" disabled={busy}>
          {t(busy ? "auth.passwordChange.saving" : "auth.passwordChange.submit")}
        </button>
      </form>
    </Dialog>
  );
}

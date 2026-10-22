import { KeyRound, Send, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/translations";
import { registerWithQq, sendQqRegistrationCode } from "../../services/authService";
import { useQqChallenge } from "./useQqChallenge";

export function QqRegistrationForm({ onRegistered }: { onRegistered: () => Promise<void> }) {
  const { t } = useI18n();
  const challenge = useQqChallenge(sendQqRegistrationCode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  async function requestCode() {
    setBusy(true);
    setErrorKey(null);
    try {
      await challenge.requestCode();
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!challenge.challenge) return;
    if (password !== confirmation) {
      setErrorKey("auth.passwordChange.mismatch");
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await registerWithQq({
        challengeId: challenge.challenge.challengeId,
        qqNumber: challenge.qqNumber,
        code: challenge.code,
        username,
        password,
        confirmation
      });
      await onRegistered();
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack qq-registration-form" onSubmit={submit}>
      <label>
        {t("auth.qq.number")}
        <div className="qq-code-request">
          <input
            inputMode="numeric"
            autoComplete="tel"
            pattern="[1-9][0-9]{4,10}"
            value={challenge.qqNumber}
            onChange={event => challenge.setQqNumber(event.target.value.replace(/\D/g, ""))}
            disabled={busy || Boolean(challenge.challenge)}
            required
          />
          {challenge.challenge ? (
            <button className="text-action" type="button" onClick={challenge.reset} disabled={busy}>
              {t("auth.qq.change")}
            </button>
          ) : (
            <button className="button" type="button" onClick={() => void requestCode()} disabled={busy || !challenge.qqNumber}>
              <Send size={16} />{t(busy ? "auth.qq.sending" : "auth.qq.send")}
            </button>
          )}
        </div>
      </label>

      {challenge.challenge ? (
        <>
          <div className="qq-code-status"><KeyRound size={17} />{t("auth.qq.sent", { seconds: challenge.remaining })}</div>
          <label>{t("auth.qq.code")}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={challenge.code} onChange={event => challenge.setCode(event.target.value.replace(/\D/g, ""))} required /></label>
          <label>{t("auth.username")}<input autoComplete="username" minLength={2} maxLength={32} value={username} onChange={event => setUsername(event.target.value)} required /></label>
          <label>{t("auth.password")}<input type="password" autoComplete="new-password" minLength={10} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} required /></label>
          <label>{t("auth.register.confirmPassword")}<input type="password" autoComplete="new-password" minLength={10} maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
        </>
      ) : <p className="muted auth-qq-hint">{t("auth.qq.friendHint")}</p>}

      {errorKey ? <div className="notice error" role="alert">{t(errorKey)}</div> : null}
      {challenge.challenge ? (
        <button type="submit" className="button primary" disabled={busy || challenge.code.length !== 6}>
          <UserPlus size={17} />{t(busy ? "auth.register.submitting" : "auth.register.submit")}
        </button>
      ) : null}
    </form>
  );
}

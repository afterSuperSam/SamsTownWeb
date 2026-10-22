import { KeyRound, Link2, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/translations";
import { bindQq, getQqBindingStatus, sendQqBindingCode, type QqBindingStatus } from "../../services/authService";
import { useQqChallenge } from "./useQqChallenge";

export function QqBindingPanel() {
  const { t } = useI18n();
  const challenge = useQqChallenge(sendQqBindingCode);
  const [status, setStatus] = useState<QqBindingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  useEffect(() => {
    let active = true;
    void getQqBindingStatus()
      .then(next => { if (active) setStatus(next); })
      .catch(error => { if (active) setErrorKey(getErrorTranslationKey(error)); });
    return () => { active = false; };
  }, []);

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
    setBusy(true);
    setErrorKey(null);
    try {
      await bindQq({
        challengeId: challenge.challenge.challengeId,
        qqNumber: challenge.qqNumber,
        code: challenge.code
      });
      setStatus({ bound: true, maskedNumber: `${challenge.qqNumber.slice(0, 2)}${"*".repeat(Math.max(challenge.qqNumber.length - 4, 1))}${challenge.qqNumber.slice(-2)}` });
      challenge.reset();
    } catch (error) {
      setErrorKey(getErrorTranslationKey(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-form qq-binding-panel">
      <div className="qq-binding-heading">
        <Link2 size={22} />
        <div>
          <h3>{t("account.qq.title")}</h3>
          <p>{status?.bound ? t("account.qq.bound", { number: status.maskedNumber ?? "" }) : t("account.qq.body")}</p>
        </div>
      </div>
      <form className="form-stack" onSubmit={submit}>
        <label>
          {t("auth.qq.number")}
          <div className="qq-code-request">
            <input inputMode="numeric" pattern="[1-9][0-9]{4,10}" value={challenge.qqNumber} onChange={event => challenge.setQqNumber(event.target.value.replace(/\D/g, ""))} disabled={busy || Boolean(challenge.challenge)} required />
            {challenge.challenge ? (
              <button className="text-action" type="button" onClick={challenge.reset} disabled={busy}>{t("auth.qq.change")}</button>
            ) : (
              <button className="button" type="button" onClick={() => void requestCode()} disabled={busy || !challenge.qqNumber}><Send size={16} />{t(busy ? "auth.qq.sending" : "auth.qq.send")}</button>
            )}
          </div>
        </label>
        {challenge.challenge ? (
          <>
            <div className="qq-code-status"><KeyRound size={17} />{t("auth.qq.sent", { seconds: challenge.remaining })}</div>
            <label>{t("auth.qq.code")}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={challenge.code} onChange={event => challenge.setCode(event.target.value.replace(/\D/g, ""))} required /></label>
            <button className="button primary" type="submit" disabled={busy || challenge.code.length !== 6}>{t(busy ? "account.qq.binding" : "account.qq.bind")}</button>
          </>
        ) : null}
        {errorKey ? <div className="notice error" role="alert">{t(errorKey)}</div> : null}
      </form>
    </section>
  );
}

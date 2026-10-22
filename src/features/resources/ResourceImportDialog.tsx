import { useState, type FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";
import { createResource, resolveProjectUrl } from "../../services/resourceRepository";

// The public resource centre and Owner workspace share one import flow so URL
// validation, metadata resolution, duplicate handling, and progress copy cannot
// drift between surfaces.
export function ResourceImportDialog({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createResource(await resolveProjectUrl(url));
      await onSaved();
      onClose();
    } catch (caught) {
      setError(t(getErrorTranslationKey(caught)));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t("resources.import.title")} onClose={onClose} className="rm-import" dismissible={!busy}>
    <form className="form-stack" onSubmit={submit}>
      <p>{t("resources.import.body")}</p>
      <label>{t("resources.import.url")}<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://modrinth.com/plugin/..." required /></label>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <div className="button-row end">
        <button type="button" className="button secondary" onClick={onClose}>{t("app.cancel")}</button>
        <button type="submit" className="button modrinth" disabled={busy || !url.trim()}>{t(busy ? "resources.import.busy" : "resources.import.submit")}</button>
      </div>
    </form>
  </Dialog>;
}

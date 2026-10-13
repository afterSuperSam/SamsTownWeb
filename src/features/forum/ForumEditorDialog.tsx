import { Notice } from "../../components/RetryNotice";
import { useState, type FormEvent } from "react";
import { Dialog, DialogActions } from "../../components/Dialog";
import { SelectField } from "../../components/SelectField";
import type { ForumPostDraft, ForumPostKind } from "../../domain/types";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";

const blankDraft: ForumPostDraft = {
  title: "",
  kind: "task",
  body: ""
};

interface ForumEditorDialogProps {
  initial?: ForumPostDraft;
  onClose: () => void;
  onSave: (draft: ForumPostDraft) => Promise<void>;
}

// One editor is shared by the public forum and Owner workspace so validation,
// labels, limits, and accessibility cannot drift.
export function ForumEditorDialog({ initial, onClose, onSave }: ForumEditorDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ForumPostDraft>(initial ?? blankDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(draft);
    } catch (caught) {
      setError(t(getErrorTranslationKey(caught)));
    } finally {
      setBusy(false);
    }
  }

  const kindOptions: Array<{ value: ForumPostKind; label: string }> = [
    { value: "task", label: t("forum.kind.task") },
    { value: "anecdote", label: t("forum.kind.anecdote") },
    { value: "event", label: t("forum.kind.event") }
  ];

  return (
    <Dialog title={t(initial ? "forum.edit" : "forum.create")} onClose={onClose} className="forum-editor-dialog" dismissible={!busy}>
      <form className="form-stack forum-editor-form" onSubmit={submit}>
        {error ? <Notice>{error}</Notice> : null}
        <label>
          {t("forum.form.title")}
          <input
            autoFocus
            required
            maxLength={120}
            value={draft.title}
            placeholder={t("forum.form.titleHint")}
            onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
            disabled={busy}
          />
        </label>
        <div className="forum-form-field">
          <span>{t("forum.form.kind")}</span>
          <SelectField
            value={draft.kind}
            label={t("forum.form.kind")}
            options={kindOptions}
            onChange={kind => setDraft(current => ({ ...current, kind }))}
            disabled={busy}
          />
        </div>
        <label>
          {t("forum.form.body")}
          <textarea
            required
            maxLength={8000}
            rows={9}
            value={draft.body}
            placeholder={t("forum.form.bodyHint")}
            onChange={event => setDraft(current => ({ ...current, body: event.target.value }))}
            disabled={busy}
          />
        </label>
        <div className="forum-editor-count" aria-live="polite">{draft.body.length} / 8000</div>
        <DialogActions busy={busy} onClose={onClose} saveLabel={t(initial ? "app.save" : "forum.form.submit")} />
      </form>
    </Dialog>
  );
}

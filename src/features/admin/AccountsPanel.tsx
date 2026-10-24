import { Notice } from "../../components/RetryNotice";
import { Button, IconButton } from "../../components/Button";
import { Plus, Save, Shield, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/Dialog";
import { SelectField } from "../../components/SelectField";
import { roleLabels } from "../../domain/permissions";
import type { Account, AppRole } from "../../domain/types";
import { getErrorTranslationKey } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nContext";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateManagedAccount
} from "../../services/adminApi";

const managedRoles: AppRole[] = ["member", "owner"];
type AccountDraft = { role: AppRole; password: string };

interface AccountsPanelProps {
  currentUserId: string;
  onNotice: (message: string, tone?: "success" | "error") => void;
}

export function AccountsPanel({ currentUserId, onNotice }: AccountsPanelProps) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({
    username: "",
    password: "",
    role: "member" as AppRole
  });
  const [drafts, setDrafts] = useState<Record<string, AccountDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const accountsRef = useRef<Account[]>([]);
  const refreshRevision = useRef(0);
  const noticeRef = useRef(onNotice);
  const translateRef = useRef(t);
  noticeRef.current = onNotice;
  translateRef.current = t;

  const refresh = useCallback(async (resetDraftId?: string): Promise<boolean> => {
    const revision = ++refreshRevision.current;
    try {
      const next = await listAccounts();
      if (revision !== refreshRevision.current) return false;
      setLoadError(null);
      const previousAccounts = new Map(accountsRef.current.map(account => [account.id, account]));
      accountsRef.current = next;
      setAccounts(next);
      setDrafts(current => Object.fromEntries(next.map(account => {
        const fallback: AccountDraft = { role: account.role, password: "" };
        const currentDraft = current[account.id];
        const previous = previousAccounts.get(account.id);
        const locallyChanged = currentDraft && previous && (
          Boolean(currentDraft.password) ||
          (previous.role !== "owner" && currentDraft.role !== previous.role)
        );
        return [account.id, account.id !== resetDraftId && locallyChanged ? currentDraft : fallback];
      })));
      return true;
    } catch (error) {
      if (revision !== refreshRevision.current) return false;
      const message = translateRef.current(getErrorTranslationKey(error));
      setLoadError(message);
      noticeRef.current(message, "error");
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { refreshRevision.current += 1; };
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusyId("create");
    try {
      await createAccount(form);
      setForm({ username: "", password: "", role: "member" });
      if (await refresh()) onNotice(t("admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveAccount(account: Account) {
    const draft = drafts[account.id];
    if (!draft) return;
    setBusyId(account.id);
    try {
      await updateManagedAccount(account.id, {
        ...(account.role !== "owner" && draft.role !== account.role ? { role: draft.role } : {}),
        ...(draft.password ? { temporaryPassword: draft.password } : {})
      });
      if (await refresh(account.id)) onNotice(t("admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      const result = await deleteAccount(pendingDelete.id);
      setPendingDelete(null);
      if (await refresh()) onNotice(t(result.pending ? "admin.accounts.deletePending" : "admin.saved"));
    } catch (error) {
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <header className="admin-heading">
        <div><h2>{t("admin.accounts.title")}</h2><p>{t("admin.accounts.body")}</p></div>
      </header>
      {loadError ? <Notice className="account-service-state"><span>{loadError}</span><Button type="button" className="secondary small" onClick={() => void refresh()}>{t("app.retry")}</Button></Notice> : null}
      <form className="panel account-form" onSubmit={submit}>
        <input aria-label={t("app.username")} placeholder={t("app.username")} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} pattern="[\p{L}\p{Nd}_\-]{2,32}" required />
        <input type="password" minLength={10} aria-label={t("admin.accounts.tempPassword")} placeholder={t("admin.accounts.tempPassword")} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required />
        <SelectField value={form.role} label={t("app.role")} options={managedRoles.map(role => ({ value: role, label: t(roleLabels[role]) }))} onChange={role => setForm({ ...form, role })} />
        <Button type="submit" className="primary" disabled={busyId === "create" || Boolean(loadError)}><Plus size={17} />{t("admin.accounts.create")}</Button>
      </form>

      <div className="collection-list">
        {accounts.map(account => {
          const draft = drafts[account.id];
          const owner = account.role === "owner";
          return (
            <article className="collection-row panel account-row" key={account.id}>
              <Shield />
              <div className="grow">
                <strong>{account.username}</strong>
                <p>{t(roleLabels[account.role])}</p>
                {account.mustChangePassword ? <small>{t("admin.accounts.mustChange")}</small> : null}
              </div>
              {!owner && draft ? (
                <SelectField value={draft.role} label={t("app.role")} options={managedRoles.map(role => ({ value: role, label: t(roleLabels[role]) }))} onChange={role => setDrafts(current => ({ ...current, [account.id]: { ...draft, role } }))} />
              ) : <span className="role-badge">{t(roleLabels.owner)}</span>}
              <input
                className="account-password"
                type="password"
                minLength={10}
                aria-label={t("admin.accounts.tempPassword")}
                placeholder={t("admin.accounts.reset")}
                value={draft?.password ?? ""}
                onChange={event => {
                  if (draft) {
                    setDrafts(current => ({ ...current, [account.id]: { ...draft, password: event.target.value } }));
                  }
                }}
              />
              <IconButton
                type="button"

                disabled={busyId === account.id || (!draft?.password && (owner || draft?.role === account.role))}
                onClick={() => void saveAccount(account)}
                aria-label={t("app.save")}
              >
                <Save size={17} />
              </IconButton>
              <IconButton
                type="button"
                className="danger"
                disabled={busyId === account.id || account.id === currentUserId}
                onClick={() => setPendingDelete(account)}
                aria-label={t("app.delete")}
              >
                <Trash2 size={17} />
              </IconButton>
            </article>
          );
        })}
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title={t("admin.accounts.deleteTitle")}
          description={t("admin.accounts.deleteBody", { name: pendingDelete.username })}
          busy={busyId === pendingDelete.id}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  );
}

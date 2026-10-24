import { Button, SaveButton } from "../components/Button";
import { Database, ImagePlus, Languages, LogOut, Settings, Shield } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { ConfirmDialog } from "../components/Dialog";
import { SelectField } from "../components/SelectField";
import { PageLoading } from "../components/TerrainLoading";
import { defaultContent } from "../domain/defaults";
import { MAX_HOME_MEMBERS } from "../domain/memberPolicy";
import { roleLabels } from "../domain/permissions";
import type { FaqItem, HistoryEvent, SiteContent, TownImage, TownMember } from "../domain/types";
import { AccountsPanel } from "../features/admin/AccountsPanel";
import { ImageManager } from "../features/admin/ImageManager";
import { OrderedCollection } from "../features/admin/OrderedCollection";
import { WebDataPanel } from "../features/admin/WebDataPanel";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { translations, translationGroups, type TranslationKey } from "../i18n/translations";
import { signOut, updateAccountDetails } from "../services/authService";
import {
  getSiteBundle,
  getTownHistory,
  replaceFaqs,
  replaceHistory,
  replaceMembers,
  saveContent
} from "../services/siteRepository";
import { useAuth } from "../state/AuthContext";

type Tab = "content" | "images" | "members" | "faq" | "history" | "analytics" | "profile" | "accounts" | "system";
type SiteDataStatus = "loading" | "ready" | "error";
type AdminNotice = { id: number; message: string; tone: "success" | "error"; translationKey?: TranslationKey } | null;

const dataTabs = new Set<Tab>(["content", "images", "members", "faq", "history", "system"]);
const memberGroups: TownMember["group"][] = ["primary", "town", "friend"];
const blankMember = (): TownMember => ({
  id: crypto.randomUUID(),
  username: "",
  roleZh: "镇民",
  roleEn: "Citizen",
  variant: "",
  group: "town",
  showOnHome: false,
  introZh: "",
  introEn: "",
  sortOrder: 0
});
const blankHistory = (): HistoryEvent => ({
  id: crypto.randomUUID(),
  date: "",
  titleZh: "",
  titleEn: "",
  bodyZh: "",
  bodyEn: "",
  imageId: null,
  sortOrder: 0
});
const blankFaq = (): FaqItem => ({
  id: crypto.randomUUID(),
  questionZh: "",
  questionEn: "",
  answerZh: "",
  answerEn: "",
  visible: true,
  sortOrder: 0
});

// 后台共享完整内容草稿；各编辑器只维护自己的展示状态。
export function AdminPage() {
  const { profile, user, refreshProfile } = useAuth();
  const { t, reloadContent } = useI18n();
  const [tab, setTab] = useState<Tab>("content");
  const [content, setContent] = useState<SiteContent>(defaultContent);
  const [members, setMembers] = useState<TownMember[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [images, setImages] = useState<TownImage[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberGroupFilter, setMemberGroupFilter] = useState<"all" | TownMember["group"]>("all");
  const [notice, setNotice] = useState<AdminNotice>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SiteDataStatus>("loading");
  const loadRevision = useRef(0);
  const noticeTimer = useRef<number | undefined>(undefined);

  const showNotice = useCallback((message: string, tone: "success" | "error" = "success", translationKey?: TranslationKey) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), message, tone, translationKey });
    noticeTimer.current = window.setTimeout(() => setNotice(null), tone === "success" ? 3000 : 5000);
  }, []);

  const loadData = useCallback(async () => {
    const revision = ++loadRevision.current;
    setStatus("loading");
    try {
      const [bundle, historyEvents] = await Promise.all([getSiteBundle({ refreshContent: true }), getTownHistory({ forEditing: true })]);
      if (revision !== loadRevision.current) return;
      setContent(bundle.content);
      setMembers(bundle.members);
      setHistory(historyEvents);
      setFaqs(bundle.faqs);
      setImages(bundle.images);
      setStatus("ready");
    } catch (error) {
      if (revision !== loadRevision.current) return;
      showNotice("", "error", getErrorTranslationKey(error));
      setStatus("error");
    }
  }, [showNotice]);

  useEffect(() => {
    void loadData();
    return () => {
      loadRevision.current += 1;
      window.clearTimeout(noticeTimer.current);
    };
  }, [loadData]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (status !== "ready") {
      showNotice("", "error", "admin.saveBlocked");
      return false;
    }
    setBusy(true);
    try {
      await action();
      showNotice("", "success", "admin.saved");
      return true;
    } catch (error) {
      showNotice("", "error", getErrorTranslationKey(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function leaveAdmin() {
    try {
      await signOut();
    } catch (error) {
      showNotice("", "error", getErrorTranslationKey(error));
    }
  }

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    window.scrollTo(0, 0);
  }

  function clearMemberFilters() {
    setMemberQuery("");
    setMemberGroupFilter("all");
  }

  function createMember() {
    clearMemberFilters();
    return blankMember();
  }

  const tabs: Array<[Tab, ReactElement, TranslationKey]> = [
    ["content", <Languages size={17} />, "admin.nav.content"],
    ["images", <ImagePlus size={17} />, "admin.nav.images"],
    ["analytics", <Settings size={17} />, "admin.nav.site"],
    ["profile", <Shield size={17} />, "admin.nav.accounts"]
  ];
  const featuredMemberCount = members.filter(member => member.showOnHome).length;
  const normalizedMemberQuery = memberQuery.trim().toLocaleLowerCase();
  const memberFilterActive = memberGroupFilter !== "all" || normalizedMemberQuery !== "";
  const matchesMemberFilter = (member: TownMember) =>
    (memberGroupFilter === "all" || member.group === memberGroupFilter)
    && member.username.toLocaleLowerCase().includes(normalizedMemberQuery);
  const visibleMemberCount = members.filter(matchesMemberFilter).length;

  return (
    <main className="admin-layout ambient-page">
      <aside className="admin-sidebar">
        <div>
          <span className="eyebrow">{t("admin.title")}</span>
          <h1>{t("admin.workspace")}</h1>
          <p>{profile?.username} · {profile?.role ? t(roleLabels[profile.role]) : ""}</p>
        </div>
        <nav aria-label={t("admin.workspace")}>
          {tabs.map(([key, icon, label]) => (
            <button type="button" disabled={busy} className={adminModule(tab) === adminModule(key) ? "active" : ""} aria-current={adminModule(tab) === adminModule(key) ? "page" : undefined} onClick={() => selectTab(key)} key={key}>{icon}{t(label)}</button>
          ))}
        </nav>
        <Button type="button" disabled={busy} onClick={() => void leaveAdmin()}><LogOut size={16} />{t("admin.signOut")}</Button>
      </aside>

      <section className="admin-main">
        {notice ? (
          <div className={`admin-toast ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"} key={notice.id}>
            {notice.translationKey ? t(notice.translationKey) : notice.message}
          </div>
        ) : null}
        {dataTabs.has(tab) && status !== "ready" ? <DataGate status={status} retry={loadData} /> : null}
        <AdminSectionNav tab={tab} selectTab={selectTab} disabled={busy} />

        {status === "ready" && tab === "content" ? (
          <ContentEditor
            content={content}
            setContent={setContent}
            busy={busy}
            onSave={() => void run(async () => {
              await saveContent(content);
              await reloadContent();
            })}
          />
        ) : null}
        {status === "ready" && tab === "images" ? <ImageManager images={images} setImages={setImages} busy={busy} setBusy={setBusy} onNotice={showNotice} /> : null}
        {status === "ready" && tab === "members" ? (
          <EditorSection title={t("admin.members.title")} body={t("admin.members.body")} busy={busy} onSave={() => void run(() => replaceMembers(members))}>
            <div className="member-filters">
              <label>{t("admin.members.search")}<input type="search" autoComplete="off" value={memberQuery} placeholder={t("admin.members.searchPlaceholder")} onChange={event => setMemberQuery(event.target.value)} /></label>
              <label>{t("admin.members.group")}<SelectField value={memberGroupFilter} label={t("admin.members.group")} disabled={busy} options={[{ value: "all", label: t("admin.members.allGroups") }, ...memberGroups.map(group => ({ value: group, label: t(`home.members.${group}`) }))]} onChange={setMemberGroupFilter} /></label>
              {memberFilterActive ? <Button type="button" onClick={clearMemberFilters}>{t("admin.members.clearFilters")}</Button> : null}
            </div>
            <p className="muted" role="status">{t("admin.members.matchCount", { count: visibleMemberCount, total: members.length })}{memberFilterActive ? ` ${t("admin.members.filteredOrderHint")}` : ""}</p>
            <OrderedCollection items={members} setItems={setMembers} createItem={createMember} filterItem={matchesMemberFilter} reorderable={!memberFilterActive} disabled={busy} emptyLabel={t("admin.members.empty")} addLabel={t("admin.members.add")} fieldClassName="member-editor-fields" scrollable render={(member, update) => (
              <>
                <input aria-label={t("admin.members.username")} placeholder={t("admin.members.username")} autoComplete="off" value={member.username} onChange={event => update({ ...member, username: event.target.value })} />
                <input aria-label={t("admin.members.roleZh")} placeholder={t("admin.members.roleZh")} value={member.roleZh} onChange={event => update({ ...member, roleZh: event.target.value })} />
                <input aria-label={t("admin.members.roleEn")} placeholder={t("admin.members.roleEn")} value={member.roleEn} onChange={event => update({ ...member, roleEn: event.target.value })} />
                <div className="member-group-picker segmented-control" role="group" aria-label={t("admin.members.group")}>
                  {memberGroups.map(group => (
                    <button
                      type="button"
                      className={member.group === group ? "active" : ""}
                      aria-pressed={member.group === group}
                      onClick={() => update({ ...member, group })}
                      key={group}
                    >
                      {t(`home.members.${group}`)}
                    </button>
                  ))}
                </div>
                <label className="visibility-toggle home-member-toggle">
                  <input type="checkbox" checked={member.showOnHome} disabled={!member.showOnHome && featuredMemberCount >= MAX_HOME_MEMBERS} onChange={event => update({ ...member, showOnHome: event.target.checked })} />
                  {t("admin.members.showOnHome")}
                </label>
                {member.showOnHome ? <>
                  <textarea maxLength={800} aria-label={t("admin.members.introZh")} placeholder={t("admin.members.introZh")} value={member.introZh} onChange={event => update({ ...member, introZh: event.target.value })} />
                  <textarea maxLength={800} aria-label={t("admin.members.introEn")} placeholder={t("admin.members.introEn")} value={member.introEn} onChange={event => update({ ...member, introEn: event.target.value })} />
                </> : null}
              </>
            )} />
          </EditorSection>
        ) : null}
        {status === "ready" && tab === "faq" ? (
          <EditorSection title={t("admin.faq.title")} body={t("admin.faq.body")} busy={busy} onSave={() => void run(() => replaceFaqs(faqs))}>
            <OrderedCollection items={faqs} setItems={setFaqs} createItem={blankFaq} disabled={busy} addLabel={t("admin.faq.add")} fieldClassName="faq-editor-fields" render={(faq, update) => (
              <>
                <input aria-label={t("admin.faq.questionZh")} placeholder={t("admin.faq.questionZh")} value={faq.questionZh} onChange={event => update({ ...faq, questionZh: event.target.value })} />
                <input aria-label={t("admin.faq.questionEn")} placeholder={t("admin.faq.questionEn")} value={faq.questionEn} onChange={event => update({ ...faq, questionEn: event.target.value })} />
                <textarea aria-label={t("admin.faq.answerZh")} placeholder={t("admin.faq.answerZh")} value={faq.answerZh} onChange={event => update({ ...faq, answerZh: event.target.value })} />
                <textarea aria-label={t("admin.faq.answerEn")} placeholder={t("admin.faq.answerEn")} value={faq.answerEn} onChange={event => update({ ...faq, answerEn: event.target.value })} />
                <label className="visibility-toggle"><input type="checkbox" checked={faq.visible} onChange={event => update({ ...faq, visible: event.target.checked })} />{t(faq.visible ? "app.visible" : "app.hidden")}</label>
              </>
            )} />
          </EditorSection>
        ) : null}
        {status === "ready" && tab === "history" ? (
          <EditorSection title={t("admin.history.title")} body={t("admin.history.body")} busy={busy} onSave={() => void run(() => replaceHistory(history))}>
            <OrderedCollection items={history} setItems={setHistory} createItem={blankHistory} disabled={busy} addLabel={t("admin.history.add")} scrollable render={(event, update) => (
              <>
                <input aria-label={t("admin.history.date")} placeholder={t("admin.history.date")} value={event.date} onChange={change => update({ ...event, date: change.target.value })} />
                <input aria-label={t("admin.history.titleZh")} placeholder={t("admin.history.titleZh")} value={event.titleZh} onChange={change => update({ ...event, titleZh: change.target.value })} />
                <input aria-label={t("admin.history.titleEn")} placeholder={t("admin.history.titleEn")} value={event.titleEn} onChange={change => update({ ...event, titleEn: change.target.value })} />
                <textarea aria-label={t("admin.history.bodyZh")} placeholder={t("admin.history.bodyZh")} value={event.bodyZh} onChange={change => update({ ...event, bodyZh: change.target.value })} />
                <textarea aria-label={t("admin.history.bodyEn")} placeholder={t("admin.history.bodyEn")} value={event.bodyEn} onChange={change => update({ ...event, bodyEn: change.target.value })} />
                <SelectField
                  value={event.imageId ?? ""}
                  label={t("admin.history.image")}
                  disabled={busy}
                  options={[{ value: "", label: t("admin.history.noImage") }, ...images.filter(image => image.visible).map(image => ({ value: image.id, label: image.captionZh || image.sourceUrl }))]}
                  onChange={imageId => update({ ...event, imageId: imageId || null })}
                />
              </>
            )} />
          </EditorSection>
        ) : null}
        {tab === "analytics" ? <WebDataPanel onNotice={showNotice} /> : null}
        {tab === "profile" ? (
          <>
            <ProfilePanel username={profile?.username ?? ""} refreshProfile={refreshProfile} onNotice={showNotice} />
          </>
        ) : null}
        {tab === "accounts" ? <AccountsPanel currentUserId={user?.id ?? ""} onNotice={showNotice} /> : null}
        {status === "ready" && tab === "system" ? (
          <SystemPanel
            content={content}
            setContent={setContent}
            busy={busy}
            onSave={() => void run(async () => {
              await saveContent(content);
              await reloadContent();
            })}
            applyDefaults={() => run(async () => {
              const next = { ...content, translations: {} };
              await saveContent(next);
              setContent(next);
              await reloadContent();
            })}
          />
        ) : null}
      </section>
    </main>
  );
}

function adminModule(tab: Tab): "content" | "media" | "site" | "accounts" {
  if (["content", "members", "faq", "history"].includes(tab)) return "content";
  if (tab === "images") return "media";
  if (["analytics", "system"].includes(tab)) return "site";
  return "accounts";
}

function AdminSectionNav({ tab, selectTab, disabled }: { tab: Tab; selectTab: (tab: Tab) => void; disabled: boolean }) {
  const { t } = useI18n();
  const groups: Record<ReturnType<typeof adminModule>, Array<[Tab, TranslationKey]>> = {
    content: [
      ["content", "admin.nav.copy"], ["faq", "admin.nav.faq"], ["history", "admin.nav.history"],
      ["members", "admin.nav.members"]
    ],
    media: [["images", "admin.nav.images"]],
    site: [["analytics", "admin.nav.analytics"], ["system", "admin.nav.system"]],
    accounts: [["profile", "admin.nav.profile"], ["accounts", "admin.nav.accounts"]]
  };
  const options = groups[adminModule(tab)];
  if (options.length < 2) return null;
  return <nav className="admin-section-nav" aria-label={t("admin.title")}>
    {options.map(([key, label]) => <button type="button" disabled={disabled} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => selectTab(key)} key={key}>{t(label)}</button>)}
  </nav>;
}

function DataGate({ status, retry }: { status: SiteDataStatus; retry: () => Promise<void> }) {
  const { t } = useI18n();
  if (status === "loading") return <PageLoading label={t("app.loading.admin")} />;
  return (
    <section className="panel admin-data-state" role="alert">
      <Database size={24} />
      <div><h2>{t("admin.loadError")}</h2><p>{t("admin.loadErrorBody")}</p></div>
      <Button className="primary" type="button" onClick={() => void retry()}>{t("app.retry")}</Button>
    </section>
  );
}

function EditorSection({ title, body, busy, onSave, children }: {
  title: string;
  body: string;
  busy: boolean;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <header className="admin-heading">
        <div><h2>{title}</h2><p>{body}</p></div>
        <SaveButton type="button" onClick={onSave} busy={busy}></SaveButton>
      </header>
      <fieldset className="admin-editor-fields" disabled={busy}>{children}</fieldset>
    </div>
  );
}

function ContentEditor({ content, setContent, busy, onSave }: {
  content: SiteContent;
  setContent: (content: SiteContent) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const [group, setGroup] = useState<(typeof translationGroups)[number]["id"]>("home");
  const currentGroup = translationGroups.find(item => item.id === group)!;
  const keys = (Object.keys(translations) as TranslationKey[]).filter(key => key.startsWith(currentGroup.prefix));

  function updateCopy(key: TranslationKey, language: "zh-CN" | "en", value: string) {
    const current = content.translations[key] ?? translations[key];
    setContent({
      ...content,
      translations: {
        ...content.translations,
        [key]: { ...current, [language]: value }
      }
    });
  }

  return (
    <div>
      <header className="admin-heading">
        <div><h2>{t("admin.copy.title")}</h2><p>{t("admin.copy.overrides")}</p></div>
        <SaveButton type="button" onClick={onSave} busy={busy}></SaveButton>
      </header>
      <fieldset className="admin-editor-fields" disabled={busy}>
        <label className="copy-group-select">
          {t("admin.copy.group")}
          <SelectField value={group} label={t("admin.copy.group")} disabled={busy} options={translationGroups.map(item => ({ value: item.id, label: t(`admin.copy.groups.${item.id}`) }))} onChange={setGroup} />
        </label>
        <div className="editor-grid">
          {keys.map(key => {
            const value = content.translations[key] ?? translations[key];
            return (
              <section className="copy-field form-stack" key={key}>
                <h3>{key}</h3>
                <label>{t("app.chinese")}<textarea rows={3} value={value["zh-CN"]} onChange={event => updateCopy(key, "zh-CN", event.target.value)} /></label>
                <label>{t("app.english")}<textarea rows={3} value={value.en} onChange={event => updateCopy(key, "en", event.target.value)} /></label>
              </section>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function SettingsEditor({ content, setContent }: { content: SiteContent; setContent: (content: SiteContent) => void }) {
  const { t } = useI18n();
  const set = (key: keyof SiteContent["settings"], value: string) =>
    setContent({ ...content, settings: { ...content.settings, [key]: value } });
  return (
    <section className="settings-editor">
      <h3>{t("admin.settings.title")}</h3>
      <label>{t("admin.settings.qq")}<input value={content.settings.qqGroup} onChange={event => set("qqGroup", event.target.value)} /></label>
      <label>{t("admin.settings.kook")}<input type="url" value={content.settings.kookUrl} onChange={event => set("kookUrl", event.target.value)} /></label>
    </section>
  );
}

function ProfilePanel({ username, refreshProfile, onNotice }: {
  username: string;
  refreshProfile: () => Promise<void>;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ username, password: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(current => ({ ...current, username })), [username]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateAccountDetails(form);
      await refreshProfile();
      setForm(current => ({ ...current, password: "" }));
      onNotice(t("admin.saved"));
    } catch (error) {
      await refreshProfile().catch(() => undefined);
      onNotice(t(getErrorTranslationKey(error)), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="admin-heading"><div><h2>{t("admin.profile.title")}</h2><p>{t("admin.profile.body")}</p></div></header>
      <form className="profile-form form-stack" onSubmit={submit}>
        <label>{t("app.username")}<input pattern="[\p{L}\p{Nd}_\-]{2,32}" disabled={busy} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} required /></label>
        <label>{t("admin.profile.newPassword")}<input type="password" minLength={10} disabled={busy} placeholder={t("admin.profile.passwordHint")} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
        <SaveButton type="submit" busy={busy}>{t("admin.profile.save")}</SaveButton>
      </form>
    </div>
  );
}

function SystemPanel({ content, setContent, busy: saving, onSave, applyDefaults }: {
  content: SiteContent;
  setContent: (content: SiteContent) => void;
  busy: boolean;
  onSave: () => void;
  applyDefaults: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [confirmDefaults, setConfirmDefaults] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <header className="admin-heading">
        <div><h2>{t("admin.system.title")}</h2><p>{t("admin.system.body")}</p></div>
        <SaveButton type="button" onClick={onSave} busy={saving}></SaveButton>
      </header>
      <fieldset className="admin-editor-fields" disabled={saving || busy}>
        <SettingsEditor content={content} setContent={setContent} />
        <section className="panel system-card">
          <Languages size={28} />
          <div><h3>{t("admin.system.defaultsTitle")}</h3><p>{t("admin.system.defaultsBody")}</p></div>
          <Button type="button" disabled={saving || busy} onClick={() => setConfirmDefaults(true)}>{t("admin.system.defaultsAction")}</Button>
        </section>
      </fieldset>
      {confirmDefaults ? (
        <ConfirmDialog
          title={t("admin.system.defaultsTitle")}
          description={t("admin.system.defaultsConfirm")}
          busy={busy}
          onClose={() => setConfirmDefaults(false)}
          onConfirm={async () => {
            setBusy(true);
            const saved = await applyDefaults();
            setBusy(false);
            if (saved) setConfirmDefaults(false);
          }}
        />
      ) : null}
    </div>
  );
}

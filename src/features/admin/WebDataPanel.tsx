import { Button } from "../../components/Button";
import { Activity, CalendarDays, ChevronDown, Eye, Globe2, RefreshCw, Trash2, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectField } from "../../components/SelectField";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/translations";
import {
  getOperationLogs,
  getPageViewAnalytics,
  groupOperationLogs,
  pruneExpiredOperationLogs,
  type OperationAction,
  type OperationCategory,
  type OperationLog,
  type OperationLogGroup,
  type PageViewAnalytics,
  type PageViewSeries
} from "../../services/webDataRepository";

const categories: OperationCategory[] = ["map_project", "map_marker"];
const actions: OperationAction[] = ["add", "update", "delete"];
const tableLabels: Record<string, TranslationKey> = {
  map_claims: "admin.analytics.table.map_claims",
  map_markers: "admin.analytics.table.map_markers"
};

export function WebDataPanel({ onNotice }: {
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const { language, t } = useI18n();
  const [days, setDays] = useState("30");
  const [series, setSeries] = useState<PageViewSeries>("totalViews");
  const [category, setCategory] = useState("");
  const [action, setAction] = useState("");
  const [analytics, setAnalytics] = useState<PageViewAnalytics>({ totalViews: 0, authenticatedViews: 0, daily: [], frequentVisitors: [] });
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const loadRevision = useRef(0);
  const numberFormat = useMemo(() => new Intl.NumberFormat(language), [language]);
  const groupedLogs = useMemo(() => groupOperationLogs(logs), [logs]);

  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const [nextAnalytics, nextLogs] = await Promise.all([
        getPageViewAnalytics(Number(days)),
        getOperationLogs(
          category as OperationCategory || undefined,
          action as OperationAction || undefined
        )
      ]);
      if (revision !== loadRevision.current) return;
      setAnalytics(nextAnalytics);
      setLogs(nextLogs);
    } catch {
      if (revision === loadRevision.current) onNotice(t("admin.analytics.loadError"), "error");
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [action, category, days, onNotice, t]);

  useEffect(() => {
    void load();
    return () => {
      loadRevision.current += 1;
    };
  }, [load]);

  async function cleanup() {
    try {
      const count = await pruneExpiredOperationLogs();
      onNotice(t("admin.analytics.cleaned", { count }));
      await load();
    } catch {
      onNotice(t("admin.analytics.loadError"), "error");
    }
  }

  return (
    <div className="web-data-panel">
      <header className="admin-heading">
        <div><h2>{t("admin.analytics.title")}</h2><p>{t("admin.analytics.body")}</p></div>
        <Button  type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} />{t("app.retry")}
        </Button>
      </header>

      <section className="web-data-overview">
        <div><Activity size={19} /><strong>{numberFormat.format(analytics.totalViews)}</strong><span>{t("admin.analytics.total")}</span></div>
        <div><UsersRound size={19} /><strong>{numberFormat.format(analytics.authenticatedViews)}</strong><span>{t("admin.analytics.authenticated")}</span></div>
        <div><CalendarDays size={19} /><strong>{numberFormat.format(analytics.daily.at(-1)?.totalViews ?? 0)}</strong><span>{t("admin.analytics.today")}</span></div>
        <div><Globe2 size={19} /><strong>{numberFormat.format(analytics.frequentVisitors.length)}</strong><span>{t("admin.analytics.frequentCount")}</span></div>
      </section>

      <section className="web-data-chart-section">
        <div className="web-data-controls">
          <div className="segmented-control" role="group" aria-label={t("admin.analytics.title")}>
            {(["totalViews", "authenticatedViews"] as PageViewSeries[]).map(value => (
              <button type="button" aria-pressed={series === value} onClick={() => setSeries(value)} key={value}>
                {t(value === "totalViews" ? "admin.analytics.total" : "admin.analytics.authenticated")}
              </button>
            ))}
          </div>
          <SelectField
            value={days}
            label={t("admin.analytics.range")}
            options={["7", "30", "90"].map(value => ({ value, label: t("admin.analytics.days", { count: value }) }))}
            onChange={setDays}
          />
        </div>
        <PageViewChart analytics={analytics} series={series} label={t(series === "totalViews" ? "admin.analytics.total" : "admin.analytics.authenticated")} />
      </section>

      <section className="frequent-visitors-section">
        <header><div><h3>{t("admin.analytics.frequentVisitors")}</h3><p>{t("admin.analytics.frequentVisitorsBody")}</p></div></header>
        <div className="frequent-visitor-list">
          {analytics.frequentVisitors.map(visitor => <article key={`${visitor.maskedIp}-${visitor.lastSeenAt}`}>
            <Globe2 size={17} />
            <div><strong>{visitor.maskedIp}</strong><small>{t("admin.analytics.activeDays", { count: visitor.activeDays })}</small></div>
            <span><Eye size={14} />{numberFormat.format(visitor.views)}</span>
            <time dateTime={visitor.lastSeenAt}>{new Date(visitor.lastSeenAt).toLocaleString(language)}</time>
          </article>)}
          {!loading && !analytics.frequentVisitors.length ? <p className="empty-state">{t("admin.analytics.noVisitors")}</p> : null}
        </div>
      </section>

      <section className="operation-log-section">
        <header>
          <div><h3>{t("admin.analytics.operations")}</h3><p>{t("admin.analytics.retention")}</p></div>
          <Button className="small" type="button" onClick={() => void cleanup()}><Trash2 size={15} />{t("admin.analytics.cleanup")}</Button>
        </header>
        <div className="operation-filters">
          <SelectField
            value={category}
            label={t("admin.analytics.allCategories")}
            options={[
              { value: "", label: t("admin.analytics.allCategories") },
              ...categories.map(value => ({ value, label: t(`admin.analytics.category.${value}` as TranslationKey) }))
            ]}
            onChange={setCategory}
          />
          <SelectField
            value={action}
            label={t("admin.analytics.allActions")}
            options={[
              { value: "", label: t("admin.analytics.allActions") },
              ...actions.map(value => ({ value, label: t(`admin.analytics.action.${value}` as TranslationKey) }))
            ]}
            onChange={setAction}
          />
        </div>
        <div className="operation-log-list" aria-busy={loading}>
          {!loading && !groupedLogs.length ? <p className="empty-state">{t("admin.analytics.empty")}</p> : null}
          {groupedLogs.map(group => <OperationGroup group={group} language={language} key={group.id} />)}
        </div>
      </section>
    </div>
  );
}

function OperationGroup({ group, language }: { group: OperationLogGroup; language: "zh-CN" | "en" }) {
  const { t } = useI18n();
  const category = t(`admin.analytics.category.${group.category}` as TranslationKey);
  return <details className="operation-group">
    <summary>
      <span className={`operation-action ${group.action}`}>{t(`admin.analytics.action.${group.action}` as TranslationKey)}</span>
      <span className="operation-group-title">
        <strong>{group.targetName || category}</strong>
        <small>{category} · {t("admin.analytics.changeCount", { count: group.entries.length })}</small>
      </span>
      <span>{group.actorUsername}</span>
      <time dateTime={group.createdAt}>{new Date(group.createdAt).toLocaleString(language)}</time>
      <ChevronDown className="operation-disclosure" size={16} aria-hidden="true" />
    </summary>
    <div className="operation-group-children">
      {group.entries.map(log => <OperationEntry log={log} language={language} key={log.id} />)}
    </div>
  </details>;
}

function OperationEntry({ log, language }: { log: OperationLog; language: "zh-CN" | "en" }) {
  const { t } = useI18n();
  const tableKey = tableLabels[log.sourceTable];
  return <details className="operation-entry">
    <summary>
      <span className={`operation-action ${log.action}`}>{t(`admin.analytics.action.${log.action}` as TranslationKey)}</span>
      <strong>{tableKey ? t(tableKey) : t(`admin.analytics.category.${log.category}` as TranslationKey)}</strong>
      <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString(language)}</time>
      <ChevronDown size={14} aria-hidden="true" />
    </summary>
    <div>
      {log.targetId ? <code>{log.targetId}</code> : null}
      {log.before !== null ? <Snapshot title={t("admin.analytics.before")} value={log.before} /> : null}
      {log.after !== null ? <Snapshot title={t("admin.analytics.after")} value={log.after} /> : null}
    </div>
  </details>;
}

function PageViewChart({ analytics, series, label }: {
  analytics: PageViewAnalytics;
  series: PageViewSeries;
  label: string;
}) {
  const chartPoints = useMemo(() => {
    const values = analytics.daily.map(item => item[series]);
    const maximum = Math.max(1, ...values);
    return analytics.daily.map((item, index) => {
      const x = analytics.daily.length <= 1 ? 360 : 26 + index * 668 / (analytics.daily.length - 1);
      const y = 188 - item[series] / maximum * 152;
      return { x, y, item };
    });
  }, [analytics.daily, series]);
  const points = chartPoints.map(point => `${point.x},${point.y}`).join(" ");

  return (
    <figure className="web-data-chart">
      <svg viewBox="0 0 720 220" role="img" aria-label={label}>
        <path d="M26 36H694M26 112H694M26 188H694" className="chart-grid" />
        {points ? <polyline points={points} className="chart-line" /> : null}
        {chartPoints.map(({ x, y, item }) => <g className="chart-point" tabIndex={0} role="img" aria-label={`${item.date} · ${item[series]} · ${label}`} key={item.date}>
          <rect className="chart-hit-area" x={x - 10} y={y - 14} width="20" height="28" />
          <title>{`${item.date} · ${item[series]} · ${label}`}</title>
          <text x={x} y={Math.max(18, y - 12)} textAnchor="middle">{item[series]}</text>
        </g>)}
      </svg>
      <figcaption>
        <span>{analytics.daily.at(0)?.date ?? "—"}</span>
        <span>{analytics.daily.at(-1)?.date ?? "—"}</span>
      </figcaption>
    </figure>
  );
}

function Snapshot({ title, value }: { title: string; value: unknown }) {
  return <section><strong>{title}</strong><pre>{JSON.stringify(value, null, 2)}</pre></section>;
}

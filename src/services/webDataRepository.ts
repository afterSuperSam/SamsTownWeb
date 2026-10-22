import type { Json } from "../lib/database.types";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { sessionAwareApiRequest } from "./apiClient";

export type PageViewSeries = "totalViews" | "authenticatedViews";
export type OperationCategory = "map_claim" | "map_marker" | "material" | "resource";
export type OperationAction = "add" | "update" | "delete";

interface DailyPageViews {
  date: string;
  totalViews: number;
  authenticatedViews: number;
}

export interface PageViewAnalytics {
  totalViews: number;
  authenticatedViews: number;
  daily: DailyPageViews[];
  frequentVisitors: FrequentVisitor[];
}

interface FrequentVisitor {
  maskedIp: string;
  views: number;
  activeDays: number;
  lastSeenAt: string;
}

export interface OperationLog {
  id: number;
  actorId: string | null;
  actorUsername: string;
  action: OperationAction;
  category: OperationCategory;
  targetId: string | null;
  rootTargetId: string | null;
  targetName: string;
  sourceTable: string;
  before: Json | null;
  after: Json | null;
  createdAt: string;
}

export interface OperationLogGroup {
  id: string;
  action: OperationAction;
  category: OperationCategory;
  targetId: string | null;
  targetName: string;
  actorUsername: string;
  createdAt: string;
  entries: OperationLog[];
}

const emptyAnalytics: PageViewAnalytics = {
  totalViews: 0,
  authenticatedViews: 0,
  daily: [],
  frequentVisitors: []
};

export async function recordPageView(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await sessionAwareApiRequest<void>("/api/analytics/view", { method: "POST" });
}

export async function getPageViewAnalytics(days = 30): Promise<PageViewAnalytics> {
  if (!isSupabaseConfigured) return emptyAnalytics;
  const { data, error } = await supabase.rpc("get_page_view_analytics", { p_days: days });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) return emptyAnalytics;
  const value = data as Record<string, Json | undefined>;
  const daily = Array.isArray(value.daily)
    ? value.daily.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const row = item as Record<string, Json | undefined>;
        return [{
          date: String(row.date ?? ""),
          totalViews: Number(row.totalViews ?? 0),
          authenticatedViews: Number(row.authenticatedViews ?? 0)
        }];
      })
    : [];
  const frequentVisitors = Array.isArray(value.frequentVisitors)
    ? value.frequentVisitors.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const row = item as Record<string, Json | undefined>;
        return [{
          maskedIp: String(row.maskedIp ?? ""),
          views: Number(row.views ?? 0),
          activeDays: Number(row.activeDays ?? 0),
          lastSeenAt: String(row.lastSeenAt ?? "")
        }];
      })
    : [];
  return {
    totalViews: Number(value.totalViews ?? 0),
    authenticatedViews: Number(value.authenticatedViews ?? 0),
    daily,
    frequentVisitors
  };
}

export async function getOperationLogs(
  category?: OperationCategory,
  action?: OperationAction
): Promise<OperationLog[]> {
  if (!isSupabaseConfigured) return [];
  let query = supabase
    .from("audit_logs")
    .select("id,actor_id,action,target_type,target_id,details,created_at")
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(250);
  if (category) query = query.eq("target_type", category);
  if (action) query = query.eq("action", action);
  const { data, error } = await query;
  if (error) throw error;
  const logs = (data ?? []).flatMap(row => {
    if (!["add", "update", "delete"].includes(row.action)) return [];
    if (!["map_claim", "map_marker", "material", "resource"].includes(row.target_type)) return [];
    const details = row.details && typeof row.details === "object" && !Array.isArray(row.details)
      ? row.details as Record<string, Json | undefined>
      : {};
    const before = jsonRecord(details.before);
    const after = jsonRecord(details.after);
    return [{
      id: row.id,
      actorId: row.actor_id,
      actorUsername: String(details.actorUsername ?? "System"),
      action: row.action as OperationAction,
      category: row.target_type as OperationCategory,
      targetId: row.target_id,
      rootTargetId: typeof details.rootTargetId === "string" ? details.rootTargetId : null,
      targetName: typeof details.targetName === "string" ? details.targetName : "",
      sourceTable: typeof details.table === "string" ? details.table : "",
      before: details.before ?? null,
      after: details.after ?? null,
      sourceItemId: String(after.item_id ?? before.item_id ?? ""),
      createdAt: row.created_at
    }];
  });

  const legacyItemIds = [...new Set(logs.flatMap(log =>
    log.category === "material" && !log.rootTargetId && log.sourceItemId ? [log.sourceItemId] : []
  ))];
  const projectByItem = new Map<string, string>();
  const projectName = new Map<string, string>();
  if (legacyItemIds.length) {
    const { data: items } = await supabase.from("material_items").select("id,project_id").in("id", legacyItemIds);
    for (const item of items ?? []) projectByItem.set(item.id, item.project_id);
    const projectIds = [...new Set((items ?? []).map(item => item.project_id))];
    if (projectIds.length) {
      const { data: projects } = await supabase.from("material_projects").select("id,name").in("id", projectIds);
      for (const project of projects ?? []) projectName.set(project.id, project.name);
    }
  }

  const enriched = logs.map(({ sourceItemId, ...log }) => {
    const resolvedRoot = log.rootTargetId ?? projectByItem.get(sourceItemId) ?? log.targetId;
    return {
      ...log,
      rootTargetId: resolvedRoot,
      targetName: log.targetName || (resolvedRoot ? projectName.get(resolvedRoot) ?? "" : "")
    };
  });
  const nameByGroup = new Map<string, string>();
  for (const log of enriched) {
    if (log.rootTargetId && log.targetName) nameByGroup.set(`${log.category}:${log.rootTargetId}`, log.targetName);
  }
  return enriched.map(log => ({
    ...log,
    targetName: log.targetName || (log.rootTargetId ? nameByGroup.get(`${log.category}:${log.rootTargetId}`) ?? "" : "")
  }));
}

export function groupOperationLogs(logs: OperationLog[]): OperationLogGroup[] {
  const groups = new Map<string, OperationLogGroup>();
  for (const log of logs) {
    const target = log.rootTargetId ?? log.targetId ?? `log-${log.id}`;
    const actor = log.actorId ?? log.actorUsername;
    const key = `${log.category}:${target}:${actor}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(log);
      if (!existing.targetName && log.targetName) existing.targetName = log.targetName;
      continue;
    }
    groups.set(key, {
      id: key,
      action: log.action,
      category: log.category,
      targetId: target.startsWith("log-") ? null : target,
      targetName: log.targetName,
      actorUsername: log.actorUsername,
      createdAt: log.createdAt,
      entries: [log]
    });
  }

  const rootTables: Record<OperationCategory, string> = {
    map_claim: "map_claims",
    map_marker: "map_markers",
    material: "material_projects",
    resource: "resources"
  };
  return [...groups.values()].map(group => {
    const rootChanges = group.entries.filter(entry => entry.sourceTable === rootTables[group.category]);
    const primary = rootChanges.find(entry => entry.action === "delete")
      ?? rootChanges.find(entry => entry.action === "add")
      ?? rootChanges[0]
      ?? group.entries[0];
    return { ...group, action: primary.action };
  });
}

function jsonRecord(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

export async function pruneExpiredOperationLogs(): Promise<number> {
  const { data, error } = await supabase.rpc("prune_operation_logs");
  if (error) throw error;
  return data ?? 0;
}

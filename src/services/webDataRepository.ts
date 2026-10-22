import { z } from "zod";
import type { Json } from "../lib/database.types";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { sessionAwareApiRequest } from "./apiClient";

export type PageViewSeries = "totalViews" | "authenticatedViews";
export type OperationCategory = "map_project" | "map_marker";
const operationCategories: OperationCategory[] = ["map_project", "map_marker"];
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

const pageViewAnalyticsSchema = z.object({
  totalViews: z.number(), authenticatedViews: z.number(),
  daily: z.array(z.object({ date: z.string(), totalViews: z.number(), authenticatedViews: z.number() })),
  frequentVisitors: z.array(z.object({ maskedIp: z.string(), views: z.number(), activeDays: z.number(), lastSeenAt: z.string() }))
});

export async function recordPageView(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await sessionAwareApiRequest<void>("/api/analytics/view", { method: "POST" });
}

export async function getPageViewAnalytics(days = 30): Promise<PageViewAnalytics> {
  if (!isSupabaseConfigured) return emptyAnalytics;
  const { data, error } = await supabase.rpc("get_page_view_analytics", { p_days: days });
  if (error) throw error;
  return pageViewAnalyticsSchema.parse(data);
}

export async function getOperationLogs(
  category?: OperationCategory,
  action?: OperationAction
): Promise<OperationLog[]> {
  if (!isSupabaseConfigured) return [];
  let query = supabase
    .from("audit_logs")
    .select("id,actor_id,action,target_type,target_id,details,created_at")
    .in("target_type", operationCategories)
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(250);
  if (category) query = query.eq("target_type", category);
  if (action) query = query.eq("action", action);
  const { data, error } = await query;
  if (error) throw error;
  const logs = (data ?? []).flatMap(row => {
    if (!["add", "update", "delete"].includes(row.action)) return [];
    if (!operationCategories.includes(row.target_type as OperationCategory)) return [];
    const details = row.details && typeof row.details === "object" && !Array.isArray(row.details)
      ? row.details as Record<string, Json | undefined>
      : {};
    return [{
      id: row.id,
      actorId: row.actor_id,
      actorUsername: String(details.actorUsername ?? "System"),
      action: row.action as OperationAction,
      category: row.target_type as OperationCategory,
      targetId: row.target_id,
      rootTargetId: typeof details.rootTargetId === "string" ? details.rootTargetId : row.target_id,
      targetName: typeof details.targetName === "string" ? details.targetName : "",
      sourceTable: typeof details.table === "string" ? details.table : "",
      before: details.before ?? null,
      after: details.after ?? null,
      createdAt: row.created_at
    }];
  });

  const nameByGroup = new Map<string, string>();
  for (const log of logs) {
    if (log.rootTargetId && log.targetName) nameByGroup.set(`${log.category}:${log.rootTargetId}`, log.targetName);
  }
  return logs.map(log => ({
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
    map_project: "map_claims",
    map_marker: "map_markers"
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

export async function pruneExpiredOperationLogs(): Promise<number> {
  const { data, error } = await supabase.rpc("prune_operation_logs");
  if (error) throw error;
  return data ?? 0;
}

import type { PageResult, Resource, ResourceSource, SharedFile } from "../domain/types";
import { supabase } from "../lib/supabase";
import { mapResource } from "./siteRepository";

const MODRINTH_API = "https://api.modrinth.com/v2";
const GITHUB_API = "https://api.github.com";
const NO_VERSION = "—";
const EXTERNAL_REQUEST_TIMEOUT_MS = 10_000;

interface ResourceDraft {
  externalId: string;
  name: string;
  description: string;
  source: ResourceSource;
  resourceType: string;
  projectType: string;
  url: string;
  iconUrl?: string | null;
  author: string;
  currentVersion: string;
  latestVersion: string;
  gameVersions: string[];
  loaders: string[];
  tags: string[];
  projectUpdatedAt?: string | null;
}

interface ModrinthProject {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  project_type?: string;
  icon_url?: string;
  team?: string;
  categories?: string[];
  updated?: string;
}

interface ModrinthVersion {
  version_number?: string;
  loaders?: string[];
  game_versions?: string[];
}

interface GithubRepository {
  full_name: string;
  name: string;
  description?: string;
  html_url: string;
  owner?: { avatar_url?: string; login?: string };
  language?: string;
  topics?: string[];
  updated_at?: string;
}

interface GithubRelease {
  tag_name?: string;
}

interface ModrinthTeamMember {
  user?: { username?: string };
  role?: string;
}

export type ResourceFilter = "all" | "plugin" | "datapack" | "github" | "updates";

interface ResourceQuery {
  page: number;
  pageSize?: number;
  search?: string;
  filter?: ResourceFilter;
  loader?: string;
}

export interface ResourceStats {
  total: number;
  plugin: number;
  datapack: number;
  github: number;
  updates: number;
}

// Import metadata from a supported project URL ------------------------------
export async function resolveProjectUrl(input: string): Promise<ResourceDraft> {
  const url = parseUrl(input);
  if (["modrinth.com", "www.modrinth.com"].includes(url.hostname)) return resolveModrinth(url);
  if (["github.com", "www.github.com"].includes(url.hostname)) return resolveGithub(url);
  return {
    externalId: normalizeUrl(url), name: url.hostname, description: "", source: "minecraft",
    resourceType: "link", projectType: "link", url: url.toString(), iconUrl: null, author: "",
    currentVersion: NO_VERSION, latestVersion: NO_VERSION, gameVersions: [], loaders: [], tags: []
  };
}

async function resolveModrinth(url: URL): Promise<ResourceDraft> {
  const match = url.pathname.match(/^\/(?:plugin|datapack|mod|modpack|resourcepack|shader|project)\/([^/?#]+)/i);
  if (!match) throw new Error("error.invalidModrinthUrl");
  const projectResponse = await fetchExternal(`${MODRINTH_API}/project/${encodeURIComponent(match[1])}`);
  if (!projectResponse.ok) throw new Error("error.projectMetadata");
  const project = await projectResponse.json() as ModrinthProject;
  const [versionsResponse, teamResponse] = await Promise.all([
    fetchExternal(`${MODRINTH_API}/project/${encodeURIComponent(String(project.id))}/version`),
    project.team ? fetchExternal(`${MODRINTH_API}/team/${encodeURIComponent(project.team)}/members`) : null
  ]);
  if (!versionsResponse.ok) throw new Error("error.projectMetadata");
  const versions = await versionsResponse.json() as ModrinthVersion[];
  const team = teamResponse?.ok ? await teamResponse.json() as ModrinthTeamMember[] : [];
  const latest = versions[0];
  const loaders = unique(versions.flatMap(version => Array.isArray(version.loaders) ? version.loaders : []));
  const gameVersions = sortMinecraftVersions(unique(versions.flatMap(version => Array.isArray(version.game_versions) ? version.game_versions : [])));
  return {
    externalId: String(project.id), name: String(project.title), description: String(project.description ?? ""),
    source: "modrinth", resourceType: classifyModrinth(project.project_type, loaders),
    projectType: String(project.project_type ?? "other"),
    url: `https://modrinth.com/${String(project.project_type ?? "project")}/${String(project.slug ?? project.id)}`,
    iconUrl: project.icon_url ? String(project.icon_url) : null,
    author: team.map(member => member.user?.username).filter(Boolean).join(", "),
    currentVersion: String(latest?.version_number ?? NO_VERSION), latestVersion: String(latest?.version_number ?? NO_VERSION),
    gameVersions, loaders, tags: unique([...(project.categories ?? []), ...loaders]).slice(0, 12),
    projectUpdatedAt: project.updated ? String(project.updated) : null
  };
}

async function resolveGithub(url: URL): Promise<ResourceDraft> {
  const match = url.pathname.match(/^\/([^/]+)\/([^/#?]+)\/?$/);
  if (!match) throw new Error("error.invalidGithubUrl");
  const fullName = `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
  const [projectResponse, releaseResponse] = await Promise.all([
    fetchExternal(`${GITHUB_API}/repos/${fullName}`),
    fetchExternal(`${GITHUB_API}/repos/${fullName}/releases/latest`)
  ]);
  if (!projectResponse.ok) throw new Error("error.projectMetadata");
  const project = await projectResponse.json() as GithubRepository;
  const release = releaseResponse.ok ? await releaseResponse.json() as GithubRelease : null;
  const version = String(release?.tag_name ?? NO_VERSION);
  return {
    externalId: String(project.full_name).toLowerCase(), name: String(project.name),
    description: String(project.description ?? ""), source: "github", resourceType: "github",
    projectType: "repository", url: String(project.html_url), iconUrl: project.owner?.avatar_url ? String(project.owner.avatar_url) : null,
    author: String(project.owner?.login ?? match[1]), currentVersion: version, latestVersion: version,
    gameVersions: [], loaders: [], tags: unique([project.language, ...(project.topics ?? [])].filter(Boolean).map(String)).slice(0, 12),
    projectUpdatedAt: project.updated_at ? String(project.updated_at) : null
  };
}

function classifyModrinth(projectType: unknown, loaders: string[]) {
  const type = String(projectType ?? "").toLowerCase();
  const pluginLoaders = new Set(["bukkit", "spigot", "paper", "purpur", "folia", "velocity", "waterfall", "bungeecord"]);
  if (type === "plugin" || loaders.some(loader => pluginLoaders.has(loader.toLowerCase()))) return "plugin";
  if (type === "datapack" || loaders.some(loader => loader.toLowerCase() === "datapack")) return "datapack";
  return type || "modrinth";
}

// Server-side paging keeps network and render work bounded at ten items.
export async function listResourcesPage(values: ResourceQuery): Promise<PageResult<Resource>> {
  const pageSize = Math.min(10, Math.max(1, values.pageSize ?? 10));
  const page = Math.max(1, values.page);
  let query = supabase.from("resources").select("*", { count: "exact" });
  const search = values.search?.trim().replace(/[,%()]/g, " ");
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},description.ilike.${pattern},author.ilike.${pattern}`);
  }
  if (values.filter === "github") query = query.eq("source", "github");
  else if (values.filter === "updates") query = query.eq("update_available", true);
  else if (values.filter && values.filter !== "all") query = query.eq("resource_type", values.filter);
  if (values.loader && values.loader !== "all") query = query.contains("loaders", [values.loader]);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;
  return {
    items: (data ?? []).map(mapResource),
    total: count ?? 0,
    page,
    pageSize
  };
}

// Update checks operate on every externally managed project, not only the
// currently visible page. Fetching in bounded pages avoids an unbounded
// response while keeping the UI's ten-item pagination independent.
export async function listCheckableResources(): Promise<Resource[]> {
  const pageSize = 100;
  const resources: Resource[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("resources")
      .select("*")
      .in("source", ["modrinth", "github"])
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    resources.push(...(data ?? []).map(mapResource));
    if ((data?.length ?? 0) < pageSize) return resources;
  }
}

export async function getResourceStats(): Promise<ResourceStats> {
  const { data, error } = await supabase.rpc("get_resource_stats").single();
  if (error) throw error;
  const row = data as Partial<Record<keyof ResourceStats, number | string | null>>;
  return {
    total: Number(row.total ?? 0),
    plugin: Number(row.plugin ?? 0),
    datapack: Number(row.datapack ?? 0),
    github: Number(row.github ?? 0),
    updates: Number(row.updates ?? 0)
  };
}

export async function listResourceLoaders(): Promise<string[]> {
  const { data, error } = await supabase.rpc("list_resource_loaders");
  if (error) {
    const missingRpc = error.code === "PGRST202" || /function .* does not exist|schema cache/i.test(error.message);
    if (missingRpc) return [];
    throw error;
  }
  return (data ?? []).map((row: { loader?: string } | string) =>
    typeof row === "string" ? row : String(row.loader ?? "")
  ).filter(Boolean);
}

export async function createResource(draft: ResourceDraft): Promise<void> {
  let duplicate: { id: string; name: string } | null = null;
  const modernLookup = await supabase.from("resources")
    .select("id,name").eq("source", draft.source).eq("external_id", draft.externalId).maybeSingle();
  if (isMissingColumn(modernLookup.error)) {
    const legacyLookup = await supabase.from("resources").select("id,name,url").eq("source", draft.source);
    if (legacyLookup.error) throw legacyLookup.error;
    duplicate = legacyLookup.data?.find(item => projectKey(String(item.url), draft.source) === projectKey(draft.url, draft.source)) ?? null;
  } else {
    if (modernLookup.error) throw modernLookup.error;
    duplicate = modernLookup.data;
  }
  if (duplicate) throw new Error("error.duplicateResource");
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("error.session");
  let { error } = await supabase.from("resources").insert(toResourceRow(draft, userData.user.id));
  if (isMissingColumn(error)) {
    ({ error } = await supabase.from("resources").insert({
      name: draft.name, description: draft.description, source: draft.source,
      resource_type: draft.resourceType, url: draft.url, icon_url: draft.iconUrl ?? null,
      tags: unique([...draft.tags, ...draft.loaders, ...draft.gameVersions]).slice(0, 20),
      created_by: userData.user.id
    }));
  }
  if (error?.code === "23505") throw new Error("error.duplicateResource");
  if (error) throw error;
}

export async function checkResourceUpdate(resource: Resource): Promise<Resource> {
  let latestVersion = resource.latestVersion;
  if (resource.source === "modrinth" && resource.externalId) {
    const response = await fetchExternal(`${MODRINTH_API}/project/${encodeURIComponent(resource.externalId)}/version`);
    if (!response.ok) throw new Error("error.projectMetadata");
    const versions = await response.json() as ModrinthVersion[];
    latestVersion = String(versions[0]?.version_number ?? resource.latestVersion);
  } else if (resource.source === "github" && resource.externalId) {
    const response = await fetchExternal(`${GITHUB_API}/repos/${resource.externalId}/releases/latest`);
    if (!response.ok && response.status !== 404) throw new Error("error.projectMetadata");
    latestVersion = response.status === 404 ? NO_VERSION : String((await response.json() as GithubRelease).tag_name ?? NO_VERSION);
  }
  const updateAvailable = resource.currentVersion !== NO_VERSION && latestVersion !== NO_VERSION && resource.currentVersion !== latestVersion;
  const checkedAt = new Date().toISOString();
  const { error } = await supabase.rpc("update_resource_check", {
    p_resource_id: resource.id,
    p_latest_version: latestVersion,
    p_update_available: updateAvailable,
    p_checked_at: checkedAt
  });
  if (error) throw error;
  return { ...resource, latestVersion, updateAvailable, updateCheckedAt: checkedAt };
}

export async function deleteResource(id: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_resource", { p_resource_id: id });
  if (error) throw error;
}

export async function updateResourceDetails(id: string, values: { name: string; description: string }): Promise<void> {
  const name = values.name.trim();
  const description = values.description.trim();
  if (!name || name.length > 120 || description.length > 2000) throw new Error("error.invalidResourceDetails");
  const { error } = await supabase.rpc("admin_update_resource_details", {
    p_resource_id: id,
    p_name: name,
    p_description: description
  });
  if (error) throw error;
}

function toResourceRow(draft: ResourceDraft, userId: string) {
  return {
    external_id: draft.externalId, name: draft.name, description: draft.description, source: draft.source,
    resource_type: draft.resourceType, project_type: draft.projectType, url: draft.url, icon_url: draft.iconUrl ?? null,
    author: draft.author, current_version: draft.currentVersion, latest_version: draft.latestVersion,
    game_versions: draft.gameVersions, loaders: draft.loaders, tags: draft.tags,
    update_available: false, project_updated_at: draft.projectUpdatedAt ?? null,
    update_checked_at: new Date().toISOString(), created_by: userId
  };
}

// Shared file storage and metadata ------------------------------------------
export async function listSharedFilesPage(page: number, pageSize = 10): Promise<PageResult<SharedFile>> {
  const safePageSize = Math.min(10, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await supabase
    .from("schematics")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + safePageSize - 1);
  if (error) throw error;
  return {
    items: (data ?? []).map(row => ({
    id: row.id, name: row.name, description: row.description, author: row.author,
    fileName: row.file_name, storagePath: row.storage_path, fileSize: row.file_size,
    mimeType: row.mime_type ?? "application/octet-stream",
    category: row.category ?? (String(row.file_name).toLowerCase().endsWith(".litematic") ? "schematic" : "other"),
    createdAt: row.created_at
    })),
    total: count ?? 0,
    page: safePage,
    pageSize: safePageSize
  };
}

export async function uploadSharedFile(file: File, values: { name: string; author: string; description: string }): Promise<void> {
  if (file.size > 25 * 1024 * 1024) throw new Error("error.fileTooLarge");
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("error.session");
  // Storage keys stay ASCII-only; the original name remains in file_name.
  const path = `${userData.user.id}/${crypto.randomUUID()}${safeStorageExtension(file.name)}`;
  const mimeType = file.type || "application/octet-stream";
  const upload = await supabase.storage.from("schematics").upload(path, file, { contentType: mimeType });
  if (upload.error) throw upload.error;
  let { error } = await supabase.from("schematics").insert({
    name: values.name, author: values.author, description: values.description, file_name: file.name,
    storage_path: path, file_size: file.size, mime_type: mimeType, category: getFileCategory(file), created_by: userData.user.id
  });
  if (isMissingColumn(error)) {
    ({ error } = await supabase.from("schematics").insert({
      name: values.name, author: values.author, description: values.description, file_name: file.name,
      storage_path: path, file_size: file.size, created_by: userData.user.id
    }));
  }
  if (error) {
    const cleanup = await supabase.storage.from("schematics").remove([path]);
    if (cleanup.error) await queueOwnStorageCleanup("schematics", path);
    throw error;
  }
}

export async function deleteSharedFile(item: SharedFile): Promise<void> {
  const { error } = await supabase.rpc("queue_shared_file_deletion", { p_file_id: item.id });
  if (error) throw error;
}

export async function getSharedFileDownloadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("schematics").createSignedUrl(path, 60, {
    download: true
  });
  if (error) throw error;
  return data.signedUrl;
}

function getFileCategory(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "litematic") return "schematic";
  if (extension === "jar") return "mod";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/") || ["txt", "md", "json", "yml", "yaml"].includes(extension ?? "")) return "text";
  return "other";
}

function safeStorageExtension(fileName: string): string {
  const separator = fileName.lastIndexOf(".");
  if (separator < 0) return "";
  const extension = fileName.slice(separator + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  return extension ? `.${extension}` : "";
}

async function queueOwnStorageCleanup(bucket: string, path: string): Promise<void> {
  const queued = await supabase.rpc("queue_own_storage_cleanup", { p_bucket: bucket, p_path: path });
  if (queued.error) console.error("Storage cleanup could not be queued", queued.error);
}

function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("error.invalidProjectUrl");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error("error.invalidProjectUrl");
  }
  return url;
}

async function fetchExternal(input: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), EXTERNAL_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
  } catch {
    throw new Error("error.projectMetadata");
  } finally {
    window.clearTimeout(timeout);
  }
}
function normalizeUrl(url: URL) { return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`; }
function projectKey(value: string, source: ResourceSource) {
  const url = parseUrl(value);
  if (source === "modrinth") return url.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? normalizeUrl(url);
  if (source === "github") return url.pathname.replace(/^\/|\/$/g, "").replace(/\.git$/i, "").toLowerCase();
  return normalizeUrl(url);
}
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function sortMinecraftVersions(values: string[]) { return values.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
function isMissingColumn(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "PGRST204" || error.code === "42703" || /column .* does not exist|schema cache/i.test(error.message ?? "")));
}

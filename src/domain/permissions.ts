import type { AppRole } from "./types";

export type Capability =
  | "resources"
  | "account"
  | "admin"
  | "map:view"
  | "map:claim"
  | "map:manage"
  | "materials:view"
  | "materials:edit"
  | "forum:view"
  | "forum:write";

const capabilities: Record<AppRole, ReadonlySet<Capability>> = {
  viewer: new Set(["account", "map:view", "materials:view", "forum:view"]),
  member: new Set(["account", "resources", "map:view", "map:claim", "materials:view", "materials:edit", "forum:view", "forum:write"]),
  admin: new Set(["account", "resources", "map:view", "map:claim", "map:manage", "materials:view", "materials:edit", "forum:view", "forum:write"]),
  owner: new Set(["account", "resources", "admin", "map:view", "map:claim", "map:manage", "materials:view", "materials:edit", "forum:view", "forum:write"])
};

export const roleLabels: Record<AppRole, string> = {
  viewer: "Viewer",
  member: "Member",
  admin: "Admin",
  owner: "Owner"
};

// Permission checks live behind one interface so UI guards and actions cannot
// drift when Admin receives distinct capabilities in a future release.
export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  return Boolean(role && capabilities[role].has(capability));
}

export function defaultAuthenticatedPath(role: AppRole | null | undefined): string {
  if (role === "owner") return "/admin";
  if (role === "viewer") return "/map";
  return "/resources";
}

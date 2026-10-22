import type { AppRole } from "./types";

export type Capability =
  | "account"
  | "admin"
  | "map:view"
  | "map:project"
  | "map:manage";

const capabilities: Record<AppRole, ReadonlySet<Capability>> = {
  member: new Set(["account", "map:view", "map:project"]),
  owner: new Set(["account", "admin", "map:view", "map:project", "map:manage"])
};

export const roleLabels = {
  member: "app.roles.member",
  owner: "app.roles.owner"
} as const satisfies Record<AppRole, string>;

// 统一游客、成员和管理的界面权限；写入仍由服务端和数据库授权。
export function can(role: AppRole | null | undefined, capability: Capability): boolean {
  return capability === "map:view" || Boolean(role && capabilities[role]?.has(capability));
}

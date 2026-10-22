import { can } from "../../../domain/permissions";
import type { AppRole } from "../../../domain/types";
import type { MapProject } from "./mapTypes";

const mayCreateProject = (role: AppRole | null | undefined) => can(role, "map:project");
const mayManageMap = (role: AppRole | null | undefined) => can(role, "map:manage");
export const mayEditProject = (role: AppRole | null | undefined, userId: string | undefined, project: MapProject) =>
  mayManageMap(role) || (mayCreateProject(role) && Boolean(userId) && project.ownerId === userId);

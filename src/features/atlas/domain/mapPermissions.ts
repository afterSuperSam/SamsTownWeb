import { can } from "../../../domain/permissions";
import type { AppRole } from "../../../domain/types";
import type { MapClaim } from "./mapTypes";

const mayClaimMap = (role: AppRole | null | undefined) => can(role, "map:claim");
const mayManageMap = (role: AppRole | null | undefined) => can(role, "map:manage");
export const mayEditClaim = (role: AppRole | null | undefined, userId: string | undefined, claim: MapClaim) =>
  mayManageMap(role) || (mayClaimMap(role) && Boolean(userId) && claim.ownerId === userId);

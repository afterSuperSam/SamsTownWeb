import { authenticatedApiRequest } from "../../../services/apiClient";
import type { MapUploadFields, TownMap } from "../domain/mapTypes";

export function uploadMap(file: File, fields: MapUploadFields): Promise<TownMap> {
  const body = new FormData();
  body.append("name", fields.name);
  body.append("description", fields.description);
  body.append("shortLabel", fields.shortLabel);
  body.append("visible", String(fields.visible));
  body.append("sortOrder", String(fields.sortOrder ?? 0));
  body.append("file", file);
  return authenticatedApiRequest<TownMap>("/api/maps", { method: "POST", body });
}

export const updateMapMetadata = (id: string, fields: MapUploadFields) =>
  authenticatedApiRequest<TownMap>(`/api/maps/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields)
  });

export function replaceMapImage(id: string, file: File, clearExisting: boolean): Promise<TownMap> {
  const body = new FormData();
  body.append("clearExisting", String(clearExisting));
  body.append("file", file);
  return authenticatedApiRequest<TownMap>(`/api/maps/${id}/image`, { method: "PUT", body });
}

export const deleteMap = (id: string, confirmName: string) =>
  authenticatedApiRequest<{ ok: true }>(`/api/maps/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmName })
  });

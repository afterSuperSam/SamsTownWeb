import type { Account, AppRole } from "../domain/types";
import { authenticatedApiRequest } from "./apiClient";

export const listAccounts = () => authenticatedApiRequest<Account[]>("/api/accounts");
export const createAccount = (values: { password: string; username: string; role: AppRole }) =>
  authenticatedApiRequest<Account>("/api/accounts", { method: "POST", body: JSON.stringify(values) });
export const updateManagedAccount = (
  id: string,
  values: { role?: AppRole; temporaryPassword?: string }
) => authenticatedApiRequest<{ ok: boolean }>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(values) });
export const deleteAccount = (id: string) =>
  authenticatedApiRequest<{ ok: boolean }>(`/api/accounts/${id}`, { method: "DELETE" });

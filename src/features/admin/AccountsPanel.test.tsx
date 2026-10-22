// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../domain/types";
import { AccountsPanel } from "./AccountsPanel";

const apiMocks = vi.hoisted(() => ({
  createAccount: vi.fn(),
  deleteAccount: vi.fn(),
  listAccounts: vi.fn(),
  updateManagedAccount: vi.fn()
}));

vi.mock("../../services/adminApi", () => apiMocks);
vi.mock("../../i18n/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values?.number === undefined ? key : `${key}:${values.number}`
  })
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const accounts: Account[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    username: "DogSam",
    role: "owner",
    qqNumber: "1234567890",
    mustChangePassword: false,
    createdAt: "2026-07-30T00:00:00Z"
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    username: "legacy_member",
    role: "member",
    qqNumber: null,
    mustChangePassword: false,
    createdAt: "2026-07-30T00:00:00Z"
  }
];

describe("AccountsPanel", () => {
  it("shows full QQ numbers and an explicit unbound state to the Owner", async () => {
    apiMocks.listAccounts.mockResolvedValue(accounts);

    render(<AccountsPanel currentUserId={accounts[0].id} onNotice={vi.fn()} />);

    expect(await screen.findByText("admin.accounts.qq:1234567890")).toBeInTheDocument();
    expect(screen.getByText("admin.accounts.qqUnbound")).toBeInTheDocument();
  });

  it("preserves another account's unsaved draft when one row is saved", async () => {
    apiMocks.listAccounts.mockResolvedValue(accounts);
    apiMocks.updateManagedAccount.mockResolvedValue(undefined);
    render(<AccountsPanel currentUserId={accounts[0].id} onNotice={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByLabelText("admin.accounts.tempPassword")).toHaveLength(3));
    const passwordInputs = screen.getAllByLabelText("admin.accounts.tempPassword");
    fireEvent.change(passwordInputs[1], { target: { value: "OwnerReset123" } });
    fireEvent.change(passwordInputs[2], { target: { value: "MemberDraft123" } });
    fireEvent.click(screen.getAllByRole("button", { name: "app.save" })[0]);

    await waitFor(() => expect(apiMocks.listAccounts).toHaveBeenCalledTimes(2));
    expect(screen.getAllByLabelText("admin.accounts.tempPassword")[2]).toHaveValue("MemberDraft123");
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeOwnPassword } from "../services/authService";
import { useAuth } from "../state/AuthContext";
import { MandatoryPasswordDialog } from "./MandatoryPasswordDialog";

vi.mock("../i18n/I18nContext", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../services/authService", () => ({ changeOwnPassword: vi.fn() }));
vi.mock("../state/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedChangePassword = vi.mocked(changeOwnPassword);
const mockedUseAuth = vi.mocked(useAuth);
const refreshProfile = vi.fn();

afterEach(cleanup);

describe("MandatoryPasswordDialog", () => {
  beforeEach(() => {
    mockedChangePassword.mockReset();
    refreshProfile.mockReset();
    mockedUseAuth.mockReturnValue({
      profile: { id: "first-login-user", username: "viewer", role: "viewer", mustChangePassword: true },
      refreshProfile
    } as unknown as ReturnType<typeof useAuth>);
  });

  it("requires the two password entries to match", () => {
    render(<MandatoryPasswordDialog />);
    const fields = screen.getAllByLabelText(/auth\.passwordChange\.(new|confirm)/);
    fireEvent.change(fields[0], { target: { value: "new-password-1" } });
    fireEvent.change(fields[1], { target: { value: "new-password-2" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.passwordChange.submit" }));

    expect(screen.getByRole("alert")).toHaveTextContent("auth.passwordChange.mismatch");
    expect(mockedChangePassword).not.toHaveBeenCalled();
  });

  it("changes a matching password and refreshes the profile gate", async () => {
    mockedChangePassword.mockResolvedValue(undefined);
    refreshProfile.mockResolvedValue(undefined);
    render(<MandatoryPasswordDialog />);
    const fields = screen.getAllByLabelText(/auth\.passwordChange\.(new|confirm)/);
    fireEvent.change(fields[0], { target: { value: "new-password-1" } });
    fireEvent.change(fields[1], { target: { value: "new-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.passwordChange.submit" }));

    await waitFor(() => expect(mockedChangePassword).toHaveBeenCalledWith("new-password-1", "new-password-1"));
    expect(refreshProfile).toHaveBeenCalledOnce();
  });
});

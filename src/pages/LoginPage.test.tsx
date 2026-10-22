// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../state/AuthContext";
import { getCurrentProfile, registerWithQq, sendQqRegistrationCode, signIn } from "../services/authService";
import { AccountPage } from "./AccountPage";

vi.mock("../i18n/I18nContext", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../state/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/supabase", () => ({ isSupabaseConfigured: true }));
vi.mock("../services/authService", () => ({
  getCurrentProfile: vi.fn(),
  registerWithQq: vi.fn(),
  sendQqRegistrationCode: vi.fn(),
  sendQqBindingCode: vi.fn(),
  getQqBindingStatus: vi.fn().mockResolvedValue({ bound: false, maskedNumber: null }),
  bindQq: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn()
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetCurrentProfile = vi.mocked(getCurrentProfile);
const mockedSignIn = vi.mocked(signIn);
const mockedRegisterWithQq = vi.mocked(registerWithQq);
const mockedSendQqRegistrationCode = vi.mocked(sendQqRegistrationCode);

afterEach(cleanup);

describe("AccountPage authentication", () => {
  beforeEach(() => {
    mockedUseAuth.mockReset();
    mockedGetCurrentProfile.mockReset();
    mockedSignIn.mockReset();
    mockedRegisterWithQq.mockReset();
    mockedSendQqRegistrationCode.mockReset();
  });

  it("shows the account workspace for an authenticated Viewer", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "viewer" },
      profile: { id: "viewer", username: "viewer", role: "viewer", mustChangePassword: false }
    } as unknown as ReturnType<typeof useAuth>);

    render(
      <MemoryRouter initialEntries={["/account"]}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/map" element={<div>map destination</div>} />
          <Route path="/resources" element={<div>resources destination</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("account.title")).toBeInTheDocument();
  });

  it("keeps the Viewer map destination when an auth event supersedes the explicit refresh", async () => {
    const refreshSession = vi.fn().mockResolvedValue(null);
    mockedUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshSession } as unknown as ReturnType<typeof useAuth>);
    mockedSignIn.mockResolvedValue(undefined);
    mockedGetCurrentProfile.mockResolvedValue({ id: "viewer", username: "viewer", role: "viewer", mustChangePassword: true });

    render(
      <MemoryRouter initialEntries={["/account"]}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/map" element={<div>map destination</div>} />
          <Route path="/resources" element={<div>resources destination</div>} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText("auth.username"), { target: { value: "viewer" } });
    fireEvent.change(screen.getByLabelText("auth.password"), { target: { value: "temporary-password" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.submit" }));

    await waitFor(() => expect(screen.getByText("map destination")).toBeInTheDocument());
    expect(mockedGetCurrentProfile).toHaveBeenCalledOnce();
  });

  it("registers through a delivered QQ challenge with password confirmation", async () => {
    const refreshSession = vi.fn().mockResolvedValue({ id: "viewer", username: "new_user", role: "viewer" });
    mockedUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshSession } as unknown as ReturnType<typeof useAuth>);
    mockedSendQqRegistrationCode.mockResolvedValue({ challengeId: "challenge", expiresIn: 300, retryAfter: 300 });
    mockedRegisterWithQq.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/account"]}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/map" element={<div>map destination</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("tab", { name: "auth.mode.register" }));
    fireEvent.change(screen.getByLabelText("auth.qq.number"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.qq.send" }));
    await screen.findByText(/auth.qq.sent/);
    fireEvent.change(screen.getByLabelText("auth.qq.code"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("auth.username"), { target: { value: "new_user" } });
    const passwordFields = screen.getAllByLabelText(/auth.password|auth.register.confirmPassword/);
    fireEvent.change(passwordFields[0], { target: { value: "strong-password" } });
    fireEvent.change(passwordFields[1], { target: { value: "strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "auth.register.submit" }));

    await waitFor(() => expect(screen.getByText("map destination")).toBeInTheDocument());
    expect(mockedRegisterWithQq).toHaveBeenCalledWith(expect.objectContaining({
      qqNumber: "12345678",
      code: "123456",
      username: "new_user"
    }));
  });
});

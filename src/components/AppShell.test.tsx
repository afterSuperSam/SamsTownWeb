// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../state/AuthContext";
import { defaultContent } from "../domain/defaults";
import { ThemeProvider } from "../theme/ThemeContext";
import { AppShell } from "./AppShell";

vi.mock("../i18n/I18nContext", () => ({
  useI18n: () => ({
    language: "zh-CN",
    content: { ...defaultContent, settings: { ...defaultContent.settings, kookUrl: "https://kook.vip/test" } },
    switching: false,
    switchLanguage: vi.fn(),
    t: (key: string) => key
  })
}));
vi.mock("../state/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const renderShell = () => render(
  <ThemeProvider>
    <MemoryRouter>
      <Routes><Route element={<AppShell />}><Route index element={<div>home</div>} /></Route></Routes>
    </MemoryRouter>
  </ThemeProvider>
);

describe("AppShell", () => {
  beforeEach(() => {
    mockedUseAuth.mockReset();
    vi.stubGlobal("__APP_VERSION__", "test");
    vi.stubGlobal("scrollTo", vi.fn());
  });
  afterEach(cleanup);

  it("keeps public pages visible and hides member tools while signed out", () => {
    mockedUseAuth.mockReturnValue({ loading: false, user: null, profile: null } as ReturnType<typeof useAuth>);
    renderShell();

    expect(screen.getAllByRole("link", { name: "app.nav.home" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "app.nav.history" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "app.nav.signIn" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "app.nav.map" })).toHaveAttribute("href", "/map");
    expect(screen.queryByRole("link", { name: "app.nav.materials" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "app.nav.forum" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "app.nav.resources" })).not.toBeInTheDocument();
    const blogLinks = screen.getAllByRole("link", { name: "app.nav.blog" });
    expect(blogLinks).toHaveLength(2);
    blogLinks.forEach(link => {
      expect(link).toHaveAttribute("href", "https://blog.moesam.com");
      expect(link).toHaveAttribute("target", "_blank");
    });
    expect(screen.getByRole("link", { name: "app.footer.bilibili" })).toHaveAttribute("href", "https://space.bilibili.com/390142693");
  });

  it("shows each available town tool to authenticated members", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "member" },
      profile: { id: "member", username: "member", role: "member", mustChangePassword: false }
    } as unknown as ReturnType<typeof useAuth>);
    renderShell();

    expect(screen.getByRole("link", { name: "app.nav.map" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "app.nav.materials" })).toHaveAttribute("href", "/materials");
    expect(screen.getByRole("link", { name: "app.nav.forum" })).toHaveAttribute("href", "/forum");
    expect(screen.getByRole("link", { name: "app.nav.resources" })).toHaveAttribute("href", "/resources");
    expect(screen.getByRole("link", { name: "app.nav.account" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "app.nav.signIn" })).not.toBeInTheDocument();
  });

  it("keeps Viewer navigation within Viewer capabilities", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "viewer" },
      profile: { id: "viewer", username: "viewer", role: "viewer", mustChangePassword: false }
    } as unknown as ReturnType<typeof useAuth>);
    renderShell();

    expect(screen.getByRole("link", { name: "app.nav.map" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "app.nav.materials" })).toHaveAttribute("href", "/materials");
    expect(screen.getByRole("link", { name: "app.nav.forum" })).toHaveAttribute("href", "/forum");
    expect(screen.queryByRole("link", { name: "app.nav.resources" })).not.toBeInTheDocument();
  });

  it("blocks a temporary-password account with the password-change dialog", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "first-login-user" },
      profile: { id: "first-login-user", username: "new-user", role: "viewer", mustChangePassword: true },
      refreshProfile: vi.fn()
    } as unknown as ReturnType<typeof useAuth>);

    renderShell();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "auth.passwordChange.title" })).toBeInTheDocument();
  });
});

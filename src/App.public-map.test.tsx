// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null,
  loading: false,
  refreshProfile: vi.fn(),
  refreshSession: vi.fn()
}));

vi.mock("./state/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("./i18n/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key })
}));
vi.mock("./components/AppShell", () => ({ AppShell: () => <Outlet /> }));
vi.mock("./pages/HomePage", () => ({ HomePage: () => <div>home-page</div> }));
vi.mock("./pages/AtlasPage", () => ({ AtlasPage: () => <div>public-map-page</div> }));
vi.mock("./pages/AccountPage", () => ({ AccountPage: () => <div>account-page</div> }));

import { App } from "./App";

describe("public map route", () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
  });

  it("renders the town map without requiring a session", async () => {
    render(<MemoryRouter initialEntries={["/map"]}><App /></MemoryRouter>);
    expect(await screen.findByText("public-map-page")).toBeInTheDocument();
    expect(screen.queryByText("account-page")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../state/AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";

vi.mock("../i18n/I18nContext", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../state/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/resources"]}>
      <Routes>
        <Route path="/account" element={<div>account page</div>} />
        <Route element={<ProtectedRoute capability="resources" />}>
          <Route path="/resources" element={<div>protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function renderMapRoute() {
  return render(
    <MemoryRouter initialEntries={["/map"]}>
      <Routes>
        <Route path="/account" element={<div>account page</div>} />
        <Route element={<ProtectedRoute capability="map:view" />}>
          <Route path="/map" element={<div>map content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function renderMaterialRoute() {
  return render(
    <MemoryRouter initialEntries={["/materials"]}>
      <Routes>
        <Route path="/account" element={<div>account page</div>} />
        <Route element={<ProtectedRoute capability="materials:view" />}>
          <Route path="/materials" element={<div>materials content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => mockedUseAuth.mockReset());
  afterEach(cleanup);

  it("waits until authentication and the profile are settled", () => {
    mockedUseAuth.mockReturnValue({ loading: true, user: null, profile: null } as ReturnType<typeof useAuth>);
    renderRoute();
    expect(screen.getByText("app.loading.auth")).toBeInTheDocument();
  });

  it("redirects signed-out users and explains denied access to signed-in users", () => {
    mockedUseAuth.mockReturnValue({ loading: false, user: null, profile: null } as ReturnType<typeof useAuth>);
    const { unmount } = renderRoute();
    expect(screen.getByText("account page")).toBeInTheDocument();
    unmount();

    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "viewer" },
      profile: { role: "viewer" }
    } as ReturnType<typeof useAuth>);
    renderRoute();
    expect(screen.getByText("auth.denied")).toBeInTheDocument();
    expect(screen.queryByText("account page")).not.toBeInTheDocument();
  });

  it("renders the route for a role with the requested capability", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "member" },
      profile: { role: "member" }
    } as ReturnType<typeof useAuth>);
    renderRoute();
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("does not mount protected content before the required password is replaced", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "temporary-password-user" },
      profile: { role: "member", mustChangePassword: true }
    } as ReturnType<typeof useAuth>);
    renderRoute();
    expect(screen.getByText("error.passwordChangeRequired")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("allows a Viewer to open the map", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "viewer" },
      profile: { role: "viewer" }
    } as ReturnType<typeof useAuth>);
    renderMapRoute();
    expect(screen.getByText("map content")).toBeInTheDocument();
  });

  it("allows a Viewer to open material assistance", () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "viewer" },
      profile: { role: "viewer" }
    } as ReturnType<typeof useAuth>);
    renderMaterialRoute();
    expect(screen.getByText("materials content")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMaterialWorkspace } from "../features/material/data/materialRepository";
import { useAuth } from "../state/AuthContext";
import { MaterialPage } from "./MaterialPage";

vi.mock("../i18n/I18nContext", () => ({
  useI18n: () => ({ language: "zh-CN", t: (key: string) => key })
}));
vi.mock("../state/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../services/siteRepository", () => ({ getTownImages: vi.fn().mockResolvedValue([]) }));
vi.mock("../features/material/data/materialRepository", () => ({
  getMaterialWorkspace: vi.fn(),
  setMaterialClaimCompleted: vi.fn(),
  subscribeToMaterialWorkspace: vi.fn(() => ({ topic: "materials" })),
  unsubscribeFromMaterialWorkspace: vi.fn()
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetWorkspace = vi.mocked(getMaterialWorkspace);
const emptyWorkspace = { projects: [], items: [], assignments: [], leaderboard: [] };

describe("MaterialPage", () => {
  beforeEach(() => {
    mockedGetWorkspace.mockResolvedValue(emptyWorkspace);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lets a Viewer read the workspace without showing project creation", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "viewer-id" },
      profile: { role: "viewer" }
    } as ReturnType<typeof useAuth>);
    const { container } = render(<MaterialPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "materials.title" })).toBeInTheDocument());
    expect(screen.queryByRole("img", { name: /楹雾材料互助/ })).not.toBeInTheDocument();
    expect(await screen.findByText("materials.empty.title")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "materials.create" })).not.toBeInTheDocument();
    const toolbar = container.querySelector(".material-toolbar");
    expect(toolbar?.children[0]).toHaveClass("material-search");
    expect(toolbar?.querySelector(".material-toolbar-actions .material-stats")).toBeInTheDocument();
    expect(container.querySelector(".material-hero .material-stats")).toBeNull();
  });

  it("lets a Member create a project", async () => {
    mockedUseAuth.mockReturnValue({
      user: { id: "member-id" },
      profile: { role: "member" }
    } as ReturnType<typeof useAuth>);
    render(<MaterialPage />);
    expect(await screen.findByRole("button", { name: "materials.create" })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resource } from "../../domain/types";
import type { MaterialProject, MaterialWorkspace } from "../material/domain/materialTypes";
import { ResourceManagementPanel } from "./ResourceManagementPanel";

const resourceMocks = vi.hoisted(() => ({
  checkResourceUpdate: vi.fn(),
  createResource: vi.fn(),
  deleteResource: vi.fn(),
  listResourcesPage: vi.fn(),
  resolveProjectUrl: vi.fn(),
  updateResourceDetails: vi.fn()
}));
const materialMocks = vi.hoisted(() => ({
  administerMaterialProject: vi.fn(),
  deleteMaterialProject: vi.fn(),
  getMaterialWorkspace: vi.fn()
}));

vi.mock("../../services/resourceRepository", () => resourceMocks);
vi.mock("../material/data/materialRepository", () => materialMocks);
vi.mock("../../components/ResourceIcon", () => ({
  ResourceIcon: () => <span aria-hidden="true">icon</span>
}));
vi.mock("../material/components/MaterialDialogs", () => ({
  ImportProjectDialog: () => <div>material-import</div>,
  StarPicker: () => <div>priority</div>,
  formatCount: (value: number) => String(value)
}));
vi.mock("../../i18n/I18nContext", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: (key: string, values?: Record<string, string | number>) =>
      values?.name === undefined ? key : `${key}:${values.name}`
  })
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const resource: Resource = {
  id: "00000000-0000-4000-8000-000000000001",
  externalId: "project",
  name: "Project",
  description: "Note",
  source: "modrinth",
  resourceType: "plugin",
  projectType: "project",
  url: "https://modrinth.com/project/project",
  iconUrl: null,
  author: "Builder",
  currentVersion: "1.0",
  latestVersion: "1.0",
  gameVersions: [],
  loaders: [],
  tags: [],
  updateAvailable: false,
  projectUpdatedAt: null,
  updateCheckedAt: null,
  createdAt: "2026-07-27T00:00:00.000Z"
};
const materialProject: MaterialProject = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Warehouse",
  priority: 2,
  storageLocation: "North gate",
  sourceTitle: "Materials",
  sourceDate: "2026-07-27",
  creatorId: "00000000-0000-4000-8000-000000000003",
  creatorUsername: "DogSam",
  originX: 0,
  originY: 64,
  originZ: 0,
  mirror: "none",
  rotation: 0,
  projectionFileName: null,
  projectionFileSize: null,
  projectionStoragePath: null,
  hasProjectionFile: false,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
  itemCount: 12,
  totalCount: 500,
  missingCount: 120
};
const workspace: MaterialWorkspace = {
  projects: [materialProject],
  items: [],
  assignments: [],
  leaderboard: []
};

describe("ResourceManagementPanel", () => {
  it("edits both resource catalog and material-assistance projects through one admin module", async () => {
    resourceMocks.listResourcesPage.mockResolvedValue({ items: [resource], total: 1, page: 1, pageSize: 10 });
    materialMocks.getMaterialWorkspace.mockResolvedValue(workspace);
    const onNotice = vi.fn();
    render(<ResourceManagementPanel onNotice={onNotice} />);

    expect(await screen.findByText("Project")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "admin.resources.edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "admin.resources.name" }), { target: { value: "Renamed project" } });
    fireEvent.click(screen.getByRole("button", { name: "app.save" }));
    await waitFor(() => expect(resourceMocks.updateResourceDetails)
      .toHaveBeenCalledWith(resource.id, { name: "Renamed project", description: "Note" }));

    fireEvent.click(screen.getByRole("button", { name: "admin.resources.materials" }));
    expect(await screen.findByText("Warehouse")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "admin.resources.edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "admin.resources.name" }), { target: { value: "Main warehouse" } });
    fireEvent.click(screen.getByRole("button", { name: "app.save" }));
    await waitFor(() => expect(materialMocks.administerMaterialProject).toHaveBeenCalledWith(
      materialProject.id,
      { name: "Main warehouse", priority: 2, storageLocation: "North gate" }
    ));
  });

  it("returns to the last valid page after deleting its final resource", async () => {
    let deleted = false;
    const finalPageResource = { ...resource, id: "00000000-0000-4000-8000-000000000004", name: "Final page" };
    resourceMocks.listResourcesPage.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 2) {
        return { items: deleted ? [] : [finalPageResource], total: deleted ? 10 : 11, page, pageSize: 10 };
      }
      return { items: [resource], total: deleted ? 10 : 11, page, pageSize: 10 };
    });
    resourceMocks.deleteResource.mockImplementation(async () => {
      deleted = true;
    });
    materialMocks.getMaterialWorkspace.mockResolvedValue(workspace);

    render(<ResourceManagementPanel onNotice={vi.fn()} />);
    await screen.findByText("Project");
    fireEvent.click(screen.getByRole("button", { name: "app.next" }));
    expect(await screen.findByText("Final page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "app.delete" }));
    fireEvent.click(screen.getByRole("button", { name: "app.confirm" }));

    expect(await screen.findByText("Project")).toBeInTheDocument();
    await waitFor(() => expect(resourceMocks.listResourcesPage)
      .toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })));
  });
});

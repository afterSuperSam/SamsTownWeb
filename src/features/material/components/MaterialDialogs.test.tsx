// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterialItem } from "../domain/materialTypes";
import { BatchClaimDialog, ClaimDialog, ImportProjectDialog, QuickClaimDialog } from "./MaterialDialogs";

const repositoryMocks = vi.hoisted(() => ({
  createMaterialProject: vi.fn(),
  setMaterialClaim: vi.fn(),
  setMaterialClaims: vi.fn(),
  setMaterialClaimsCompleted: vi.fn(),
  updateMaterialProject: vi.fn()
}));

vi.mock("../data/materialRepository", () => repositoryMocks);
vi.mock("../../../i18n/I18nContext", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: (key: string, values?: Record<string, string | number>) =>
      values?.count === undefined ? key : `${key}:${values.count}`
  })
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const item: MaterialItem = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  itemId: "minecraft:stone",
  nameZh: "石头",
  nameEn: "Stone",
  imageUrl: null,
  totalCount: 128,
  sourceMissingCount: 128,
  initialAvailableCount: 0,
  mismatchedCount: 0,
  existingCount: 0,
  missingCount: 128,
  reservedCount: 0,
  sortOrder: 0
};

function renderClaimDialog() {
  render(<ClaimDialog
    item={item}
    assignment={null}
    maxAmount={128}
    onClose={vi.fn()}
    onSaved={vi.fn().mockResolvedValue(undefined)}
    onNotice={vi.fn()}
  />);
}

describe("ClaimDialog", () => {
  it("claims the full available amount by default without showing an amount input", async () => {
    renderClaimDialog();

    expect(screen.getByRole("button", { name: "materials.claim.all" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "materials.claim.save" }));

    await waitFor(() => expect(repositoryMocks.setMaterialClaim)
      .toHaveBeenCalledWith(item.id, 128, ""));
  });

  it("shows and submits the amount only after partial claim is selected", async () => {
    renderClaimDialog();

    fireEvent.click(screen.getByRole("button", { name: "materials.claim.partial" }));
    const amountInput = screen.getByRole("spinbutton");
    expect(amountInput).toHaveValue(128);
    fireEvent.change(amountInput, { target: { value: "64" } });
    fireEvent.click(screen.getByRole("button", { name: "materials.claim.save" }));

    await waitFor(() => expect(repositoryMocks.setMaterialClaim)
      .toHaveBeenCalledWith(item.id, 64, ""));
  });
});

describe("BatchClaimDialog", () => {
  const secondItem: MaterialItem = {
    ...item,
    id: "00000000-0000-4000-8000-000000000003",
    itemId: "minecraft:dirt",
    nameZh: "泥土",
    nameEn: "Dirt",
    totalCount: 32,
    sourceMissingCount: 32,
    missingCount: 32
  };
  const batchItems = [
    { item, maxAmount: 128 },
    { item: secondItem, maxAmount: 32 }
  ];

  it("defaults to atomically claiming each selected material's full capacity", async () => {
    render(<BatchClaimDialog
      items={batchItems}
      onClose={vi.fn()}
      onSaved={vi.fn().mockResolvedValue(undefined)}
      onNotice={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: "materials.claim.all" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "materials.batch.claim" }));

    await waitFor(() => expect(repositoryMocks.setMaterialClaims)
      .toHaveBeenCalledWith([item.id, secondItem.id], null, ""));
  });

  it("shows one bounded amount for every material only in partial mode", async () => {
    render(<BatchClaimDialog
      items={batchItems}
      onClose={vi.fn()}
      onSaved={vi.fn().mockResolvedValue(undefined)}
      onNotice={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "materials.claim.partial" }));
    const amountInputs = screen.getAllByRole("spinbutton");
    expect(amountInputs).toHaveLength(2);
    expect(amountInputs[0]).toHaveValue(128);
    expect(amountInputs[1]).toHaveValue(32);
    fireEvent.change(amountInputs[0], { target: { value: "64" } });
    fireEvent.click(screen.getByRole("button", { name: "materials.batch.claim" }));

    await waitFor(() => expect(repositoryMocks.setMaterialClaims)
      .toHaveBeenCalledWith([item.id, secondItem.id], [64, 32], ""));
  });
});

describe("ImportProjectDialog", () => {
  it("uses one textarea for the location and shows export guidance below priority", () => {
    render(<ImportProjectDialog
      onClose={vi.fn()}
      onCreated={vi.fn().mockResolvedValue(undefined)}
      onNotice={vi.fn()}
    />);

    expect(screen.getByRole("textbox", { name: "materials.import.location" })).toHaveClass("material-location-input");
    expect(screen.getByText("materials.import.guideTitle")).toBeInTheDocument();
    expect(screen.getByText("materials.import.guideStep")).toBeInTheDocument();
    expect(screen.getByText("materials.import.guidePath")).toBeInTheDocument();
  });
});

describe("QuickClaimDialog", () => {
  const smallItem: MaterialItem = {
    ...item,
    id: "00000000-0000-4000-8000-000000000004",
    itemId: "minecraft:glass",
    nameZh: "玻璃",
    nameEn: "Glass",
    totalCount: 32,
    sourceMissingCount: 32,
    missingCount: 32
  };

  it("previews items under the selected threshold and claims them atomically after sliding", async () => {
    render(<QuickClaimDialog
      items={[
        { item, maxAmount: 128 },
        { item: smallItem, maxAmount: 32 }
      ]}
      onClose={vi.fn()}
      onSaved={vi.fn().mockResolvedValue(undefined)}
      onNotice={vi.fn()}
    />);

    expect(screen.getByText("玻璃")).toBeInTheDocument();
    expect(screen.queryByText("石头")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: "materials.quickClaim.threshold" }), {
      target: { value: "128" }
    });
    expect(screen.getByText("石头")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "materials.quickClaim.slide" }), {
      target: { value: "100" }
    });
    await waitFor(() => expect(repositoryMocks.setMaterialClaims)
      .toHaveBeenCalledWith([item.id, smallItem.id], null, ""));
  });

  it("refreshes and closes a stale preview after a concurrent claim failure", async () => {
    repositoryMocks.setMaterialClaims.mockRejectedValueOnce(new Error("error.materialClaimExceeded"));
    const onClose = vi.fn();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<QuickClaimDialog
      items={[{ item: smallItem, maxAmount: 32 }]}
      onClose={onClose}
      onSaved={onSaved}
      onNotice={vi.fn()}
    />);

    fireEvent.change(screen.getByRole("slider", { name: "materials.quickClaim.slide" }), {
      target: { value: "100" }
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});

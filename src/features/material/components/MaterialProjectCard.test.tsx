// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterialItem, MaterialProject } from "../domain/materialTypes";
import { MaterialProjectCard } from "./MaterialProjectCard";

vi.mock("../../../i18n/I18nContext", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: (key: string) => key
  })
}));
vi.mock("../../atlas/components/MinecraftAvatar", () => ({
  MinecraftAvatar: ({ username }: { username: string }) => <span>{username}</span>
}));

afterEach(cleanup);

const project: MaterialProject = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "主城仓库",
  priority: 2,
  storageLocation: "主仓",
  sourceTitle: "材料清单",
  sourceDate: "2026-07-26",
  creatorId: "00000000-0000-4000-8000-000000000002",
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
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  itemCount: 3,
  totalCount: 30,
  missingCount: 18
};

const items: MaterialItem[] = Array.from({ length: 3 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000001${index}`,
  projectId: project.id,
  itemId: `minecraft:item_${index}`,
  nameZh: `材料 ${index}`,
  nameEn: `Material ${index}`,
  imageUrl: null,
  totalCount: 10,
  sourceMissingCount: 8,
  initialAvailableCount: index,
  mismatchedCount: 0,
  existingCount: index,
  missingCount: 8 - index,
  reservedCount: 0,
  sortOrder: index
}));

describe("MaterialProjectCard batch workflow", () => {
  it("selects every visible item and opens one bounded batch claim", () => {
    const onBatchClaim = vi.fn();
    const onQuickClaim = vi.fn();
    render(<MaterialProjectCard
      project={project}
      items={items}
      assignments={[]}
      currentUserId="00000000-0000-4000-8000-000000000003"
      canEdit
      search=""
      onEdit={vi.fn()}
      onDownload={vi.fn()}
      onClaim={vi.fn()}
      onComplete={vi.fn()}
      onQuickClaim={onQuickClaim}
      onBatchClaim={onBatchClaim}
      onBatchComplete={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "materials.project.expand" }));
    fireEvent.click(screen.getByRole("button", { name: "materials.quickClaim.open" }));
    expect(onQuickClaim.mock.calls[0][0].map(({ maxAmount }: { maxAmount: number }) => maxAmount)).toEqual([8, 7, 6]);
    fireEvent.click(screen.getByRole("checkbox", { name: "materials.batch.selectAll" }));
    fireEvent.click(screen.getByRole("button", { name: "materials.batch.claimCount" }));

    expect(onBatchClaim).toHaveBeenCalledOnce();
    expect(onBatchClaim.mock.calls[0][0]).toHaveLength(3);
    expect(onBatchClaim.mock.calls[0][0].map(({ maxAmount }: { maxAmount: number }) => maxAmount)).toEqual([8, 7, 6]);
  });

  it("sorts each project independently and always keeps completed materials last", () => {
    const sortableItems = [
      { ...items[0], totalCount: 100, missingCount: 2, sortOrder: 0 },
      { ...items[1], totalCount: 1000, missingCount: 0, sortOrder: 1 },
      { ...items[2], totalCount: 20, missingCount: 8, sortOrder: 2 }
    ];
    const { container } = render(<MaterialProjectCard
      project={project}
      items={sortableItems}
      assignments={[]}
      currentUserId="00000000-0000-4000-8000-000000000003"
      canEdit={false}
      search=""
      onEdit={vi.fn()}
      onDownload={vi.fn()}
      onClaim={vi.fn()}
      onComplete={vi.fn()}
      onQuickClaim={vi.fn()}
      onBatchClaim={vi.fn()}
      onBatchComplete={vi.fn()}
    />);

    const renderedNames = () => [...container.querySelectorAll(".material-name strong")].map(node => node.textContent);
    fireEvent.click(screen.getByRole("button", { name: "materials.project.expand" }));
    expect(renderedNames()).toEqual([items[0].nameZh, items[2].nameZh, items[1].nameZh]);

    fireEvent.click(screen.getByRole("button", { name: "materials.sort.label" }));
    fireEvent.click(screen.getByRole("option", { name: "materials.sort.missing" }));
    expect(renderedNames()).toEqual([items[2].nameZh, items[0].nameZh, items[1].nameZh]);

    fireEvent.click(screen.getByRole("button", { name: "materials.sort.descending" }));
    expect(renderedNames()).toEqual([items[0].nameZh, items[2].nameZh, items[1].nameZh]);

    fireEvent.click(screen.getByRole("button", { name: "materials.sort.label" }));
    fireEvent.click(screen.getByRole("option", { name: "materials.sort.total" }));
    expect(renderedNames()).toEqual([items[2].nameZh, items[0].nameZh, items[1].nameZh]);
  });
});

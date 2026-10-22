// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateCycleCopies, DriftWall, measureCycleLayoutHeight, type DriftWallItem } from "./DriftWall";

const items: DriftWallItem[] = [
  { id: "wide", image: "/wide.jpg", title: "横幅风景", alt: "横幅", layout: "wide" },
  { id: "tall", image: "/tall.jpg", title: "竖幅建筑", alt: "竖幅", layout: "tall" },
  { id: "standard", image: "/standard.jpg", title: "标准照片", alt: "标准", layout: "standard" }
];

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriftWall", () => {
  it("measures the untransformed layout cycle for seamless wrapping", () => {
    const cycle = document.createElement("div");
    Object.defineProperty(cycle, "offsetHeight", { value: 1125 });
    cycle.getBoundingClientRect = () => ({
      bottom: 991,
      height: 991,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    expect(measureCycleLayoutHeight(cycle)).toBe(1125);
    expect(measureCycleLayoutHeight(cycle)).not.toBe(cycle.getBoundingClientRect().height);
  });

  it("keeps enough repeated cycles around the centered viewport", () => {
    expect(calculateCycleCopies(758, 760)).toBe(5);
    expect(calculateCycleCopies(1072, 760)).toBe(4);
    expect(calculateCycleCopies(0, 760)).toBe(4);
  });

  it("renders each gallery layout once in the accessible cycle", () => {
    const { container } = render(<DriftWall items={items} label="小镇风景" />);
    const wall = container.querySelector(".drift-wall");
    const accessibleCycles = container.querySelectorAll(".drift-wall__cycle:not([aria-hidden])");
    const accessibleTiles = container.querySelectorAll(".drift-wall__cycle:not([aria-hidden]) .drift-wall__tile");

    expect(wall).toHaveAttribute("aria-label", "小镇风景");
    expect(accessibleCycles).toHaveLength(3);
    expect(accessibleTiles).toHaveLength(3);
    expect(container.querySelector(".drift-wall__tile--wide")).toBeInTheDocument();
    expect(container.querySelector(".drift-wall__tile--tall")).toBeInTheDocument();
    expect(container.querySelector(".drift-wall__tile--standard")).toBeInTheDocument();
    expect(within(wall as HTMLElement).getAllByText("横幅风景").length).toBeGreaterThan(0);
  });

  it("keeps repeated track copies out of keyboard navigation", () => {
    const { container } = render(<DriftWall items={items} label="小镇风景" />);
    const duplicateTiles = container.querySelectorAll('.drift-wall__cycle[aria-hidden="true"] .drift-wall__tile');

    expect(duplicateTiles.length).toBeGreaterThan(0);
    duplicateTiles.forEach(tile => expect(tile).toHaveAttribute("tabindex", "-1"));
  });

  it("reveals a caption from the same tile when tapped", () => {
    const { container } = render(<DriftWall items={items} label="小镇风景" />);
    const tile = container.querySelector<HTMLElement>('.drift-wall__cycle:not([aria-hidden]) .drift-wall__tile[aria-label="横幅风景"]')!;

    fireEvent.click(tile);
    expect(tile).toHaveClass("is-active");
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(within(tile).getByText("横幅风景")).toBeInTheDocument();
  });
});

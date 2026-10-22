// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function BrokenView(): never {
  throw new Error("render failed");
}

describe("ErrorBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("replaces a crashed subtree with a usable recovery screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><BrokenView /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("页面暂时无法显示");
    expect(screen.getByRole("button", { name: "重新载入" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回主页" })).toHaveAttribute("href", "/");
  });
});

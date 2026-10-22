// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TownImage } from "./TownImage";

afterEach(cleanup);

describe("TownImage", () => {
  it("resolves historical bundled PNG identifiers to optimized JPG assets", () => {
    render(<TownImage source="images/ingame/1.png" alt="Town" />);
    expect(screen.getByRole("img", { name: "Town" }).getAttribute("src"))
      .toBe("/images/optimized/ingame/1.jpg");
  });

  it("keeps other local formats and remote URLs unchanged", () => {
    const { rerender } = render(<TownImage source="images/local/photo.jpg" alt="Town" />);
    expect(screen.getByRole("img", { name: "Town" }).getAttribute("src"))
      .toBe("/images/local/photo.jpg");

    rerender(<TownImage source="https://example.com/town.png" alt="Town" />);
    expect(screen.getByRole("img", { name: "Town" }).getAttribute("src"))
      .toBe("https://example.com/town.png");
  });

});

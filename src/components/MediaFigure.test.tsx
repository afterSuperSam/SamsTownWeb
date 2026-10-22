// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TownImage } from "../domain/types";
import { MediaFigure } from "./MediaFigure";

vi.mock("../i18n/I18nContext", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: (key: string) => key
  })
}));

const image: TownImage = {
  id: "town-image",
  mediaType: "image",
  area: "gallery",
  sourceUrl: "images/ingame/1.png",
  storagePath: null,
  externalId: null,
  externalUrl: null,
  creatorName: "",
  durationSeconds: null,
  captionZh: "小镇风景",
  captionEn: "Town view",
  altZh: "小镇",
  altEn: "Town",
  layout: "standard",
  visible: true,
  sortOrder: 0
};

describe("MediaFigure", () => {
  it("keeps captioned images keyboard-accessible", () => {
    const { container } = render(
      <MediaFigure media={image} alt="Town" caption="Town view" />
    );

    expect(container.querySelector("figure")).toHaveAttribute("tabindex", "0");
  });

  it("does not expose decorative gallery duplicates to keyboard focus", () => {
    const { container } = render(
      <MediaFigure media={image} alt="" caption="Town view" interactive={false} aria-hidden />
    );

    expect(container.querySelector("figure")).not.toHaveAttribute("tabindex");
  });
});

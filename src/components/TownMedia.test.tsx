// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TownImage } from "../domain/types";
import { TownMedia } from "./TownMedia";

vi.mock("../i18n/I18nContext", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: (key: string, values?: Record<string, string>) => values?.title ?? values?.name ?? key
  })
}));

afterEach(cleanup);

const video: TownImage = {
  id: "video-1",
  mediaType: "bilibili",
  area: "gallery",
  sourceUrl: "https://i0.hdslb.com/example.jpg",
  storagePath: null,
  externalId: "BV1B7411m7LV",
  externalUrl: "https://www.bilibili.com/video/BV1B7411m7LV",
  creatorName: "DogSam",
  durationSeconds: 125,
  captionZh: "楹雾镇宣传片",
  captionEn: "Yingwu Town film",
  altZh: "视频封面",
  altEn: "Video thumbnail",
  layout: "wide",
  visible: true,
  sortOrder: 0
};

describe("TownMedia", () => {
  it("defers the official Bilibili player until the visitor opens the video", () => {
    render(<TownMedia media={video} alt={video.altZh} />);

    expect(screen.queryByTitle(video.captionZh)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: video.captionZh }));

    const player = screen.getByTitle(video.captionZh);
    expect(player).toHaveAttribute("src", expect.stringContaining("player.bilibili.com/player.html"));
    expect(player).toHaveAttribute("src", expect.stringContaining("bvid=BV1B7411m7LV"));
    expect(screen.getByRole("link", { name: /media.openBilibili/ })).toHaveAttribute("href", video.externalUrl);
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEvent, TownImage } from "../domain/types";
import { getTownArchive } from "../services/siteRepository";
import { HistoryPage } from "./HistoryPage";

vi.mock("motion/react", async () => {
  const React = await import("react");
  return {
    motion: {
      path: ({ style, ...props }: React.SVGProps<SVGPathElement> & { style?: { pathLength?: number } }) => (
        <path {...props} data-path-length={style?.pathLength} />
      ),
      span: ({ style: _style, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props} />
    },
    useReducedMotion: () => false,
    useScroll: ({ target }: { target?: React.RefObject<HTMLElement | null> }) => {
      const [scrollYProgress, setScrollYProgress] = React.useState(0);
      React.useLayoutEffect(() => {
        if (target?.current) setScrollYProgress(.5);
      }, [target]);
      return { scrollYProgress };
    },
    useTransform: () => 1
  };
});
vi.mock("../components/HeroTransition", () => ({ HeroTransition: () => null }));
vi.mock("../hooks/useScrollReveal", () => ({ useScrollReveal: vi.fn() }));
vi.mock("../i18n/I18nContext", () => ({
  useI18n: () => ({ language: "zh-CN", t: (key: string) => key })
}));
vi.mock("../services/siteRepository", () => ({ getTownArchive: vi.fn() }));

const mockedGetTownArchive = vi.mocked(getTownArchive);
const history: HistoryEvent[] = [
  {
    id: "arrival",
    date: "2025-01-01",
    titleZh: "抵达",
    titleEn: "Arrival",
    bodyZh: "第一段历史",
    bodyEn: "The first event",
    imageId: null,
    showOnHome: false,
    sortOrder: 0
  },
  {
    id: "settlement",
    date: "2025-02-01",
    titleZh: "定居",
    titleEn: "Settlement",
    bodyZh: "第二段历史",
    bodyEn: "The second event",
    imageId: null,
    showOnHome: false,
    sortOrder: 1
  }
];
const galleryImages: TownImage[] = [
  {
    id: "gallery-later", mediaType: "image", area: "gallery", sourceUrl: "/later.jpg",
    storagePath: null, externalId: null, externalUrl: null, creatorName: "", durationSeconds: null,
    captionZh: "第二张", captionEn: "Second", altZh: "第二张", altEn: "Second",
    layout: "standard", visible: true, sortOrder: 2
  },
  {
    id: "gallery-first", mediaType: "image", area: "gallery", sourceUrl: "/first.jpg",
    storagePath: null, externalId: null, externalUrl: null, creatorName: "", durationSeconds: null,
    captionZh: "第一张", captionEn: "First", altZh: "第一张", altEn: "First",
    layout: "wide", visible: true, sortOrder: 1
  },
  {
    id: "not-gallery", mediaType: "image", area: "story", sourceUrl: "/story.jpg",
    storagePath: null, externalId: null, externalUrl: null, creatorName: "", durationSeconds: null,
    captionZh: "不展示", captionEn: "Hidden", altZh: "不展示", altEn: "Hidden",
    layout: "standard", visible: true, sortOrder: 0
  }
];

class ImmediateResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() { this.callback([], this as unknown as ResizeObserver); }
  disconnect() {}
  unobserve() {}
}

describe("HistoryPage timeline", () => {
  beforeEach(() => {
    mockedGetTownArchive.mockResolvedValue({ members: [], history, images: [] });
    vi.stubGlobal("ResizeObserver", ImmediateResizeObserver);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.historyEvent === "settlement" ? 340 : 96;
    });
  });

  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("measures the viewport-driven curve after archive data replaces the loading screen", async () => {
    const { container } = render(<MemoryRouter><HistoryPage /></MemoryRouter>);

    await waitFor(() => {
      const progress = container.querySelector(".history-curve-progress");
      const path = progress?.getAttribute("d");
      expect(path).toMatch(/^M 438 139 C /);
      expect(progress).toHaveAttribute("data-path-length", "0.5");
    });
    expect(container.querySelector(".history-curve-track")).not.toBeInTheDocument();
  });

  it("renders the ordered 2D gallery between members and the history timeline", async () => {
    mockedGetTownArchive.mockResolvedValue({ members: [], history, images: galleryImages });
    const { container } = render(<MemoryRouter initialEntries={["/history#gallery"]}><HistoryPage /></MemoryRouter>);

    await waitFor(() => expect(container.querySelectorAll(".archive-gallery-item")).toHaveLength(2));
    const members = container.querySelector("#members")!;
    const gallery = container.querySelector("#gallery")!;
    const timelineHeading = container.querySelector(".history-timeline-heading")!;
    expect(members.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gallery.compareDocumentPosition(timelineHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...gallery.querySelectorAll("figcaption")].map(item => item.textContent)).toEqual(["01第一张", "02第二张"]);
    expect(gallery.querySelector(".archive-gallery-item-wide")).toBeInTheDocument();
    expect(gallery.querySelector(".archive-gallery-item-standard")).toBeInTheDocument();
    expect(gallery).not.toHaveTextContent("不展示");
  });

  it("shows four complete gallery rows before expanding the archive", async () => {
    const manyImages = Array.from({ length: 13 }, (_, index): TownImage => ({
      ...galleryImages[1],
      id: `gallery-${index}`,
      captionZh: `图片${index + 1}`,
      altZh: `图片${index + 1}`,
      layout: "standard",
      sortOrder: index
    }));
    mockedGetTownArchive.mockResolvedValue({ members: [], history, images: manyImages });
    const { container, getByRole } = render(<MemoryRouter><HistoryPage /></MemoryRouter>);

    await waitFor(() => expect(container.querySelectorAll(".archive-gallery-item")).toHaveLength(12));
    const toggle = getByRole("button", { name: "history.gallery.showAll" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(container.querySelectorAll(".archive-gallery-item")).toHaveLength(13);
    expect(getByRole("button", { name: "history.gallery.collapse" })).toHaveAttribute("aria-expanded", "true");
  });
});

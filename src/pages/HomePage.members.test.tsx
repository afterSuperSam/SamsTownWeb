// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContent, defaultFaqs } from "../domain/defaults";
import type { HistoryEvent, TownImage, TownMember } from "../domain/types";
import { getSiteBundle } from "../services/siteRepository";
import { HomePage } from "./HomePage";

vi.mock("../components/CountUp", () => ({ CountUp: ({ value }: { value: number }) => <i>{value}</i> }));
vi.mock("../components/DayCounter", () => ({ DayCounter: () => <span>days</span> }));
vi.mock("../components/DriftWall", () => ({ DriftWall: () => <div data-testid="gallery-wall" /> }));
vi.mock("../components/TownImage", () => ({ TownImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("../hooks/useScrollReveal", () => ({ useScrollReveal: vi.fn() }));
vi.mock("../i18n/I18nContext", () => ({
  useI18n: () => ({ language: "zh-CN", content: defaultContent, t: (key: string) => key })
}));
vi.mock("../services/siteRepository", () => ({ getSiteBundle: vi.fn() }));

const mockedGetSiteBundle = vi.mocked(getSiteBundle);
const testMembers: TownMember[] = ([
  ["primary", 18], ["town", 24], ["friend", 12]
] as const).flatMap(([group, count]) => Array.from({ length: count }, (_, index) => ({
  id: `${group}-${index}`, username: `${group}_${index}`, roleZh: "成员", roleEn: "Member",
  variant: "", group, showOnHome: group === "primary" && index < 6,
  introZh: `简介 ${group} ${index}`, introEn: `Introduction ${group} ${index}`, sortOrder: index
})));
const testImages: TownImage[] = Array.from({ length: 3 }, (_, index) => ({
  id: `story-${index}`, mediaType: "image", area: "story", sourceUrl: `/story-${index}.jpg`,
  storagePath: null, externalId: null, externalUrl: null, creatorName: "", durationSeconds: null,
  captionZh: `故事 ${index}`, captionEn: `Story ${index}`, altZh: `故事 ${index}`, altEn: `Story ${index}`,
  layout: "wide", visible: true, sortOrder: index
}));
const galleryImage: TownImage = {
  id: "gallery", mediaType: "image", area: "gallery", sourceUrl: "/gallery.jpg",
  storagePath: null, externalId: null, externalUrl: null, creatorName: "", durationSeconds: null,
  captionZh: "小镇照片", captionEn: "Town view", altZh: "小镇照片", altEn: "Town view",
  layout: "standard", visible: true, sortOrder: 0
};
const testHistory: HistoryEvent = {
  id: "history", date: "2026-01-01", titleZh: "历史", titleEn: "History", bodyZh: "正文", bodyEn: "Body",
  imageId: null, showOnHome: true, sortOrder: 0
};

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

function renderPage() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

describe("HomePage featured members", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    mockedGetSiteBundle.mockResolvedValue({
      content: defaultContent,
      members: testMembers,
      history: [testHistory],
      images: testImages,
      faqs: defaultFaqs,
      announcements: []
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows at most four selected members with the shared avatar treatment", async () => {
    setViewport(1280);
    const { container, findByText } = renderPage();
    await waitFor(() => expect(container.querySelectorAll(".featured-member-row")).toHaveLength(4));
    expect(await findByText("简介 primary 0")).toBeInTheDocument();
    expect(container.querySelector('.featured-archive-link[href="/history#members"]')).toBeInTheDocument();
    expect(container.querySelector(".featured-member-row button")).not.toBeInTheDocument();
  });

  it("reveals the homepage section navigation only after scrolling", async () => {
    setViewport(1280);
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector(".home-quick-nav")).toBeInTheDocument());
    const nav = container.querySelector<HTMLElement>(".home-quick-nav")!;
    const links = [...nav.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links).toHaveLength(8);
    expect(links.map(link => link.hash)).toEqual([
      "#home", "#story", "#gallery", "#members", "#history-preview",
      "#join", "#faq", "#survey"
    ]);
    const history = container.querySelector("#history-preview")!;
    const join = container.querySelector("#join")!;
    const faq = container.querySelector("#faq")!;
    expect(history.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(join.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav).not.toHaveClass("visible");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 700 });
    fireEvent.scroll(window);
    await waitFor(() => expect(nav).toHaveClass("visible"));
  });

  it("renders the Story follow-up with two managed community images", async () => {
    const { container, findByText } = renderPage();

    expect(await findByText("home.story.whyTitle")).toBeInTheDocument();
    expect(container.querySelectorAll(".story-reason-media")).toHaveLength(2);
    expect(container.querySelector("#story")).toHaveAttribute("data-reveal-group");
    expect(container.querySelector(".story-media")).toHaveAttribute("data-reveal", "media-right");
    expect(container.querySelector(".story-reasons-media")).toHaveAttribute("data-reveal", "media-left");
    expect(container.querySelector(".section-heading")).toHaveAttribute("data-reveal-group");
    expect(container.querySelector(".faq-list")).not.toHaveAttribute("data-reveal-group");
  });

  it("only exposes the complete gallery link when gallery media exists", async () => {
    const withoutGallery = renderPage();
    await waitFor(() => expect(withoutGallery.container.querySelector(".home-page")).toBeInTheDocument());
    expect(withoutGallery.container.querySelector('.gallery-archive-link[href="/history#gallery"]')).not.toBeInTheDocument();
    withoutGallery.unmount();

    mockedGetSiteBundle.mockResolvedValue({
      content: defaultContent,
      members: testMembers,
      history: [testHistory],
      images: [...testImages, galleryImage],
      faqs: defaultFaqs,
      announcements: []
    });
    const withGallery = renderPage();
    await waitFor(() => expect(withGallery.container.querySelector(".gallery-archive-link")).toBeInTheDocument());
    expect(withGallery.container.querySelector('.gallery-archive-link[href="/history#gallery"]')).toBeInTheDocument();
  });

  it("keeps the complete history entry on the centered history control", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector(".home-page")).toBeInTheDocument());
    expect(container.querySelector('.history-archive-link[href="/history"]')).toBeInTheDocument();
  });

  it("keeps FAQ content visible while repeatedly expanding and collapsing", async () => {
    mockedGetSiteBundle.mockResolvedValue({
      content: defaultContent,
      members: testMembers,
      history: [testHistory],
      images: testImages,
      faqs: [{
        id: "join-faq",
        questionZh: "怎么加入？",
        questionEn: "How do I join?",
        answerZh: "联系管理员即可加入。",
        answerEn: "Contact an administrator.",
        visible: true,
        sortOrder: 0
      }],
      announcements: []
    });
    const { container, findByRole } = renderPage();
    const question = await findByRole("button", { name: /怎么加入/ });
    const article = question.closest("article")!;
    const answer = article.querySelector(".faq-answer")!;

    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(article).not.toHaveAttribute("data-reveal");
    for (let cycle = 0; cycle < 3; cycle += 1) {
      fireEvent.click(question);
      expect(question).toHaveAttribute("aria-expanded", "false");
      expect(answer).toHaveAttribute("aria-hidden", "true");
      fireEvent.click(question);
      expect(question).toHaveAttribute("aria-expanded", "true");
      expect(answer).toHaveAttribute("aria-hidden", "false");
      expect(container).toHaveTextContent("联系管理员即可加入。");
    }
  });

  it("renders only history selected for home and exposes visible notices", async () => {
    mockedGetSiteBundle.mockResolvedValue({
      content: defaultContent,
      members: testMembers,
      history: [
        { ...testHistory, id: "hidden", titleZh: "不应展示", showOnHome: false },
        { ...testHistory, id: "shown", titleZh: "主页历史", showOnHome: true }
      ],
      images: testImages,
      faqs: defaultFaqs,
      announcements: [{
        id: "notice",
        kind: "affair",
        titleZh: "本周事务",
        titleEn: "This week",
        subtitleZh: "建设安排",
        subtitleEn: "Build plan",
        bodyZh: "周末集合。",
        bodyEn: "Meet this weekend.",
        imageId: null,
        visible: true,
        sortOrder: 0
      }]
    });

    const { findByText, queryByText, container } = renderPage();
    expect(await findByText("主页历史")).toBeInTheDocument();
    expect(queryByText("不应展示")).not.toBeInTheDocument();
    expect(await findByText("本周事务")).toBeInTheDocument();
    expect(container.querySelector('a[href="#announcements"]')).toBeInTheDocument();
  });
});

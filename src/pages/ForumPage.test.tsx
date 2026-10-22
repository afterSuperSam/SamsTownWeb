// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForumPost } from "../domain/types";
import {
  listForumAnnouncements,
  listForumPosts
} from "../features/forum/forumRepository";
import { useAuth } from "../state/AuthContext";
import { ForumPage } from "./ForumPage";

const { translate } = vi.hoisted(() => ({
  translate: (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(":")}` : key
}));

vi.mock("../i18n/I18nContext", () => ({
  useI18n: () => ({
    language: "zh-CN",
    t: translate
  })
}));
vi.mock("../state/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../hooks/useTownHero", () => ({
  useTownHero: () => ({ image: null, ready: true })
}));
vi.mock("../features/forum/forumRepository", async importOriginal => {
  const original = await importOriginal<typeof import("../features/forum/forumRepository")>();
  return {
    ...original,
    listForumPosts: vi.fn(),
    listForumAnnouncements: vi.fn(),
    createForumPost: vi.fn(),
    updateForumPost: vi.fn(),
    deleteForumPost: vi.fn()
  };
});

const mockedUseAuth = vi.mocked(useAuth);
const mockedListPosts = vi.mocked(listForumPosts);
const mockedListAnnouncements = vi.mocked(listForumAnnouncements);
const basePost: ForumPost = {
  id: "post-1",
  title: "测试留言",
  kind: "task",
  body: "<img src=x onerror=alert(1)>",
  authorId: "member-1",
  authorUsername: "MemberOne",
  createdAt: "2026-08-02T00:00:00Z",
  updatedAt: "2026-08-02T00:00:00Z"
};

describe("ForumPage", () => {
  beforeEach(() => {
    mockedUseAuth.mockReset();
    mockedListPosts.mockReset();
    mockedListAnnouncements.mockReset();
    mockedListAnnouncements.mockResolvedValue([]);
    mockedListPosts.mockResolvedValue([basePost]);
  });
  afterEach(cleanup);

  it("keeps Viewer read-only and renders submitted markup as plain text", async () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "viewer-1" },
      profile: { id: "viewer-1", username: "ViewerOne", role: "viewer" }
    } as ReturnType<typeof useAuth>);

    render(<ForumPage />);

    expect(await screen.findByText(basePost.body)).toBeInTheDocument();
    expect(document.querySelector(".forum-entry img")).toBeNull();
    expect(screen.queryByRole("button", { name: "forum.create" })).not.toBeInTheDocument();
    expect(mockedListPosts).toHaveBeenCalledWith({ kind: undefined, authorId: undefined, limit: 5 });
  });

  it("lets a Member manage only their own visible post", async () => {
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "member-1" },
      profile: { id: "member-1", username: "MemberOne", role: "member" }
    } as ReturnType<typeof useAuth>);
    mockedListPosts.mockResolvedValue([
      basePost,
      { ...basePost, id: "post-2", authorId: "member-2", authorUsername: "MemberTwo" }
    ]);

    render(<ForumPage />);

    expect(await screen.findByRole("button", { name: "forum.create" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "forum.edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "app.delete" })).toHaveLength(1);
  });

  it("provides a Member-only view of older posts by the current author", async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "member-1" },
      profile: { id: "member-1", username: "MemberOne", role: "member" }
    } as ReturnType<typeof useAuth>);

    render(<ForumPage />);
    await screen.findByText(basePost.title);
    await user.click(screen.getByRole("button", { name: "forum.filter.mine" }));

    await waitFor(() => expect(mockedListPosts).toHaveBeenLastCalledWith({
      kind: undefined,
      authorId: "member-1",
      limit: 21,
      offset: 0
    }));
  });

  it("pages through all posts owned by the current Member", async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      loading: false,
      user: { id: "member-1" },
      profile: { id: "member-1", username: "MemberOne", role: "member" }
    } as ReturnType<typeof useAuth>);
    mockedListPosts.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        ...basePost,
        id: `post-${index}`,
        title: `post ${index}`
      }))
    );

    render(<ForumPage />);
    await screen.findByText("post 0");
    await user.click(screen.getByRole("button", { name: "forum.filter.mine" }));
    await waitFor(() => expect(mockedListPosts).toHaveBeenLastCalledWith({
      kind: undefined,
      authorId: "member-1",
      limit: 21,
      offset: 0
    }));
    await user.click(await screen.findByRole("button", { name: "app.next" }));

    await waitFor(() => expect(mockedListPosts).toHaveBeenLastCalledWith({
      kind: undefined,
      authorId: "member-1",
      limit: 21,
      offset: 20
    }));
  });
});

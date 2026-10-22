import { describe, expect, it } from "vitest";
import { mapForumPost, normalizeForumDraft } from "./forumRepository";

describe("forumRepository", () => {
  it("normalizes editable text without accepting identity fields", () => {
    expect(normalizeForumDraft({
      title: "  收集石材  ",
      kind: "task",
      body: "  需要两盒石头。  "
    })).toEqual({
      title: "收集石材",
      kind: "task",
      body: "需要两盒石头。"
    });
  });

  it("rejects invalid kinds and empty content", () => {
    expect(() => normalizeForumDraft({ title: "", kind: "event", body: "正文" }))
      .toThrow("error.forumTitle");
    expect(() => normalizeForumDraft({ title: "标题", kind: "event", body: " " }))
      .toThrow("error.forumBody");
    expect(() => normalizeForumDraft({ title: "标题", kind: "other" as "task", body: "正文" }))
      .toThrow("error.forumKind");
  });

  it("maps database-owned author and timestamp fields", () => {
    expect(mapForumPost({
      id: "post-1",
      title: "活动通知",
      kind: "event",
      body: "周六集合",
      author_id: "user-1",
      author_username: "DogSam",
      created_at: "2026-08-02T00:00:00Z",
      updated_at: "2026-08-02T01:00:00Z"
    })).toMatchObject({
      id: "post-1",
      kind: "event",
      authorId: "user-1",
      authorUsername: "DogSam"
    });
  });
});

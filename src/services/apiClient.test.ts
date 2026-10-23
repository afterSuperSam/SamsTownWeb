import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), setSession: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/env", () => ({ env: { VITE_API_URL: "http://fixture.local", VITE_API_TIMEOUT_MS: 15_000 } }));
vi.mock("../lib/supabase", () => ({ isSupabaseConfigured: true, supabase: {
  auth: { getSession: mocks.session, setSession: mocks.setSession }, from: mocks.from, rpc: mocks.rpc
} }));
import { authenticatedApiRequest, publicApiRequest } from "./apiClient";
import { getHomeData, getSiteContent, getSiteBundle, getTownImages, getTownMembers, preloadHomeData, replaceMembers, uploadTownImage } from "./siteRepository";
import { formatTranslation, type TranslationKey } from "../i18n/translations";
import { changeOwnPassword, getCurrentProfile, updateAccountDetails } from "./authService";

beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ data: { session: null } }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function rowsQuery(rows: Record<string, unknown>[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const query = { then: result.then.bind(result), order: vi.fn(), eq: vi.fn(), limit: vi.fn() };
  query.order.mockReturnValue(query); query.eq.mockReturnValue(query); query.limit.mockReturnValue(query);
  return query;
}

describe("request and media boundaries", () => {
  it("keeps public content available after copy failure without allowing an admin fallback save", async () => {
    const contentError = new Error("site copy unavailable");
    const readContent = vi.fn().mockResolvedValue({ data: null, error: contentError });
    mocks.from.mockImplementation(table => table === "site_content"
      ? { select: () => ({ eq: () => ({ maybeSingle: readContent }) }) }
      : { select: () => rowsQuery([]) });
    mocks.rpc.mockResolvedValue({ data: { items: [], revision: "read-version" }, error: null });
    await expect(getSiteBundle()).resolves.toMatchObject({ members: [], images: [], faqs: [], content: { settings: { qqGroup: expect.any(String) } } });
    await getSiteBundle();
    expect(readContent).toHaveBeenCalledTimes(1);
    await expect(getSiteBundle({ refreshContent: true })).rejects.toBe(contentError);
  });
  it("reads full collections beyond the REST row limit and rejects stale saves", async () => {
    const rows = Array.from({ length: 1501 }, (_, index) => ({ id: String(index), username: `Player${index}`, member_group: "town" }));
    mocks.from.mockReturnValue({ select: () => ({ order: async () => ({ data: rows.slice(0, 1000), error: null }) }) });
    mocks.rpc.mockResolvedValueOnce({ data: { items: rows, revision: "read-version" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "error.contentChanged" } });
    const members = await getTownMembers({ forEditing: true });
    expect(members).toHaveLength(1501);
    await expect(replaceMembers(members)).rejects.toMatchObject({ message: "error.contentChanged" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("save_site_collection", expect.objectContaining({
      p_collection: "town_members", p_revision: "read-version"
    }));
  });
  it("keeps the newest editor read as its save baseline when older reads finish later", async () => {
    const rows = [{ id: "member", username: "Player", member_group: "town" }];
    let finishOlder!: (value: unknown) => void;
    mocks.rpc.mockReturnValueOnce(new Promise(resolve => { finishOlder = resolve; }))
      .mockResolvedValueOnce({ data: { items: rows, revision: "newer-read" }, error: null })
      .mockResolvedValueOnce({ data: "saved-version", error: null });
    const older = getTownMembers({ forEditing: true });
    const members = await getTownMembers({ forEditing: true });
    finishOlder({ data: { items: rows, revision: "older-read" }, error: null });
    await older;
    await replaceMembers(members);
    expect(mocks.rpc).toHaveBeenLastCalledWith("save_site_collection", expect.objectContaining({ p_revision: "newer-read" }));
  });
  it("keeps retired media in Other with valid editable categories and translations", async () => {
    const areas = ["hero", "story", "gallery", "join", "history", "mapHero", "other", "forumHero", "resources", "materialHero"];
    mocks.from.mockReturnValue({ select: () => rowsQuery(
      areas.map((area, index) => ({ id: String(index), area, source_url: `image-${index}.webp`, layout: index === 9 ? "retired" : "wide" }))
    ) });
    const images = await getTownImages();
    expect(images).toHaveLength(areas.length);
    expect(images.map(image => image.area)).toEqual([...areas.slice(0, 5), "other", "other", "other", "other", "other"]);
    expect(images[9].layout).toBe("standard");
    expect(images[7].sourceUrl).toBe("image-7.webp");
    for (const image of images) {
      for (const language of ["zh-CN", "en"] as const) {
        expect(formatTranslation(`admin.images.area.${image.area}` as TranslationKey, language)).toBeTruthy();
      }
    }
  });
  it("replaces the password-change session before the next authenticated request", async () => {
    mocks.session.mockResolvedValue({ data: { session: { access_token: "old-token" } } });
    mocks.setSession.mockImplementation(async session => {
      mocks.session.mockResolvedValue({ data: { session } });
      return { error: null };
    });
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ accessToken: "new-token", refreshToken: "new-refresh" }))
      .mockResolvedValueOnce(Response.json({}));
    await changeOwnPassword("replacement-password");
    await authenticatedApiRequest("/api/accounts");
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: "new-token", refresh_token: "new-refresh" });
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer new-token");
  });
  it("requires a session and sends JSON with a Bearer token", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await expect(authenticatedApiRequest("/api/accounts")).rejects.toThrow("error.session");
    expect(fetcher).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ data: { session: { access_token: "fixture-token" } } });
    await authenticatedApiRequest("/api/accounts", { method: "POST", body: "{}" });
    const init = fetcher.mock.calls[0][1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer fixture-token");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
  it.each(["username", "password"])("does not reuse a pre-update profile after changing %s", async update => {
    const oldProfile = { id: "member", username: "Before", role: "member", must_change_password: true };
    let completeRead!: (value: { data: typeof oldProfile; error: null }) => void;
    const single = vi.fn().mockReturnValueOnce(new Promise(resolve => { completeRead = resolve; }))
      .mockResolvedValueOnce({ data: { ...oldProfile, username: "After", must_change_password: false }, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.session.mockResolvedValue({ data: { session: { access_token: "old-token" } } });
    mocks.setSession.mockResolvedValue({ error: null });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ accessToken: "new-token", refreshToken: "new-refresh" }));
    const previous = getCurrentProfile("member");
    if (update === "username") await updateAccountDetails({ username: "After" });
    else await changeOwnPassword("replacement-password");
    const refreshed = getCurrentProfile("member");
    completeRead({ data: oldProfile, error: null });
    await previous;
    expect((await refreshed).username).toBe("After");
    expect(single).toHaveBeenCalledTimes(2);
  });
  it("preserves multipart boundaries and exposes server error codes", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "error.permission" }), { status: 403 }));
    expect(await publicApiRequest("/upload", { method: "POST", body: new FormData() })).toBeUndefined();
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has("Content-Type")).toBe(false);
    await expect(publicApiRequest("/restricted")).rejects.toThrow("error.permission");
  });
  it("aborts timed-out requests", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const request = expect(publicApiRequest("/slow")).rejects.toThrow("error.apiTimeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await request;
  });
  it("keeps the timeout active while reading a response body", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestSignal = init?.signal;
      return new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
        }
      }));
    });
    const request = expect(publicApiRequest("/slow-body")).rejects.toThrow("error.apiTimeout");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(requestSignal?.aborted).toBe(true);
    await request;
  });
  it("keeps caller cancellation active while reading a response body", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestSignal = init?.signal;
      return new Response(new ReadableStream({
        start(stream) {
          init?.signal?.addEventListener("abort", () => stream.error(new Error("aborted")), { once: true });
        }
      }));
    });
    const request = publicApiRequest("/cancel-body", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
    await expect(request).rejects.toThrow("error.apiUnavailable");
  });
  it("sends image uploads through the authenticated optimizer", async () => {
    mocks.session.mockResolvedValue({ data: { session: { access_token: "fixture-token" } }, error: null });
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "image", source_url: "image.png.display/720.webp", area: "gallery" }));
    const file = new File(["image"], "fixture.png", { type: "image/png" });
    await expect(uploadTownImage(file, {
      area: "gallery", captionZh: "", captionEn: "", altZh: "", altEn: "", layout: "standard"
    })).resolves.toMatchObject({ sourceUrl: "image.png.display/720.webp" });
    expect(send).toHaveBeenCalledWith("http://fixture.local/api/site/images", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("retains completed preloads until the homepage consumes them", async () => {
    const query = rowsQuery([]);
    mocks.from.mockReturnValue({ select: () => query });
    mocks.rpc.mockResolvedValue({ data: { items: [], revision: "fixture" }, error: null });
    preloadHomeData();
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.all(Object.values(getHomeData()));
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenCalledWith("show_on_home", true);
    expect(query.limit).toHaveBeenCalledWith(4);
  });
  it("exposes homepage images even while member and FAQ requests are pending", async () => {
    const query = rowsQuery([{ id: "hero", area: "hero", source_url: "hero.webp" }]);
    const pendingMembers = rowsQuery([]);
    pendingMembers.limit.mockReturnValue(new Promise(() => {}));
    mocks.from.mockImplementation(table => ({ select: () => table === "town_members" ? pendingMembers : query }));
    mocks.rpc.mockReturnValue(new Promise(() => {}));
    const requests = getHomeData();
    await expect(requests.images).resolves.toMatchObject([{ id: "hero" }]);
    preloadHomeData();
    expect(getHomeData()).toBe(requests);
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("shares early media between public readers without hiding media from the editor", async () => {
    vi.stubGlobal("window", { __yingwuImages: Promise.resolve([{ id: "early", area: "hero", source_url: "hero.webp" }]) });
    const first = getTownImages({ forDisplay: true });
    expect(getTownImages({ forDisplay: true })).toBe(first);
    await expect(first).resolves.toMatchObject([{ id: "early" }]);
    expect(mocks.from).not.toHaveBeenCalled();
    const query = rowsQuery([{ id: "hidden", area: "other", is_visible: false }]);
    mocks.from.mockReturnValue({ select: () => query });
    await expect(getTownImages()).resolves.toMatchObject([{ id: "hidden", visible: false }]);
    expect(query.eq).not.toHaveBeenCalled();
    await getTownImages({ forDisplay: true });
    expect(query.eq).toHaveBeenCalledWith("is_visible", true);
  });
  it("consumes early public copy once and reads fresh copy for later edits", async () => {
    const early = { translations: {}, settings: { qqGroup: "early" } };
    vi.stubGlobal("window", { __yingwuContent: Promise.resolve(early) });
    await expect(getSiteContent()).resolves.toMatchObject(early);
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { content: { settings: { qqGroup: "fresh" } } }, error: null }) }) }) });
    await expect(getSiteContent()).resolves.toMatchObject({ settings: { qqGroup: "fresh" } });
    expect(mocks.from).toHaveBeenCalledOnce();
  });
});

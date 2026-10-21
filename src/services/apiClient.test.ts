import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), setSession: vi.fn(), from: vi.fn(), upload: vi.fn(), remove: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/env", () => ({ env: { VITE_API_URL: "http://fixture.local", VITE_API_TIMEOUT_MS: 15_000 } }));
vi.mock("../lib/supabase", () => ({ isSupabaseConfigured: true, supabase: {
  auth: { getSession: mocks.session, setSession: mocks.setSession }, from: mocks.from, rpc: mocks.rpc,
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove,
    getPublicUrl: () => ({ data: { publicUrl: "https://fixture.local/image.png" } }) }) }
} }));
import { authenticatedApiRequest, publicApiRequest } from "./apiClient";
import { getTownImages, uploadTownImage } from "./siteRepository";
import { formatTranslation, type TranslationKey } from "../i18n/translations";
import { changeOwnPassword, getCurrentProfile, updateAccountDetails } from "./authService";

beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ data: { session: null } }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("request and media boundaries", () => {
  it("keeps retired media in Other with valid editable categories and translations", async () => {
    const areas = ["hero", "story", "gallery", "join", "history", "mapHero", "other", "forumHero", "resources", "materialHero"];
    mocks.from.mockReturnValue({ select: () => ({ order: async () => ({
      data: areas.map((area, index) => ({ id: String(index), area, source_url: `image-${index}.webp`, layout: index === 9 ? "retired" : "wide" })),
      error: null
    }) }) });
    const images = await getTownImages();
    expect(images).toHaveLength(areas.length);
    expect(images.map(image => image.area)).toEqual([...areas.slice(0, 7), "other", "other", "other"]);
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
  it.each([false, true])("reports storage compensation and queue failure=%s accurately", async queueFailed => {
    const databaseError = new Error("insert denied");
    mocks.upload.mockResolvedValue({ error: null });
    mocks.remove.mockResolvedValue({ error: new Error("remove failed") });
    mocks.rpc.mockResolvedValue({ error: queueFailed ? new Error("queue failed") : null });
    mocks.from.mockReturnValue({ insert: () => ({ select: () => ({ single: async () => ({ error: databaseError }) }) }) });
    await expect(uploadTownImage({ name: "fixture.png", type: "image/png" } as File, {
      area: "gallery", captionZh: "", captionEn: "", altZh: "", altEn: "", layout: "standard"
    })).rejects.toMatchObject({ code: queueFailed ? "SITE_IMAGE_CLEANUP_QUEUE_FAILED" : "SITE_IMAGE_CLEANUP_QUEUED", cause: databaseError });
  });
});

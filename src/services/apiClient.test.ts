// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn(), upload: vi.fn(), remove: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/env", () => ({ env: { VITE_API_URL: "http://fixture.local", VITE_API_TIMEOUT_MS: 15_000 } }));
vi.mock("../lib/supabase", () => ({ isSupabaseConfigured: true, supabase: {
  auth: { getSession: mocks.session }, from: mocks.from, rpc: mocks.rpc,
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove,
    getPublicUrl: () => ({ data: { publicUrl: "https://fixture.local/image.png" } }) }) }
} }));
import { authenticatedApiRequest, publicApiRequest } from "./apiClient";
import { uploadTownImage } from "./siteRepository";

beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ data: { session: null } }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("request and media boundaries", () => {
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

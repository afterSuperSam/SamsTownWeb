import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSemaphore } from "./taskQueue.js";
import { accountPasswordSchema, usernameSchema } from "./authCredentials.js";
import { createVisitorIdentity } from "./analyticsPrivacy.js";
import { extractBvid, resolveBilibiliVideo } from "./bilibili.js";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), updateUser: vi.fn(), signIn: vi.fn() }));
vi.mock("./config.js", () => ({ config: {
  SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
  WEB_ORIGIN: "http://localhost:5173", API_TRUST_PROXY: "loopback", API_BODY_MAX_BYTES: 1_048_576,
  AUTH_LOGIN_RATE_MAX: 10, AUTH_PASSWORD_RATE_MAX: 5, AUTH_RATE_WINDOW_MS: 900_000,
  MAP_UPLOAD_MAX_BYTES: 52_428_800, MAP_UPLOAD_RATE_MAX: 3, BILIBILI_REQUEST_TIMEOUT_MS: 10_000,
  ANALYTICS_IP_PEPPER: "fixture-analytics-secret-at-least-32-characters"
} }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }) }));
vi.mock("./supabaseAdmin.js", () => ({ supabaseAdmin: {
  rpc: mocks.rpc, from: mocks.from, storage: { from: vi.fn() },
  auth: { getUser: mocks.getUser, admin: { updateUserById: mocks.updateUser, getUserById: vi.fn() } }
} }));
const { buildApp } = await import("./app.js");
const userId = "00000000-0000-4000-8000-000000000001";
let app: Awaited<ReturnType<typeof buildApp>>;
function actor(role: string, mustChangePassword = false) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({
    data: { role, must_change_password: mustChangePassword }, error: null
  }) }) }) });
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  app = await buildApp({ logger: false, startWorkers: false });
});
afterEach(async () => { await app.close(); });

describe("API behavior", () => {
  it("serves health and returns 404 for removed registration and binding endpoints", async () => {
    expect((await app.inject("/health")).json()).toEqual({ ok: true, service: "yingwu-api" });
    for (const [method, url] of [["GET", "/api/auth/qq/status"], ["POST", "/api/auth/register"], ["POST", "/api/auth/qq/send-registration-code"],
      ["GET", "/api/profile/qq"], ["POST", "/api/profile/qq/bind"], ["POST", "/api/profile/qq/send-code"]] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "error.notFound" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates input and rate-limits login attempts", async () => {
    expect((await app.inject({ method: "POST", url: "/api/auth/sign-in", payload: { username: "?", password: "" } })).statusCode).toBe(400);
    for (let index = 0; index < 10; index++) {
      expect((await app.inject({ method: "POST", url: "/api/auth/sign-in", remoteAddress: "198.51.100.10",
        payload: { username: "Member", password: "invalid" } })).statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: "POST", url: "/api/auth/sign-in", remoteAddress: "198.51.100.10", payload: { username: "Member", password: "invalid" } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ code: "error.rateLimit" });
  });
  it("enforces authentication, Owner authority and map administration", async () => {
    expect((await app.inject("/api/accounts")).statusCode).toBe(401);
    actor("member");
    expect((await app.inject({ url: "/api/accounts", headers: { authorization: "Bearer token" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/maps", headers: { authorization: "Bearer token" } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/accounts", headers: { authorization: "token" } })).statusCode).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps temporary-password accounts gated until password replacement succeeds", async () => {
    actor("owner", true);
    const headers = { authorization: "Bearer token" };
    expect((await app.inject({ url: "/api/accounts", headers })).json()).toEqual({ code: "error.passwordChangeRequired" });
    const clearGate = vi.fn().mockResolvedValue({ error: null });
    const base = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation((...args) => ({ ...base(...args), update: () => ({ eq: clearGate }) }));
    const request = { method: "POST" as const, url: "/api/auth/change-password", headers,
      payload: { password: "replacement-password", confirmation: "replacement-password" } };
    mocks.updateUser.mockResolvedValueOnce({ error: new Error("Auth unavailable") });
    expect((await app.inject(request)).statusCode).toBe(400);
    expect(clearGate).not.toHaveBeenCalled();
    mocks.updateUser.mockResolvedValueOnce({ error: null });
    expect((await app.inject(request)).json()).toEqual({ ok: true });
    expect(clearGate).toHaveBeenCalledWith("id", userId);
  });
  it("returns account data without QQ fields and hides internal failures", async () => {
    actor("owner");
    const authRead = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation(() => ({ select: (columns: string) => columns === "role,must_change_password"
      ? authRead().select() : { order: async () => ({ data: [{ id: userId, username: "Owner", role: "owner", must_change_password: false, created_at: "fixture" }], error: null }) } }));
    const response = await app.inject({ url: "/api/accounts", headers: { authorization: "Bearer token" } });
    expect(response.json()).toEqual([{ id: userId, username: "Owner", role: "owner", mustChangePassword: false, createdAt: "fixture" }]);
    mocks.rpc.mockRejectedValueOnce(new Error("private database details"));
    const failed = await app.inject({ method: "POST", url: "/api/auth/sign-in", payload: { username: "Member", password: "invalid" } });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ code: "error.generic" });
  });
});

describe("security and concurrency", () => {
  it("validates credentials and masks analytics identity", () => {
    expect(usernameSchema.safeParse("../admin").success).toBe(false);
    expect(accountPasswordSchema.safeParse("short").success).toBe(false);
    const identity = createVisitorIdentity("198.51.100.10", "private-secret");
    expect(identity.maskedIp).toBe("198.51.100.*");
    expect(identity.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("blocks lookalike Bilibili hosts and untrusted short-link redirects", async () => {
    expect(extractBvid("BV1B7411m7LV")).toBe("BV1B7411m7LV");
    expect(() => extractBvid("https://bilibili.com.evil.test/video/BV1B7411m7LV")).toThrow();
    for (const url of ["https://user:password@b23.tv/fixture", "https://b23.tv:8443/fixture"]) {
      const fetcher = vi.fn<typeof fetch>();
      await expect(resolveBilibiliVideo(url, fetcher)).rejects.toThrow("error.invalidBilibiliUrl");
      expect(fetcher).not.toHaveBeenCalled();
    }
    for (const location of ["http://127.0.0.1/private", "https://b23.tv:8443/private", "https://["]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
      await expect(resolveBilibiliVideo("https://b23.tv/fixture", fetcher)).rejects.toThrow("error.invalidBilibiliUrl");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("bounds queued work and releases capacity after errors", async () => {
    const semaphore = new TaskSemaphore(1, 1);
    let release!: () => void;
    const first = semaphore.run(() => new Promise<void>(resolve => { release = resolve; }));
    const second = semaphore.run(async () => "next");
    await expect(semaphore.run(async () => undefined)).rejects.toMatchObject({ statusCode: 503 });
    release();
    await Promise.all([first, second]);
    await expect(semaphore.run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await expect(semaphore.run(async () => "released")).resolves.toBe("released");
  });
});

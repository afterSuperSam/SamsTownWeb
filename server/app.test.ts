import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSemaphore } from "./taskQueue.js";
import { accountPasswordSchema, usernameSchema } from "./authCredentials.js";
import { createVisitorIdentity } from "./analyticsPrivacy.js";
import { extractBvid, resolveBilibiliVideo } from "./bilibili.js";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), updateUser: vi.fn(), signIn: vi.fn(), createUser: vi.fn() }));
vi.mock("./config.js", () => ({ config: {
  SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
  WEB_ORIGIN: "http://localhost:5173", API_TRUST_PROXY: "loopback", API_BODY_MAX_BYTES: 1_048_576,
  AUTH_LOGIN_RATE_MAX: 10, AUTH_PASSWORD_RATE_MAX: 5, AUTH_RATE_WINDOW_MS: 900_000,
  MAP_UPLOAD_MAX_BYTES: 52_428_800, MAP_UPLOAD_RATE_MAX: 3, BILIBILI_REQUEST_TIMEOUT_MS: 10_000,
  ANALYTICS_IP_PEPPER: "fixture-analytics-secret-at-least-32-characters",
  BLOG_API_URL: "https://blog.fixture.test/api/public/site-card.json", BLOG_REQUEST_TIMEOUT_MS: 5000,
  BLOG_RESPONSE_MAX_BYTES: 1_048_576, BLOG_CACHE_MS: 300_000, BLOG_HOME_POST_LIMIT: 3
} }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }) }));
vi.mock("./supabaseAdmin.js", () => ({ supabaseAdmin: {
  rpc: mocks.rpc, from: mocks.from, storage: { from: vi.fn() },
  auth: { getUser: mocks.getUser, admin: { updateUserById: mocks.updateUser, getUserById: vi.fn(), createUser: mocks.createUser } }
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
afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

describe("API behavior", () => {
  it("returns only the latest three distinct blog articles and caches them", async () => {
    const article = (day: number, url = `https://blog.fixture.test/articles/${day}`) => ({
      title: `Article ${day}`, url, coverUrl: "javascript:alert(1)", description: "Plain text <script> is not HTML",
      createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`
    });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      latest: [article(1), article(5), article(3), article(5), article(4), article(6, "https://other.test/articles/6")]
    }));
    const response = await app.inject("/api/blog/posts");
    expect(response.statusCode).toBe(200);
    expect(response.json().map((post: { title: string }) => post.title)).toEqual(["Article 5", "Article 4", "Article 3"]);
    expect(response.json().every((post: { coverUrl: string | null }) => post.coverUrl === null)).toBe(true);
    expect((await app.inject("/api/blog/posts")).json()).toEqual(response.json());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports upstream failures without exposing details", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("private network details"));
    const response = await app.inject("/api/blog/posts");
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ code: "error.blogFeed" });
  });
  it("ignores malformed blog covers without dropping valid articles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ latest: [{
      title: "Valid article", url: "https://blog.fixture.test/articles/valid", coverUrl: "https://[",
      description: "Fixture", createdAt: "2026-10-18T12:00:00.000Z"
    }] }));
    const response = await app.inject("/api/blog/posts");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].coverUrl).toBeNull();
  });
  it("cancels unsuccessful upstream blog response bodies", async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 503 }));
    expect((await app.inject("/api/blog/posts")).statusCode).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("retains the last successful blog response during an outage", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ latest: [] }));
    expect((await app.inject("/api/blog/posts")).json()).toEqual([]);
    clock.mockReturnValue(300_001);
    fetcher.mockRejectedValueOnce(new Error("offline"));
    expect((await app.inject("/api/blog/posts")).json()).toEqual([]);
    expect((await app.inject("/api/blog/posts")).json()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
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
  it("treats legacy non-owner roles as members and rejects retired role assignments", async () => {
    for (const role of ["admin", "viewer"]) {
      actor(role);
      expect((await app.inject({ url: "/api/accounts", headers: { authorization: "Bearer token" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/api/maps", headers: { authorization: "Bearer token" } })).statusCode).toBe(403);
      actor("owner");
      expect((await app.inject({ method: "POST", url: "/api/accounts", headers: { authorization: "Bearer token" },
        payload: { username: "NewMember", password: "temporary-password", role } })).statusCode).toBe(400);
    }
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
    mocks.updateUser.mockResolvedValueOnce({ data: { user: { email: "member@accounts.yingwu.invalid" } }, error: null });
    mocks.signIn.mockResolvedValueOnce({ data: { session: { access_token: "new-access", refresh_token: "new-refresh" } }, error: null });
    expect((await app.inject(request)).json()).toEqual({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "member@accounts.yingwu.invalid", password: "replacement-password" });
    expect(clearGate).toHaveBeenCalledWith("id", userId);
  });
  it("keeps an administrator reset gated when it overlaps a self-service password change", async () => {
    const memberId = "00000000-0000-4000-8000-000000000002";
    const profiles: Record<string, { role: string; must_change_password: boolean }> = {
      [userId]: { role: "owner", must_change_password: false },
      [memberId]: { role: "member", must_change_password: true }
    };
    const ownerAuthenticated = Promise.withResolvers<void>();
    mocks.getUser.mockImplementation(async (token: string) => {
      if (token === "owner") ownerAuthenticated.resolve();
      return { data: { user: { id: token === "owner" ? userId : memberId } }, error: null };
    });
    mocks.from.mockImplementation(() => ({
      select: () => ({ eq: (_column: string, id: string) => ({ single: async () => ({ data: { ...profiles[id] }, error: null }) }) }),
      update: (values: object) => ({ eq: async (_column: string, id: string) => {
        Object.assign(profiles[id], values);
        return { error: null };
      } }),
      insert: async () => ({ error: null })
    }));
    mocks.updateUser.mockResolvedValue({ data: { user: { email: "member@accounts.yingwu.invalid" } }, error: null });
    const sessionStarted = Promise.withResolvers<void>();
    const issueSession = Promise.withResolvers<{ data: { session: { access_token: string; refresh_token: string } }; error: null }>();
    mocks.signIn.mockImplementation(() => { sessionStarted.resolve(); return issueSession.promise; });
    const change = app.inject({ method: "POST", url: "/api/auth/change-password", headers: { authorization: "Bearer member" },
      payload: { password: "replacement-password", confirmation: "replacement-password" } }).then(response => response);
    await sessionStarted.promise;
    const reset = app.inject({ method: "PATCH", url: `/api/accounts/${memberId}`, headers: { authorization: "Bearer owner" },
      payload: { temporaryPassword: "temporary-password" } }).then(response => response);
    await ownerAuthenticated.promise;
    await new Promise(resolve => setImmediate(resolve));
    issueSession.resolve({ data: { session: { access_token: "new-access", refresh_token: "new-refresh" } }, error: null });
    expect((await change).statusCode).toBe(200);
    expect((await reset).statusCode).toBe(200);
    expect(profiles[memberId].must_change_password).toBe(true);
  });
  it("rechecks Owner authorization after a queued account update starts", async () => {
    const { accountMutations } = await import("./auth.js");
    const enteredQueue = Promise.withResolvers<void>();
    const releaseQueue = Promise.withResolvers<void>();
    const first = accountMutations.run(async () => { enteredQueue.resolve(); await releaseQueue.promise; });
    await enteredQueue.promise;
    actor("owner");
    const authenticated = Promise.withResolvers<void>();
    mocks.getUser.mockImplementation(async () => {
      authenticated.resolve();
      return { data: { user: { id: userId } }, error: null };
    });
    const pending = app.inject({ method: "PATCH", url: "/api/accounts/00000000-0000-4000-8000-000000000002",
      headers: { authorization: "Bearer token" }, payload: { role: "member" } }).then(response => response);
    await authenticated.promise;
    await new Promise(resolve => setImmediate(resolve));
    actor("owner", true);
    releaseQueue.resolve();
    await first;
    expect((await pending).json()).toEqual({ code: "error.passwordChangeRequired" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
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
  it("does not reserve a renamed account's previous username in Auth", async () => {
    const { createInternalAuthUser } = await import("./accountProvisioning.js");
    mocks.createUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    await createInternalAuthUser("Member", "replacement-password");
    await createInternalAuthUser("Member", "replacement-password");
    const [first, second] = mocks.createUser.mock.calls;
    expect(first[0].email).not.toBe(second[0].email);
    expect(second[0].user_metadata.username).toBe("Member");
  });
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

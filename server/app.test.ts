import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSemaphore } from "./taskQueue.js";
import { accountPasswordSchema, usernameSchema } from "./authCredentials.js";
import { createVisitorIdentity } from "./analyticsPrivacy.js";
import { extractBvid, resolveBilibiliVideo } from "./bilibili.js";
import sharp from "sharp";
import { createDisplayImages, heroImageUrl } from "./siteImages.js";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), storageFrom: vi.fn(), updateUser: vi.fn(), signIn: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn() }));
vi.mock("./config.js", () => ({ config: {
  SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
  SUPABASE_REQUEST_TIMEOUT_MS: 25,
  STORAGE_CLEANUP_RETRY_BASE_MS: 30_000, STORAGE_CLEANUP_RETRY_MAX_MS: 3_600_000,
  WEB_ORIGIN: "http://localhost:5173", API_TRUST_PROXY: "loopback", API_BODY_MAX_BYTES: 1_048_576,
  AUTH_LOGIN_RATE_MAX: 10, AUTH_PASSWORD_RATE_MAX: 5, AUTH_RATE_WINDOW_MS: 900_000,
  MAP_UPLOAD_MAX_BYTES: 52_428_800, MAP_UPLOAD_RATE_MAX: 3, BILIBILI_REQUEST_TIMEOUT_MS: 10_000,
  SITE_IMAGE_MAX_BYTES: 52_428_800, SITE_IMAGE_MAX_PIXELS: 50_000_000, SITE_IMAGE_WEBP_QUALITY: 90,
  SITE_IMAGE_SIZES: { hero: [1920, 1080], content: [1280, 720] }, SITE_HERO_CACHE_MS: 30_000, SITE_IMAGE_CACHE_SECONDS: 31_536_000,
  ANALYTICS_IP_PEPPER: "fixture-analytics-secret-at-least-32-characters",
  BLOG_API_URL: "https://blog.fixture.test/api/public/site-card.json", BLOG_REQUEST_TIMEOUT_MS: 5000,
  BLOG_RESPONSE_MAX_BYTES: 1_048_576, BLOG_CACHE_MS: 300_000, BLOG_HOME_POST_LIMIT: 3
} }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }) }));
vi.mock("./supabaseAdmin.js", () => ({ supabaseFetch: vi.fn(), supabaseAdmin: {
  rpc: mocks.rpc, from: mocks.from, storage: { from: mocks.storageFrom },
  auth: { getUser: mocks.getUser, admin: { updateUserById: mocks.updateUser, getUserById: vi.fn(), createUser: mocks.createUser, deleteUser: mocks.deleteUser } }
} }));
const { buildApp } = await import("./app.js");
const userId = "00000000-0000-4000-8000-000000000001";
const sessionToken = (label = "token") => `${label}.${Buffer.from(JSON.stringify({ session_id: userId })).toString("base64url")}.signature`;
let app: Awaited<ReturnType<typeof buildApp>>;
function actor(role: string, mustChangePassword = false) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({
    data: { role, must_change_password: mustChangePassword }, error: null
  }) }) }) });
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "is_current_auth_session" ? true : null, error: null }));
  app = await buildApp({ logger: false, startWorkers: false });
});
afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

describe("API behavior", () => {
  it("creates sharp proportional 1080p and 720p WebP without altering the original", async () => {
    const source = await sharp({ create: { width: 2560, height: 1440, channels: 3, background: "#d38d42" } }).png().toBuffer();
    const before = Buffer.from(source);
    const { versions } = await createDisplayImages(source);
    expect(await sharp(versions["1080.webp"]).metadata()).toMatchObject({ width: 1920, height: 1080, format: "webp" });
    expect(await sharp(versions["720.webp"]).metadata()).toMatchObject({ width: 1280, height: 720 });
    expect(source.equals(before)).toBe(true);
    expect(heroImageUrl("images/ingame/1.png")).toBe("images/optimized/ingame/1.1080.webp");
    expect(heroImageUrl("/images/optimized/ingame/1.720.webp")).toBe("/images/optimized/ingame/1.1080.webp");
  });
  it.each([false, true])("stores original and both display sizes, cleaning up a rejected metadata write (%s)", async failMetadata => {
    actor("owner");
    const profileQuery = mocks.from.getMockImplementation()!;
    const inserted = vi.fn();
    const cleanup = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockImplementation((table: string) => table === "town_images" ? {
      insert: (row: object) => {
        inserted(row);
        return { select: () => ({ single: async () => failMetadata
          ? { error: { code: "23514", message: "constraint violation" } }
          : { data: row, error: null } }) };
      }
    } : table === "storage_cleanup_queue" ? { upsert: cleanup } : profileQuery(table));
    const upload = vi.fn().mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({ upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://fixture.supabase.co/${path}` } }) });
    const source = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#d38d42" } }).png().toBuffer();
    const form = new FormData();
    for (const [key, value] of Object.entries({ area: "hero", layout: "standard", captionZh: "", captionEn: "", altZh: "", altEn: "" })) form.set(key, value);
    form.set("file", new Blob([new Uint8Array(source)], { type: "image/png" }), "test.png");
    const encoded = new Response(form);
    const response = await app.inject({ method: "POST", url: "/api/site/images",
      headers: { authorization: `Bearer ${sessionToken()}`, "content-type": encoded.headers.get("content-type")! },
      payload: Buffer.from(await encoded.arrayBuffer()) });
    expect(response.statusCode, response.body).toBe(failMetadata ? 500 : 201);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[0][1].equals(source)).toBe(true);
    expect(inserted).toHaveBeenCalledWith(expect.objectContaining({ created_by: userId, source_url: expect.stringMatching(/\.display\/1080\.webp$/) }));
    if (failMetadata) expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ bucket_id: "site-images", object_path: upload.mock.calls[0][0] }), expect.anything());
    else expect(cleanup).not.toHaveBeenCalled();
  });
  it("lets guests preload a visible hero, caches its URL, but rejects guest uploads", async () => {
    const row = vi.fn().mockResolvedValue({ data: { source_url: "https://fixture.supabase.co/hero.png.display/720.webp" }, error: null });
    const query = { eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: row };
    query.eq.mockReturnValue(query); query.order.mockReturnValue(query); query.limit.mockReturnValue(query);
    mocks.from.mockReturnValue({ select: () => query });
    const response = await app.inject("/api/site/hero?area=hero");
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://fixture.supabase.co/hero.png.display/1080.webp");
    expect(query.eq).toHaveBeenCalledWith("is_visible", true);
    await app.inject("/api/site/hero?area=hero");
    expect(row).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: "POST", url: "/api/site/images" })).statusCode).toBe(401);
  });
  it("rejects a revoked session even when Auth still accepts its unexpired token", async () => {
    actor("member", true);
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await app.inject({ method: "POST", url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${sessionToken()}` },
      payload: { password: "replacement-password", confirmation: "replacement-password" } });
    expect(response.statusCode).toBe(401);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
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
    expect((await app.inject({ url: "/api/accounts", headers: { authorization: `Bearer ${sessionToken()}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/maps", headers: { authorization: `Bearer ${sessionToken()}` } })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/accounts", headers: { authorization: "token" } })).statusCode).toBe(401);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "is_current_auth_session")).toBe(true);
  });
  it("treats legacy non-owner roles as members and rejects retired role assignments", async () => {
    for (const role of ["admin", "viewer"]) {
      actor(role);
      expect((await app.inject({ url: "/api/accounts", headers: { authorization: `Bearer ${sessionToken()}` } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/api/maps", headers: { authorization: `Bearer ${sessionToken()}` } })).statusCode).toBe(403);
      actor("owner");
      expect((await app.inject({ method: "POST", url: "/api/accounts", headers: { authorization: `Bearer ${sessionToken()}` },
        payload: { username: "NewMember", password: "temporary-password", role } })).statusCode).toBe(400);
    }
  });
  it("keeps temporary-password accounts gated until password replacement succeeds", async () => {
    actor("owner", true);
    const headers = { authorization: `Bearer ${sessionToken()}` };
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
      if (token === sessionToken("owner")) ownerAuthenticated.resolve();
      return { data: { user: { id: token === sessionToken("owner") ? userId : memberId } }, error: null };
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
    const change = app.inject({ method: "POST", url: "/api/auth/change-password", headers: { authorization: `Bearer ${sessionToken("member")}` },
      payload: { password: "replacement-password", confirmation: "replacement-password" } }).then(response => response);
    await sessionStarted.promise;
    const reset = app.inject({ method: "PATCH", url: `/api/accounts/${memberId}`, headers: { authorization: `Bearer ${sessionToken("owner")}` },
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
      headers: { authorization: `Bearer ${sessionToken()}` }, payload: { role: "member" } }).then(response => response);
    await authenticated.promise;
    await new Promise(resolve => setImmediate(resolve));
    actor("owner", true);
    releaseQueue.resolve();
    await first;
    expect((await pending).json()).toEqual({ code: "error.passwordChangeRequired" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it.each(["POST", "PUT"] as const)("rechecks authorization before a queued %s map upload reads its file", async method => {
    actor("owner");
    const staged = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pipeline = await import("./maps/mapTilePipeline.js");
    const stage = vi.spyOn(pipeline, "stageMapUpload").mockImplementation(async () => {
      staged.resolve();
      await release.promise;
      throw new Error("Fixture upload ended");
    });
    const headers = { authorization: `Bearer ${sessionToken()}`, "content-type": "multipart/form-data; boundary=fixture" };
    const payload = '--fixture\r\nContent-Disposition: form-data; name="image"; filename="map.png"\r\nContent-Type: image/png\r\n\r\nimage\r\n--fixture--\r\n';
    const first = app.inject({ method: "POST", url: "/api/maps", headers, payload }).then(response => response);
    await staged.promise;
    const queued = Promise.withResolvers<void>();
    mocks.getUser.mockImplementation(async () => { queued.resolve(); return { data: { user: { id: userId } }, error: null }; });
    const second = app.inject({ method, url: method === "POST" ? "/api/maps" : `/api/maps/${userId}/image`, headers, payload }).then(response => response);
    await queued.promise;
    await new Promise(resolve => setImmediate(resolve));
    actor("owner", true);
    release.resolve();
    expect((await first).statusCode).toBe(500);
    expect((await second).json()).toEqual({ code: "error.passwordChangeRequired" });
    expect(stage).toHaveBeenCalledOnce();
  });
  it.each([false, true])("reports whether Auth deletion remains queued: %s", async pending => {
    actor("owner");
    const authRead = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation((table: string) => table === "profiles" ? authRead() : {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: pending ? { status: "pending" } : null, error: null }) }) })
    });
    const response = await app.inject({ method: "DELETE", url: "/api/accounts/00000000-0000-4000-8000-000000000002",
      headers: { authorization: `Bearer ${sessionToken()}` } });
    expect(response.statusCode).toBe(pending ? 202 : 200);
    expect(response.json()).toEqual({ ok: true, pending });
  });
  it.each([400, 0, 503])("does not reactivate old sessions after an ambiguous password reset: HTTP %s", async status => {
    actor("owner");
    const authRead = mocks.from.getMockImplementation()!;
    const target = { role: "member", must_change_password: false, sessions_valid_after: "-infinity" };
    mocks.from.mockImplementation(() => ({
      select: (columns: string) => columns === "role,must_change_password" ? authRead().select()
        : { eq: () => ({ single: async () => ({ data: { ...target }, error: null }) }) },
      update: (values: object) => ({ eq: async () => { Object.assign(target, values); return { error: null }; } })
    }));
    mocks.updateUser.mockResolvedValue({ error: { status, message: "Auth response unavailable" } });
    const response = await app.inject({ method: "PATCH", url: "/api/accounts/00000000-0000-4000-8000-000000000002",
      headers: { authorization: `Bearer ${sessionToken()}` }, payload: { temporaryPassword: "temporary-password" } });
    expect(response.statusCode).toBe(400);
    expect(target.must_change_password).toBe(status !== 400);
    expect(target.sessions_valid_after === "-infinity").toBe(status === 400);
  });
  it("returns account data without QQ fields and hides internal failures", async () => {
    actor("owner");
    const authRead = mocks.from.getMockImplementation()!;
    mocks.from.mockImplementation(() => ({ select: (columns: string) => columns === "role,must_change_password"
      ? authRead().select() : { order: async () => ({ data: [{ id: userId, username: "Owner", role: "owner", must_change_password: false, created_at: "fixture" }], error: null }) } }));
    const response = await app.inject({ url: "/api/accounts", headers: { authorization: `Bearer ${sessionToken()}` } });
    expect(response.json()).toEqual([{ id: userId, username: "Owner", role: "owner", mustChangePassword: false, createdAt: "fixture" }]);
    mocks.rpc.mockRejectedValueOnce(new Error("private database details"));
    const failed = await app.inject({ method: "POST", url: "/api/auth/sign-in", payload: { username: "Member", password: "invalid" } });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ code: "error.generic" });
  });
});

describe("security and concurrency", () => {
  it("aborts a stalled Supabase request instead of holding the account queue indefinitely", async () => {
    const { supabaseFetch } = await vi.importActual<typeof import("./supabaseAdmin.js")>("./supabaseAdmin.js");
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    await expect(supabaseFetch("https://fixture.supabase.co/rest/v1/profiles")).rejects.toMatchObject({ name: "TimeoutError" });
  });
  it.each([false, true])("transfers Storage ownership before Auth deletion; failed transfer=%s", async failed => {
    const { processAccountCleanup } = await import("./accountCleanup.js");
    mocks.rpc.mockImplementation(async (name: string) => name === "claim_account_deletion_batch"
      ? { data: [{ user_id: userId, attempts: 0 }], error: null }
      : { error: failed ? new Error("Storage transfer unavailable") : null });
    mocks.from.mockReturnValue({ delete: () => ({ eq: async () => ({ error: null }) }),
      update: () => ({ eq: async () => ({ error: null }) }) });
    mocks.deleteUser.mockResolvedValue({ error: null });
    await processAccountCleanup(app);
    expect(mocks.rpc).toHaveBeenCalledWith("transfer_account_storage", { p_user_id: userId });
    expect(mocks.deleteUser).toHaveBeenCalledTimes(failed ? 0 : 1);
    if (!failed) expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(mocks.deleteUser.mock.invocationCallOrder[0]);
  });
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
  it("uses Unicode letters and decimal digits consistently for usernames", () => {
    for (const name of ["Player_1", "楹雾", "Éclair", "玩家１", "𠀀".repeat(32)]) {
      expect.soft(usernameSchema.safeParse(name).success, name).toBe(true);
    }
    for (const name of ["User²", "UserⅧ", "User😀", "User name", "a", "𠀀".repeat(33)]) {
      expect.soft(usernameSchema.safeParse(name).success, name).toBe(false);
    }
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

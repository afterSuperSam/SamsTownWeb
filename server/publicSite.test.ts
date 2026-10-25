import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const settings = vi.hoisted(() => ({
  SUPABASE_URL: "https://fixture.supabase.co", WEB_ORIGIN: "https://town.fixture.test",
  SITE_PUBLIC_KEY: "fixture-publishable-key", SITE_PUBLIC_CACHE_DIR: "",
  SITE_PUBLIC_CACHE_MS: 1000, SITE_PUBLIC_STALE_MS: 10_000, SITE_PUBLIC_RETRY_MS: 1000,
  SITE_PUBLIC_TIMEOUT_MS: 500, SITE_PUBLIC_MAX_BYTES: 4096, SITE_PUBLIC_MEDIA_MAX_BYTES: 4096
}));
vi.mock("./config.js", () => ({ config: settings }));
vi.mock("./supabaseAdmin.js", () => ({ supabaseAdmin: {} }));
const { publicSiteRoutes } = await import("./routes/publicSite.js");
let app: ReturnType<typeof Fastify>;
const media = Buffer.from("RIFF0000WEBPfixture");
const image = { id: "hero", area: "hero", media_type: "image", is_visible: true,
  source_url: "https://fixture.supabase.co/storage/v1/object/public/site-images/hero/fixture.display/1080.webp" };
async function createApp() {
  const server = Fastify();
  server.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ code: "error.invalidRequest" }));
  await server.register(publicSiteRoutes, { warm: false });
  return server;
}
beforeEach(async () => {
  settings.SITE_PUBLIC_CACHE_DIR = await mkdtemp(join(tmpdir(), "town-public-site-test-"));
  app = await createApp();
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
  await rm(settings.SITE_PUBLIC_CACHE_DIR, { recursive: true, force: true });
});

describe("same-origin public site cache", () => {
  it("loads the real public-key fallback and rejects privileged cache credentials", async () => {
    vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-role-key-for-server-only");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_fixture-anonymous-key");
    vi.stubEnv("SITE_PUBLIC_KEY", undefined);
    try {
      const actual = await vi.importActual<{ config: { SITE_PUBLIC_KEY?: string } }>("./config.js");
      expect(actual.config.SITE_PUBLIC_KEY).toBe("sb_publishable_fixture-anonymous-key");
      vi.stubEnv("SITE_PUBLIC_KEY", "sb_secret_not-a-public-key-for-cache");
      vi.resetModules();
      await expect(vi.importActual("./config.js")).rejects.toThrow("SITE_PUBLIC_KEY");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("coalesces anonymous reads and never forwards visitor authorization", async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { await barrier; return Response.json([{ content: { settings: {} } }]); });
    const results = Promise.all([app.inject({ url: "/api/site/public/content", headers: { authorization: "Bearer private-visitor" } }), app.inject("/api/site/public/content")]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    release();
    expect((await results).map(response => response.statusCode)).toEqual([200, 200]);
    await app.inject("/api/site/public/content");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ apikey: "fixture-publishable-key" });
  });
  it("mirrors the visible hero once and serves local bytes with conditional caching", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => String(input).includes("/rest/v1/")
      ? Response.json([image]) : new Response(media, { headers: { "content-type": "image/webp" } }));
    const response = await app.inject("/api/site/public/images");
    const source = response.json()[0].source_url;
    expect(source).toMatch(/^\/api\/site\/media\/[a-f0-9]{64}\.webp$/);
    const local = await app.inject(source);
    expect(local.statusCode).toBe(200);
    expect(local.headers["content-type"]).toBe("image/webp");
    expect(local.rawPayload.equals(media)).toBe(true);
    expect((await app.inject({ url: source, headers: { "if-none-match": String(local.headers.etag) } })).statusCode).toBe(304);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain("is_visible=eq.true");
    expect(String(fetcher.mock.calls[0][0])).not.toContain("storage_path");
  });
  it("serves persisted snapshots immediately after a process restart", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([{ content: { settings: { qqGroup: "public" } } }]));
    expect((await app.inject("/api/site/public/content")).statusCode).toBe(200);
    await app.close();
    app = await createApp();
    fetcher.mockRejectedValue(new Error("upstream offline"));
    expect((await app.inject("/api/site/public/content")).json()).toEqual({ settings: { qqGroup: "public" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("serves bounded stale data while a failed refresh is retried in the background", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json([{ content: { public: true } }]))
      .mockRejectedValue(new Error("upstream offline"));
    await app.inject("/api/site/public/content");
    clock.mockReturnValue(102_000);
    const stale = await app.inject("/api/site/public/content");
    expect(stale.statusCode).toBe(200);
    expect(stale.headers["x-site-cache"]).toBe("stale");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await app.inject("/api/site/public/content");
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(120_000);
    const expired = await app.inject("/api/site/public/content");
    expect(expired.statusCode).toBe(503);
    expect(expired.body).not.toContain("upstream offline");
  });
  it("does not fetch arbitrary external images or accept arbitrary resource paths", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([{ ...image, source_url: "https://private.invalid/secret.webp" }]));
    expect((await app.inject("/api/site/public/images")).json()[0].source_url).toBe("https://private.invalid/secret.webp");
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await app.inject("/api/site/public/profiles")).statusCode).toBe(400);
    expect((await app.inject("/api/site/media/not-a-hash.webp")).statusCode).toBe(400);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("bounds upstream bodies and does not expose a failed response or key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([{ content: "x".repeat(5000) }]));
    const response = await app.inject("/api/site/public/content");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "error.contentUnavailable" });
    expect(response.body).not.toContain(settings.SITE_PUBLIC_KEY);
  });
});

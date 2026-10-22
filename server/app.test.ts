import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
const from = vi.fn();
const getUserById = vi.fn();
const updateUserById = vi.fn();

vi.mock("./config.js", () => ({
  config: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-long-enough",
    API_HOST: "127.0.0.1",
    API_PORT: 8787,
    API_TRUST_PROXY: true,
    WEB_ORIGIN: "http://localhost:5173",
    STORAGE_CLEANUP_INTERVAL_MS: 300_000,
    ANALYTICS_IP_PEPPER: "test-analytics-pepper-at-least-32-characters"
  }
}));

vi.mock("./supabaseAdmin.js", () => ({
  supabaseAdmin: {
    rpc,
    auth: { getUser, admin: { getUserById, updateUserById } },
    from,
    storage: { from: vi.fn() }
  }
}));

const { buildApp } = await import("./app.js");

describe("Fastify application", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
    getUser.mockReset();
    getUserById.mockReset();
    updateUserById.mockReset();
    from.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("serves the health endpoint", async () => {
    const app = await buildApp({ logger: false, startWorkers: false });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "yingwu-api" });
    await app.close();
  });

  it("records page views through the rate-limited server boundary", async () => {
    const app = await buildApp({ logger: false, startWorkers: false });
    const response = await app.inject({ method: "POST", url: "/api/analytics/view" });

    expect(response.statusCode).toBe(204);
    expect(rpc).toHaveBeenCalledWith("record_page_view", {
      p_authenticated: false,
      p_masked_ip: "127.0.0.*",
      p_visitor_digest: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    await app.close();
  });

  it("rate-limits repeated login attempts by IP", async () => {
    const app = await buildApp({ logger: false, startWorkers: false });
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in",
        headers: { "x-forwarded-for": "198.51.100.10" },
        payload: { username: "DogSam", password: "invalid" }
      });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in",
      headers: { "x-forwarded-for": "198.51.100.10" },
      payload: { username: "AnotherName", password: "invalid" }
    });
    expect(blocked.statusCode, blocked.body).toBe(429);
    expect(blocked.json()).toEqual({ code: "error.loginRateLimit" });

    const otherClient = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in",
      headers: { "x-forwarded-for": "203.0.113.20" },
      payload: { username: "AnotherName", password: "invalid" }
    });
    expect(otherClient.statusCode).toBe(401);
    await app.close();
  });

  it("uses the project error contract for invalid request bodies", async () => {
    const app = await buildApp({ logger: false, startWorkers: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in",
      payload: { username: "?", password: "" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "error.invalidRequest" });
    await app.close();
  });

  it("rejects account administration without an Owner profile", async () => {
    const app = await buildApp({ logger: false, startWorkers: false });

    const signedOut = await app.inject({ method: "GET", url: "/api/accounts" });
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.json()).toEqual({ code: "error.session" });

    getUser.mockResolvedValue({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } }, error: null });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { role: "member", must_change_password: false }, error: null }) })
      })
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/accounts",
      headers: { authorization: "Bearer member-token" }
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: "error.permission" });
    await app.close();
  });

  it("returns complete QQ bindings only through the Owner account endpoint", async () => {
    const ownerId = "00000000-0000-4000-8000-000000000010";
    const memberId = "00000000-0000-4000-8000-000000000011";
    getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
    rpc.mockImplementation(async (name: string) => name === "list_account_qq_bindings"
      ? { data: [{ user_id: memberId, qq_number: "1234567890", verified_at: "2026-07-30T00:00:00Z" }], error: null }
      : { data: null, error: null });
    from.mockImplementation((table: string) => {
      if (table === "account_deletion_queue") {
        return {
          select: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) })
          })
        };
      }
      if (table === "profiles") {
        return {
          select: (columns: string) => columns === "role,must_change_password,qq_registration_pending"
            ? {
                eq: () => ({
                  single: async () => ({
                    data: { role: "owner", must_change_password: false, qq_registration_pending: false },
                    error: null
                  })
                })
              }
            : {
                order: async () => ({
                  data: [
                    { id: ownerId, username: "DogSam", role: "owner", must_change_password: false, created_at: "2026-07-29T00:00:00Z" },
                    { id: memberId, username: "member", role: "member", must_change_password: false, created_at: "2026-07-30T00:00:00Z" }
                  ],
                  error: null
                })
              }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const app = await buildApp({ logger: false, startWorkers: false });
    const response = await app.inject({
      method: "GET",
      url: "/api/accounts",
      headers: { authorization: "Bearer owner-token" }
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ id: ownerId, qqNumber: null }),
      expect.objectContaining({ id: memberId, qqNumber: "1234567890" })
    ]);
    expect(rpc).toHaveBeenCalledWith("list_account_qq_bindings");
    await app.close();
  });

  it("allows an existing account to remain unbound after login", async () => {
    const userId = "00000000-0000-4000-8000-000000000012";
    getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { role: "viewer", must_change_password: false, qq_registration_pending: false },
            error: null
          })
        })
      })
    });
    rpc.mockImplementation(async (name: string) => name === "get_qq_binding_status"
      ? { data: { bound: false, maskedNumber: null }, error: null }
      : { data: null, error: null });

    const app = await buildApp({ logger: false, startWorkers: false });
    const response = await app.inject({
      method: "GET",
      url: "/api/profile/qq",
      headers: { authorization: "Bearer unbound-viewer-token" }
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ bound: false, maskedNumber: null });
    await app.close();
  });

  it("blocks every application route while a temporary password is active", async () => {
    const app = await buildApp({ logger: false, startWorkers: false });
    getUser.mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000002" } },
      error: null
    });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { role: "member", must_change_password: true },
            error: null
          })
        })
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/materials/projects",
      headers: { authorization: "Bearer temporary-password-token" },
      payload: {}
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "error.passwordChangeRequired" });
    expect(rpc).not.toHaveBeenCalledWith("create_material_project_server", expect.anything());
    await app.close();
  });

  it("changes a temporary password before clearing the profile gate", async () => {
    const app = await buildApp({ logger: false, startWorkers: false });
    const userId = "00000000-0000-4000-8000-000000000003";
    getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    updateUserById.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    const clearGate = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { role: "viewer", must_change_password: true },
            error: null
          })
        })
      }),
      update: (values: unknown) => {
        expect(values).toEqual({ must_change_password: false });
        return { eq: clearGate };
      }
    }));

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: "Bearer temporary-password-token" },
      payload: { password: "replacement-password", confirmation: "replacement-password" }
    });

    expect(response.statusCode).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(userId, { password: "replacement-password" });
    expect(clearGate).toHaveBeenCalledWith("id", userId);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});

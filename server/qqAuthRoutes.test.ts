import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const sendQqVerificationCode = vi.fn();
const createInternalAuthUser = vi.fn();
const createInternalSession = vi.fn();
const deleteInternalAuthUser = vi.fn();

vi.mock("./config.js", () => ({
  config: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-long-enough",
    API_HOST: "127.0.0.1",
    API_PORT: 8787,
    API_TRUST_PROXY: true,
    WEB_ORIGIN: "http://localhost:5173",
    STORAGE_CLEANUP_INTERVAL_MS: 300_000,
    BOT_API_URL: "http://127.0.0.1:3000",
    BOT_API_KEY: "test-onebot-token-long-enough",
    QQ_CODE_PEPPER: "test-pepper-that-is-at-least-thirty-two-characters"
  }
}));
vi.mock("./supabaseAdmin.js", () => ({
  supabaseAdmin: {
    rpc,
    auth: { getUser: vi.fn(), admin: { getUserById: vi.fn(), updateUserById: vi.fn(), deleteUser: vi.fn() } },
    from: vi.fn(),
    storage: { from: vi.fn() }
  }
}));
vi.mock("./accountProvisioning.js", () => ({ createInternalAuthUser, createInternalSession, deleteInternalAuthUser }));
vi.mock("./qqVerification.js", async importOriginal => ({
  ...await importOriginal<typeof import("./qqVerification.js")>(),
  createQqVerificationCode: () => "123456",
  sendQqVerificationCode
}));

const { buildApp } = await import("./app.js");

describe("QQ authentication routes", () => {
  beforeEach(() => {
    rpc.mockReset();
    sendQqVerificationCode.mockReset();
    createInternalAuthUser.mockReset();
    createInternalSession.mockReset();
    deleteInternalAuthUser.mockReset();
  });

  it("invalidates a challenge when private-message delivery fails", async () => {
    rpc.mockResolvedValueOnce({ data: "ok", error: null });
    sendQqVerificationCode.mockRejectedValue(Object.assign(new Error("error.qqDeliveryFailed"), { statusCode: 502 }));
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const app = await buildApp({ logger: false, startWorkers: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/qq/send-registration-code",
      payload: { qqNumber: "12345678" }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ code: "error.qqDeliveryFailed" });
    expect(rpc).toHaveBeenLastCalledWith("set_qq_challenge_delivery", expect.objectContaining({ p_delivered: false }));
    await app.close();
  });

  it("does not reveal whether a QQ number is already bound", async () => {
    rpc.mockResolvedValueOnce({ data: "unavailable", error: null });
    const app = await buildApp({ logger: false, startWorkers: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/qq/send-registration-code",
      payload: { qqNumber: "12345678" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ expiresIn: 300, retryAfter: 300 });
    expect(response.json().challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sendQqVerificationCode).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns the locked state without creating an Auth user", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_profile_id") return { data: null, error: null };
      if (name === "claim_qq_verification_challenge") return { data: "locked", error: null };
      return { data: null, error: null };
    });
    const app = await buildApp({ logger: false, startWorkers: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        challengeId: "00000000-0000-4000-8000-000000000001",
        qqNumber: "12345678",
        code: "000000",
        username: "new_user",
        password: "strong-password",
        confirmation: "strong-password"
      }
    });
    expect(response.statusCode).toBe(423);
    expect(response.json()).toEqual({ code: "error.qqCodeLocked" });
    expect(createInternalAuthUser).not.toHaveBeenCalled();
    await app.close();
  });

  it("creates a Viewer account only after claiming and completing the challenge", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "resolve_profile_id") return { data: null, error: null };
      if (name === "claim_qq_verification_challenge" || name === "complete_qq_verification") {
        return { data: "ok", error: null };
      }
      return { data: null, error: null };
    });
    createInternalAuthUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000002",
      email: "internal@accounts.yingwu.invalid"
    });
    createInternalSession.mockResolvedValue({ accessToken: "access", refreshToken: "refresh" });
    const app = await buildApp({ logger: false, startWorkers: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        challengeId: "00000000-0000-4000-8000-000000000001",
        qqNumber: "12345678",
        code: "123456",
        username: "new_user",
        password: "strong-password",
        confirmation: "strong-password"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ accessToken: "access", refreshToken: "refresh" });
    expect(rpc).toHaveBeenCalledWith("complete_qq_verification", expect.objectContaining({
      p_user_id: "00000000-0000-4000-8000-000000000002"
    }));
    await app.close();
  });
});

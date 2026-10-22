import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
  config: {
    BOT_API_URL: "http://127.0.0.1:3000",
    BOT_API_KEY: "test-onebot-token-long-enough",
    QQ_CODE_PEPPER: "test-pepper-that-is-at-least-thirty-two-characters"
  }
}));

const {
  createClaimDigest,
  createCodeDigest,
  createQqVerificationCode,
  createRequestIpDigest,
  qqCodeSchema,
  qqNumberSchema,
  sendQqVerificationCode
} = await import("./qqVerification.js");

afterEach(() => vi.unstubAllGlobals());

describe("QQ verification helpers", () => {
  it("validates QQ numbers and six-digit codes", () => {
    expect(qqNumberSchema.parse("12345")).toBe("12345");
    expect(() => qqNumberSchema.parse("01234")).toThrow();
    expect(() => qqNumberSchema.parse("1234a")).toThrow();
    expect(qqCodeSchema.parse("001234")).toBe("001234");
    expect(createQqVerificationCode()).toMatch(/^[0-9]{6}$/);
  });

  it("binds digests to their purpose and challenge", () => {
    const challengeId = "00000000-0000-4000-8000-000000000001";
    const digest = createCodeDigest(challengeId, "register", "12345678", "123456");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(createCodeDigest(challengeId, "bind", "12345678", "123456")).not.toBe(digest);
    expect(createRequestIpDigest("203.0.113.4")).toMatch(/^[a-f0-9]{64}$/);
    expect(createClaimDigest(challengeId, "claim-token")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sends one private message through the loopback OneBot endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok", retcode: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await sendQqVerificationCode("12345678", "654321");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:3000/send_private_msg");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-onebot-token-long-enough");
    expect(JSON.parse(String(init.body))).toMatchObject({ user_id: "12345678" });
  });

  it("maps OneBot delivery failures to the stable API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "failed", retcode: 100 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })));
    await expect(sendQqVerificationCode("12345678", "654321")).rejects.toMatchObject({
      message: "error.qqDeliveryFailed",
      statusCode: 502
    });
  });
});

import { describe, expect, it } from "vitest";
import { createVisitorIdentity, maskIpAddress } from "./analyticsPrivacy.js";

describe("analytics privacy", () => {
  it("masks IPv4 and mapped IPv4 addresses", () => {
    expect(maskIpAddress("203.0.113.42")).toBe("203.0.113.*");
    expect(maskIpAddress("::ffff:198.51.100.9")).toBe("198.51.100.*");
  });

  it("creates stable non-reversible visitor digests", () => {
    const first = createVisitorIdentity("203.0.113.42", "a".repeat(32));
    const second = createVisitorIdentity("203.0.113.42", "a".repeat(32));
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("203.0.113.42");
  });
});

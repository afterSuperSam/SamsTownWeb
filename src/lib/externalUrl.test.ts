import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./externalUrl";

describe("safeExternalUrl", () => {
  it("accepts absolute web links", () => {
    expect(safeExternalUrl("https://modrinth.com/plugin/example")).toBe("https://modrinth.com/plugin/example");
    expect(safeExternalUrl("http://example.test/project")).toBe("http://example.test/project");
  });

  it("blocks executable, relative, and credential-bearing links", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalUrl("/trusted-looking-path")).toBeNull();
    expect(safeExternalUrl("https://user:password@example.test/")).toBeNull();
  });

  it("can require HTTPS for embedded third-party content", () => {
    expect(safeExternalUrl("http://wj.qq.com/form", { httpsOnly: true })).toBeNull();
    expect(safeExternalUrl("https://wj.qq.com/form", { httpsOnly: true })).toBe("https://wj.qq.com/form");
  });
});

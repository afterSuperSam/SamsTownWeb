import { describe, expect, it } from "vitest";
import { can } from "./permissions";

describe("forum permissions", () => {
  it("allows every signed-in role to manage its own account", () => {
    expect(can("viewer", "account")).toBe(true);
    expect(can("member", "account")).toBe(true);
    expect(can("admin", "account")).toBe(true);
    expect(can("owner", "account")).toBe(true);
  });
  it("allows every settled account to view the forum", () => {
    expect(can("viewer", "forum:view")).toBe(true);
    expect(can("member", "forum:view")).toBe(true);
    expect(can("admin", "forum:view")).toBe(true);
    expect(can("owner", "forum:view")).toBe(true);
  });

  it("keeps forum writing at Member and above", () => {
    expect(can("viewer", "forum:write")).toBe(false);
    expect(can("member", "forum:write")).toBe(true);
    expect(can("admin", "forum:write")).toBe(true);
    expect(can("owner", "forum:write")).toBe(true);
  });
});

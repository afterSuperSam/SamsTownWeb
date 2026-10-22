import { describe, expect, it } from "vitest";
import { accountPasswordSchema, loginSchema, normalizeUsername } from "./authCredentials.js";

describe("account credential contract", () => {
  it("normalizes usernames consistently", () => {
    expect(normalizeUsername("  DogSam  ")).toBe("dogsam");
  });

  it("uses the same password ceiling for creation and login", () => {
    const password = "a".repeat(257);
    expect(accountPasswordSchema.safeParse(password).success).toBe(false);
    expect(loginSchema.safeParse({ username: "DogSam", password }).success).toBe(false);
  });

  it("accepts the longest supported password", () => {
    const password = "a".repeat(256);
    expect(accountPasswordSchema.safeParse(password).success).toBe(true);
    expect(loginSchema.safeParse({ username: "DogSam", password }).success).toBe(true);
  });
});

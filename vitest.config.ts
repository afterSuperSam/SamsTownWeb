import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10_000,
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}", "server/**/*.test.ts"]
  }
});

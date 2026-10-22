// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({ env: { VITE_API_URL: "http://localhost:8787" } }));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } }
}));

const { publicApiRequest } = await import("./apiClient");

describe("API client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("attaches an abort signal to every request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await publicApiRequest("/health");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

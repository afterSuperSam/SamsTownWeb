import { describe, expect, it, vi } from "vitest";
import { collectPages, getTileRequest } from "./mapRepository";

vi.mock("../../../lib/env", () => ({
  env: {
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_ANON_KEY: "public-anon-key"
  }
}));

vi.mock("../../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } })
    }
  }
}));

describe("map cell pagination", () => {
  it("keeps reading after the Supabase 1,000 row boundary", async () => {
    const source = Array.from({ length: 2_305 }, (_, index) => index);
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null
    }));

    await expect(collectPages(fetchPage)).resolves.toEqual(source);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 1_000, 1_999);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 2_000, 2_999);
  });

  it("propagates a failed page without returning a partial map", async () => {
    await expect(collectPages(async from => from === 0
      ? { data: Array.from({ length: 1_000 }, () => 1), error: null }
      : { data: null, error: { message: "page failed" } }
    )).rejects.toMatchObject({ message: "page failed" });
  });
});

describe("public map tiles", () => {
  it("uses the anonymous project token when no user is signed in", async () => {
    const request = await getTileRequest({
      id: "map-1",
      name: "Town",
      description: "",
      shortLabel: "T",
      imageWidth: 1024,
      imageHeight: 1024,
      tileSize: 256,
      maxLevel: 2,
      tileRevision: "revision",
      storagePrefix: "map-1/revision",
      visible: true,
      sortOrder: 0,
      createdBy: "owner",
      createdAt: "2026-08-12T00:00:00Z",
      updatedAt: "2026-08-12T00:00:00Z"
    });

    expect(request.base).toBe("https://example.supabase.co/storage/v1/object/authenticated/town-maps/map-1/revision/tiles");
    expect(request.headers).toEqual({
      Authorization: "Bearer public-anon-key",
      apikey: "public-anon-key"
    });
  });
});

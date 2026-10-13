import { describe, expect, it, vi } from "vitest";
import { getClaimDetail, getMapViewport, listMapSummaries } from "./mapRepository";
import { supabase } from "../../../lib/supabase";

vi.mock("../../../lib/env", () => ({
  env: {
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_ANON_KEY: "public-anon-key"
  }
}));

vi.mock("../../../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } })
    }
  }
}));

const claimRow = {
  id: "claim-1", map_id: "map-1", owner_id: "owner", project_name: "Project", minecraft_username: "Player",
  description: "", color: "#d38d42", status: "planned", created_at: "created", updated_at: "updated"
};
const cells = Array.from({ length: 2305 }, (_, column) => ({ column, row: 0 }));
const bounds = { minColumn: 0, minRow: 0, maxColumn: 3000, maxRow: 0 };

describe("bounded spatial reads", () => {
  it("paginates bounded cells and merges the same claim without losing cells beyond 1000", async () => {
    vi.mocked(supabase.rpc).mockReset().mockImplementation(async (_name, args) => {
      const offset = (args as { p_offset: number }).p_offset;
      return { data: {
        claims: [{ ...claimRow, cells: cells.slice(offset, offset + 1000), partial: true }],
        markers: [], hasMore: offset + 1000 <= cells.length, markerTotal: 0, markerRevision: "empty",
        cellTotal: cells.length, cellRevision: "stable"
      }, error: null } as never;
    });
    const snapshot = await getMapViewport("map-1", bounds, "claims");
    expect(snapshot.claims[0].cells).toEqual(cells);
    expect(snapshot.claims[0].partial).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(3);
  });

  it("paginates markers beyond 1000 and rejects a changing marker revision", async () => {
    const markers = Array.from({ length: 2305 }, (_, index) => ({
      id: `marker-${index}`, map_id: "map-1", name: "Marker", icon_type: "other", color: "#d38d42",
      description: "", pixel_x: index, pixel_y: 0, created_by: "owner", created_at: "created", updated_at: "updated"
    }));
    vi.mocked(supabase.rpc).mockImplementation(async (_name, args) => {
      const offset = (args as unknown as { p_offset: number }).p_offset;
      return { data: { claims: [], markers: markers.slice(offset, offset + 1000), hasMore: offset + 1000 < markers.length,
        markerTotal: markers.length, markerRevision: "stable", cellTotal: 0, cellRevision: "empty" }, error: null } as never;
    });
    expect((await getMapViewport("map-1", bounds, "markers")).markers).toHaveLength(2305);
    vi.mocked(supabase.rpc).mockReset().mockResolvedValueOnce({ data: {
      claims: [], markers: markers.slice(0, 1000), hasMore: true, markerTotal: 2305, markerRevision: "before", cellTotal: 0, cellRevision: "empty"
    }, error: null } as never).mockResolvedValueOnce({ data: {
      claims: [], markers: [], hasMore: false, markerTotal: 0, markerRevision: "after", cellTotal: 0, cellRevision: "empty"
    }, error: null } as never);
    await expect(getMapViewport("map-1", bounds, "markers")).rejects.toThrow("error.mapDataChanged");
  });



  it("keeps full detail separate from list geometry and exposes database totals", async () => {
    vi.mocked(supabase.rpc).mockReset().mockResolvedValueOnce({ data: {
      items: [{ ...claimRow, cellCount: 2305, bounds }], total: 75, members: ["Player"], colors: ["#d38d42"]
    }, error: null } as never).mockResolvedValueOnce({ data: { ...claimRow, cells }, error: null } as never);
    const page = await listMapSummaries("map-1", "claims", { query: "Project", status: "all", member: "all", color: "all", mine: false, page: 2 });
    expect(page.total).toBe(75);
    expect(page.claims[0]).toMatchObject({ cellCount: 2305, bounds, cells: [] });
    expect((await getClaimDetail("map-1", "claim-1")).cells).toEqual(cells);
  });

  it("rejects incomplete or wrong-map claim geometry rather than marking empty cells as loaded", async () => {
    vi.mocked(supabase.rpc).mockReset().mockResolvedValueOnce({ data: {
      claims: [{ ...claimRow }], markers: [], hasMore: false, markerTotal: 0, markerRevision: "empty", cellTotal: 1, cellRevision: "stable"
    }, error: null } as never).mockResolvedValueOnce({ data: {
      claims: [{ ...claimRow, map_id: "another-map", cells: cells.slice(0, 1) }], markers: [], hasMore: false, markerTotal: 0, markerRevision: "empty", cellTotal: 1, cellRevision: "stable"
    }, error: null } as never);
    await expect(getMapViewport("map-1", bounds, "claims")).rejects.toThrow("error.mapDetailIncomplete");
    await expect(getMapViewport("map-1", bounds, "claims")).rejects.toThrow("error.mapDetailIncomplete");
  });


});

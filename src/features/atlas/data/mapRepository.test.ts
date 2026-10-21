import { describe, expect, it, vi } from "vitest";
import { getProjectDetail, getMapSnapshot, listMapProjects, saveProject, subscribeToMap, subscribeToMapList } from "./mapRepository";
import { supabase } from "../../../lib/supabase";

vi.mock("../../../lib/env", () => ({
  env: { VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_ANON_KEY: "public-anon-key" }
}));

vi.mock("../../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    channel: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }
  }
}));

const claimRow = {
  id: "claim-1", map_id: "map-1", owner_id: "owner", project_name: "Project", minecraft_username: "Player",
  description: "", color: "#d38d42", created_at: "created", updated_at: "updated"
};
const cells = Array.from({ length: 2305 }, (_, column) => ({ column, row: 0 }));
const bounds = { minColumn: 0, minRow: 0, maxColumn: 3000, maxRow: 0 };

function mockTables(tables: Record<string, unknown[]>) {
  const readPage = vi.fn(async (table: string, from: number, to: number) => ({
    data: tables[table].slice(from, to + 1), error: null
  }));
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      range: (from: number, to: number) => readPage(table, from, to)
    };
    return query as never;
  });
  return readPage;
}

describe("complete map reads", () => {
  it("loads all claimed cells beyond 1000 while preserving real geometry and colour", async () => {
    const readPage = mockTables({
      map_claims: [claimRow],
      map_claim_cells: cells.map(cell => ({ claim_id: claimRow.id, chunk_column: cell.column, chunk_row: cell.row }))
    });
    const snapshot = await getMapSnapshot("map-1");
    expect(snapshot.projects[0]).toMatchObject({ color: claimRow.color, cells });
    expect(readPage.mock.calls.filter(([table]) => table === "map_claim_cells")).toHaveLength(3);
  });

  it("keeps full detail separate from list geometry and exposes database totals", async () => {
    vi.mocked(supabase.rpc).mockReset().mockResolvedValueOnce({ data: {
      items: [{ ...claimRow, cellCount: 2305, bounds }], total: 75
    }, error: null } as never).mockResolvedValueOnce({ data: { ...claimRow, cells }, error: null } as never);
    const page = await listMapProjects("map-1", 2);
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "list_map_claim_summaries", {
      p_map_id: "map-1", p_offset: 60, p_limit: 30
    });
    expect(page.total).toBe(75);
    expect(page.projects[0]).toMatchObject({ cellCount: 2305, bounds, cells: [] });
    expect((await getProjectDetail("map-1", "claim-1")).cells).toEqual(cells);
  });

  it("rejects cells whose claim disappeared during pagination", async () => {
    mockTables({ map_claims: [], map_claim_cells: [{ claim_id: claimRow.id, chunk_column: 0, chunk_row: 0 }] });
    await expect(getMapSnapshot("map-1")).rejects.toThrow("error.mapDataChanged");
  });

  it("saves the project contract without a status field", async () => {
    vi.mocked(supabase.rpc).mockReset().mockResolvedValueOnce({ data: { claimId: "project-1", conflicts: [] }, error: null } as never);
    await expect(saveProject({
      mapId: "map-1", projectName: "Project", minecraftUsername: "Player", description: "Long description",
      color: "#d38d42", cells: [{ column: 0, row: 0 }]
    })).resolves.toEqual({ projectId: "project-1", conflicts: [] });
    expect(supabase.rpc).toHaveBeenCalledWith("save_map_claim", {
      p_claim_id: null, p_map_id: "map-1", p_project_name: "Project", p_minecraft_username: "Player",
      p_description: "Long description", p_color: "#d38d42", p_cells: [{ column: 0, row: 0 }]
    });
  });

  it("refreshes map data and directory after subscriptions connect or reconnect", () => {
    const subscriptions: Array<((status: string) => void) | undefined> = [];
    const channel = {
      on: vi.fn((..._arguments: unknown[]) => channel),
      subscribe: (callback?: (status: string) => void) => { subscriptions.push(callback); return channel; }
    };
    vi.mocked(supabase.channel).mockReturnValue(channel as never);
    const changed = vi.fn();
    const mapsChanged = vi.fn();
    subscribeToMap("map-1", changed);
    subscribeToMapList(mapsChanged);
    expect(channel.on.mock.calls.map(call => (call[1] as { table: string }).table)).toEqual([
      "map_claims", "map_claim_cells", "town_maps"
    ]);
    for (const subscription of subscriptions) {
      expect(subscription).toBeTypeOf("function");
      subscription?.("SUBSCRIBED");
      subscription?.("CHANNEL_ERROR");
      subscription?.("SUBSCRIBED");
    }
    expect(changed).toHaveBeenCalledTimes(2);
    expect(mapsChanged).toHaveBeenCalledTimes(2);
  });
});

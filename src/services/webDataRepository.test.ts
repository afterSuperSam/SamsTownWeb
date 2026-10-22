import { describe, expect, it } from "vitest";
import { groupOperationLogs, type OperationLog } from "./webDataRepository";

function log(values: Partial<OperationLog> & Pick<OperationLog, "id" | "action">): OperationLog {
  return {
    actorId: "actor-1",
    actorUsername: "Blessing__you",
    category: "material",
    targetId: `assignment-${values.id}`,
    rootTargetId: "project-1",
    targetName: "北区仓库",
    sourceTable: "material_assignments",
    before: null,
    after: null,
    createdAt: `2026-08-04T10:00:0${values.id}Z`,
    ...values
  };
}

describe("groupOperationLogs", () => {
  it("collapses row-level material changes under one project entry", () => {
    const groups = groupOperationLogs([
      log({ id: 3, action: "update" }),
      log({ id: 2, action: "update" }),
      log({ id: 1, action: "add", targetId: "project-1", sourceTable: "material_projects" })
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ action: "add", targetId: "project-1", targetName: "北区仓库" });
    expect(groups[0].entries).toHaveLength(3);
  });

  it("does not merge changes made by different actors", () => {
    const groups = groupOperationLogs([
      log({ id: 2, action: "update" }),
      log({ id: 1, action: "update", actorId: "actor-2", actorUsername: "DogSam" })
    ]);

    expect(groups).toHaveLength(2);
  });
});

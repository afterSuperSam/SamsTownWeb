import { describe, expect, it } from "vitest";
import { TaskSemaphore } from "./taskQueue.js";

describe("TaskSemaphore", () => {
  it("never runs more tasks than its capacity", async () => {
    const semaphore = new TaskSemaphore(1);
    let active = 0;
    let maximum = 0;
    const task = () => semaphore.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
    });

    await Promise.all([task(), task(), task()]);
    expect(maximum).toBe(1);
  });

  it("releases capacity after a rejected task", async () => {
    const semaphore = new TaskSemaphore(1);
    await expect(semaphore.run(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await expect(semaphore.run(async () => "next")).resolves.toBe("next");
  });

  it("rejects work beyond its bounded waiting room", async () => {
    const semaphore = new TaskSemaphore(1, 1);
    let release!: () => void;
    const blocked = semaphore.run(() => new Promise<void>(resolve => { release = resolve; }));
    const waiting = semaphore.run(async () => undefined);
    await expect(semaphore.run(async () => undefined)).rejects.toMatchObject({
      message: "error.serverBusy",
      statusCode: 503
    });
    release();
    await Promise.all([blocked, waiting]);
  });
});

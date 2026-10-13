// Small in-process semaphore used for CPU-heavy work. It deliberately keeps
// the interface narrower than a general job queue: tasks wait, run, release.
export class TaskSemaphore {
  private readonly waiters: Array<() => void> = [];
  private active = 0;

  constructor(private readonly capacity: number, private readonly maxWaiters = Number.POSITIVE_INFINITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("capacity must be positive");
    if (maxWaiters !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxWaiters) || maxWaiters < 0)) {
      throw new Error("maxWaiters must be non-negative");
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.maxWaiters) {
      throw Object.assign(new Error("error.serverBusy"), { statusCode: 503 });
    }
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }
}

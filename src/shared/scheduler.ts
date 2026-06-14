export type SchedulerTimer = unknown;
export type SchedulerSetTimeout = (callback: () => void, delayMs: number) => SchedulerTimer;
export type SchedulerClearTimeout = (timer: SchedulerTimer) => void;

/**
 * Owns at most one timeout. Replacing or cancelling a schedule invalidates any
 * already-queued callback so stale timers cannot execute later.
 */
export class SingleRunScheduler {
  private timer: SchedulerTimer | undefined;
  private dueAt: number | undefined;
  private generation = 0;

  constructor(
    private readonly setTimeoutFn: SchedulerSetTimeout,
    private readonly clearTimeoutFn: SchedulerClearTimeout,
    private readonly now: () => number = Date.now
  ) {}

  schedule(dueAt: number, callback: () => void | Promise<void>) {
    if (!Number.isFinite(dueAt)) throw new Error("Scheduled wallpaper time is invalid.");
    if (this.timer !== undefined && this.dueAt === dueAt) return false;

    this.cancel();
    const generation = ++this.generation;
    this.dueAt = dueAt;
    this.timer = this.setTimeoutFn(() => {
      if (generation !== this.generation) return;
      this.generation += 1;
      this.timer = undefined;
      this.dueAt = undefined;
      void callback();
    }, Math.max(0, dueAt - this.now()));
    return true;
  }

  cancel() {
    this.generation += 1;
    if (this.timer !== undefined) this.clearTimeoutFn(this.timer);
    this.timer = undefined;
    this.dueAt = undefined;
  }

  pendingAt() {
    return this.dueAt;
  }
}

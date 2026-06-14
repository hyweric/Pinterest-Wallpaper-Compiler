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

export interface WallpaperOperationLease {
  token: number;
  kind: "manual" | "scheduled" | "history" | "source-change";
  startedAt: number;
  recoveredStale: boolean;
}

/**
 * Guards wallpaper work so scheduled and manual runs cannot overlap. A stale
 * lease can be recovered by the next user action instead of leaving the UI
 * permanently locked after a renderer/native-process interruption.
 */
export class SingleFlightWallpaperOperation {
  private lease: WallpaperOperationLease | undefined;
  private sequence = 0;

  constructor(private readonly now: () => number = Date.now) {}

  begin(
    kind: WallpaperOperationLease["kind"],
    staleAfterMs = 180_000
  ): WallpaperOperationLease | undefined {
    const current = this.lease;
    const currentAge = current ? Math.max(0, this.now() - current.startedAt) : 0;
    if (current && currentAge < staleAfterMs) return undefined;

    const lease: WallpaperOperationLease = {
      token: ++this.sequence,
      kind,
      startedAt: this.now(),
      recoveredStale: Boolean(current)
    };
    this.lease = lease;
    return lease;
  }

  finish(token: number) {
    if (!this.lease || this.lease.token !== token) return false;
    this.lease = undefined;
    return true;
  }

  active() {
    return this.lease;
  }

  clear() {
    this.lease = undefined;
  }
}

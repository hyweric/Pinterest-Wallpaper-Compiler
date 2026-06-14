import assert from "node:assert/strict";
import test from "node:test";
import { SingleRunScheduler } from "../shared/scheduler.js";
import { formatWallpaperCountdown } from "../shared/wallpaper.js";

type FakeTimer = { callback: () => void; delay: number; cleared: boolean };

function fakeClock(start = 0) {
  let now = start;
  const timers: FakeTimer[] = [];
  return {
    timers,
    now: () => now,
    setNow: (value: number) => { now = value; },
    setTimeout: (callback: () => void, delay: number) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (value: unknown) => {
      (value as FakeTimer).cleared = true;
    }
  };
}

test("five-second countdown visibly progresses from 5 to 0", () => {
  const target = "2026-06-14T12:00:05.000Z";
  const start = Date.parse("2026-06-14T12:00:00.000Z");
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((seconds) => formatWallpaperCountdown(target, start + seconds * 1000)),
    ["5s", "4s", "3s", "2s", "1s", "0s"]
  );
});

test("scheduler runs a five-second task exactly once", () => {
  const clock = fakeClock(1_000);
  const scheduler = new SingleRunScheduler(clock.setTimeout, clock.clearTimeout, clock.now);
  let runs = 0;
  scheduler.schedule(6_000, () => { runs += 1; });
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0].delay, 5_000);
  clock.setNow(6_000);
  clock.timers[0].callback();
  clock.timers[0].callback();
  assert.equal(runs, 1);
});

test("replacement, duplicate, and cancellation behavior is single-run", () => {
  const clock = fakeClock(0);
  const scheduler = new SingleRunScheduler(clock.setTimeout, clock.clearTimeout, clock.now);
  let runs = 0;
  assert.equal(scheduler.schedule(5_000, () => { runs += 1; }), true);
  const first = clock.timers[0];
  assert.equal(scheduler.schedule(5_000, () => { runs += 1; }), false);
  assert.equal(clock.timers.length, 1);
  assert.equal(scheduler.schedule(10_000, () => { runs += 1; }), true);
  assert.equal(first.cleared, true);
  const replacement = clock.timers[1];
  scheduler.cancel();
  assert.equal(replacement.cleared, true);
  replacement.callback();
  assert.equal(runs, 0);
});

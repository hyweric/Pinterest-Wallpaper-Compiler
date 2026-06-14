import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("scheduled runs defer without creating a one-second retry loop", async () => {
  const source = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(source, /scheduledRunDeferredRef\.current = true/);
  assert.match(source, /finishWallpaperOperation\(operationToken\)/);
  assert.match(source, /SingleFlightWallpaperOperation/);
  assert.doesNotMatch(source, /Date\.now\(\) \+ 1_000/);
  assert.doesNotMatch(source, /nextScheduledAt: retryAt/);
});

test("wallpaper controller is process-wide so the active-Space observer is not duplicated", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");
  assert.match(source, /const wallpaperController = createWallpaperController\(\)/);
  assert.equal((source.match(/createWallpaperController\(\)/g) ?? []).length, 1);
  assert.match(source, /wallpaperController\.dispose\?\.\(\)/);
});

test("visible-display application has one bounded WallpaperAgent catch-up retry", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/wallpaper.ts"), "utf8");
  assert.match(source, /applyMacScreensWithRetry/);
  assert.match(source, /setTimeout\(resolve, 1_000\)/);
  assert.match(source, /successfulMacApplyCount/);
});

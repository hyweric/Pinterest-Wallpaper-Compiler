import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("renderer scheduling is removed while wallpaper operations remain single-flight", async () => {
  const source = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(source, /SingleFlightWallpaperOperation/);
  assert.match(source, /finishWallpaperOperation\(operationToken\)/);
  assert.doesNotMatch(source, /SingleRunScheduler/);
  assert.doesNotMatch(source, /scheduledRunDeferredRef/);
  assert.doesNotMatch(source, /<summary>Schedule/);
  assert.match(source, /interval: "manual"/);
});

test("wallpaper controller is process-wide so the active-Space observer is not duplicated", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");
  assert.match(source, /const wallpaperController = createWallpaperController\(\)/);
  assert.equal((source.match(/createWallpaperController\(\)/g) ?? []).length, 1);
  assert.match(source, /wallpaperController\.dispose\?\.\(\)/);
});

test("visible-display application has bounded delayed verification before failure", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/wallpaper.ts"), "utf8");
  assert.match(source, /applyMacScreensWithRetry/);
  assert.match(source, /setTimeout\(resolve, 1_000\)/);
  assert.match(source, /macos-appkit-verify-visible-displays/);
  assert.match(source, /const visiblePass = await applyMacScreensWithRetry\(assignments, nativeResults\)/);
  assert.match(source, /successfulMacApplyCount/);
});

test("failed inactive-Space adoption rolls back to a visible-preserving Store baseline", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/macos-spaces.ts"), "utf8");
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(source, /function applyVisibleFallbackBaseline/);
  assert.match(source, /writePlist\(visibleFallback, backupPath\)/);
  assert.match(source, /fallbackVerification = verifyAppliedApproach/);
  assert.match(source, /output\.verifiedDisplayCount = fallbackVerification\.verifiedDisplays/);
  assert.match(source, /bridgeResult\.privateFrameworksAvailable/);
  assert.match(source, /return candidates\.find\(\(section\) => desktopReferencesPath\(get\(section, 'Desktop'\), assignment\.filePath\)\) \|\| candidates\[0\] \|\| null/);
  assert.doesNotMatch(source, /copyReplacing\(indexPath, backupPath\);\s*const initial = readMutablePlist\(indexPath\)/);
  assert.match(renderer, /Create Wallpaper Set is the supported workflow for all Mission Control Spaces/);
  assert.match(renderer, /Preview on Current Desktop affects only the active desktop/);
});

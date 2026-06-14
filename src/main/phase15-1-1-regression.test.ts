import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chooseMacOSWallpaperStrategy } from "./macos-spaces.js";

const base = {
  platform: "darwin",
  storeCompatible: false,
  storeWritable: false,
  legacyCompatible: false,
  legacyWritable: false,
  legacyTargetRecordCount: 0
};

test("strategy selection uses both verified stores when available", () => {
  assert.equal(chooseMacOSWallpaperStrategy({
    ...base,
    storeCompatible: true,
    storeWritable: true,
    legacyCompatible: true,
    legacyWritable: true,
    legacyTargetRecordCount: 12
  }), "modern-store+legacy-dock");
});

test("strategy fixtures cover modern, legacy, observer-only, and unsupported environments", () => {
  assert.equal(chooseMacOSWallpaperStrategy({ ...base, storeCompatible: true, storeWritable: true }), "modern-store");
  assert.equal(chooseMacOSWallpaperStrategy({ ...base, legacyCompatible: true, legacyWritable: true, legacyTargetRecordCount: 5 }), "legacy-dock");
  assert.equal(chooseMacOSWallpaperStrategy(base), "observer-only");
  assert.equal(chooseMacOSWallpaperStrategy({ ...base, platform: "linux" }), "unsupported");
});

test("modern Store transaction preserves a template, writes Files and Configuration, verifies every target, and rolls back mismatches", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/macos-spaces.ts"), "utf8");
  assert.match(source, /findDesktopTemplate/);
  assert.match(source, /existingChoices/);
  assert.match(source, /set\(first, 'Configuration'/);
  assert.match(source, /set\(first, 'Files'/);
  assert.match(source, /targetSpaceKeys/);
  assert.match(source, /verifiedSpaceCount !== result\.targetSpaceCount/);
  assert.match(source, /copyReplacing\(backupPath, indexPath\)/);
});

test("legacy compatibility route backs up, updates in one transaction, verifies, and restores on failure", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/macos-spaces.ts"), "utf8");
  assert.match(source, /\.backup/);
  assert.match(source, /begin immediate/);
  assert.match(source, /macos-legacy-wallpaper-verify/);
  assert.match(source, /restoreLegacyDatabase/);
  assert.match(source, /killall", \["Dock"\]/);
});

test("generated wallpaper cleanup preserves paths referenced by both wallpaper stores", async () => {
  const mainSource = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");
  const spacesSource = await readFile(path.join(process.cwd(), "src/main/macos-spaces.ts"), "utf8");
  assert.match(mainSource, /cleanupGeneratedWallpaperCache/);
  assert.match(mainSource, /getReferencedWallpaperPaths/);
  assert.match(spacesSource, /getMacOSReferencedWallpaperPaths/);
  assert.match(mainSource, /cleanupGeneratedWallpapers\(cacheDir, 160, \[currentFilePath, \.\.\.referenced\]\)/);
});

test("observer is maintenance or fallback and stops when scheduling is paused", async () => {
  const mainSource = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");
  const wallpaperSource = await readFile(path.join(process.cwd(), "src/main/wallpaper.ts"), "utf8");
  assert.match(mainSource, /!state\.enabled \|\| state\.paused/);
  assert.match(mainSource, /stopSpaceObserver/);
  assert.match(wallpaperSource, /observerFallback = !advanced\.summary\.ok/);
  assert.match(wallpaperSource, /spaceObserver\.start/);
});

test("schedule overlap protection remains single-flight", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /SingleFlightWallpaperOperation/);
  assert.match(renderer, /scheduledRunDeferredRef\.current = true/);
  assert.doesNotMatch(renderer, /Date\.now\(\) \+ 1_000/);
});

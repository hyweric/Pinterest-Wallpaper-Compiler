import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupManagedWallpaperSets,
  listManagedWallpaperSets,
  safeWallpaperSetName,
  uniqueWallpaperSetPath,
  wallpaperSetFolderName,
  wallpaperSetManifestFile
} from "./wallpaper-sets.js";

test("wallpaper set names are Finder-safe", () => {
  assert.equal(safeWallpaperSetName('  Anime / Night: Set?  '), "Anime - Night- Set");
  assert.equal(safeWallpaperSetName("   "), "Wallpaper Set");
  assert.match(wallpaperSetFolderName("Set", new Date(2026, 5, 16, 14, 5, 9)), /^Set - 2026-06-16 140509$/);
});

test("wallpaper set paths never overwrite an existing set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pwc-set-path-"));
  await mkdir(path.join(root, "Set - 2026-06-16 140509"));
  const next = await uniqueWallpaperSetPath(root, "Set - 2026-06-16 140509");
  assert.equal(path.basename(next), "Set - 2026-06-16 140509 (2)");
});

test("cleanup deletes only managed old sets and keeps the newest five", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pwc-set-cleanup-"));
  for (let index = 0; index < 7; index += 1) {
    const folder = path.join(root, `Set ${index}`);
    await mkdir(folder);
    await writeFile(path.join(folder, "wallpaper.png"), Buffer.alloc(index + 1));
    await writeFile(path.join(folder, wallpaperSetManifestFile), JSON.stringify({
      kind: "pwc-macos-wallpaper-set",
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      variationCount: 1
    }));
  }
  const unrelated = path.join(root, "Personal Photos");
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, "keep.txt"), "keep");

  const before = await listManagedWallpaperSets(root);
  assert.equal(before.length, 7);
  const summary = await cleanupManagedWallpaperSets(root, 5);
  assert.equal(summary.deletedSetCount, 2);
  assert.equal(summary.keptSetCount, 5);
  const after = await listManagedWallpaperSets(root);
  assert.equal(after.length, 5);
  assert.equal(await readFile(path.join(unrelated, "keep.txt"), "utf8"), "keep");
});

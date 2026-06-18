import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("macOS wallpaper sets are versioned, staged, and finalized atomically", async () => {
  const main = await source("src/main/main.ts");
  const renderer = await source("src/renderer/main.tsx");
  const sets = await source("src/main/wallpaper-sets.ts");
  assert.match(main, /export-set:begin/);
  assert.match(main, /export-set:finalize/);
  assert.match(main, /export-set:abort/);
  assert.match(sets, /wallpaper-set\.json/);
  assert.match(main, /await rename\(session\.stagingPath, session\.finalPath\)/);
  assert.match(sets, /uniqueWallpaperSetPath/);
  assert.match(renderer, /No incomplete folder was published/);
  assert.match(renderer, /max="500"/);
});

test("Generate and Apply opens set creation for manual inactive-Space requests", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /isMacOS && wallpaperTargetModeNeedsInactiveSpaces/);
  assert.match(renderer, /openExportSet\(targetTemplateId\)/);
  assert.match(renderer, /Create Wallpaper Set/);
  assert.match(renderer, /Automatic all-desktop application is replaced by macOS folder shuffle/);
});

test("wallpaper set deletion requires explicit confirmation and preserves the parent folder", async () => {
  const main = await source("src/main/main.ts");
  const sets = await source("src/main/wallpaper-sets.ts");
  assert.match(main, /Clean up old generated wallpaper set folders/);
  assert.match(main, /Clean Up Folder/);
  assert.match(main, /preview/);
  assert.match(main, /safeWallpaperSetEraseRoot/);
  assert.match(sets, /eraseWallpaperSetRootContents/);
  assert.match(sets, /await rm\(entry\.entryPath, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(sets, /await rm\(rootPath/);
});

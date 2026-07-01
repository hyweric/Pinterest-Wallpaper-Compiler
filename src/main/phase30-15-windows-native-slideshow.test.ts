import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("Windows wallpaper packs prefer the native IDesktopWallpaper slideshow API", async () => {
  const main = await source("src/main/main.ts");
  assert.match(main, /windowsNativeSlideshowPowerShell/);
  assert.match(main, /IDesktopWallpaper\.SetSlideshow/);
  assert.match(main, /SetSlideshowOptions\(\$slideOptions, \$intervalMs\)/);
  assert.match(main, /SHCreateShellItemArrayFromShellItem/);
  assert.match(main, /verificationMethod:\s*"windows-idesktopwallpaper-native-slideshow"/);
});

test("Windows fallback rotation disables custom overlay fades after native setup failure", async () => {
  const main = await source("src/main/main.ts");
  assert.match(main, /Windows native slideshow setup failed; falling back to Pin Paper timer/);
  assert.match(main, /transitionEnabled:\s*false/);
  assert.match(main, /compatibility timer without custom fade overlays/);
});

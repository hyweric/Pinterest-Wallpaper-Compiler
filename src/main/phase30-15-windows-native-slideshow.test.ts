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

test("Windows wallpaper set UI exposes apply wording, fit mode, and shuffle", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const sharedPlatform = await source("src/shared/platform.ts");
  assert.match(sharedPlatform, /createWallpaperSet:\s*"Apply Wallpaper Set"/);
  assert.match(renderer, /Wallpaper fit/);
  assert.match(renderer, /Shuffle images/);
  assert.match(renderer, /Apply Wallpaper Set/);
  assert.match(renderer, /windowsDisplayMode/);
  assert.match(renderer, /windowsShuffle/);
});

test("Windows native slideshow receives display mode and shuffle preferences", async () => {
  const main = await source("src/main/main.ts");
  const types = await source("src/shared/types.ts");
  assert.match(types, /shuffle\?: boolean/);
  assert.match(main, /SetPosition\(\[PinPaperWallpaperNative\.DesktopWallpaperPosition\]::\$positionName\)/);
  assert.match(main, /payload\.shuffle !== false/);
  assert.match(main, /shuffledWindowsWallpaperFiles/);
});

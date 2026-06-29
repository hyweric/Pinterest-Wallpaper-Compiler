import test from "node:test";
import assert from "node:assert/strict";
import {
  fallbackWallpaperTargetMode,
  platformCapabilities,
  platformCopy,
  platformKindFromNodePlatform,
  platformSupportsWallpaperTargetMode
} from "../shared/platform.js";

test("platform capabilities separate macOS Spaces from Windows and web", () => {
  assert.equal(platformKindFromNodePlatform("darwin"), "macos");
  assert.equal(platformKindFromNodePlatform("win32"), "windows");
  assert.equal(platformCapabilities("macos").canUseMacSpaces, true);
  assert.equal(platformCapabilities("windows").canUseMacSpaces, false);
  assert.equal(platformCapabilities("web").canApplyWallpaper, false);
});

test("unsupported wallpaper target modes fall back safely by platform", () => {
  assert.equal(platformSupportsWallpaperTargetMode("macos", "all-desktops-all-monitors"), true);
  assert.equal(platformSupportsWallpaperTargetMode("windows", "all-desktops-all-monitors"), false);
  assert.equal(fallbackWallpaperTargetMode("windows", "all-desktops-all-monitors"), "current-desktop");
  assert.equal(fallbackWallpaperTargetMode("web", "current-desktop"), "current-desktop");
});

test("platform copy avoids macOS language outside macOS", () => {
  assert.match(platformCopy("macos").previewCurrentDesktop, /Current Desktop/);
  assert.equal(platformCopy("windows").createWallpaperSet, "Create Wallpaper Pack");
  assert.equal(platformCopy("web").applyWallpaper, "Download Wallpaper");
});

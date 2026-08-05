import test from "node:test";
import { isLikelyPinterestAd } from "./providers.js";
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
  assert.equal(platformCapabilities("macos").canPreviewCurrentDesktop, true);
  assert.equal(platformCapabilities("windows").canPreviewCurrentDesktop, true);
  assert.equal(platformCopy("windows").createWallpaperSet, "Apply Wallpaper Set");
  assert.equal(platformCopy("web").applyWallpaper, "Download Wallpaper");
});


test("Pinterest ad metadata is rejected without broad content guessing", () => {
  assert.equal(isLikelyPinterestAd({ is_promoted: true }), true);
  assert.equal(isLikelyPinterestAd({ promotedPin: { id: "ad" } }), true);
  assert.equal(isLikelyPinterestAd({ label: "Sponsored" }), true);
  assert.equal(isLikelyPinterestAd({ description: "ordinary art reference", type: "pin" }), false);
});

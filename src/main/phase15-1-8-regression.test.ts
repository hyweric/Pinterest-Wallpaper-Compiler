import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chooseMacOSWallpaperStrategy, nativeGlobalAllSpacesEligibility } from "./macos-spaces.js";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("modern Store is the only inactive-Space strategy and refresh never restarts Dock", async () => {
  assert.equal(chooseMacOSWallpaperStrategy({
    platform: "darwin",
    macOSMajorVersion: 15,
    storeCompatible: true,
    storeWritable: true,
    legacyCompatible: true,
    legacyWritable: true,
    legacyTargetRecordCount: 147
  }), "modern-store");
  assert.equal(chooseMacOSWallpaperStrategy({
    platform: "darwin",
    macOSMajorVersion: 15,
    storeCompatible: false,
    storeWritable: false,
    legacyCompatible: true,
    legacyWritable: true,
    legacyTargetRecordCount: 147
  }), "observer-only");

  const macOS = await source("src/main/macos-spaces.ts");
  assert.doesNotMatch(macOS, /killall[\s\S]{0,80}Dock/);
  assert.match(macOS, /PWC_NATIVE_GLOBAL_ALL_SPACES_V1/);
  assert.match(macOS, /macos-native-show-on-all-spaces/);
  assert.doesNotMatch(macOS, /refreshMode === 'active-space-walk'/);
  assert.doesNotMatch(macOS, /CGSManagedDisplaySetCurrentSpace/);
  assert.doesNotMatch(macOS, /runTask\('\/usr\/bin\/killall', \['WallpaperAgent'\]\)/);
  assert.doesNotMatch(macOS, /applyLegacyWallpaperDatabase/);
  assert.doesNotMatch(macOS, /desktoppicture\.db path is diagnostic-only[\s\S]*restart Dock/);
});

test("desktop overlay architecture is completely removed", async () => {
  const main = await source("src/main/main.ts");
  const types = await source("src/shared/types.ts");
  const renderer = await source("src/renderer/main.tsx");
  await assert.rejects(access(path.join(root, "src/main/desktop-layer.ts")));
  assert.doesNotMatch(main, /DesktopLayer|desktopLayerManager|type:\s*["']desktop["']/);
  assert.doesNotMatch(types, /desktopLayer/);
  assert.doesNotMatch(renderer, /desktopLayer|Silent desktop-layer coverage/);
});

test("obsolete private bridge and desktop overlay architecture are not part of the build", async () => {
  const packageJson = JSON.parse(await source("package.json")) as { scripts: Record<string, string>; build: { asarUnpack?: string[] } };
  assert.doesNotMatch(packageJson.scripts["build:electron"], /build-macos-wallpaper-bridge/);
  assert.ok(!packageJson.build.asarUnpack || !packageJson.build.asarUnpack.some((entry) => entry.includes("pwc-wallpaper-bridge")));
});

test("legacy native global controller remains bounded while the renderer uses immutable wallpaper sets", async () => {
  const macOS = await source("src/main/macos-spaces.ts");
  const wallpaper = await source("src/main/wallpaper.ts");
  const renderer = await source("src/renderer/main.tsx");
  const controllerStart = macOS.lastIndexOf("export async function applyMacOSWallpapersAcrossSpaces(");
  const controllerEnd = macOS.indexOf("export async function getMacOSReferencedWallpaperPaths", controllerStart);
  const controller = macOS.slice(controllerStart, controllerEnd);
  assert.match(controller, /applyNativeGlobalAllSpacesSetting/);
  assert.match(controller, /globalWallpaperReferenceMatches/);
  assert.match(macOS, /x-apple\.systempreferences:com\.apple\.Wallpaper-Settings\.extension/);
  assert.match(macOS, /Show on all Spaces/);
  assert.doesNotMatch(controller, /applyStableAssetSlots/);
  assert.doesNotMatch(controller, /applyModernWallpaperStore/);
  assert.doesNotMatch(controller, /copyFile\(/);
  assert.doesNotMatch(controller, /killall/);
  assert.doesNotMatch(macOS, /CGSManagedDisplaySetCurrentSpace/);
  assert.doesNotMatch(wallpaper, /this\.spaceObserver\.start\(/);
  assert.match(renderer, /Create a Wallpaper Set, then choose that folder in macOS Wallpaper Settings/);
  assert.match(renderer, /Pin Paper Sets/);
  assert.match(renderer, /Create Wallpaper Set/);
});

test("native global eligibility protects per-monitor and different-image batches", () => {
  const same = [{ displayId: "1", filePath: "/tmp/wallpaper.png" }];
  assert.equal(nativeGlobalAllSpacesEligibility(same, "all-desktops-current-monitor", 1).ok, true);
  assert.equal(nativeGlobalAllSpacesEligibility(same, "all-desktops-current-monitor", 2).ok, false);
  assert.equal(nativeGlobalAllSpacesEligibility([
    { displayId: "1", filePath: "/tmp/a.png" },
    { displayId: "2", filePath: "/tmp/b.png" }
  ], "all-desktops-all-monitors", 2).ok, false);
  assert.equal(nativeGlobalAllSpacesEligibility([
    { displayId: "1", filePath: "/tmp/a.png" },
    { displayId: "2", filePath: "/tmp/a.png" }
  ], "all-desktops-all-monitors", 2).ok, true);
});

test("legacy native global telemetry stays typed but is no longer the primary all-Space UI", async () => {
  const types = await source("src/shared/types.ts");
  const renderer = await source("src/renderer/main.tsx");
  assert.match(types, /nativeGlobalSettingAttempted/);
  assert.match(types, /nativeGlobalSettingEnabled/);
  assert.match(types, /nativeGlobalSettingRearmed/);
  assert.match(types, /nativeGlobalSettingPermissionDenied/);
  assert.match(renderer, /macOS folder shuffle/);
  assert.match(renderer, /Show on all Spaces/);
  assert.doesNotMatch(renderer, /Run macOS diagnostic/);
});

test("fade overlays stay disabled while native desktop refresh is the default", async () => {
  const main = await source("src/main/main.ts");
  assert.match(main, /const fadeOverlayTransitionsEnabled = false/);
  assert.doesNotMatch(main, /activeFadeOverlayWindows/);
  assert.doesNotMatch(main, /destroyAllFadeOverlays/);
  assert.doesNotMatch(main, /Fade overlay exceeded its maximum lifetime/);
  assert.match(main, /transitionDiagnostics/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  selectWallpaperTargets,
  wallpaperTargetModeLabel,
  wallpaperTargetModeNeedsInactiveSpaces
} from "../shared/wallpaper.js";
import type { WallpaperTarget } from "../shared/types.js";

const targets: WallpaperTarget[] = [
  {
    id: "display-101",
    label: "Built-in Display",
    index: 1,
    displayId: "101",
    displayName: "Built-in Display",
    current: false,
    primary: true,
    visible: true,
    targetType: "physical-display",
    reliable: true
  },
  {
    id: "display-202",
    label: "Studio Display",
    index: 2,
    displayId: "202",
    displayName: "Studio Display",
    current: true,
    primary: false,
    visible: true,
    targetType: "physical-display",
    reliable: true
  }
];

test("current desktop resolves to the display containing the app window", () => {
  assert.deepEqual(selectWallpaperTargets(targets, "current-desktop").map((item) => item.displayId), ["202"]);
});

test("current monitor honors the explicit monitor selection", () => {
  assert.deepEqual(selectWallpaperTargets(targets, "current-monitor", "101").map((item) => item.displayId), ["101"]);
});

test("all visible monitors selects every reliable connected physical display", () => {
  assert.deepEqual(selectWallpaperTargets(targets, "all-visible-monitors").map((item) => item.displayId), ["101", "202"]);
});

test("inactive Space modes retain their physical display scope", () => {
  assert.equal(wallpaperTargetModeNeedsInactiveSpaces("all-desktops-current-monitor"), true);
  assert.equal(wallpaperTargetModeNeedsInactiveSpaces("all-desktops-all-monitors"), true);
  assert.deepEqual(selectWallpaperTargets(targets, "all-desktops-current-monitor", "101").map((item) => item.displayId), ["101"]);
  assert.deepEqual(selectWallpaperTargets(targets, "all-desktops-all-monitors").map((item) => item.displayId), ["101", "202"]);
  assert.equal(wallpaperTargetModeLabel("all-desktops-all-monitors"), "All desktops on all monitors");
});

test("macOS all-desktop implementation is diagnostic-driven, transactional, and uses the modern Store on macOS 15", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/wallpaper.ts"), "utf8");
  const spacesSource = await readFile(path.join(process.cwd(), "src/main/macos-spaces.ts"), "utf8");
  assert.match(source, /setDesktopImageURLForScreenOptionsError/);
  assert.match(spacesSource, /diagnoseMacOSWallpaperEnvironment/);
  assert.match(spacesSource, /com\.apple\.wallpaper\/Store\/Index\.plist/);
  assert.match(spacesSource, /writePlist/);
  assert.match(spacesSource, /desktopReferencesPath/);
  assert.match(spacesSource, /desktoppicture\.db/);
  assert.match(spacesSource, /macOSMajorVersion/);
  assert.match(spacesSource, /if \(modern\) return "modern-store"/);
  assert.match(spacesSource, /spaceDisplayUUIDs/);
  assert.match(spacesSource, /rollbackPerformed/);
  assert.match(spacesSource, /PWC_SPACE_OBSERVER_V3/);
  assert.match(spacesSource, /NSWorkspaceActiveSpaceDidChangeNotification/);
  assert.match(spacesSource, /NSWorkspaceDidWakeNotification/);
});

test("targeting UI hides low-level targets and exposes only supported wallpaper assignment choices", async () => {
  const source = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const start = source.indexOf("function WallpaperPanel(");
  const end = source.indexOf("function CanvasDesignPanel(", start);
  const panel = source.slice(start, end);
  assert.match(panel, /Same generated wallpaper on every display/);
  assert.match(panel, /Different generated variation on each display/);
  assert.match(panel, /Create Wallpaper Set is the supported workflow for all Mission Control Spaces/);
  assert.doesNotMatch(panel, /Apply to/);
  assert.doesNotMatch(panel, /value="current-desktop"/);
  assert.doesNotMatch(panel, /value="all-desktops-all-monitors"/);
  assert.doesNotMatch(panel, /Target templates/);
  assert.match(source, /Automatic all-desktop application is replaced by macOS folder shuffle/);
  assert.doesNotMatch(source, /Advanced macOS mode: inactive Spaces are updated immediately/);
});

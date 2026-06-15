import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chooseMacOSWallpaperStrategy } from "./macos-spaces.js";

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
  assert.match(macOS, /runTask\('\/usr\/bin\/killall', \['WallpaperAgent'\]\)/);
  assert.match(macOS, /wallpaperagent-restart/);
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

test("compiled Swift bridge is built, packaged outside asar, and never opens windows or restarts processes", async () => {
  const macOS = await source("src/main/macos-spaces.ts");
  const helper = await source("src/main/pwc-wallpaper-bridge.swift");
  const buildScript = await source("scripts/build-macos-wallpaper-bridge.cjs");
  const packageJson = JSON.parse(await source("package.json")) as { scripts: Record<string, string>; build: { asarUnpack?: string[] } };
  assert.match(macOS, /app\.asar\.unpacked/);
  assert.match(macOS, /if \(\s*\/app\\\.asar\[\\\\\/\]\/\.test\(candidate\)\s*\) continue/);
  assert.match(helper, /Wallpaper\.framework/);
  assert.match(helper, /WallpaperFoundation\.framework/);
  assert.match(helper, /WallpaperExtensionKit\.framework/);
  assert.match(helper, /Wallpaper\.AgentXPCProtocol/);
  assert.match(helper, /updateDesktopWallpaperUserSettings/);
  assert.doesNotMatch(helper, /DistributedNotificationCenter|CFNotificationCenterPostNotification/);
  assert.doesNotMatch(helper, /NSWindow|BrowserWindow|killall|pkill|SIGKILL|terminate\(/);
  assert.match(buildScript, /require\(["']node:child_process["']\)/);
  assert.match(buildScript, /const \{ spawnSync \} = require\(["']node:child_process["']\)/);
  assert.doesNotMatch(buildScript, /spawnSync[^\n]*require\(["']node:fs["']\)/);
  assert.match(buildScript, /swiftc/);
  assert.match(packageJson.scripts["build:electron"], /build-macos-wallpaper-bridge/);
  assert.deepEqual(packageJson.build.asarUnpack, ["dist/main/helpers/pwc-wallpaper-bridge"]);
});

test("failed direct bridge can fall back to WallpaperAgent refresh without Dock or Space automation", async () => {
  const macOS = await source("src/main/macos-spaces.ts");
  const wallpaper = await source("src/main/wallpaper.ts");
  const renderer = await source("src/renderer/main.tsx");
  assert.match(macOS, /Direct private wallpaper bridge is unavailable/);
  assert.match(macOS, /The direct private wallpaper bridge could not get WallpaperAgent to accept a native refresh request/);
  assert.match(macOS, /runTask\('\/usr\/bin\/killall', \['WallpaperAgent'\]\)/);
  assert.match(macOS, /reloadMethod = 'wallpaperagent-restart'/);
  assert.match(macOS, /copyReplacing\(backupPath, indexPath\)/);
  assert.match(macOS, /Only the currently visible monitor targets were changed/);
  assert.match(macOS, /No Dock restart, WallpaperAgent restart, or overlay was used/);
  assert.match(wallpaper, /advancedObserverFallback = !advancedImmediate && observerStarted/);
  assert.match(wallpaper, /observer-fallback/);
  assert.match(wallpaper, /active-Space observer will apply this wallpaper to each Mission Control desktop as you visit it/);
  assert.match(renderer, /active Space-change observer will repair inactive Mission Control desktops as you visit them/);
  assert.doesNotMatch(macOS, /macos-mission-control-space-sweep/);
  assert.doesNotMatch(macOS, /Application\('System Events'\)\.keyCode/);
  assert.doesNotMatch(renderer, /Sweep desktops now/);
  assert.doesNotMatch(macOS, /macos-space-visit-appkit-apply/);
  assert.doesNotMatch(macOS, /CGSManagedDisplaySetCurrentSpace/);
});

test("direct bridge telemetry is presented honestly", async () => {
  const types = await source("src/shared/types.ts");
  const renderer = await source("src/renderer/main.tsx");
  assert.match(types, /directBridgeAttempted/);
  assert.match(types, /directBridgeAvailable/);
  assert.match(types, /directBridgeRequestAccepted/);
  assert.match(types, /directBridgeMechanism/);
  assert.match(types, /fallbackToVisibleMonitors/);
  assert.match(renderer, /Direct bridge attempted/);
  assert.match(renderer, /Direct bridge available/);
  assert.match(renderer, /Request accepted/);
  assert.match(renderer, /Mechanism/);
  assert.match(renderer, /Overlay created: no/);
});

test("fade stays disabled while direct all-Space control is experimental", async () => {
  const main = await source("src/main/main.ts");
  assert.match(main, /const fadeOverlayTransitionsEnabled = false/);
});

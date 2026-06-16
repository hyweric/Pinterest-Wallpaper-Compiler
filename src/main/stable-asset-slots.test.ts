import assert from "node:assert/strict";
import test from "node:test";
import type { MacOSWallpaperDiagnosticReport } from "../shared/types.js";
import { planStableAssetSlotUpdates } from "./macos-spaces.js";

function diagnostic(overrides: Partial<MacOSWallpaperDiagnosticReport> = {}): MacOSWallpaperDiagnosticReport {
  return {
    ok: true,
    generatedAt: new Date(0).toISOString(),
    platform: "darwin",
    macOSVersion: "15.6.1",
    activeSpaceUUIDs: ["SPACE-1"],
    displays: [{
      displayId: "1",
      displayUUID: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      name: "Built-in Retina Display",
      primary: true,
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      currentSpaceUUID: "SPACE-1",
      spaceUUIDs: ["SPACE-1", "SPACE-2", "SPACE-3"]
    }],
    totalSpaceCount: 3,
    sharedSpaceCount: 0,
    sharedSpaceUUIDs: [],
    wallpaperAgentRunning: true,
    dockRunning: true,
    store: {
      path: "/tmp/Index.plist",
      exists: true,
      readable: true,
      writable: true,
      schema: "modern-index-v1",
      compatible: true,
      topLevelKeys: ["Spaces", "Displays"],
      displayRecordCount: 1,
      spaceRecordCount: 3,
      desktopRecordCount: 7,
      displayKeys: ["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"],
      spaceDisplayUUIDs: {
        "SPACE-1": ["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"],
        "SPACE-2": ["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"],
        "SPACE-3": ["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"]
      },
      displayPaths: {
        "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE": "/tmp/vault/display.png"
      },
      spaceDisplayPaths: {
        "SPACE-1": { "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE": "/tmp/vault/space-1.png" },
        "SPACE-2": { "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE": "/tmp/vault/space-2.png" },
        "SPACE-3": { "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE": "/tmp/vault/space-3.png" }
      },
      references: []
    },
    legacyDatabase: {
      path: "/tmp/desktoppicture.db",
      exists: true,
      readable: true,
      writable: true,
      compatible: true,
      tables: [],
      pictureRecordCount: 0,
      targetRecordCount: 0,
      references: []
    },
    recommendedStrategy: "modern-store",
    warnings: [],
    errors: [],
    ...overrides
  };
}

test("stable asset-slot planning covers every app-owned Space without changing Store paths", () => {
  const plan = planStableAssetSlotUpdates(
    diagnostic(),
    [{ displayId: "1", filePath: "/tmp/vault/new.png" }],
    "all-desktops-current-monitor",
    "/tmp/vault"
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.targetSpaceCount, 3);
  assert.equal(plan.targetSharedSpaceCount, 0);
  assert.equal(plan.targetDisplayCount, 1);
  assert.deepEqual(
    plan.updates.filter((update) => update.kind === "space").map((update) => update.targetPath).sort(),
    ["/tmp/vault/space-1.png", "/tmp/vault/space-2.png", "/tmp/vault/space-3.png"]
  );
});

test("shared Store records are updated but excluded from the user desktop count", () => {
  const current = diagnostic();
  current.sharedSpaceUUIDs = ["SPACE-3"];
  current.sharedSpaceCount = 1;
  const plan = planStableAssetSlotUpdates(
    current,
    [{ displayId: "1", filePath: "/tmp/vault/new.png" }],
    "all-desktops-current-monitor",
    "/tmp/vault"
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.targetSpaceCount, 2);
  assert.equal(plan.targetSharedSpaceCount, 1);
});

test("stable asset-slot planning refuses to overwrite wallpaper files outside the permanent vault", () => {
  const current = diagnostic();
  current.store.spaceDisplayPaths!["SPACE-2"]["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"] = "/Users/example/Pictures/personal-photo.jpg";
  const plan = planStableAssetSlotUpdates(
    current,
    [{ displayId: "1", filePath: "/tmp/vault/new.png" }],
    "all-desktops-current-monitor",
    "/tmp/vault"
  );
  assert.equal(plan.ok, false);
  assert.match(plan.errors.join(" "), /outside the Wallpaper Vault/);
});

test("global backing slots are included only when one wallpaper targets all monitors", () => {
  const current = diagnostic();
  current.store.references = [
    { source: "SystemDefault.Desktop.Content.Choices.0.Files.0.relative", path: "/tmp/vault/system.png", exists: true, readable: true },
    { source: "AllSpacesAndDisplays.Desktop.Content.Choices.0.Files.0.relative", path: "/tmp/vault/all.png", exists: true, readable: true }
  ];
  const currentMonitor = planStableAssetSlotUpdates(
    current,
    [{ displayId: "1", filePath: "/tmp/vault/new.png" }],
    "all-desktops-current-monitor",
    "/tmp/vault"
  );
  assert.equal(currentMonitor.updates.some((update) => update.kind === "global"), false);

  const allMonitors = planStableAssetSlotUpdates(
    current,
    [{ displayId: "1", filePath: "/tmp/vault/new.png" }],
    "all-desktops-all-monitors",
    "/tmp/vault"
  );
  assert.equal(allMonitors.updates.filter((update) => update.kind === "global").length, 2);
});

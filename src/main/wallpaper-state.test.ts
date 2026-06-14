import test from "node:test";
import assert from "node:assert/strict";
import {
  appendAppliedHistory,
  buildMacOSWallpaperTargets,
  classifyMacOSDockRows,
  generationStateAfterApplication,
  nextHistoryIndex,
  nextScheduledAt,
  planFadeOverlayAssignments,
  planTemplateRotation,
  previousHistoryIndex,
  targetsForWallpaperApply,
  wallpaperFailureDecision
} from "../shared/wallpaper.js";
import type { GeneratedCombination, TemplateLibrary, WallpaperTemplate } from "../shared/types.js";

function combo(id: string): GeneratedCombination {
  return { id, name: id, createdAt: new Date(0).toISOString(), assignments: {} };
}

function template(id: string, enabledForRotation = true): WallpaperTemplate {
  return {
    id,
    name: id,
    project: { canvas: {} as WallpaperTemplate["project"]["canvas"], layers: [], sourceIds: [], wallpaper: {} as WallpaperTemplate["project"]["wallpaper"] },
    collectionIds: [], favorite: false, enabledForRotation, weight: 1,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

const library: TemplateLibrary = {
  templates: [], collections: [], rotationMode: "sequential", rotationTemplateIds: ["a", "b"],
  shuffleQueue: [], currentIndex: 0, activeTemplateId: "a"
};

test("rotation scheduling computes the next run", () => {
  assert.equal(nextScheduledAt("5m", 20, new Date("2026-01-01T00:00:00.000Z")), "2026-01-01T00:05:00.000Z");
  assert.equal(nextScheduledAt("manual", 20), undefined);
});

test("history navigation does not wrap or mutate history", () => {
  assert.equal(previousHistoryIndex(0, 3), 1);
  assert.equal(previousHistoryIndex(2, 3), undefined);
  assert.equal(nextHistoryIndex(2, 3), 1);
  assert.equal(nextHistoryIndex(0, 3), undefined);
  const history = [combo("a")];
  const appended = appendAppliedHistory(history, combo("b"), 2);
  assert.deepEqual(appended.map((item) => item.id), ["b", "a"]);
  assert.deepEqual(history.map((item) => item.id), ["a"]);
});

test("template rotation is planned without mutating persisted state", () => {
  const plan = planTemplateRotation(library, [template("a"), template("b")]);
  assert.equal(plan?.templateId, "b");
  assert.equal(plan?.nextLibrary.currentIndex, 0);
  assert.equal(library.currentIndex, 0);
});

test("generated shuffle state is committed only after a successful application", () => {
  const current = { layers: [{ sourceState: { currentIndex: 0, shuffleQueue: ["a", "b"] } }] };
  const candidate = { layers: [{ sourceState: { currentIndex: 1, shuffleQueue: ["b"] } }] };
  assert.equal(generationStateAfterApplication(current, candidate, false).layers[0].sourceState.currentIndex, 0);
  assert.equal(generationStateAfterApplication(current, candidate, true).layers[0].sourceState.currentIndex, 1);
});


test("macOS target discovery preserves inactive Spaces even when wallpapers match", () => {
  const targets = buildMacOSWallpaperTargets(
    [
      { pictureId: 11, spaceId: "space-a", displayId: "display-1", currentPath: "/wallpapers/shared.png" },
      { pictureId: 12, spaceId: "space-b", displayId: "display-1", currentPath: "/wallpapers/shared.png" },
      { pictureId: 13, spaceId: "space-c", displayId: "display-1", currentPath: "/wallpapers/other.png" }
    ],
    [{ index: 1, currentPath: "/wallpapers/shared.png" }]
  );
  assert.deepEqual(targets.map((target) => target.id), ["picture-11", "picture-12", "picture-13"]);
  assert.equal(targets.filter((target) => target.current).length, 1);
  assert.equal(targets[1].current, false);
  assert.equal(targets[0].targetType, "active-space");
  assert.equal(targets[1].targetType, "inactive-space");
});

test("fade planning creates exactly one overlay assignment per visible display", () => {
  const plan = planFadeOverlayAssignments(
    ["101", "202"],
    [
      { displayId: "101", filePath: "/new-a.png", oldFilePath: "/old-a.png", current: true },
      { displayId: "202", filePath: "/new-b.png", oldFilePath: "/old-b.png", current: true }
    ]
  );
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((item) => item.item.filePath), ["/new-a.png", "/new-b.png"]);
});


test("visibility classification consumes duplicate wallpaper paths only once per visible desktop", () => {
  const classified = classifyMacOSDockRows(
    [
      { pictureId: 1, currentPath: "/wall/shared.jpg" },
      { pictureId: 2, currentPath: "/wall/shared.jpg" },
      { pictureId: 3, currentPath: "/wall/other.jpg" }
    ],
    [
      { index: 1, currentPath: "/wall/shared.jpg" },
      { index: 2, currentPath: "/wall/other.jpg" }
    ]
  );
  assert.deepEqual(classified.map((item) => item.visible), [true, false, true]);
  assert.deepEqual(classified.map((item) => item.targetType), ["active-space", "inactive-space", "active-space"]);
});


test("manual and soft failures do not auto-pause rotation", () => {
  assert.deepEqual(wallpaperFailureDecision(2, { automatic: false }), { consecutiveFailures: 2, shouldPause: false });
  assert.deepEqual(wallpaperFailureDecision(2, { automatic: true, hardFailure: false }), { consecutiveFailures: 2, shouldPause: false });
  assert.deepEqual(wallpaperFailureDecision(2, { automatic: true }), { consecutiveFailures: 3, shouldPause: true });
});

test("wallpaper target selection keeps inactive Spaces and removes only duplicate IDs", () => {
  const targets = targetsForWallpaperApply([
    { id: "picture-1", label: "Current", index: 1, current: true, reliable: true },
    { id: "picture-2", label: "Inactive", index: 2, current: false, reliable: false },
    { id: "picture-2", label: "Duplicate", index: 2, current: false, reliable: false }
  ]);
  assert.deepEqual(targets.map((target) => target.id), ["picture-1", "picture-2"]);
});

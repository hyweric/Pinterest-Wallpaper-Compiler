import test from "node:test";
import assert from "node:assert/strict";
import {
  appendAppliedHistory,
  buildMacOSWallpaperTargets,
  generationStateAfterApplication,
  nextHistoryIndex,
  nextScheduledAt,
  planTemplateRotation,
  previousHistoryIndex
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
});

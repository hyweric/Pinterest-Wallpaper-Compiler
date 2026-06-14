import test from "node:test";
import assert from "node:assert/strict";
import {
  appendAppliedHistory,
  buildMacOSWallpaperTargets,
  classifyMacOSDockRows,
  generationStateAfterApplication,
  mergeAppliedWallpaperState,
  nextHistoryIndex,
  nextScheduledAt,
  planFadeOverlayAssignments,
  planTemplateRotation,
  previousHistoryIndex
} from "../shared/wallpaper.js";
import type { GeneratedCombination, PlaceholderLayer, TemplateLibrary, WallpaperProject, WallpaperTemplate } from "../shared/types.js";

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

function layer(id: string, width: number, generatedImageId?: string): PlaceholderLayer {
  return {
    id,
    type: "placeholder",
    name: id,
    x: 0,
    y: 0,
    width,
    height: 100,
    rotation: 0,
    cropMode: "cover",
    alignment: "center",
    borderWidth: 0,
    borderColor: "#fff",
    borderOpacity: 1,
    borderRadius: 0,
    maskShape: "rectangle",
    shadow: false,
    opacity: 1,
    locked: false,
    hidden: false,
    keepAspectRatio: false,
    crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    effects: {} as PlaceholderLayer["effects"],
    sourceId: "source-a",
    generatedImageId,
    sourceState: {
      sourceIds: ["source-a"],
      mode: "shuffle",
      currentIndex: 0,
      shuffleQueue: ["image-a", "image-b"],
      usedImageIds: [],
      preventDuplicates: true,
      includeSubfolders: false
    }
  };
}

function projectWithLayer(testLayer: PlaceholderLayer): WallpaperProject {
  return {
    schemaVersion: 2,
    id: "project",
    name: "Project",
    canvas: {} as WallpaperProject["canvas"],
    layers: [testLayer],
    sources: [],
    customTextures: [],
    wallpaper: { enabled: true, paused: false, interval: "manual", customIntervalMinutes: 20, customIntervalValue: 20, customIntervalUnit: "minutes", launchAtLogin: false, startMinimized: false, monitorMode: "all", scope: "same-all-desktops", targetTemplateMode: "single-template", targetTemplateIds: {}, targetPlaylistIds: {}, displayMode: "fill", transitionEnabled: true, transitionDurationMs: 650, consecutiveFailures: 0 },
    templates: { templates: [], collections: [], rotationMode: "shuffle", rotationTemplateIds: [], shuffleQueue: [], currentIndex: 0 },
    savedCombinations: [],
    recentCombinations: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

test("verified wallpaper apply preserves newer sidebar layer edits", () => {
  const candidateLayer = layer("layer-a", 100, "image-a");
  const currentLayer = layer("layer-a", 180);
  const candidate = projectWithLayer(candidateLayer);
  const current = projectWithLayer(currentLayer);
  const appliedAt = "2026-06-14T00:00:00.000Z";
  const merged = mergeAppliedWallpaperState(current, candidate, { ...combo("combo-a"), assignments: { "layer-a": "image-a" } }, {
    appliedAt,
    filePath: "/wallpaper.png",
    templateId: "template-a"
  });
  assert.equal(merged.layers[0].width, 180);
  assert.equal(merged.layers[0].generatedImageId, "image-a");
  assert.equal(merged.wallpaper.lastAppliedFilePath, "/wallpaper.png");
  assert.equal(merged.wallpaper.lastUpdatedAt, appliedAt);
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

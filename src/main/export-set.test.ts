import assert from "node:assert/strict";
import test from "node:test";
import { projectAfterExportSet } from "../shared/export-set.js";
import type { WallpaperProject } from "../shared/types.js";

function project(index: number): WallpaperProject {
  return {
    schemaVersion: 2,
    id: "project",
    name: "Test",
    canvas: {
      width: 1920,
      height: 1200,
      presetId: "1920x1200",
      orientation: "landscape",
      backgroundColor: "#ffffff",
      backgroundBaseMode: "color",
      backgroundTransparent: false,
      backgroundMode: "cover",
      backgroundAlignment: "center",
      backgroundOffsetX: 0,
      backgroundOffsetY: 0,
      backgroundScale: 1,
      backgroundBlur: 0,
      backgroundBrightness: 100,
      backgroundContrast: 100,
      backgroundTemperature: 0,
      backgroundVignette: 0,
      backgroundOpacity: 1,
      backgroundPaper: { type: "none", intensity: 0, scale: 1, rotation: 0, opacity: 0, blendMode: "multiply", seed: 1 }
    },
    layers: [],
    sources: [],
    customTextures: [],
    wallpaper: {
      enabled: false,
      paused: false,
      interval: "manual",
      customIntervalMinutes: 1,
      customIntervalValue: 1,
      customIntervalUnit: "minutes",
      launchAtLogin: false,
      startMinimized: false,
      monitorMode: "all",
      scope: "same-all-desktops",
      targetTemplateMode: "single-template",
      targetTemplateIds: {},
      targetPlaylistIds: {},
      displayMode: "fill",
      transitionEnabled: true,
      transitionDurationMs: 650,
      consecutiveFailures: index
    },
    templates: { templates: [], collections: [], rotationMode: "sequential", rotationTemplateIds: [], shuffleQueue: [], currentIndex: index },
    savedCombinations: [],
    recentCombinations: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

test("export set preserves live state unless explicitly advanced", () => {
  const live = project(1);
  const generated = project(9);
  assert.equal(projectAfterExportSet(live, generated, false), live);
  assert.equal(projectAfterExportSet(live, generated, true), generated);
});

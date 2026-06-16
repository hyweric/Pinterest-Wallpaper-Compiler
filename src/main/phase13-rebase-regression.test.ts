import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compactProjectForAutosave, createProject } from "../renderer/project.js";

test("normal editor UI exposes exactly one Generate and Apply button", async () => {
  const source = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.equal((source.match(/Generate and Apply/g) ?? []).length, 1);
});

test("main process registers generation and apply-file IPC handlers", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");
  assert.match(source, /ipcMain\.handle\("wallpaper:generate"/);
  assert.match(source, /ipcMain\.handle\("wallpaper:apply-file"/);
  assert.match(source, /const fadeOverlayTransitionsEnabled = false/);
  assert.doesNotMatch(source, /destroyAllFadeOverlays/);
  assert.doesNotMatch(source, /Fade overlay exceeded its maximum lifetime/);
});

test("autosave compaction removes rendered previews without mutating live state", () => {
  const project = createProject();
  const preview = `data:image/png;base64,${"A".repeat(100_000)}`;
  project.recentCombinations = [{
    id: "recent",
    name: "Recent",
    createdAt: new Date(0).toISOString(),
    assignments: {},
    previewDataUrl: preview
  }];
  project.templates.templates[0].thumbnailDataUrl = preview;

  const compact = compactProjectForAutosave(project);
  assert.equal(compact.recentCombinations[0].previewDataUrl, undefined);
  assert.equal(compact.templates.templates[0].thumbnailDataUrl, undefined);
  assert.equal(project.recentCombinations[0].previewDataUrl, preview);
});

test("renderer has a visible recovery boundary instead of an empty root", async () => {
  const source = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(source, /class AppErrorBoundary/);
  assert.match(source, /Reset Autosave and Reload/);
  assert.match(source, /<AppErrorBoundary><App \/><\/AppErrorBoundary>/);
});

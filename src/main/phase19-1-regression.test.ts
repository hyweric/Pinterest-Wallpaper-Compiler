import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createProject, normalizeProject } from "../renderer/project.js";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("background choices contain only Color and Image and legacy clear projects migrate to color", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf('aria-label="Background base"');
  const end = renderer.indexOf('</div>', start);
  const controls = renderer.slice(start, end);
  assert.match(controls, />Color<\/button>/);
  assert.match(controls, />Image<\/button>/);
  assert.doesNotMatch(controls, />Clear<\/button>/);

  const project = createProject();
  project.canvas.backgroundBaseMode = "transparent";
  project.canvas.backgroundTransparent = true;
  project.canvas.backgroundColor = "#abc123";
  const migrated = normalizeProject(project);
  assert.equal(migrated.canvas.backgroundBaseMode, "color");
  assert.equal(migrated.canvas.backgroundTransparent, false);
  assert.equal(migrated.canvas.backgroundColor, "#abc123");
});

test("Wallpaper settings remove Apply to, template mapping, rotation help, Advanced, and Diagnostics", async () => {
  const renderer = await source("src/renderer/main.tsx");

  assert.doesNotMatch(renderer, /function WallpaperPanel/);
  assert.doesNotMatch(renderer, /Wallpaper Rotation/);
  assert.doesNotMatch(renderer, /Apply to/);
  assert.doesNotMatch(renderer, /<label>Template/);
  assert.doesNotMatch(renderer, /Target templates/);
  assert.doesNotMatch(renderer, /Diagnostics/);
  assert.doesNotMatch(renderer, /playlist/);
});

test("the Canvas settings panel no longer exposes an Advanced section", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function CanvasDesignPanel(");
  const end = renderer.indexOf("const alignmentOptions", start);
  const panel = renderer.slice(start, end);
  assert.match(panel, /<summary>Canvas/);
  assert.match(panel, /<summary>Background/);
  assert.match(panel, /<summary>Surface/);
  assert.doesNotMatch(panel, /<summary>Advanced/);
  assert.doesNotMatch(renderer, /backgroundAdvancedKey/);
  assert.doesNotMatch(renderer, /runMacOSWallpaperDiagnostic/);
  assert.doesNotMatch(renderer, /lastWallpaperDiagnostics/);
});

test("legacy target template modes normalize to the two supported assignment choices", () => {
  const project = createProject();
  project.wallpaper.targetMode = "all-desktops-all-monitors";
  project.wallpaper.targetTemplateMode = "playlist";
  const normalized = normalizeProject(project);
  assert.equal(normalized.wallpaper.targetMode, "all-visible-monitors");
  assert.equal(normalized.wallpaper.targetTemplateMode, "different-template");
  assert.equal(normalized.wallpaper.monitorMode, "all");
  assert.equal(normalized.wallpaper.monitorId, undefined);
});

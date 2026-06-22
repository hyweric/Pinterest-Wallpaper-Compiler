import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(path, "utf8");

test("expanded Polaroid inspector is reduced to direct-canvas photo positioning and a few frame controls", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function PolaroidInspector(");
  const end = renderer.indexOf("function TornPaperInspector(", start);
  const panel = renderer.slice(start, end);

  for (const label of ["Polaroid", "Corner Radius", "Reset Photo Placement", "Reset"]) {
    assert.match(panel, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const removed of ["Border Size", "Top border", "Right border", "Bottom border", "Left border", "Paper Surface", "Shadows", "Caption", "Show caption", "Frame opacity", "Paper warmth"]) {
    assert.doesNotMatch(panel, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(panel, /polaroid-direct-edit-note/);
});

test("drop shadow editing is simplified to one slider and no checkbox shadow editor", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function patchSimpleDropShadow/);
  assert.match(renderer, /FilterSlider label="Drop Shadow"/);
  assert.doesNotMatch(renderer, /function ShadowInspector/);
  assert.doesNotMatch(renderer, /type="checkbox"/);
  assert.doesNotMatch(renderer, /label="Inner shadow"/);
});

test("editor and export both render Polaroid image transforms, warmth, caption, and shadows", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const exporter = await source("src/renderer/exporter.ts");
  assert.match(renderer, /scale: polaroid\.imageScale/);
  assert.match(renderer, /polaroid-caption/);
  assert.match(renderer, /paperWarmthOverlay\(polaroid\.warmth\)/);
  assert.match(renderer, /shadowToCss\(polaroid\.dropShadow\)/);
  assert.match(exporter, /imageTransform\.rotation/);
  assert.match(exporter, /polaroid\.caption\.text/);
  assert.match(exporter, /paperWarmthOverlay\(polaroid\.warmth\)/);
  assert.match(exporter, /applyCanvasShadow\(context, outerShadow\)/);
});

test("Polaroid patches are committed through the normal project undo path", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function patchPolaroid\(patch: Partial<PolaroidEffect>\)/);
  assert.match(renderer, /onPatch\(\{ effects: \{ \.\.\.activeLayer\.effects, polaroid:/);
  assert.match(renderer, /createDefaultPolaroidEffect/);
  assert.match(renderer, /structuredClone\(project\)/);
});

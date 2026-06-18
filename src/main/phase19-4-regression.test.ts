import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(path, "utf8");

test("expanded Torn Paper inspector exposes presets, per-edge controls, paper details, image placement, and shadows", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function TornPaperInspector(");
  const end = renderer.indexOf("function ShadowInspector(", start);
  const panel = renderer.slice(start, end);
  for (const section of ["Presets", "Tear Edges", "Paper Appearance", "Image", "Shadows"]) {
    assert.match(panel, new RegExp(`<summary>${section}`));
  }
  for (const label of [
    "Regenerate Tear", "Link all edges", "Paper color", "Paper opacity", "Grain", "Fibers", "Wrinkles", "Stains", "Speckles", "Edge darkening",
    "Image inset", "Image scale", "Image X", "Image Y", "Outer shadow", "Inner shadow", "Reset Torn Paper"
  ]) {
    assert.match(panel, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(panel, /\["top", "right", "bottom", "left"\]/);
});

test("torn presets are editable and include save, duplicate, rename, delete, and restore actions", async () => {
  const renderer = await source("src/renderer/main.tsx");
  for (const action of ["Save Current", "Duplicate", "Rename", "Delete", "Restore Bundled Preset"]) assert.match(renderer, new RegExp(action));
  assert.match(renderer, /createCustomTornPaperPreset/);
  assert.match(renderer, /applyTornPaperPreset/);
  assert.match(renderer, /customPresets/);
});

test("tear regeneration is explicit and does not use Math.random in the Torn inspector", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function TornPaperInspector(");
  const end = renderer.indexOf("function ShadowInspector(", start);
  const panel = renderer.slice(start, end);
  assert.match(panel, /nextStableSeed\(effect\.seed\)/);
  assert.doesNotMatch(panel, /Math\.random/);
});

test("editor and export share deterministic torn texture detail rendering", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const exporter = await source("src/renderer/exporter.ts");
  assert.match(renderer, /tornPaperTextureDataUrl/);
  assert.match(renderer, /torn-paper-detail-overlay/);
  assert.match(exporter, /tornPaperTextureDataUrl/);
  assert.match(exporter, /tornPaper\.fibers > 0/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(path, "utf8");

test("expanded Torn Paper inspector exposes unified tear controls, paper details, image placement, and shadows", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function TornPaperInspector(");
  const end = renderer.indexOf("function ShadowInspector(", start);
  const panel = renderer.slice(start, end);
  for (const section of ["Tear Shape", "Paper Appearance", "Image", "Shadows"]) {
    assert.match(panel, new RegExp(`<summary>${section}`));
  }
  for (const label of [
    "Tearness", "Regenerate Tear", "Paper color", "Paper opacity", "Grain", "Fibers", "Wrinkles",
    "Image inset", "Image scale", "Image X", "Image Y", "Outer shadow", "Inner shadow", "Reset Torn Paper"
  ]) {
    assert.match(panel, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(panel, /Link all edges/);
  assert.doesNotMatch(panel, /Save Current/);
  assert.doesNotMatch(panel, /Restore Bundled Preset/);
});

test("torn paper uses one shared tear control instead of per-edge preset management", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function TornPaperInspector(");
  const end = renderer.indexOf("function ShadowInspector(", start);
  const panel = renderer.slice(start, end);
  assert.match(panel, /function patchAllEdges/);
  assert.match(panel, /FilterSlider label="Tearness"/);
  assert.doesNotMatch(panel, /\["top", "right", "bottom", "left"\]/);
  assert.doesNotMatch(panel, /applyTornPaperPreset/);
  assert.doesNotMatch(panel, /customPresets/);
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

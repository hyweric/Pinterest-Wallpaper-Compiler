import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(path, "utf8");

test("expanded Torn Paper inspector exposes only depth, ridge count, and regenerate", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function TornPaperInspector(");
  const end = renderer.indexOf("function FilterSlider(", start);
  const panel = renderer.slice(start, end);

  for (const label of ["Torn Paper", "Tear Depth", "Ridge Count", "Regenerate Tear", "Reset"]) {
    assert.match(panel, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const removed of ["Tearness", "Paper Appearance", "Image", "Shadows", "Paper opacity", "Image inset", "Image scale", "Outer shadow", "Inner shadow"]) {
    assert.doesNotMatch(panel, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("torn paper uses two shared tear controls instead of per-edge preset management", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function TornPaperInspector(");
  const end = renderer.indexOf("function FilterSlider(", start);
  const panel = renderer.slice(start, end);
  assert.match(panel, /function patchDepth/);
  assert.match(panel, /function patchRidgeCount/);
  assert.match(panel, /FilterSlider label="Tear Depth"/);
  assert.match(panel, /FilterSlider label="Ridge Count"/);
  assert.doesNotMatch(panel, /applyTornPaperPreset/);
  assert.doesNotMatch(panel, /customPresets/);
});

test("tear regeneration is explicit and does not use Math.random in the Torn inspector", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function TornPaperInspector(");
  const end = renderer.indexOf("function FilterSlider(", start);
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

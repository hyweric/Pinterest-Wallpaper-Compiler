import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("phase 22.3.8 removes Clean Paper and keeps only Polaroid and Torn Paper frame styles", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.doesNotMatch(renderer, /<option value="clean">Clean Paper<\/option>/);
  assert.match(renderer, /<option value="polaroid">Polaroid<\/option>/);
  assert.match(renderer, /<option value="torn">Torn Paper<\/option>/);
});

test("phase 22.3.8 replaces texture slider with curated paper texture choices", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.doesNotMatch(renderer, /FilterSlider label="Texture"/);
  assert.match(renderer, /<label>Texture<select/);
  assert.match(renderer, /<option value="paper">Paper<\/option>/);
  assert.match(renderer, /<option value="crumpled-paper">Crumpled Paper<\/option>/);
  assert.match(renderer, /function patchFrameTexture\(type: "none" \| "paper" \| "crumpled-paper"\)/);
  assert.match(renderer, /surfaceDefaultsForType\(type\)/);
});

test("phase 22.3.8 keeps Polaroid simple controls without a generic Border Size slider", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function PolaroidInspector(");
  const end = renderer.indexOf("function TornPaperInspector(", start);
  const panel = renderer.slice(start, end);
  assert.doesNotMatch(panel, /Border Size/);
  assert.doesNotMatch(panel, /patchBorderSize/);
  assert.match(panel, /Corner Radius/);
  assert.match(panel, /Reset Photo Placement/);
});

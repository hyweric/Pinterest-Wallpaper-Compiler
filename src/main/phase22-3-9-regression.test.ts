import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("phase 22.3.9 restores per-side Polaroid border controls without generic Border Size", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function PolaroidInspector(");
  const end = renderer.indexOf("function TornPaperInspector(", start);
  const panel = renderer.slice(start, end);
  assert.match(panel, /polaroid-border-grid/);
  assert.match(panel, /borderTop/);
  assert.match(panel, /borderRight/);
  assert.match(panel, /borderBottom/);
  assert.match(panel, /borderLeft/);
  assert.doesNotMatch(panel, /Border Size/);
});

test("phase 22.3.9 makes reset placement full-width and keeps text unclipped", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /polaroid-placement-row/);
  assert.match(styles, /\.polaroid-placement-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.polaroid-placement-row \.button,[\s\S]*min-height: 44px;/);
});

test("phase 22.3.9 uses the real surface renderer for visible frame textures", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function FrameSurfaceTextureOverlay/);
  assert.match(renderer, /drawSurfacePreview\(target, width, height/);
  assert.match(renderer, /textureType === "crumpled-paper" \? 100 : 92/);
  assert.match(renderer, /<FrameSurfaceTextureOverlay layer=\{layer\}/);
});

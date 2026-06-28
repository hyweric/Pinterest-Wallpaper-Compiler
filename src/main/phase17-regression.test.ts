import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("editor preview and export share the same deterministic surface renderer", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const exporter = await source("src/renderer/exporter.ts");
  const surface = await source("src/renderer/surface-renderer.ts");
  assert.match(renderer, /drawSurfacePreview\(/);
  assert.match(exporter, /drawSurfaceTexture\(context, width, height, project\.canvas\.backgroundPaper/);
  assert.match(surface, /export async function drawSurfacePreview/);
  assert.match(surface, /await drawSurfaceTexture\(context, logicalWidth, logicalHeight, effect, custom\)/);
  assert.doesNotMatch(renderer, /canvas-background-texture/);
});

test("canvas surface is drawn behind placeholders so uploaded sources remain unaffected", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const exporter = await source("src/renderer/exporter.ts");
  assert.match(renderer, /<CanvasSurfaceOverlay canvas=\{project\.canvas\}[\s\S]*project\.layers\.map\(/);
  assert.match(exporter, /await drawSurfaceTexture\(context, width, height, project\.canvas\.backgroundPaper[\s\S]*for \(const layer of project\.layers\) await drawLayer/);
});

test("all requested surface controls update persisted canvas settings", async () => {
  const renderer = await source("src/renderer/main.tsx");
  for (const label of ["Opacity", "Scale", "Noise / grain", "Roughness", "Light / dark", "Rotation", "Blend mode", "Reset Surface", "Regenerate Texture"]) {
    assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(renderer, /Enable surface texture/);
  assert.doesNotMatch(renderer, /Texture seed/);
  assert.doesNotMatch(renderer, /label="Intensity"/);
  assert.match(renderer, /function resetSurface\(/);
  assert.match(renderer, /patchPaper\(\{ seed: nextSurfaceSeed\(surface\.seed\) \}\)/);
  assert.match(renderer, /backgroundPaper: \{ \.\.\.canvas\.backgroundPaper, \.\.\.patch \}/);
});

test("procedural texture generation is cached, bounded, and contains no implicit random regeneration", async () => {
  const surface = await source("src/renderer/surface-renderer.ts");
  assert.match(surface, /const tileCache = new Map/);
  assert.match(surface, /MAX_SURFACE_TILE_CACHE_ENTRIES/);
  assert.match(surface, /MAX_SURFACE_IMAGE_CACHE_ENTRIES/);
  assert.match(surface, /surfaceTileCacheKey/);
  assert.doesNotMatch(surface, /Math\.random/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("Phase 23 paste and default aspect handling are single-source and ratio-aware", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /lastPasteRef/);
  assert.match(renderer, /webImagePasteFingerprint\(candidates\)/);
  assert.match(renderer, /now - lastPasteRef\.current\.at < 650/);
  assert.match(renderer, /event\.stopPropagation\(\)/);
  assert.match(renderer, /const dropAspectRatio = await decodedImageAspectRatio\(chosenDropImage\) \?\? sourcePreferredAspectRatio\(source\)/);
  assert.match(renderer, /placementForCanvasDrop\(next\.canvas, point, createdLayerIds\.length, dropAspectRatio\)/);
  assert.match(renderer, /function createProjectForCurrentScreen/);
});

test("Phase 23 Pinterest import handles Unicode sections, count overflow, and promoted cards", async () => {
  const provider = await source("src/main/providers.ts");
  const main = await source("src/main/main.ts");
  assert.match(provider, /decodedPinterestPathParts/);
  assert.match(provider, /decodeURIComponent/);
  assert.match(provider, /pinterestScopeFromUrl/);
  assert.match(provider, /Section URL detected/);
  assert.match(provider, /Pinterest reported about/);
  assert.match(provider, /Using discovered count for progress/);
  assert.match(provider, /pin\.promoted/);
  assert.match(main, /promoted\|sponsored\|advertisement\|ad/);
  assert.match(main, /valid pin cards/);
});

test("Phase 24 selection marquee, group snap, and flat layer controls are enabled", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /const additive = event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey/);
  assert.match(renderer, /baseIds: additive \? selectedLayerIds : \[\]/);
  assert.match(renderer, /const ids = next\.additive \? \[\.\.\.new Set\(\[\.\.\.next\.baseIds, \.\.\.hits\]\)\] : hits/);
  assert.match(renderer, /snapLayer\(drag\.layer, drag\.layer\.x \+ dx, drag\.layer\.y \+ dy, drag\.groupLayers\)/);
  assert.match(renderer, /selectionBoundsForLayers/);
  assert.match(renderer, /resizeBoundsFromOppositeCorner/);
  assert.match(renderer, /patchLayers\(editableIds, patch, historyEnabled\)/);
  assert.match(styles, /layer-row\.active[\s\S]*box-shadow: none !important/);
  assert.match(styles, /selection-marquee[\s\S]*rgba\(156, 117, 204/);
});

test("Phase 25 through 27 simplify import completion and wallpaper set UI without debug artifacts", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /pinterest-complete-card/);
  assert.match(renderer, /Import complete/);
  assert.match(renderer, /Create Wallpaper Set/);
  assert.doesNotMatch(renderer, /wallpaper-count-presets/);
  assert.match(renderer, /More options/);
  assert.match(renderer, /Copy Folder Path/);
  assert.match(renderer, /copySourcePath/);
  assert.match(renderer, /Click Add Folder or Album, then Choose Folder/);
  assert.match(styles, /advanced-wallpaper-set-options/);
  assert.doesNotMatch(renderer, /Clean Paper only needs color, wrinkles, and shadow/);
});

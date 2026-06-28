import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { surfaceCompositeAlpha } from "../shared/surface-rendering.js";
import { surfaceDefaultsForType } from "../shared/surfaces.js";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("Phase 28 removes clutter and keeps the new simplified controls", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.doesNotMatch(renderer, /COLLECTIONS/);
  assert.doesNotMatch(renderer, /Save template/);
  assert.doesNotMatch(renderer, /Edit details/);
  assert.match(renderer, /← Return Home/);
  assert.match(renderer, /brand-home-button/);
  assert.doesNotMatch(renderer, /<label>Alignment<select/);
  assert.doesNotMatch(renderer, /Apply Size/);
  assert.match(renderer, /Reset Surface/);
  assert.match(renderer, /Import Custom Surface/);
  assert.match(renderer, /Border Thickness/);
  assert.match(renderer, /Border Color/);
  assert.match(renderer, /<ChevronRight size=\{14\} \/> More options/);
  assert.match(styles, /add-source-heading[\s\S]*width: 100%/);
  assert.match(styles, /wallpaper-ready-layout[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(renderer, /wallpaper-ready-preview-grid/);
  assert.doesNotMatch(renderer, /<label>How many<SoftNumberInput/);
  assert.match(renderer, /Image variation count/);
  assert.doesNotMatch(renderer, /Add from global/i);
  assert.match(styles, /source-detail-card[\s\S]*min-height: 44px/);
  assert.match(styles, /layer-row\.active[\s\S]*rgba\(229, 241, 246/);
  assert.match(styles, /advanced-wallpaper-set-options\[open\] > summary svg[\s\S]*rotate\(90deg\)/);
});

test("Phase 28 shifts surface texture strength upward", () => {
  const paper = surfaceDefaultsForType("paper");
  const dotted = surfaceDefaultsForType("dotted-paper");
  assert.ok(paper && paper.opacity >= 0.7 && paper.intensity === 100);
  assert.ok(dotted && dotted.opacity === 1 && dotted.scale < 1);
  assert.ok(surfaceCompositeAlpha({ enabled: true, type: "paper", intensity: 100, opacity: 0.5, scale: 1, rotation: 0, blendMode: "multiply", seed: 1, noise: 0, roughness: 0, tone: 0 }) > 0.65);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("clearing layer selection also exits crop and text edit modes", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function clearLayerSelection\(\) \{[\s\S]*setSelectedLayerIds\(\[\]\);[\s\S]*setCropModeLayerId\(undefined\);[\s\S]*setEditingTextLayerId\(undefined\);[\s\S]*\}/);
  assert.doesNotMatch(renderer, /clearLayerSelection\(\);\s*setCropModeLayerId\(undefined\);\s*setEditingTextLayerId\(undefined\);/);
});

test("crop mode cannot remain active after click outside clears or invalidates selection", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /if \(!cropModeLayerId\) return;/);
  assert.match(renderer, /const cropLayer = project\.layers\.find\(\(layer\) => layer\.id === cropModeLayerId\);/);
  assert.match(renderer, /!selectedLayerIds\.includes\(cropModeLayerId\)/);
  assert.match(renderer, /setCropModeLayerId\(undefined\);/);
});

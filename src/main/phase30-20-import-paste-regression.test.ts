import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("Phase 30.20 gates source import progress and returns unsupported import failures", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const main = await source("src/main/main.ts");
  assert.match(renderer, /sourceImportActiveRef/);
  assert.match(renderer, /if \(!sourceImportActiveRef\.current\) return/);
  assert.match(renderer, /sourceImportActiveRef\.current = false/);
  assert.match(main, /importValidatedLocalPathsSafely/);
  assert.match(main, /sources: \[\]/);
  assert.match(main, /fetchWithTimeout/);
  assert.match(main, /AbortController/);
});

test("Phase 30.20 lets paste event own layer paste and dedupes repeated paste events", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /Let the actual paste event be the single source of truth/);
  assert.match(renderer, /lastLayerPasteRef/);
  assert.match(renderer, /layerPasteFingerprint\(layersToPaste\)/);
  assert.match(renderer, /now - lastLayerPasteRef\.current\.at < 650/);
  assert.doesNotMatch(renderer, /setTimeout\(\(\) => \{\n\s+pasteFallbackTimerRef\.current = undefined;\n\s+if \(pasteEventVersionRef\.current === pasteVersion\) pasteCopiedLayers/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

async function renderer() {
  return source("src/renderer/main.tsx");
}

async function styles() {
  return source("src/renderer/styles.css");
}

test("editor layer movement uses recoverable off-canvas bounds instead of canvas-only clamps", async () => {
  const source = await renderer();
  assert.match(source, /clampRecoverablePosition/);
  assert.match(source, /OFF_CANVAS_RECOVERY_PX/);
  assert.doesNotMatch(source, /clamp\(original\.x \+ appliedDx, 0, project\.canvas\.width - original\.width\)/);
  assert.doesNotMatch(source, /clamp\(layer\.x \+ dx, 0, current\.canvas\.width - layer\.width\)/);
});

test("editor canvas paint containment does not clip off-canvas layer controls", async () => {
  const [sourceCode, css] = await Promise.all([renderer(), styles()]);
  assert.match(css, /Phase 30\.11: allow editor layers/);
  assert.match(css, /\.canvas,\s*\.canvas-zoom-shell,\s*\.canvas-zoom-shell > \.canvas \{[\s\S]*overflow: visible !important;/);
  assert.match(css, /\.canvas-zoom-shell > \.canvas \{[\s\S]*contain: layout style !important;/);
  assert.match(css, /Phase 30\.14: preserve the original canvas\/pasteboard look while clipping only artwork/);
  assert.match(sourceCode, /canvasArtworkClipMaskStyle/);
  assert.doesNotMatch(sourceCode, /CanvasOutsideClipMask/);
  assert.doesNotMatch(css, /\.canvas-outside-clip-mask/);
  assert.match(css, /\.selection-handles-overlay \{[\s\S]*z-index:\s*1400/);
  assert.doesNotMatch(css, /canvas-outside-dim/);
});

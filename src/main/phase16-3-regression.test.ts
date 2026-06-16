import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("wheel zoom is editor-scoped, non-passive, and coalesced through one animation frame", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /stage\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(renderer, /wheelDeltaRef\.current \+= normalizeWheelDelta/);
  assert.match(renderer, /window\.requestAnimationFrame/);
  assert.match(renderer, /zoomAfterWheel\(zoomRef\.current, delta\)/);
  assert.doesNotMatch(renderer, /onWheel=\{/);
  assert.doesNotMatch(renderer, /addEventListener\("gesture(?:start|change)"/);
});

test("the logical canvas is scaled as one composited surface instead of resizing every layer", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /className="canvas-zoom-shell"/);
  assert.match(renderer, /transform: `scale\(\$\{zoomRef\.current\}\)`/);
  assert.match(renderer, /left: layer\.x,/);
  assert.match(renderer, /width: layer\.width,/);
  assert.doesNotMatch(renderer, /left: layer\.x \* zoom/);
  assert.doesNotMatch(renderer, /width: layer\.width \* zoom/);
  assert.match(styles, /\.canvas-zoom-shell > \.canvas \{[\s\S]*transform-origin: 0 0;/);
  assert.match(styles, /contain: layout paint style/);
});

test("cursor anchoring and all zoom inputs share the central bounded zoom engine", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function applyCanvasZoom\(nextZoom: number, clientX: number, clientY: number\)/);
  assert.match(renderer, /canvasPointAtClient\(/);
  assert.match(renderer, /stage\.scrollLeft \+= afterRect\.left \+ anchor\.x \* normalized - clientX/);
  assert.match(renderer, /zoomAfterStep\(zoomRef\.current, direction\)/);
  assert.match(renderer, /fitCanvasZoom\(/);
  assert.match(renderer, /applyCanvasZoom\(1, anchor\.clientX, anchor\.clientY\)/);
});

test("keyboard shortcuts and visible buttons use the same zoom functions", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /event\.key === "=" \|\| event\.key === "\+"/);
  assert.match(renderer, /command && event\.key === "-"/);
  assert.match(renderer, /command && event\.key === "0"/);
  assert.match(renderer, /zoomCanvasByStep\(1\)/);
  assert.match(renderer, /zoomCanvasByStep\(-1\)/);
  assert.match(renderer, /resetCanvasZoom\(\)/);
  assert.match(renderer, /aria-label="Zoom out"/);
  assert.match(renderer, /aria-label="Zoom in"/);
  assert.match(renderer, /aria-label="Fit canvas"/);
});

test("zoom readout is updated once per rendered frame and committed after gesture settle", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /zoomReadoutRef\.current\.textContent = `\$\{Math\.round\(normalized \* 100\)\}%`/);
  assert.match(renderer, /window\.setTimeout\([\s\S]*?, 120\)/);
  assert.match(renderer, /setZoom\(\(current\) => Math\.abs\(current - settledZoom\)/);
  assert.match(renderer, /aria-live="polite"/);
});

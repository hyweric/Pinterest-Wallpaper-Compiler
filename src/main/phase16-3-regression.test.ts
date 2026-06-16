import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("wheel zoom is editor-scoped, non-passive, coalesced, and faster", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const engine = await source("src/shared/canvas-zoom.ts");
  assert.match(renderer, /stage\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(renderer, /wheelDeltaRef\.current \+= normalizeWheelDelta/);
  assert.match(renderer, /window\.requestAnimationFrame/);
  assert.match(renderer, /zoomAfterWheel\(zoomRef\.current, delta\)/);
  assert.match(engine, /Math\.exp\(-normalizedDeltaY \* 0\.0032\)/);
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

test("cursor anchoring preserves the exact point beneath the pointer", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function applyCanvasZoom\(nextZoom: number, clientX: number, clientY: number\)/);
  assert.match(renderer, /canvasPointAtClient\(/);
  assert.match(renderer, /const targetClientX = beforeRect\.left \+ anchor\.x \* previous/);
  assert.match(renderer, /const nextAnchorClientX = afterRect\.left \+ anchor\.x \* normalized/);
  assert.match(renderer, /stage\.scrollLeft \+= nextAnchorClientX - targetClientX/);
  assert.match(renderer, /stage\.scrollTop \+= nextAnchorClientY - targetClientY/);
  assert.match(renderer, /zoomAfterStep\(zoomRef\.current, direction\)/);
  assert.match(renderer, /fitCanvasZoom\(/);
});

test("keyboard zoom remains available while the persistent percentage panel is hidden", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /event\.key === "=" \|\| event\.key === "\+"/);
  assert.match(renderer, /command && event\.key === "-"/);
  assert.match(renderer, /command && event\.key === "0"/);
  assert.match(renderer, /zoomCanvasByStep\(1\)/);
  assert.match(renderer, /zoomCanvasByStep\(-1\)/);
  assert.match(renderer, /resetCanvasZoom\(\)/);
  assert.doesNotMatch(renderer, /zoomReadoutRef/);
  assert.doesNotMatch(renderer, /aria-label="Canvas zoom"/);
  assert.doesNotMatch(renderer, /aria-live="polite"/);
});

test("zoom state commits once after the gesture settles", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /window\.setTimeout\([\s\S]*?, 120\)/);
  assert.match(renderer, /setZoom\(\(current\) => Math\.abs\(current - settledZoom\)/);
});

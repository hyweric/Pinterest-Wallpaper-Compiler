import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const renderer = readFileSync(join(process.cwd(), "src/renderer/main.tsx"), "utf8");

test("phase 22.3.10.2 frame texture overlay keeps hook order stable when selecting None/Paper/Crumpled", () => {
  const block = renderer.match(/function FrameSurfaceTextureOverlay[\s\S]*?function paperTextureBackground/)?.[0] ?? "";
  assert.match(block, /const canvasRef = useRef<HTMLCanvasElement>\(null\);/);
  assert.match(block, /const textureVisible = textureType !== "none" && textureIntensity > 0;/);
  assert.match(block, /useEffect\(\(\) =>/);
  assert.match(block, /if \(!target \|\| !textureVisible \|\| !surfaceEffectIsVisible\(paper\)\) return;/);
  const beforeHook = block.slice(0, block.indexOf("useEffect"));
  assert.doesNotMatch(beforeHook, /return null/);
});

test("phase 22.3.10.2 removes lock layer buttons from canvas controls and the floating toolbar", () => {
  const toolbar = renderer.match(/function ContextToolbar[\s\S]*?function CropToolbar/)?.[0] ?? "";
  const onCanvasControls = renderer.match(/className=\{`on-canvas-layer-controls[\s\S]*?className="tooltip-anchor"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.doesNotMatch(toolbar, /aria-label="Lock layer"/);
  assert.doesNotMatch(toolbar, /data-tooltip="Lock layer"/);
  assert.doesNotMatch(onCanvasControls, /Lock layer|Unlock layer|toggleLayerLock/);
});

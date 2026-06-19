import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Phase 20.3 removes wallpaper rotation and source-label clutter", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.doesNotMatch(renderer, /Wallpaper Rotation/);
  assert.doesNotMatch(renderer, /<WallpaperPanel/);
  assert.match(renderer, /<Images size=\{15\} \/> Library/);
  assert.match(renderer, /<h2>Image Library<\/h2>/);
});

test("Phase 20.3 creates aspect-matched fill placeholders from dragged sources", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /async function placeSourcesAtCanvasPoint/);
  assert.match(renderer, /const aspectRatio = await naturalAspectForSource\(source\)/);
  assert.match(renderer, /placementForCanvasDrop\(next\.canvas, point, createdLayerIds\.length, aspectRatio\)/);
  assert.match(renderer, /cropMode: "cover" as const/);
  assert.doesNotMatch(renderer, /cropMode: "contain" as const/);
});

test("Phase 20.3 removes frame ratio locking and keeps match/reset above numeric frame fields", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.doesNotMatch(renderer, /Lock frame ratio/);
  assert.match(renderer, /resizeLayer\(drag, dx, dy, event\.shiftKey\)/);
  assert.match(renderer, /<summary>Frame Position and Size[\s\S]*<div className="compact-action-row">[\s\S]*Match Image[\s\S]*Reset Frame[\s\S]*<div className="two-col">/);
});

test("Phase 20.3 double-clicking an empty placeholder opens the library instead of crop mode", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /function showAssignSourceHint\(\)/);
  assert.match(renderer, /setLeftPanelOpen\(true\)/);
  assert.match(renderer, /setLeftPanelTab\("sources"\)/);
  assert.match(renderer, /if \(!hasAssignedImage\) \{[\s\S]*showAssignSourceHint\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(renderer, /className="empty-placeholder-hint"/);
});

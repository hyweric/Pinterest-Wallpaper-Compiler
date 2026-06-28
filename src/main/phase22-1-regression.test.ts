import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Phase 22.2 keeps imported dimensions available but source drops use stable placeholder sizing", async () => {
  const main = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");
  const types = await readFile(path.join(process.cwd(), "src/shared/types.ts"), "utf8");
  const drop = await readFile(path.join(process.cwd(), "src/shared/drop-placement.ts"), "utf8");
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");

  assert.match(types, /width\?: number;/);
  assert.match(types, /height\?: number;/);
  assert.match(main, /function imageSizeForFile/);
  assert.match(main, /function enrichImportedImageDimensions/);
  assert.match(drop, /aspectRatio\?: number/);
  assert.match(renderer, /function sourcePreferredAspectRatio/);
  assert.match(renderer, /async function decodedImageAspectRatio/);
  assert.match(renderer, /const chosenDropImage = randomImageFromSource\(source\)/);
  assert.match(renderer, /placementForCanvasDrop\(next\.canvas, point, createdLayerIds\.length, dropAspectRatio\)/);
  assert.match(renderer, /projectWithDropImageAssignment\(next, source, layer\.id, chosenDropImage\)/);
  assert.match(renderer, /const dropAspectRatio = await decodedImageAspectRatio\(chosenDropImage\) \?\? sourcePreferredAspectRatio\(source\)/);
  assert.match(renderer, /cropMode: overlayLike \? "contain" as const : "cover" as const/);
});

test("Phase 22.1 restores blue inspector styling and keeps the inspector header on one row", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const styles = await readFile(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");

  assert.match(renderer, /layer-inspector-tabs/);
  assert.match(renderer, /settings-inspector-tabs/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) 36px/);
  assert.match(styles, /accent-color: #8db7c1/);
  assert.doesNotMatch(styles, /#b29be8/);
  assert.match(styles, /margin-top: -5px/);
  assert.match(styles, /workspace \{[\s\S]*overflow: hidden/);
  assert.match(styles, /canvas-stage \{[\s\S]*overflow: auto/);
});

test("Phase 22.2 exposes previous and next image controls without replacing generation duplicate prevention", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const selection = await readFile(path.join(process.cwd(), "src/shared/source-selection.ts"), "utf8");

  assert.match(renderer, /Previous Image/);
  assert.match(renderer, /Next Image/);
  assert.match(renderer, /function stepLayerImage/);
  assert.match(renderer, /collectLayerImages\(current, layer\)/);
  assert.match(renderer, /clear-layer-order-icon/);
  assert.match(selection, /layer\.generatedImageId \?\? layer\.selectedImageId/);
  assert.match(selection, /id !== avoidImageId/);
});


test("Phase 22.2 advances current desktop preview and left-aligns Add Object", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const previewSelection = await readFile(path.join(process.cwd(), "src/shared/preview-selection.ts"), "utf8");
  const styles = await readFile(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");

  assert.match(renderer, /const advanced = advancePreviewProjectImages\(previewBase\)/);
  assert.match(previewSelection, /function advancePreviewProjectImages/);
  assert.match(previewSelection, /generatedImageId: choice\.image\.id/);
  assert.match(styles, /Phase 22\.1\.1 hotfix/);
  assert.match(styles, /\.minimal-toolbar \.toolbar-create-actions \{[\s\S]*justify-self: start/);
});

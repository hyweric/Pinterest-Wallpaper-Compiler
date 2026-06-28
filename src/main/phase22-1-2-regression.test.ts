import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Phase 22.2 source drops choose one random starting image but keep Add Object frame geometry", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");

  assert.match(renderer, /function randomImageFromSource\(source: ImageSource\)/);
  assert.match(renderer, /Math\.floor\(Math\.random\(\) \* images\.length\)/);
  assert.match(renderer, /function projectWithDropImageAssignment/);
  assert.match(renderer, /const chosenDropImage = randomImageFromSource\(source\)/);
  assert.match(renderer, /projectWithDropImageAssignment\(next, source, layer\.id, chosenDropImage\)/);
  assert.match(renderer, /generatedImageId: chosenDropImage\.id/);
  assert.match(renderer, /placementForCanvasDrop\(next\.canvas, point, createdLayerIds\.length, dropAspectRatio\)/);
  assert.match(renderer, /placementForCanvasDrop\(assigned\.canvas, point, createdLayerIds\.length, dropAspectRatio\)/);
  assert.match(renderer, /const dropAspectRatio = await decodedImageAspectRatio\(chosenDropImage\) \?\? sourcePreferredAspectRatio\(source\)/);
  assert.doesNotMatch(renderer, /projectWithMeasuredImage\(assigned, chosenDropImage, chosenAspect\)/);
});

test("Phase 22.2 current desktop preview advances once without the generic generation selector", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const previewStart = renderer.indexOf("async function previewOnCurrentDesktop");
  const previewEnd = renderer.indexOf("async function applyHistoryAt", previewStart);
  const preview = renderer.slice(previewStart, previewEnd);

  assert.match(preview, /advancePreviewProjectImages\(previewBase\)/);
  assert.match(preview, /createCombination\(assignments, advanced\.templates\.activeTemplateId\)/);
  assert.doesNotMatch(preview, /prepareGeneratedProject\(previewBase/);
});

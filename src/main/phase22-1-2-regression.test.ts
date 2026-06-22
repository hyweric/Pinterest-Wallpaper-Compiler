import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Phase 22.1.2 commits one random drop image and sizes from that exact image", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");

  assert.match(renderer, /function randomImageFromSource\(source: ImageSource\)/);
  assert.match(renderer, /Math\.floor\(Math\.random\(\) \* images\.length\)/);
  assert.match(renderer, /function projectWithDropImageAssignment/);
  assert.match(renderer, /const chosenDropImage = randomImageFromSource\(source\)/);
  assert.match(renderer, /decodedImageAspectRatio\(chosenDropImage\)/);
  assert.match(renderer, /projectWithDropImageAssignment\(next, source, layer\.id, chosenDropImage\)/);
  assert.match(renderer, /generatedImageId: chosenDropImage\.id/);
  assert.match(renderer, /projectWithMeasuredImage\(assigned, chosenDropImage, chosenAspect\)/);
});

test("Phase 22.1.2 current desktop preview performs one generation selection, not manual advance plus reselection", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const previewStart = renderer.indexOf("async function previewOnCurrentDesktop");
  const previewEnd = renderer.indexOf("async function applyHistoryAt", previewStart);
  const preview = renderer.slice(previewStart, previewEnd);

  assert.match(preview, /prepareGeneratedProject\(previewBase, previewBase\.templates\.activeTemplateId\)/);
  assert.doesNotMatch(preview, /advancePreviewProjectImages\(previewBase\)/);
});

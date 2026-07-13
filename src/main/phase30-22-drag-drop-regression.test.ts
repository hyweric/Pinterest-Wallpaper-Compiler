import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rendererPath = path.join(process.cwd(), "src/renderer/main.tsx");

test("Phase 30.22 keeps native desktop path drops valid and delegates allowed-list filtering to main", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  assert.match(renderer, /function getDroppedPathsFromTransfer\(dataTransfer: DataTransfer\)/);
  assert.match(renderer, /folders often look like\s+\/\/ extensionless File objects/);
  assert.match(renderer, /const desktopPaths = getDroppedPathsFromTransfer\(dataTransfer\);\n\s+if \(desktopPaths\.length > 0\)/);
  assert.match(renderer, /Add dropped files or folder as source/);
  assert.match(renderer, /await importDroppedPaths\(paths\);/);
  assert.match(renderer, /await importDroppedPathsAtCanvasPoint\(paths, point\);/);
  assert.match(renderer, /await assignDroppedPathsToLayer\(paths, layer\);/);
  assert.doesNotMatch(renderer, /const rejection = dropImportRejection\(event\.dataTransfer, "sources"\);[\s\S]*?await importDroppedPaths\(paths\);/);
});

test("Phase 30.22 canvas path drops also close the import loading dialog", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  assert.match(renderer, /async function importDroppedPathsAtCanvasPoint\(paths: string\[\], point: CanvasDropPoint\)/);
  assert.match(renderer, /const importRunId = beginSourceImportDialog\("Importing dropped items"/);
  assert.match(renderer, /finally \{\n\s+finishSourceImportDialog\(importRunId\);\n\s+\}/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import path from "node:path";
import { bundledSurfaceManifest, surfaceManifestEntryForPaperType, surfaceManifestIsComplete } from "../shared/surfaces.js";

test("bundled surface manifest is complete and uses CC0 provenance", () => {
  assert.equal(surfaceManifestIsComplete(), true);
  assert.deepEqual(bundledSurfaceManifest.map((entry) => entry.label), [
    "Fine Paper",
    "Matte Paper",
    "Recycled Paper",
    "Canvas",
    "Handmade Paper"
  ]);
  assert.ok(bundledSurfaceManifest.every((entry) => entry.license === "CC0-1.0" && entry.sha256.length === 64));
});

test("every surface manifest entry has an asset and thumbnail", async () => {
  for (const entry of bundledSurfaceManifest) {
    await access(path.join(process.cwd(), "src/renderer/assets/textures/bundled", entry.assetFile));
    await access(path.join(process.cwd(), "src/renderer/assets/textures/bundled", entry.thumbnailFile));
  }
});

test("unsupported or missing surfaces safely resolve to no bundled entry", () => {
  assert.equal(surfaceManifestEntryForPaperType("missing-surface"), undefined);
  assert.equal(surfaceManifestEntryForPaperType("fine-grain")?.id, "fine-paper");
});

import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import path from "node:path";
import { bundledSurfaceDefaults, bundledSurfaceManifest, resolveBundledSurfaceType, surfaceDefaultsForType, surfaceManifestEntryForPaperType, surfaceManifestIsComplete } from "../shared/surfaces.js";

test("bundled surface manifest is complete and uses CC0 provenance", () => {
  assert.equal(surfaceManifestIsComplete(), true);
  assert.deepEqual(bundledSurfaceManifest.map((entry) => entry.label), [
    "Paper",
    "Crumpled Paper",
    "Grid Paper",
    "Dotted Paper"
  ]);
  assert.ok(bundledSurfaceManifest.every((entry) => entry.license === "CC0-1.0" && entry.sha256.length === 64));
});

test("every surface manifest entry has an asset and thumbnail", async () => {
  for (const entry of bundledSurfaceManifest) {
    await access(path.join(process.cwd(), "src/renderer/assets/textures/bundled", entry.assetFile));
    await access(path.join(process.cwd(), "src/renderer/assets/textures/bundled", entry.thumbnailFile));
  }
});

test("surface aliases keep older projects compatible while the editor shows the new curated set", () => {
  assert.equal(surfaceManifestEntryForPaperType("missing-surface"), undefined);
  assert.equal(surfaceManifestEntryForPaperType("paper")?.id, "paper");
  assert.equal(surfaceManifestEntryForPaperType("fine-grain")?.id, "paper");
  assert.equal(surfaceManifestEntryForPaperType("handmade")?.id, "crumpled-paper");
  assert.equal(resolveBundledSurfaceType("matte-photo"), "paper");
  assert.equal(resolveBundledSurfaceType("canvas"), "crumpled-paper");
});


test("bundled surfaces expose the requested default controls for each sourced texture", () => {
  assert.deepEqual(surfaceDefaultsForType("paper"), bundledSurfaceDefaults.paper);
  assert.deepEqual(surfaceDefaultsForType("crumpled-paper"), bundledSurfaceDefaults["crumpled-paper"]);
  assert.deepEqual(surfaceDefaultsForType("grid-paper"), bundledSurfaceDefaults["grid-paper"]);
  assert.deepEqual(surfaceDefaultsForType("dotted-paper"), bundledSurfaceDefaults["dotted-paper"]);
  assert.equal(surfaceDefaultsForType("custom"), undefined);
});


test("bundled surface presets default to multiply blending", () => {
  assert.ok(Object.values(bundledSurfaceDefaults).every((defaults) => defaults.blendMode === "multiply"));
});

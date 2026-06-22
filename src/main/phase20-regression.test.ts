import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDefaultPaperFrame, createDefaultEffects, createPlaceholder, createProject, normalizeProject } from "../renderer/project.js";
import { createDefaultPolaroidEffect, createDefaultTornPaperEffect, bundledTornPaperPresets } from "../shared/frame-effects.js";

const source = (path: string) => readFile(path, "utf8");

test("Phase 20 simplifies effect choices and maps legacy Deckle/Newsprint into Torn/Clean", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /<option value="clean">Clean Paper<\/option>/);
  assert.match(renderer, /<option value="torn">Torn Paper<\/option>/);
  assert.doesNotMatch(renderer, /<option value="deckle">/);
  assert.doesNotMatch(renderer, /<option value="newsprint">/);

  for (const [legacy, expected] of [["deckle", "torn"], ["deckle-edge", "torn"], ["newsprint", "clean"], ["newspaper-cutout", "clean"]] as const) {
    const project = createProject();
    const layer = createPlaceholder(project.canvas, 1);
    (layer.effects.paperFrame as { type: string }).type = legacy;
    project.layers = [layer];
    assert.equal(normalizeProject(project).layers[0]?.effects.paperFrame.type, expected);
  }
});

test("Phase 20 starts effects from calmer user-friendly defaults", () => {
  const polaroid = createDefaultPolaroidEffect({ ...createDefaultPaperFrame(), type: "polaroid", borderWidth: 0, innerPadding: 0 });
  assert.equal(polaroid.borderTop, 28);
  assert.equal(polaroid.imageInset, 6);
  assert.ok(polaroid.warmth > 0);
  assert.ok(polaroid.dropShadow.opacity <= 0.22);

  const torn = createDefaultTornPaperEffect({ ...createDefaultPaperFrame(), type: "torn", edgeRoughness: 0, shadowStrength: 0 });
  assert.equal(torn.presetId, "soft-paper");
  assert.ok(torn.edges.top.depth <= 24);
  assert.equal(bundledTornPaperPresets.length, 3);
});

test("Phase 20 adds managed overlay images instead of temporary overlay file paths", async () => {
  const main = await source("src/main/main.ts");
  const preload = await source("src/preload/index.ts");
  const renderer = await source("src/renderer/main.tsx");
  assert.match(main, /ipcMain\.handle\("overlay:import"/);
  assert.match(main, /app\.getPath\("userData"\), "Overlay Images"/);
  assert.match(main, /copyFile\(sourcePath, destinationPath\)/);
  assert.match(preload, /importOverlayImage/);
  assert.match(renderer, /async function addTransparentOverlay/);
  assert.doesNotMatch(renderer, /Add Overlay/);
  assert.match(renderer, /mode: "fixed" as const/);
});

test("Phase 20 removes noisy UI items and keeps PNG-only export controls", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.doesNotMatch(renderer, /Export JPEG/);
  assert.doesNotMatch(renderer, /Recently Used/);
  assert.doesNotMatch(renderer, /Active Rotation/);
  assert.doesNotMatch(renderer, /A quiet space for changing walls/i);
  assert.doesNotMatch(renderer, /Wallpaper Assignment/);
  assert.match(renderer, /Preview applied to current desktop/);
  assert.match(renderer, /Clean Up Folder/);
  assert.match(renderer, /Add Placeholder/);
});

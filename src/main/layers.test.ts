import test from "node:test";
import assert from "node:assert/strict";
import type { PlaceholderLayer } from "../shared/types";
import { layerSelectionRange, moveLayerBlockToTarget, reorderLayerBlock } from "../shared/layers";

function layer(id: string): PlaceholderLayer {
  return {
    id,
    type: "placeholder",
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    cropMode: "cover",
    alignment: "center",
    borderWidth: 0,
    borderColor: "#fff",
    borderOpacity: 1,
    borderRadius: 0,
    maskShape: "rectangle",
    shadow: false,
    opacity: 1,
    locked: false,
    hidden: false,
    keepAspectRatio: false,
    crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    effects: {
      filters: { brightness: 100, contrast: 100, saturation: 100, exposure: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, blur: 0, sharpen: 0, sepia: 0, grayscale: 0, fade: 0, vignette: 0, grain: 0 },
      paper: { type: "none", intensity: 0, scale: 1, rotation: 0, opacity: 0, blendMode: "multiply", seed: 1 },
      innerShadow: false,
      glow: false,
      backgroundColor: "#fff",
      blendMode: "normal",
      polaroidFrame: false,
      tapeDecoration: false,
      tornEdgeMask: false,
      paperFrame: { type: "none", borderWidth: 20, paperColor: "#fffdf8", edgeRoughness: 35, shadowStrength: 35, innerPadding: 0, rotationVariation: 0, textureIntensity: 20, seed: 1 }
    },
    sourceState: { sourceIds: [], mode: "shuffle", currentIndex: 0, shuffleQueue: [], usedImageIds: [], preventDuplicates: true, includeSubfolders: false }
  };
}

const base = [layer("back"), layer("middle"), layer("front")];

test("reorder block preserves relative order and render semantics", () => {
  assert.deepEqual(reorderLayerBlock(base, ["back", "middle"], "front").map((item) => item.id), ["front", "back", "middle"]);
  assert.deepEqual(reorderLayerBlock(base, ["middle", "front"], "back").map((item) => item.id), ["middle", "front", "back"]);
  assert.deepEqual(reorderLayerBlock(base, ["middle"], "forward").map((item) => item.id), ["back", "front", "middle"]);
  assert.deepEqual(reorderLayerBlock(base, ["middle"], "backward").map((item) => item.id), ["middle", "back", "front"]);
});

test("drag reorder uses reversed panel order correctly", () => {
  const movedAboveFront = moveLayerBlockToTarget(base, ["back"], "front", true);
  assert.deepEqual(movedAboveFront.map((item) => item.id), ["middle", "front", "back"]);
  const movedBelowBack = moveLayerBlockToTarget(base, ["front"], "back", false);
  assert.deepEqual(movedBelowBack.map((item) => item.id), ["front", "back", "middle"]);
});

test("shift selection follows visible panel order", () => {
  assert.deepEqual(layerSelectionRange(base, "front", "back"), ["front", "middle", "back"]);
  assert.deepEqual(layerSelectionRange(base, "middle", "back"), ["middle", "back"]);
});

test("reordered layers preserve IDs and order through persistence", () => {
  const reordered = reorderLayerBlock(base, ["back"], "front");
  const restored = JSON.parse(JSON.stringify({ layers: reordered })) as { layers: PlaceholderLayer[] };
  assert.deepEqual(restored.layers.map((item) => item.id), ["middle", "front", "back"]);
  assert.equal(new Set(restored.layers.map((item) => item.id)).size, restored.layers.length);
});

import test from "node:test";
import assert from "node:assert/strict";
import { resolveLayerFrameBounds } from "../shared/adaptive-frame.js";
import type { PlaceholderLayer } from "../shared/types.js";

function layer(patch: Partial<PlaceholderLayer> = {}): PlaceholderLayer {
  return {
    id: "layer-a",
    type: "placeholder",
    name: "Layer A",
    x: 100,
    y: 200,
    width: 300,
    height: 200,
    frameMode: "fixed",
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
    effects: {} as PlaceholderLayer["effects"],
    sourceState: {} as PlaceholderLayer["sourceState"],
    ...patch
  };
}

test("fixed frame mode preserves stored layer rectangle", () => {
  assert.deepEqual(resolveLayerFrameBounds(layer(), { width: 1600, height: 900 }), {
    x: 100,
    y: 200,
    width: 300,
    height: 200
  });
});

test("adaptive aspect keeps the same center and target area", () => {
  const bounds = resolveLayerFrameBounds(layer({ frameMode: "adaptive" }), { width: 1600, height: 900 });
  const targetCenter = { x: 250, y: 300 };
  assert.equal(Math.round(bounds.x + bounds.width / 2), targetCenter.x);
  assert.equal(Math.round(bounds.y + bounds.height / 2), targetCenter.y);
  assert.equal(Math.round(bounds.width * bounds.height), 60_000);
  assert.equal(Math.round((bounds.width / bounds.height) * 1000), 1778);
});

test("adaptive aspect falls back to stored bounds without image dimensions", () => {
  assert.deepEqual(resolveLayerFrameBounds(layer({ frameMode: "adaptive" })), {
    x: 100,
    y: 200,
    width: 300,
    height: 200
  });
});

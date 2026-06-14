import assert from "node:assert/strict";
import test from "node:test";
import { computeImagePlacement, removeBackgroundImage, resizeCanvasAndLayers, resolveMaskGeometry } from "../shared/geometry.js";
import type { CanvasSettings, PlaceholderLayer } from "../shared/types.js";

const paper = { type: "none", intensity: 0, scale: 1, rotation: 0, opacity: 0, blendMode: "multiply", seed: 1 } as const;
const canvas: CanvasSettings = {
  width: 1000,
  height: 500,
  presetId: "custom",
  orientation: "landscape",
  backgroundColor: "#112233",
  backgroundTransparent: false,
  backgroundMode: "cover",
  backgroundAlignment: "center",
  backgroundOffsetX: 0,
  backgroundOffsetY: 0,
  backgroundScale: 1,
  backgroundBlur: 0,
  backgroundBrightness: 100,
  backgroundOpacity: 1,
  backgroundPaper: paper,
  backgroundImage: { id: "bg", name: "bg", path: "/bg.png", url: "file:///bg.png" }
};

const layer = {
  id: "a",
  type: "placeholder",
  name: "A",
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  rotation: 0,
  cropMode: "cover",
  alignment: "center",
  borderWidth: 0,
  borderColor: "#fff",
  borderOpacity: 1,
  borderRadius: 12,
  maskShape: "rounded",
  shadow: false,
  opacity: 1,
  locked: false,
  hidden: false,
  keepAspectRatio: false,
  crop: { offsetX: 0, offsetY: 0, zoom: 1 },
  effects: {
    filters: { brightness: 100, contrast: 100, saturation: 100, exposure: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, blur: 0, sharpen: 0, sepia: 0, grayscale: 0, fade: 0, vignette: 0, grain: 0 },
    paper,
    innerShadow: false,
    glow: false,
    backgroundColor: "#fff",
    blendMode: "normal",
    polaroidFrame: false,
    tapeDecoration: false,
    tornEdgeMask: false
  },
  sourceState: { sourceIds: [], mode: "shuffle", currentIndex: 0, shuffleQueue: [], usedImageIds: [], preventDuplicates: true, includeSubfolders: false }
} satisfies PlaceholderLayer;

test("fit modes preserve or change aspect ratio as requested", () => {
  assert.deepEqual(computeImagePlacement(400, 200, 200, 200, "contain", "center"), { x: 0, y: 50, width: 200, height: 100, tile: false });
  assert.deepEqual(computeImagePlacement(400, 200, 200, 200, "cover", "center"), { x: -100, y: 0, width: 400, height: 200, tile: false });
  assert.deepEqual(computeImagePlacement(400, 200, 200, 200, "stretch", "center"), { x: 0, y: 0, width: 200, height: 200, tile: false });
  assert.deepEqual(computeImagePlacement(400, 200, 200, 200, "original", "center"), { x: -100, y: 0, width: 400, height: 200, tile: false });
});

test("background reset preserves color and clears image", () => {
  const reset = removeBackgroundImage(canvas);
  assert.equal(reset.backgroundColor, "#112233");
  assert.equal(reset.backgroundImage, undefined);
});

test("canvas resize can scale or center layers", () => {
  const scaled = resizeCanvasAndLayers(canvas, [layer], 2000, 1000, "scale");
  assert.deepEqual({ x: scaled.layers[0].x, y: scaled.layers[0].y, width: scaled.layers[0].width, height: scaled.layers[0].height }, { x: 200, y: 100, width: 400, height: 200 });
  const centered = resizeCanvasAndLayers(canvas, [layer], 1200, 700, "center");
  assert.deepEqual({ x: centered.layers[0].x, y: centered.layers[0].y }, { x: 200, y: 150 });
});


test("crop offsets and zoom use the same deterministic placement engine", () => {
  const placement = computeImagePlacement(400, 200, 200, 200, "cover", "center", { offsetX: 12, offsetY: -8, zoom: 1.5 });
  assert.deepEqual(placement, { x: -188, y: -58, width: 600, height: 300, tile: false });
});

test("mask geometry clamps rounded corners and distinguishes circles", () => {
  assert.deepEqual(resolveMaskGeometry("rectangle", 200, 100, 40), { ellipse: false, radius: 0 });
  assert.deepEqual(resolveMaskGeometry("rounded", 200, 100, 80), { ellipse: false, radius: 50 });
  assert.deepEqual(resolveMaskGeometry("circle", 200, 100, 0), { ellipse: true, radius: 50 });
});

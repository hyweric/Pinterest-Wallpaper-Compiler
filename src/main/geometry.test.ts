import assert from "node:assert/strict";
import test from "node:test";
import { clampCropTransform, computeImagePlacement, removeBackgroundImage, resizeCanvasAndLayers, resolveMaskGeometry } from "../shared/geometry.js";
import type { CanvasSettings, PlaceholderLayer } from "../shared/types.js";

const paper = { type: "none", intensity: 0, scale: 1, rotation: 0, opacity: 0, blendMode: "multiply", seed: 1 } as const;
const canvas: CanvasSettings = {
  width: 1000,
  height: 500,
  presetId: "custom",
  orientation: "landscape",
  backgroundColor: "#112233",
  backgroundBaseMode: "image",
  backgroundTransparent: false,
  backgroundMode: "cover",
  backgroundAlignment: "center",
  backgroundOffsetX: 0,
  backgroundOffsetY: 0,
  backgroundScale: 1,
  backgroundBlur: 0,
  backgroundBrightness: 100,
  backgroundContrast: 100,
  backgroundTemperature: 0,
  backgroundVignette: 0,
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
    tornEdgeMask: false,
    paperFrame: { type: "none", borderWidth: 20, paperColor: "#fffdf8", edgeRoughness: 35, shadowStrength: 35, innerPadding: 0, rotationVariation: 0, textureIntensity: 20, seed: 1 }
  },
  sourceState: { sourceIds: [], mode: "shuffle", currentIndex: 0, shuffleQueue: [], usedImageIds: [], preventDuplicates: true, includeSubfolders: false }
} satisfies PlaceholderLayer;

test("fit modes preserve or change aspect ratio as requested", () => {
  assert.deepEqual(computeImagePlacement(400, 200, 200, 200, "contain", "center"), { x: 0, y: 50, width: 200, height: 100, tile: false });
  const cover = computeImagePlacement(400, 200, 200, 200, "cover", "center");
  assert.equal(cover.tile, false);
  assert.equal(cover.width / cover.height, 2);
  assert.ok(cover.x <= 0 && cover.y <= 0);
  assert.ok(cover.x + cover.width >= 200 && cover.y + cover.height >= 200);
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
  assert.deepEqual(placement, { x: -191, y: -59.5, width: 606, height: 303, tile: false });
});

test("fill placement covers extreme aspect ratios with overscan", () => {
  for (const [imageWidth, imageHeight, frameWidth, frameHeight] of [
    [8000, 400, 320, 640],
    [400, 8000, 640, 320],
    [3840, 2160, 307, 503],
    [2160, 3840, 503, 307]
  ]) {
    const placement = computeImagePlacement(imageWidth, imageHeight, frameWidth, frameHeight, "cover", "center", {
      offsetX: 99999,
      offsetY: -99999,
      zoom: 1
    });
    assert.ok(placement.x <= 0, "left edge covers frame");
    assert.ok(placement.y <= 0, "top edge covers frame");
    assert.ok(placement.x + placement.width >= frameWidth, "right edge covers frame");
    assert.ok(placement.y + placement.height >= frameHeight, "bottom edge covers frame");
    assert.equal(Math.round((placement.width / placement.height) * 1_000_000), Math.round((imageWidth / imageHeight) * 1_000_000));
  }
});

test("crop clamping prevents blank areas after rotation-safe and rounded-frame sizing", () => {
  const crop = clampCropTransform(1200, 300, 333.3, 777.7, "cover", "center", { offsetX: -5000, offsetY: 5000, zoom: 0.6 });
  assert.equal(crop.zoom, 1);
  const placement = computeImagePlacement(1200, 300, 333.3, 777.7, "cover", "center", crop);
  assert.ok(placement.x <= 0);
  assert.ok(placement.y <= 0);
  assert.ok(placement.x + placement.width >= 333.3);
  assert.ok(placement.y + placement.height >= 777.7);
});

test("mask geometry clamps rounded corners and distinguishes circles", () => {
  assert.deepEqual(resolveMaskGeometry("rectangle", 200, 100, 40), { ellipse: false, radius: 0 });
  assert.deepEqual(resolveMaskGeometry("rounded", 200, 100, 80), { ellipse: false, radius: 50 });
  assert.deepEqual(resolveMaskGeometry("circle", 200, 100, 0), { ellipse: true, radius: 50 });
});

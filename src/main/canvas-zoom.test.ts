import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  canvasPointAtClient,
  clampCanvasZoom,
  fitCanvasZoom,
  normalizeWheelDelta,
  zoomAfterStep,
  zoomAfterWheel
} from "../shared/canvas-zoom";

test("canvas zoom clamps every input to 10 through 500 percent", () => {
  assert.equal(clampCanvasZoom(-20), MIN_CANVAS_ZOOM);
  assert.equal(clampCanvasZoom(20), MAX_CANVAS_ZOOM);
  assert.equal(clampCanvasZoom(Number.NaN), 1);
});

test("wheel deltas are normalized across pixel, line, and page devices", () => {
  assert.equal(normalizeWheelDelta(10, 0), 10);
  assert.equal(normalizeWheelDelta(1, 1), 16);
  assert.equal(normalizeWheelDelta(1, 2, 900), 240);
  assert.equal(normalizeWheelDelta(-9999, 0), -240);
});

test("wheel and button zoom are multiplicative and bounded", () => {
  assert.ok(zoomAfterWheel(1, -80) > 1);
  assert.ok(zoomAfterWheel(1, 80) < 1);
  assert.ok(zoomAfterStep(1, 1) > 1);
  assert.ok(zoomAfterStep(1, -1) < 1);
  assert.equal(zoomAfterStep(MAX_CANVAS_ZOOM, 1), MAX_CANVAS_ZOOM);
});

test("fit zoom respects viewport padding and global limits", () => {
  assert.equal(fitCanvasZoom(1000, 700, 1920, 1080), Math.min((1000 - 88) / 1920, (700 - 130) / 1080));
  assert.equal(fitCanvasZoom(100000, 100000, 100, 100), MAX_CANVAS_ZOOM);
});

test("cursor anchors map from the scaled client rectangle into logical canvas coordinates", () => {
  const point = canvasPointAtClient(250, 180, { left: 50, top: 30, width: 960, height: 540 }, 0.5, 1920, 1080);
  assert.deepEqual(point, { x: 400, y: 300 });
  const clamped = canvasPointAtClient(-100, 9999, { left: 50, top: 30, width: 960, height: 540 }, 0.5, 1920, 1080);
  assert.deepEqual(clamped, { x: 0, y: 1080 });
});

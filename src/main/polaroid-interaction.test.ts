import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPolaroidRotation,
  distanceBetween,
  pointerAngleDegrees,
  polaroidScaleFromPointerDistance,
  screenDeltaToFrameDelta,
  shortestAngleDelta
} from "../shared/polaroid-interaction.js";

test("direct Polaroid dragging follows the rotated frame axes", () => {
  const local = screenDeltaToFrameDelta(0, 20, 90);
  assert.ok(Math.abs(local.x - 20) < 1e-8);
  assert.ok(Math.abs(local.y) < 1e-8);
});

test("direct Polaroid corner resizing changes only image scale", () => {
  assert.equal(polaroidScaleFromPointerDistance(1, 100, 150), 1.5);
  assert.equal(polaroidScaleFromPointerDistance(2, 100, 50), 1);
  assert.equal(polaroidScaleFromPointerDistance(1, 0, 0), 1);
});

test("direct Polaroid rotation remains stable across the angle wrap", () => {
  const center = { x: 100, y: 100 };
  const start = pointerAngleDegrees({ x: 1, y: 98 }, center);
  const current = pointerAngleDegrees({ x: 1, y: 102 }, center);
  const delta = shortestAngleDelta(start, current);
  assert.ok(Math.abs(delta) < 5);
  assert.equal(clampPolaroidRotation(190), -170);
});

test("pointer distance is deterministic", () => {
  assert.equal(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

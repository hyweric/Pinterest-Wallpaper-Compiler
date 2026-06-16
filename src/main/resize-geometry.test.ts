import assert from "node:assert/strict";
import test from "node:test";
import { resizeRectAroundCenter, type ResizeHandle } from "../shared/resize-geometry.js";

const original = { x: 200, y: 100, width: 400, height: 240 };
const center = (rect: typeof original) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const handles: ResizeHandle[] = ["resize-n", "resize-s", "resize-e", "resize-w", "resize-ne", "resize-nw", "resize-se", "resize-sw"];

test("resize handles change size while keeping the layer center fixed", () => {
  for (const handle of handles) {
    const resized = resizeRectAroundCenter(original, handle, 30, 20, false, { width: 1920, height: 1080 });
    assert.deepEqual(center(resized), center(original), handle);
    assert.ok(resized.width !== original.width || resized.height !== original.height, handle);
  }
});

test("aspect-locked resizing preserves aspect ratio and center", () => {
  const resized = resizeRectAroundCenter(original, "resize-se", 80, 15, true, { width: 1920, height: 1080 });
  assert.deepEqual(center(resized), center(original));
  assert.ok(Math.abs(resized.width / resized.height - original.width / original.height) < 0.01);
});

test("centered resizing remains inside canvas bounds", () => {
  const nearEdge = { x: 20, y: 20, width: 100, height: 100 };
  const resized = resizeRectAroundCenter(nearEdge, "resize-nw", -1000, -1000, false, { width: 500, height: 400 });
  assert.ok(resized.x >= 0);
  assert.ok(resized.y >= 0);
  assert.ok(resized.x + resized.width <= 500);
  assert.ok(resized.y + resized.height <= 400);
});

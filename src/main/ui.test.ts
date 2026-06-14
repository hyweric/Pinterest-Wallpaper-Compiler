import assert from "node:assert/strict";
import test from "node:test";
import { anchoredScrollForZoom, placeTooltip } from "../shared/ui.js";

test("tooltip placement stays inside narrow viewports", () => {
  const left = placeTooltip({ left: 0, right: 32, top: 100, bottom: 132, width: 32, height: 32 }, { width: 220, height: 500 }, 180);
  const right = placeTooltip({ left: 190, right: 220, top: 100, bottom: 132, width: 30, height: 32 }, { width: 220, height: 500 }, 180);
  assert.equal(left.placement, "top");
  assert.ok(left.left >= 102);
  assert.ok(right.left <= 118);
});

test("tooltip falls below controls near the top edge", () => {
  const result = placeTooltip({ left: 60, right: 100, top: 12, bottom: 44, width: 40, height: 32 }, { width: 300, height: 500 });
  assert.equal(result.placement, "bottom");
  assert.equal(result.top, 52);
});


test("cursor anchored zoom preserves the canvas point under the pointer", () => {
  const before = { scrollLeft: 240, scrollTop: 120, pointerX: 300, pointerY: 200, currentZoom: 0.5, nextZoom: 1 };
  const canvasX = (before.scrollLeft + before.pointerX) / before.currentZoom;
  const canvasY = (before.scrollTop + before.pointerY) / before.currentZoom;
  const after = anchoredScrollForZoom(before);
  assert.equal((after.scrollLeft + before.pointerX) / before.nextZoom, canvasX);
  assert.equal((after.scrollTop + before.pointerY) / before.nextZoom, canvasY);
});

test("cursor anchored zoom works at viewport edges", () => {
  for (const [pointerX, pointerY] of [[0, 0], [800, 600]]) {
    const after = anchoredScrollForZoom({ scrollLeft: 100, scrollTop: 50, pointerX, pointerY, currentZoom: 1.25, nextZoom: 0.4 });
    assert.ok(Number.isFinite(after.scrollLeft));
    assert.ok(Number.isFinite(after.scrollTop));
  }
});

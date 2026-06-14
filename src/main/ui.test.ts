import assert from "node:assert/strict";
import test from "node:test";
import { placeTooltip } from "../shared/ui.js";

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

import assert from "node:assert/strict";
import test from "node:test";
import { defaultDroppedPlaceholderSize, placementForCanvasDrop } from "../shared/drop-placement";

const canvas = { width: 1920, height: 1080 };

test("dropped placeholders are centered on the canvas drop point", () => {
  const size = defaultDroppedPlaceholderSize(canvas);
  const placement = placementForCanvasDrop(canvas, { x: 960, y: 540 });
  assert.equal(placement.x + placement.width / 2, 960);
  assert.equal(placement.y + placement.height / 2, 540);
  assert.deepEqual({ width: placement.width, height: placement.height }, size);
});

test("drop placement clamps frames inside the canvas", () => {
  const topLeft = placementForCanvasDrop(canvas, { x: -100, y: -100 });
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 0);

  const bottomRight = placementForCanvasDrop(canvas, { x: 2500, y: 1800 });
  assert.equal(bottomRight.x + bottomRight.width, canvas.width);
  assert.equal(bottomRight.y + bottomRight.height, canvas.height);
});

test("multiple dropped sources receive a visible cascade offset", () => {
  const first = placementForCanvasDrop(canvas, { x: 600, y: 400 }, 0);
  const second = placementForCanvasDrop(canvas, { x: 600, y: 400 }, 1);
  assert.ok(second.x > first.x);
  assert.ok(second.y > first.y);
});

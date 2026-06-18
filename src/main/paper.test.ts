import test from "node:test";
import assert from "node:assert/strict";
import { paperFrameClipPath, paperFrameInsets, paperFrameRotation } from "../shared/paper.js";

const base = {
  type: "polaroid" as const,
  borderWidth: 20,
  paperColor: "#fff",
  edgeRoughness: 30,
  shadowStrength: 30,
  innerPadding: 0,
  rotationVariation: 4,
  textureIntensity: 20,
  seed: 7
};

test("polaroid reserves a larger bottom border", () => {
  const insets = paperFrameInsets(base, 400, 300);
  assert.ok(insets.bottom > insets.top);
});

test("paper rotation is deterministic", () => {
  assert.equal(paperFrameRotation(base), paperFrameRotation(base));
  assert.ok(Math.abs(paperFrameRotation(base)) <= 4);
});


test("legacy deckle uses the same deterministic torn-paper geometry", () => {
  const torn = paperFrameClipPath({ ...base, type: "torn", edgeRoughness: 70 });
  const deckle = paperFrameClipPath({ ...base, type: "deckle", edgeRoughness: 70 });
  assert.equal(torn, paperFrameClipPath({ ...base, type: "torn", edgeRoughness: 70 }));
  assert.equal(torn, deckle);
  assert.match(torn ?? "", /^polygon\(/);
});

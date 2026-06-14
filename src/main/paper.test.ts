import test from "node:test";
import assert from "node:assert/strict";
import { paperFrameClipPath, paperFrameDefaults, paperFrameInsets, paperFrameRotation } from "../shared/paper.js";
import type { PaperFrameType } from "../shared/types.js";

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


test("torn and deckle use distinct deterministic edge geometry", () => {
  const torn = paperFrameClipPath({ ...base, type: "torn", edgeRoughness: 70 });
  const deckle = paperFrameClipPath({ ...base, type: "deckle", edgeRoughness: 70 });
  assert.equal(torn, paperFrameClipPath({ ...base, type: "torn", edgeRoughness: 70 }));
  assert.notEqual(torn, deckle);
  assert.match(torn ?? "", /^polygon\(/);
  assert.match(deckle ?? "", /^polygon\(/);
});

test("every paper frame effect has distinct visible defaults", () => {
  const types: PaperFrameType[] = ["none", "clean", "polaroid", "torn", "deckle", "newsprint"];
  const defaults = types.map((type) => paperFrameDefaults(type, base));
  assert.equal(defaults.find((effect) => effect.type === "none")?.borderWidth, 0);
  assert.ok((defaults.find((effect) => effect.type === "polaroid")?.borderWidth ?? 0) > (defaults.find((effect) => effect.type === "clean")?.borderWidth ?? 0));
  assert.ok((defaults.find((effect) => effect.type === "torn")?.edgeRoughness ?? 0) > (defaults.find((effect) => effect.type === "deckle")?.edgeRoughness ?? 0));
  assert.notEqual(defaults.find((effect) => effect.type === "newsprint")?.paperColor, defaults.find((effect) => effect.type === "clean")?.paperColor);
});

test("paper frame insets stay inside the frame for every effect", () => {
  const types: PaperFrameType[] = ["none", "clean", "polaroid", "torn", "deckle", "newsprint"];
  for (const type of types) {
    const insets = paperFrameInsets(paperFrameDefaults(type, base), 240, 180);
    assert.ok(insets.left + insets.right < 240, type);
    assert.ok(insets.top + insets.bottom < 180, type);
  }
});

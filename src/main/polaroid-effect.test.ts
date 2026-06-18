import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultPolaroidEffect,
  normalizePolaroidEffect,
  paperWarmthOverlay,
  polaroidInsets
} from "../shared/frame-effects.js";
import { createDefaultPaperFrame } from "../renderer/project.js";

test("Polaroid defaults preserve the established frame proportions", () => {
  const effect = createDefaultPolaroidEffect({ ...createDefaultPaperFrame(), type: "polaroid" });
  assert.equal(effect.enabled, true);
  assert.equal(effect.borderTop, 20);
  assert.equal(effect.borderRight, 20);
  assert.equal(effect.borderLeft, 20);
  assert.equal(effect.borderBottom, 44);
  assert.equal(effect.captionHeight, 24);
  assert.equal(effect.imageScale, 1);
  assert.equal(effect.frameOpacity, 1);
});

test("Polaroid controls normalize independently and survive round-trip serialization", () => {
  const effect = normalizePolaroidEffect({
    ...createDefaultPolaroidEffect(),
    borderTop: 12,
    borderRight: 18,
    borderBottom: 72,
    borderLeft: 24,
    captionHeight: 48,
    imageInset: 7,
    imageScale: 1.4,
    imageOffsetX: 19,
    imageOffsetY: -12,
    imageRotation: 8,
    frameRotation: -4,
    frameColor: "#ffeecc",
    frameOpacity: .72,
    grain: 33,
    warmth: 41,
    cornerRadius: 15,
    caption: {
      enabled: true,
      text: "Summer",
      fontFamily: "Georgia",
      fontSize: 32,
      fontWeight: 700,
      color: "#222222",
      alignment: "right",
      x: 9,
      y: -3
    }
  });
  const loaded = normalizePolaroidEffect(JSON.parse(JSON.stringify(effect)));
  assert.deepEqual(loaded, effect);
  assert.deepEqual(polaroidInsets(loaded, 600, 400), { top: 19, right: 25, bottom: 79, left: 31 });
});

test("paper warmth has deterministic warm and cool overlays", () => {
  assert.equal(paperWarmthOverlay(0), undefined);
  assert.equal(paperWarmthOverlay(50)?.color, "#d89a5b");
  assert.equal(paperWarmthOverlay(-50)?.color, "#6f9bd8");
  assert.deepEqual(paperWarmthOverlay(50), paperWarmthOverlay(50));
});

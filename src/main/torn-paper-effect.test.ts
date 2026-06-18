import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTornPaperPreset,
  bundledTornPaperPresets,
  createCustomTornPaperPreset,
  createDefaultTornPaperEffect,
  nextStableSeed,
  normalizeTornPaperEffect,
  tornPaperTextureSvg
} from "../shared/frame-effects.js";
import { createDefaultPaperFrame } from "../renderer/project.js";

test("torn paper includes five editable bundled presets", () => {
  assert.deepEqual(bundledTornPaperPresets.map((preset) => preset.name), [
    "Soft Handmade",
    "Rough Scrap",
    "Deep Torn",
    "Worn Vintage",
    "Clean Deckle"
  ]);
  assert.ok(bundledTornPaperPresets.every((preset) => preset.bundled));
});

test("applying a torn preset changes editable settings without changing the stable seed", () => {
  const effect = normalizeTornPaperEffect({ ...createDefaultTornPaperEffect(), seed: 884422 });
  const applied = applyTornPaperPreset(effect, bundledTornPaperPresets[1]);
  assert.equal(applied.seed, 884422);
  assert.equal(applied.presetId, "rough-scrap");
  assert.equal(applied.edges.top.depth, 64);
  assert.equal(applied.stains, 24);
});

test("custom torn presets serialize independently from the active effect", () => {
  const effect = normalizeTornPaperEffect({ ...createDefaultTornPaperEffect(), grain: 77, fibers: 66 });
  const preset = createCustomTornPaperPreset(effect, "My Scrap", "custom-test");
  const loaded = JSON.parse(JSON.stringify(preset));
  assert.deepEqual(loaded, preset);
  effect.grain = 1;
  assert.equal(preset.settings.grain, 77);
});

test("torn texture details are deterministic and regenerate only when the seed changes", () => {
  const effect = normalizeTornPaperEffect({
    ...createDefaultTornPaperEffect({ ...createDefaultPaperFrame(), type: "torn" }),
    seed: 4567,
    fibers: 45,
    wrinkles: 35,
    stains: 25,
    speckles: 30,
    edgeDarkening: 40
  });
  const first = tornPaperTextureSvg(effect, 800, 600);
  const second = tornPaperTextureSvg(effect, 800, 600);
  assert.equal(first, second);
  assert.notEqual(first, tornPaperTextureSvg({ ...effect, seed: nextStableSeed(effect.seed) }, 800, 600));
});

test("individual torn edges can remain disabled through normalization", () => {
  const effect = normalizeTornPaperEffect({
    ...createDefaultTornPaperEffect(),
    edges: { top: { enabled: false }, right: {}, bottom: {}, left: {} }
  });
  assert.equal(effect.edges.top.enabled, false);
  assert.equal(effect.edges.right.enabled, true);
});

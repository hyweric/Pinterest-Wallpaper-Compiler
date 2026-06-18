import assert from "node:assert/strict";
import test from "node:test";
import {
  POLAROID_EFFECT_SCHEMA_VERSION,
  TORN_PAPER_EFFECT_SCHEMA_VERSION,
  createDefaultPolaroidEffect,
  createDefaultTornPaperEffect,
  nextStableSeed,
  normalizePolaroidEffect,
  normalizeTornPaperEffect,
  polaroidInsets,
  tornPaperPolygonPoints
} from "../shared/frame-effects.js";
import { createDefaultPaperFrame, createPlaceholder, createProject, normalizeProject } from "../renderer/project.js";

test("legacy paper-frame values migrate into versioned Polaroid and Torn effects", () => {
  const frame = {
    ...createDefaultPaperFrame(),
    type: "polaroid" as const,
    borderWidth: 24,
    innerPadding: 6,
    paperColor: "#faf1df",
    shadowStrength: 55,
    textureIntensity: 42,
    seed: 91
  };
  const polaroid = normalizePolaroidEffect(undefined, frame, true);
  assert.equal(polaroid.schemaVersion, POLAROID_EFFECT_SCHEMA_VERSION);
  assert.equal(polaroid.enabled, true);
  assert.equal(polaroid.borderTop, 30);
  assert.equal(polaroid.borderBottom, 66);
  assert.equal(polaroid.frameColor, "#faf1df");
  assert.equal(polaroid.grain, 42);
  assert.equal(polaroid.innerShadow.enabled, true);

  const tornFrame = { ...frame, type: "torn" as const, edgeRoughness: 61 };
  const torn = normalizeTornPaperEffect(undefined, tornFrame, false);
  assert.equal(torn.schemaVersion, TORN_PAPER_EFFECT_SCHEMA_VERSION);
  assert.equal(torn.enabled, true);
  assert.equal(torn.seed, 91);
  assert.equal(torn.edges.top.depth, 61);
  assert.equal(torn.paperColor, "#faf1df");
});

test("Polaroid insets use independent borders, caption height, and image inset", () => {
  const effect = {
    ...createDefaultPolaroidEffect(),
    borderTop: 10,
    borderRight: 20,
    borderBottom: 30,
    borderLeft: 40,
    captionHeight: 55,
    imageInset: 5
  };
  assert.deepEqual(polaroidInsets(effect, 600, 400), { top: 15, right: 25, bottom: 70, left: 45 });
});

test("torn-paper polygons are seeded and stable until Regenerate Tear changes the seed", () => {
  const effect = createDefaultTornPaperEffect({ ...createDefaultPaperFrame(), type: "torn", seed: 1234 });
  const first = tornPaperPolygonPoints(effect, 900, 600);
  const second = tornPaperPolygonPoints(structuredClone(effect), 900, 600);
  assert.deepEqual(first, second);
  const regenerated = { ...effect, seed: nextStableSeed(effect.seed) };
  assert.notDeepEqual(tornPaperPolygonPoints(regenerated, 900, 600), first);
});

test("individual torn edges can be disabled without randomizing other edges", () => {
  const effect = createDefaultTornPaperEffect({ ...createDefaultPaperFrame(), type: "torn", seed: 77 });
  const original = tornPaperPolygonPoints(effect, 500, 300);
  const disabled = structuredClone(effect);
  disabled.edges.top.enabled = false;
  const points = tornPaperPolygonPoints(disabled, 500, 300);
  const topCount = Math.max(2, Math.round(disabled.edges.top.frequency * disabled.edges.top.scale)) + 1;
  assert.ok(points.slice(0, topCount).every((point) => point.y === 0));
  assert.notDeepEqual(points, original);
  assert.equal(disabled.seed, effect.seed);
});

test("project normalization, save/load, and duplication preserve independent expanded effects", () => {
  const project = createProject();
  const layer = createPlaceholder(project.canvas, 1);
  const legacy = structuredClone(layer);
  delete legacy.effects.polaroid;
  delete legacy.effects.tornPaper;
  legacy.effects.paperFrame.type = "polaroid";
  project.layers = [legacy];

  const loaded = normalizeProject(JSON.parse(JSON.stringify(project)));
  const normalizedLayer = loaded.layers[0];
  assert.equal(normalizedLayer.effects.polaroid?.schemaVersion, POLAROID_EFFECT_SCHEMA_VERSION);
  assert.equal(normalizedLayer.effects.tornPaper?.schemaVersion, TORN_PAPER_EFFECT_SCHEMA_VERSION);

  normalizedLayer.effects.polaroid!.caption.text = "Original";
  const duplicate = structuredClone(normalizedLayer);
  duplicate.effects.polaroid!.caption.text = "Duplicate";
  duplicate.effects.tornPaper!.edges.left.depth = 88;
  assert.equal(normalizedLayer.effects.polaroid!.caption.text, "Original");
  assert.notEqual(normalizedLayer.effects.tornPaper!.edges.left.depth, duplicate.effects.tornPaper!.edges.left.depth);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SURFACE_IMAGE_CACHE_ENTRIES,
  MAX_SURFACE_TILE_CACHE_ENTRIES,
  nextSurfaceSeed,
  normalizeSurfaceEffect,
  surfaceCompositeAlpha,
  surfaceEffectIsVisible,
  surfacePreviewDimensions,
  surfaceSeedOffset,
  surfaceTileCacheKey
} from "../shared/surface-rendering.js";
import type { PaperTextureEffect } from "../shared/types.js";

const effect: PaperTextureEffect = {
  enabled: true,
  type: "fine-grain",
  intensity: 60,
  scale: 1.25,
  rotation: 14,
  opacity: .5,
  blendMode: "multiply",
  seed: 42,
  noise: 25,
  roughness: 35,
  tone: -10
};

test("surface normalization preserves stable persisted settings", () => {
  const normalized = normalizeSurfaceEffect(effect);
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.seed, 42);
  assert.equal(normalized.noise, 25);
  assert.equal(normalized.roughness, 35);
  assert.equal(normalized.tone, -10);
  assert.equal(surfaceEffectIsVisible(normalized), true);
  assert.equal(surfaceCompositeAlpha(normalized), .3);
});

test("legacy texture projects remain enabled while none stays disabled", () => {
  assert.equal(normalizeSurfaceEffect({ ...effect, enabled: undefined }).enabled, true);
  assert.equal(surfaceEffectIsVisible({ ...effect, type: "none", enabled: true }), false);
  assert.equal(surfaceEffectIsVisible({ ...effect, intensity: 0 }), false);
});

test("surface seeds and cache keys are deterministic until regenerate is requested", () => {
  assert.deepEqual(surfaceSeedOffset(42), surfaceSeedOffset(42));
  assert.equal(surfaceTileCacheKey(effect), surfaceTileCacheKey({ ...effect }));
  assert.notEqual(nextSurfaceSeed(42), 42);
  assert.notEqual(surfaceTileCacheKey(effect), surfaceTileCacheKey({ ...effect, seed: nextSurfaceSeed(42) }));
});

test("preview buffers stay bounded for large wallpapers", () => {
  const preview = surfacePreviewDimensions(7680, 4320);
  assert.ok(preview.width <= 1024);
  assert.ok(preview.height <= 1024);
  assert.ok(preview.width * preview.height <= 1_200_000);
  assert.ok(preview.scale < 1);
});

test("surface caches have explicit memory bounds", () => {
  assert.equal(MAX_SURFACE_TILE_CACHE_ENTRIES, 24);
  assert.equal(MAX_SURFACE_IMAGE_CACHE_ENTRIES, 12);
});

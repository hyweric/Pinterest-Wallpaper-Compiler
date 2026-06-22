import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const renderer = readFileSync(join(process.cwd(), "src/renderer/main.tsx"), "utf8");

test("phase 22.3.10.1 adds a no-texture paper option", () => {
  assert.match(renderer, /<label>Texture<select[^>]*value=\{frameTextureType\}/);
  assert.match(renderer, /<option value="none">None<\/option><option value="paper">Paper<\/option><option value="crumpled-paper">Crumpled Paper<\/option>/);
  assert.match(renderer, /function patchFrameTexture\(type: "none" \| "paper" \| "crumpled-paper"\)/);
});

test("phase 22.3.10.1 disables frame texture rendering when None is selected", () => {
  assert.match(renderer, /layer\.effects\.paper\.enabled === false \|\| layer\.effects\.paper\.type === "none" \? "none"/);
  assert.match(renderer, /const textureVisible = textureType !== "none" && textureIntensity > 0;/);
  assert.match(renderer, /if \(!textureVisible \|\| !surfaceEffectIsVisible\(paper\)\) return null;/);
  assert.match(renderer, /enabled: false,\n\s*type: "none",\n\s*customTextureId: undefined,\n\s*intensity: 0,\n\s*opacity: 0/);
  assert.match(renderer, /polaroid: normalizePolaroidEffect\(\{ \.\.\.polaroid, grain: 0, warmth: 0 \}/);
});

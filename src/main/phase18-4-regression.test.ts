import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("Phase 18.4 restyles only the right inspector with flat divided sections", async () => {
  const styles = await source("src/renderer/styles.css");
  assert.match(styles, /Phase 18\.4: visual-only right inspector cleanup/);
  assert.match(styles, /\.sidebar\.right \.settings-section > details[\s\S]*border-radius: 0;/);
  assert.match(styles, /border-bottom: 1px solid rgba\(43, 48, 58, 0\.09\)/);
  assert.match(styles, /\.sidebar\.right \.panel-tabs\.inspector-tabs:has\(button:only-child\)/);
  assert.match(styles, /\.sidebar\.right \.inspector-scroll-region[\s\S]*padding: 0 14px 24px/);
});

test("Phase 18.4 does not change inspector functionality or component structure", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /<CanvasDesignPanel/);
  assert.doesNotMatch(renderer, /<WallpaperPanel/);
  assert.match(renderer, /<Properties/);
  assert.match(renderer, /<summary>Canvas/);
  assert.match(renderer, /<summary>Background/);
  assert.match(renderer, /<summary>Surface/);
  assert.doesNotMatch(renderer, /Wallpaper Rotation/);
});

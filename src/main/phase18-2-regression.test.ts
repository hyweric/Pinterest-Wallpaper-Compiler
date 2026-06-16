import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("resize handles render in an unclipped sibling overlay", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /className="selection-handles-overlay"/);
  assert.match(renderer, /<SelectionHandles layer=\{layer\} onBeginDrag=\{beginDrag\} \/>/);
  assert.doesNotMatch(renderer, /\{cropping && <span className="crop-mode-badge">CROP MODE<\/span>\}\s*\{selectedLayerId === layer\.id/);
});

test("resize dots have large hit targets while keeping compact visible markers", async () => {
  const styles = await source("src/renderer/styles.css");
  assert.match(styles, /\.selection-handles-overlay \{[\s\S]*pointer-events: none;/);
  assert.match(styles, /\.selection-handles-overlay \.resize-handle \{[\s\S]*width: 28px;[\s\S]*height: 28px;/);
  assert.match(styles, /\.selection-handles-overlay \.resize-handle::after \{[\s\S]*width: 12px;[\s\S]*height: 12px;/);
  assert.match(styles, /\.selection-handles-overlay \.resize-handle,[\s\S]*pointer-events: auto;/);
});

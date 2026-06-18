import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("wallpaper set cleanup is visible, destructive, and reports failures outside the modal", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /Clean Up Wallpaper Sets…/);
  assert.match(renderer, /Clean Up Folder…/);
  assert.match(renderer, /setMessage\(error\)/);
  assert.match(renderer, /The Wallpaper Sets folder is already empty/);
  assert.match(renderer, /Deleted all \$\{deleted\} item/);
});

test("native confirmation names the exact folder and every child type being erased", async () => {
  const main = await source("src/main/main.ts");
  assert.match(main, /every subfolder and every file stored inside them/);
  assert.match(main, /Folder:\\n\$\{rootPath\}/);
  assert.match(main, /The Wallpaper Sets folder itself will remain/);
  assert.match(main, /defaultId: 0/);
  assert.match(main, /cancelId: 0/);
});

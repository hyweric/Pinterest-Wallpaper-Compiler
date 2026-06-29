import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("Finder paths use Electron webUtils instead of deprecated File.path", async () => {
  const preload = await source("src/preload/index.ts");
  const renderer = await source("src/renderer/main.tsx");
  assert.match(preload, /webUtils\.getPathForFile\(file\)/);
  assert.match(renderer, /window\.wallpaperApi\.getPathForFile\(file\)/);
  assert.doesNotMatch(renderer, /File\s*&\s*\{\s*path\?:/);
});

test("main process validates every picker and Finder import through one service", async () => {
  const main = await source("src/main/main.ts");
  assert.match(main, /importValidatedLocalPaths/);
  assert.match(main, /ipcMain\.handle\("source:import-paths"[\s\S]*importValidatedLocalPaths\(paths\)/);
  assert.match(main, /dialog:choose-folder[\s\S]*importValidatedLocalPaths/);
  assert.match(main, /dialog:choose-image-files[\s\S]*importValidatedLocalPaths/);
  assert.match(main, /nativeImage\.createFromPath\(filePath\)/);
});

test("empty-canvas Finder and existing-source drops create positioned placeholders", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("async function handleCanvasDrop");
  const end = renderer.indexOf("async function handlePlaceholderDrop", start);
  const block = renderer.slice(start, end);
  assert.match(block, /canvasPointFromClient\(event\.clientX, event\.clientY\)/);
  assert.match(block, /placeSourcesAtCanvasPoint\(\[source\], point\)/);
  assert.match(block, /if \(paths\.length > 0\) await importDroppedPathsAtCanvasPoint\(paths, point\)/);
  assert.match(block, /else await placeWebImagesAtCanvasPoint\(webCandidates, point\)/);
  assert.doesNotMatch(block, /import reusable sources only/);
});

test("placeholder Finder drops assign all imported pools in shuffle mode", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /assignSourcesToLayer\(merged\.resolved, layer/);
  assert.match(renderer, /sourceIds: sources\.map\(\(source\) => source\.id\)/);
  assert.match(renderer, /mode: singleImage \? "fixed" : "shuffle"/);
});

test("drag feedback distinguishes sources, empty canvas, placeholders, and invalid items", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /Add folder as source/);
  assert.match(renderer, /Assign folder to this frame/);
  assert.match(renderer, /Release to place source here/);
  assert.match(renderer, /Release to create and select the frame here/);
  assert.doesNotMatch(renderer, /No placeholder will be created/);
  assert.match(renderer, /Unsupported files cannot be imported/);
  assert.doesNotMatch(renderer, /Folders become reusable pools/);
  assert.match(styles, /\.drop-feedback-overlay/);
  assert.match(styles, /\.placeholder\.drop-target/);
});

test("source reuse prefers canonical identity keys and existing image supersets", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /if \(source\.identityKey\) return source\.identityKey/);
  assert.match(renderer, /every\(\(item\) => currentPaths\.has\(item\)\)/);
  assert.match(renderer, /reusedIds\.add/);
});

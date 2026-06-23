import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), "utf8");

test("Phase 22.3.10.4 supports persistent pasted and dragged web image imports", async () => {
  const main = await source("src/main/main.ts");
  const preload = await source("src/preload/index.ts");
  const renderer = await source("src/renderer/main.tsx");
  assert.match(main, /persistentSourceCacheRoot\(\)[\s\S]*Source Cache/);
  assert.match(main, /persistentWebImportCacheRoot\(\)[\s\S]*Web Imports/);
  assert.match(main, /ipcMain\.handle\("source:import-web-image"/);
  assert.match(preload, /importWebImage/);
  assert.match(renderer, /window\.addEventListener\("paste", onPaste\)/);
  assert.match(renderer, /webImageCandidatesFromTransfer\(event\.dataTransfer\)/);
  assert.match(renderer, /placeWebImagesAtCanvasPoint\(webCandidates, point\)/);
});

test("Phase 22.3.10.4 removes the images-only UI and keeps video thumbnails eligible", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const project = await source("src/renderer/project.ts");
  const removedImagesOnlyLabel = ["Images", "only"].join(" ");
  const removedVideoNote = ["video", "thumbnails", "excluded"].join(" ");
  assert.equal(renderer.includes(removedImagesOnlyLabel), false);
  assert.equal(renderer.includes(removedVideoNote), false);
  assert.doesNotMatch(renderer, /Images \+ video thumbnails/);
  assert.doesNotMatch(renderer, /source-media-policy/);
  assert.match(project, /mediaPolicy: "images-and-video-thumbnails"/);
  assert.match(project, /image\.mediaType !== "video" \|\| image\.videoThumbnail !== false/);
});

test("Phase 22.3.10.4 applies Pin Paper branding and removes surface preview swatches", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  const pkg = await source("package.json");
  assert.match(pkg, /"productName": "Pin Paper"/);
  assert.match(renderer, /pinPaperIcon/);
  assert.match(renderer, /Wallpaper, made personal/);
  assert.match(renderer, /Wallpapers made out of collections you love/);
  const removedPlainBrand = `<div className="${["brand", "mark"].join("-")}">P</div>`;
  assert.equal(renderer.includes(removedPlainBrand), false);
  assert.equal(renderer.includes(["texture", "swatch"].join("-")), false);
  assert.match(styles, /home-slogan[\s\S]*white-space: nowrap/);
});

test("Phase 22.3.10.4 decouples torn image tearing from paper border and clips filters to the image area", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /FilterSlider label="Paper Border"/);
  assert.doesNotMatch(renderer, /tornPaper\.imageInset = base/);
  assert.match(styles, /placeholder-image-area \.texture-overlay[\s\S]*border-radius: inherit/);
  assert.match(styles, /placeholder-image-area \.texture-overlay[\s\S]*clip-path: inherit/);
});

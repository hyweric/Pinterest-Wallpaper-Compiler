import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(path, "utf8");

test("editor and exporter consume the same normalized expanded frame geometry", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const exporter = await source("src/renderer/exporter.ts");
  for (const implementation of [renderer, exporter]) {
    assert.match(implementation, /normalizePolaroidEffect/);
    assert.match(implementation, /normalizeTornPaperEffect/);
    assert.match(implementation, /paperFrameInsets\(paperFrame, layer\.width, layer\.height, polaroid, tornPaper\)/);
    assert.match(implementation, /paperFrameRotation\(paperFrame, polaroid\)/);
  }
  assert.match(renderer, /paperFrameClipPath\(paperFrame, tornPaper, layer\.width, layer\.height\)/);
  assert.match(exporter, /tornPaperPolygonPoints/);
});

test("expanded effect state participates in structured project cloning, undo, autosave, and template snapshots", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const project = await source("src/renderer/project.ts");
  assert.match(renderer, /return structuredClone\(project\)/);
  assert.match(renderer, /history.*past/s);
  assert.match(project, /layers: structuredClone\(project\.layers\)/);
  assert.match(project, /normalizePolaroidEffect\(layer\.effects\?\.polaroid/);
  assert.match(project, /normalizeTornPaperEffect\(layer\.effects\?\.tornPaper/);
});

test("legacy Paper Frame controls synchronize the new expanded effect structures during migration phase", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function patchPaperFrame(");
  const end = renderer.indexOf("function resetCrop", start);
  const patcher = renderer.slice(start, end);
  assert.match(patcher, /polaroid\.borderTop = base/);
  assert.doesNotMatch(patcher, /tornPaper\.imageInset = base/);
  assert.match(renderer, /FilterSlider label="Paper Border"/);
  assert.match(patcher, /polaroid\.frameColor = patch\.paperColor/);
  assert.match(patcher, /tornPaper\.edges = Object\.fromEntries/);
  assert.match(patcher, /tornPaper\.seed =/);
});

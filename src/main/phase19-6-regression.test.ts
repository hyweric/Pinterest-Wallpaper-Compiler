import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createPlaceholder, createProject, normalizeProject } from "../renderer/project.js";
import type { PaperFrameType } from "../shared/types.js";

const source = (path: string) => readFile(path, "utf8");

test("current Paper Frame styles survive normalization while legacy aliases merge into simplified styles", () => {
  const supported: PaperFrameType[] = ["none", "clean", "polaroid", "torn"];
  for (const type of supported) {
    const project = createProject();
    const layer = createPlaceholder(project.canvas, 1);
    layer.effects.paperFrame.type = type;
    project.layers = [layer];
    const normalized = normalizeProject(project);
    assert.equal(normalized.layers[0]?.effects.paperFrame.type, type, `Expected ${type} to survive normalization`);
    assert.equal(normalized.layers[0]?.effects.polaroid?.enabled, type === "polaroid");
    assert.equal(normalized.layers[0]?.effects.tornPaper?.enabled, type === "torn");
  }
});

test("legacy Paper Frame aliases still migrate to their current style names", () => {
  const aliases: Array<[string, PaperFrameType]> = [
    ["clean-paper", "clean"],
    ["photo-print", "clean"],
    ["torn-paper", "torn"],
    ["deckle-edge", "torn"],
    ["deckle", "torn"],
    ["newspaper-cutout", "clean"],
    ["newsprint", "clean"]
  ];
  for (const [legacy, expected] of aliases) {
    const project = createProject();
    const layer = createPlaceholder(project.canvas, 1);
    (layer.effects.paperFrame as { type: string }).type = legacy;
    project.layers = [layer];
    assert.equal(normalizeProject(project).layers[0]?.effects.paperFrame.type, expected);
  }
});

test("Polaroid photo manipulation is direct, isolated, and committed through undo history", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /function PolaroidDirectImageEditor/);
  assert.match(renderer, /polaroidImageDragRef/);
  assert.match(renderer, /event\.nativeEvent\.stopImmediatePropagation\(\)/);
  assert.match(renderer, /imageOffsetX: polaroidDrag\.effect\.imageOffsetX \+ local\.x/);
  assert.match(renderer, /polaroidScaleFromPointerDistance/);
  assert.match(renderer, /shortestAngleDelta/);
  assert.match(renderer, /past: \[\.\.\.stack\.past, polaroidDrag\.historyProject\]/);
  assert.match(styles, /\.polaroid-direct-image-editor/);
  assert.match(styles, /\.polaroid-image-scale-handle/);
  assert.match(styles, /\.polaroid-image-rotate-handle/);
});

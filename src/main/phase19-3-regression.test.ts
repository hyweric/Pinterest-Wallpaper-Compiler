import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(path, "utf8");

test("expanded Polaroid inspector exposes all requested collapsible sections and controls", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function PolaroidInspector(");
  const end = renderer.indexOf("function ShadowInspector(", start);
  const panel = renderer.slice(start, end);
  for (const section of ["Layout", "Photo Placement", "Frame", "Paper Surface", "Shadows", "Caption"]) {
    assert.match(panel, new RegExp(`<summary>${section}`));
  }
  for (const label of [
    "Top border", "Right border", "Bottom border", "Left border", "Caption area", "Image inset",
    "Crop mode", "Edit the photo directly on the canvas", "Drag inside the photo to move it",
    "Frame rotation", "Frame color", "Frame opacity", "Corner radius", "Paper grain", "Paper warmth",
    "Caption text", "Font", "Size", "Alignment", "Position X", "Position Y"
  ]) {
    assert.match(panel, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(panel, /Reset Polaroid/);
  assert.match(panel, /Reset Photo Placement/);
  assert.match(panel, /polaroid-direct-edit-note/);
  assert.match(panel, /Reset Caption/);
});

test("drop and inner shadow editors expose position, blur, spread, opacity, and color", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function ShadowInspector(");
  const end = renderer.indexOf("function FilterSlider(", start);
  const panel = renderer.slice(start, end);
  for (const control of [">X<", ">Y<", ">Blur<", ">Spread<", ">Opacity<", ">Color<"]) {
    assert.match(panel, new RegExp(control));
  }
  assert.match(renderer, /label="Drop shadow"/);
  assert.match(renderer, /label="Inner shadow"/);
});

test("editor and export both render Polaroid image transforms, warmth, caption, and shadows", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const exporter = await source("src/renderer/exporter.ts");
  assert.match(renderer, /scale: polaroid\.imageScale/);
  assert.match(renderer, /polaroid-caption/);
  assert.match(renderer, /paperWarmthOverlay\(polaroid\.warmth\)/);
  assert.match(renderer, /shadowToCss\(polaroid\.dropShadow\)/);
  assert.match(exporter, /imageTransform\.rotation/);
  assert.match(exporter, /polaroid\.caption\.text/);
  assert.match(exporter, /paperWarmthOverlay\(polaroid\.warmth\)/);
  assert.match(exporter, /applyCanvasShadow\(context, outerShadow\)/);
});

test("Polaroid patches are committed through the normal project undo path", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function patchPolaroid\(patch: Partial<PolaroidEffect>\)/);
  assert.match(renderer, /onPatch\(\{ effects: \{ \.\.\.activeLayer\.effects, polaroid:/);
  assert.match(renderer, /createDefaultPolaroidEffect/);
  assert.match(renderer, /structuredClone\(project\)/);
});

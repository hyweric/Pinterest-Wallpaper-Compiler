import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import {
  bundledTornPaperPresets,
  createDefaultPolaroidEffect,
  createDefaultTornPaperEffect,
  nextStableSeed,
  normalizePolaroidEffect,
  normalizeTornPaperEffect,
  polaroidInsets,
  tornPaperPolygonPoints,
  tornPaperTextureSvg
} from "../shared/frame-effects.js";
import { createPlaceholder, createProject, normalizeProject } from "../renderer/project.js";

const source = (path: string) => readFile(path, "utf8");

test("many customized Polaroid and Torn layers normalize and round-trip without sharing effect objects", () => {
  const project = createProject();
  project.canvas.width = 3840;
  project.canvas.height = 2160;
  project.layers = Array.from({ length: 60 }, (_, index) => {
    const layer = createPlaceholder(project.canvas, index);
    if (index % 2 === 0) {
      layer.effects.paperFrame.type = "polaroid";
      layer.effects.polaroid = normalizePolaroidEffect({
        ...createDefaultPolaroidEffect({ ...layer.effects.paperFrame, type: "polaroid" }),
        enabled: true,
        borderTop: 10 + index,
        borderBottom: 40 + index,
        imageScale: 1 + index / 100,
        caption: { enabled: true, text: `Caption ${index}`, fontSize: 18 + index % 12 }
      });
    } else {
      layer.effects.paperFrame.type = "torn";
      layer.effects.tornPaper = normalizeTornPaperEffect({
        ...createDefaultTornPaperEffect({ ...layer.effects.paperFrame, type: "torn" }),
        enabled: true,
        seed: 1000 + index,
        presetId: bundledTornPaperPresets[index % bundledTornPaperPresets.length].id,
        fibers: index % 100,
        wrinkles: (index * 2) % 100,
        stains: (index * 3) % 100,
        speckles: (index * 4) % 100
      });
    }
    return layer;
  });

  const start = performance.now();
  const normalized = normalizeProject(JSON.parse(JSON.stringify(project)));
  const duration = performance.now() - start;
  assert.equal(normalized.layers.length, 60);
  assert.ok(duration < 2_000, `normalization took ${duration.toFixed(1)} ms`);
  assert.notEqual(normalized.layers[0].effects.polaroid, normalized.layers[2].effects.polaroid);
  assert.notEqual(normalized.layers[1].effects.tornPaper, normalized.layers[3].effects.tornPaper);
  assert.equal(normalized.layers[0].effects.polaroid?.caption.text, "Caption 0");
  assert.equal(normalized.layers[59].effects.tornPaper?.seed, 1059);
});

test("stable effect geometry and texture details survive restart-style serialization", () => {
  const torn = normalizeTornPaperEffect({
    ...createDefaultTornPaperEffect(),
    seed: 932814,
    fibers: 78,
    wrinkles: 62,
    stains: 41,
    speckles: 55,
    edgeDarkening: 44
  });
  const reloaded = normalizeTornPaperEffect(JSON.parse(JSON.stringify(torn)));
  assert.deepEqual(tornPaperPolygonPoints(reloaded, 1600, 1000), tornPaperPolygonPoints(torn, 1600, 1000));
  assert.equal(tornPaperTextureSvg(reloaded, 1600, 1000), tornPaperTextureSvg(torn, 1600, 1000));
  assert.notDeepEqual(tornPaperPolygonPoints({ ...torn, seed: nextStableSeed(torn.seed) }, 1600, 1000), tornPaperPolygonPoints(torn, 1600, 1000));
});

test("4K Polaroid and Torn render geometry remains finite and procedural texture output stays bounded", () => {
  const polaroid = normalizePolaroidEffect({
    ...createDefaultPolaroidEffect(),
    enabled: true,
    borderTop: 120,
    borderRight: 90,
    borderBottom: 300,
    borderLeft: 90,
    captionHeight: 180,
    imageInset: 25
  });
  const insets = polaroidInsets(polaroid, 3840, 2160);
  assert.ok(Object.values(insets).every(Number.isFinite));
  assert.ok(insets.left + insets.right < 3840);
  assert.ok(insets.top + insets.bottom < 2160);

  const torn = normalizeTornPaperEffect({ ...createDefaultTornPaperEffect(), seed: 44, fibers: 100, wrinkles: 100, stains: 100, speckles: 100, edgeDarkening: 100 });
  const polygon = tornPaperPolygonPoints(torn, 3840, 2160);
  const svg = tornPaperTextureSvg(torn, 3840, 2160);
  assert.ok(polygon.length < 1_500);
  assert.ok(svg.length < 2_000_000);
  assert.ok(polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("editor and export retain one shared expanded-effect geometry and detail implementation", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const exporter = await source("src/renderer/exporter.ts");
  const paper = await source("src/shared/paper.ts");
  for (const token of ["normalizePolaroidEffect", "normalizeTornPaperEffect", "paperFrameInsets", "paperFrameRotation"]) {
    assert.match(renderer, new RegExp(token));
    assert.match(exporter, new RegExp(token));
  }
  assert.match(renderer, /paperFrameClipPath/);
  assert.match(renderer, /tornPaperTextureDataUrl/);
  assert.match(exporter, /tornPaperTextureDataUrl/);
  assert.match(paper, /tornPaperPolygonPoints/);
});

test("Phase 19 retains simplified inspector and wallpaper assignment while exposing both expanded effects", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.doesNotMatch(renderer, />Clear</);
  assert.doesNotMatch(renderer, />Apply to</);
  assert.doesNotMatch(renderer, /<summary>Diagnostics/);
  assert.match(renderer, /Wallpaper Rotation/);
  assert.match(renderer, /function PolaroidInspector/);
  assert.match(renderer, /function TornPaperInspector/);
});

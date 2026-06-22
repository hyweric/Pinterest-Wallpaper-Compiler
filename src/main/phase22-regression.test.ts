import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ImageSource, PlaceholderLayer, WallpaperProject } from "../shared/types.js";
import { selectImagesForGeneration } from "../shared/source-selection.js";
import { surfaceDefaultsForType } from "../shared/surfaces.js";

function source(id: string, count: number): ImageSource {
  return {
    id,
    name: id,
    type: "local-folder",
    path: `/${id}`,
    providerId: "local-folder",
    images: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      name: `${index}.jpg`,
      path: `/${id}/${index}.jpg`,
      url: `file:///${id}/${index}.jpg`,
      mediaType: "image"
    })),
    mediaPolicy: "images-only",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function layer(id: string, sourceId: string): PlaceholderLayer {
  return {
    id,
    type: "placeholder",
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    cropMode: "cover",
    alignment: "center",
    borderWidth: 0,
    borderColor: "#fff",
    borderOpacity: 1,
    borderRadius: 24,
    maskShape: "rounded",
    shadow: false,
    opacity: 1,
    locked: false,
    hidden: false,
    keepAspectRatio: false,
    crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    effects: {} as PlaceholderLayer["effects"],
    sourceId,
    sourceState: { sourceIds: [sourceId], mode: "shuffle", currentIndex: 0, shuffleQueue: [], usedImageIds: [], preventDuplicates: true, includeSubfolders: false }
  };
}

function project(sources: ImageSource[], layers: PlaceholderLayer[]): WallpaperProject {
  return { sources, layers } as WallpaperProject;
}

const zero = () => 0;

test("Phase 22 compacts the image inspector, simplifies torn controls, and cleans the surface panel", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const styles = await readFile(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");

  assert.match(renderer, /summary>Border and Shape[\s\S]*summary>Adjustments[\s\S]*summary>Frame Position[\s\S]*summary>Fit and Crop/s);
  assert.doesNotMatch(renderer, /summary>Source <ChevronDown/);
  assert.doesNotMatch(renderer, /WallpaperPanel project=/);
  assert.match(renderer, /FilterSlider label="Tearness"/);
  assert.doesNotMatch(renderer, /Link all edges/);
  assert.doesNotMatch(renderer, /Texture seed/);
  assert.doesNotMatch(renderer, /Enable surface texture/);
  assert.match(renderer, /surface-action-row/);
  assert.match(renderer, /className={`source-row /);
  assert.match(renderer, /selection-marquee/);
  assert.match(renderer, /LayerOrderIcon direction="up"/);
  assert.match(renderer, /LayerOrderIcon direction="down"/);
  assert.match(styles, /accent-color: #8db7c1/);
  assert.match(styles, /panel-tabs\.inspector-tabs button\.active/);
});

test("Phase 22 still avoids duplicate shared-source images across a wallpaper until unique choices are exhausted", () => {
  const first = selectImagesForGeneration(project([source("board", 3)], [
    layer("a", "board"),
    layer("b", "board"),
    layer("c", "board"),
    layer("d", "board"),
    layer("e", "board")
  ]), zero);

  const assignments = Object.values(first.assignments);
  assert.equal(new Set(assignments.slice(0, 3)).size, 3);
  assert.equal(assignments.length, 5);
});

test("Phase 22 surface defaults are tuned for paper and crumpled paper", () => {
  assert.deepEqual(surfaceDefaultsForType("paper"), {
    intensity: 92,
    scale: 0.24,
    rotation: 0,
    opacity: 0.54,
    blendMode: "normal",
    noise: 82,
    roughness: 76,
    tone: 10
  });
  assert.deepEqual(surfaceDefaultsForType("crumpled-paper"), {
    intensity: 74,
    scale: 0.24,
    rotation: 24,
    opacity: 0.32,
    blendMode: "normal",
    noise: 72,
    roughness: 88,
    tone: 7
  });
});

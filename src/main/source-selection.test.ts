import test from "node:test";
import assert from "node:assert/strict";
import type { ImageSource, PlaceholderLayer, WallpaperProject } from "../shared/types.js";
import { selectImagesForGeneration } from "../shared/source-selection.js";

function source(id: string, count: number): ImageSource {
  return {
    id, name: id, type: "local-folder", path: `/${id}`, providerId: "local-folder",
    images: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, name: `${index}.jpg`, path: `/${id}/${index}.jpg`, url: `file:///${id}/${index}.jpg`, mediaType: "image" })),
    mediaPolicy: "images-only", updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function layer(id: string, sourceId: string, mode: "shuffle" | "random" | "fixed" = "shuffle"): PlaceholderLayer {
  return {
    id, type: "placeholder", name: id, x: 0, y: 0, width: 100, height: 100, rotation: 0,
    cropMode: "cover", alignment: "center", borderWidth: 0, borderColor: "#fff", borderOpacity: 1,
    borderRadius: 0, maskShape: "rectangle", shadow: false, opacity: 1, locked: false, hidden: false,
    keepAspectRatio: false, crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    effects: {} as PlaceholderLayer["effects"], sourceId,
    sourceState: { sourceIds: [sourceId], mode, currentIndex: 0, shuffleQueue: [], usedImageIds: [], preventDuplicates: true, includeSubfolders: false }
  };
}

function project(sources: ImageSource[], layers: PlaceholderLayer[]): WallpaperProject {
  return { sources, layers } as WallpaperProject;
}

const zero = () => 0;

test("shared source queue gives unique images to placeholders in one generation", () => {
  const result = selectImagesForGeneration(project([source("board", 5)], [layer("a", "board"), layer("b", "board"), layer("c", "board")]), zero);
  assert.equal(new Set(Object.values(result.assignments)).size, 3);
});

test("queue continues across generations and persists on the source", () => {
  const first = selectImagesForGeneration(project([source("board", 4)], [layer("a", "board")]), zero);
  const second = selectImagesForGeneration(first.project, zero);
  assert.notEqual(first.assignments.a, second.assignments.a);
  assert.ok(second.project.sources[0].selectionState);
});

test("fixed placeholders do not consume the source shuffle queue", () => {
  const s = source("board", 3);
  const fixed = { ...layer("fixed", "board", "fixed"), selectedImageId: "board-0" };
  const shuffled = layer("shuffle", "board");
  const result = selectImagesForGeneration(project([s], [fixed, shuffled]), zero);
  assert.equal(result.assignments.fixed, "board-0");
  assert.notEqual(result.assignments.shuffle, "board-0");
  assert.equal(result.project.sources[0].selectionState?.shuffleQueue.length, 2);
});

test("reuse occurs deterministically only when placeholders outnumber images", () => {
  const result = selectImagesForGeneration(project([source("small", 2)], [layer("a", "small"), layer("b", "small"), layer("c", "small")]), zero);
  assert.equal(new Set([result.assignments.a, result.assignments.b]).size, 2);
  assert.ok(result.assignments.c);
});

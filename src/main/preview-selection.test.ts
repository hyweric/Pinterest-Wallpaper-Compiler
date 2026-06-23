import test from "node:test";
import assert from "node:assert/strict";
import type { ImageSource, PlaceholderLayer, WallpaperProject } from "../shared/types.js";
import { advancePreviewProjectImages } from "../shared/preview-selection.js";

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
    mediaPolicy: "images-and-video-thumbnails",
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
    borderRadius: 0,
    maskShape: "rectangle",
    shadow: false,
    opacity: 1,
    locked: false,
    hidden: false,
    keepAspectRatio: false,
    crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    effects: {} as PlaceholderLayer["effects"],
    sourceId,
    sourceState: {
      sourceIds: [sourceId],
      mode: "shuffle",
      currentIndex: 0,
      shuffleQueue: [],
      usedImageIds: [],
      preventDuplicates: true,
      includeSubfolders: false
    }
  };
}

function project(sources: ImageSource[], layers: PlaceholderLayer[]): WallpaperProject {
  return { sources, layers } as WallpaperProject;
}

const zero = () => 0;

test("current desktop preview randomizes beyond the first alternative instead of bouncing between two images", () => {
  let current = project([source("board", 4)], [layer("a", "board")]);
  const seen: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    current = advancePreviewProjectImages(current, zero);
    seen.push(current.layers[0].generatedImageId!);
  }
  assert.equal(new Set(seen).size, 4);
});

test("current desktop preview avoids duplicate images across placeholders in one click", () => {
  const current = project([source("board", 5)], [layer("a", "board"), layer("b", "board"), layer("c", "board")]);
  const result = advancePreviewProjectImages(current, zero);
  const ids = result.layers.map((item) => item.generatedImageId!);
  assert.equal(new Set(ids).size, ids.length);
});

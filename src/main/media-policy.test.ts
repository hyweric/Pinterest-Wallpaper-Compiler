import test from "node:test";
import assert from "node:assert/strict";
import { getImageForLayer, sourceImagesForPolicy } from "../renderer/project.js";
import { classifyPinterestMetadata } from "./providers.js";
import { classifyLocalMediaPath } from "../shared/media.js";
import type { ImageSource, SourceMediaPolicy } from "../shared/types.js";

function source(mediaPolicy: SourceMediaPolicy): ImageSource {
  return {
    id: "mixed",
    name: "Mixed media",
    type: "pinterest-board",
    url: "https://www.pinterest.com/example/board/",
    images: [
      { id: "image-1", name: "Still 1", path: "/cache/still-1.jpg", url: "file:///cache/still-1.jpg", mediaType: "image" },
      { id: "image-2", name: "Still 2", path: "/cache/still-2.webp", url: "file:///cache/still-2.webp", mediaType: "image" },
      { id: "video-thumb", name: "Video thumbnail", path: "/cache/video.jpg", url: "file:///cache/video.jpg", mediaType: "video", videoThumbnail: true },
      { id: "video-no-thumb", name: "Video without thumbnail", path: "/cache/video.mp4", url: "file:///cache/video.mp4", mediaType: "video", videoThumbnail: false },
      { id: "unknown", name: "Unknown", path: "/cache/unknown.bin", url: "file:///cache/unknown.bin", mediaType: "unknown" }
    ],
    mediaPolicy,
    mediaCounts: { total: 5, images: 2, videos: 2, unknown: 1 },
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

test("images-only excludes all video items", () => {
  assert.deepEqual(sourceImagesForPolicy(source("images-only")).map((image) => image.id), ["image-1", "image-2"]);
});

test("images-and-video-thumbnails includes usable thumbnails but not raw video", () => {
  assert.deepEqual(sourceImagesForPolicy(source("images-and-video-thumbnails")).map((image) => image.id), ["image-1", "image-2", "video-thumb"]);
});

test("policy-aware render lookup excludes stale video assignments", () => {
  const project = {
    sources: [source("images-only")],
    layers: []
  };
  const layer = {
    sourceId: "mixed",
    generatedImageId: "video-thumb",
    sourceState: { sourceIds: ["mixed"] }
  };
  assert.equal(getImageForLayer(project as unknown as Parameters<typeof getImageForLayer>[0], layer as unknown as Parameters<typeof getImageForLayer>[1]), undefined);
});

test("Pinterest media classification recognizes image, video, story, and unknown pins", () => {
  assert.equal(classifyPinterestMetadata({ media_type: "image", images: { "1200x": { url: "https://example.com/a.jpg" } } }), "image");
  assert.equal(classifyPinterestMetadata({ media_type: "video", images: { "1200x": { url: "https://example.com/v.jpg" } } }), "video");
  assert.equal(classifyPinterestMetadata({ story_pin_data: {}, images: { "1200x": { url: "https://example.com/s.jpg" } } }), "video");
  assert.equal(classifyPinterestMetadata({ id: "unknown" }), "unknown");
});

test("local file classifier detects video extensions and unknown files", () => {
  assert.equal(classifyLocalMediaPath("/tmp/photo.webp"), "image");
  assert.equal(classifyLocalMediaPath("/tmp/movie.mov"), "video");
  assert.equal(classifyLocalMediaPath("/tmp/blob"), "unknown");
});

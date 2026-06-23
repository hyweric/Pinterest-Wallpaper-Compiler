import test from "node:test";
import assert from "node:assert/strict";
import { sourceImagesForPolicy } from "../renderer/project.js";
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
      { id: "video-no-thumb", name: "Video without thumbnail", path: "/cache/video.mp4", url: "file:///cache/video.mp4", mediaType: "video", videoThumbnail: false }
    ],
    mediaPolicy,
    mediaCounts: { total: 4, images: 2, videos: 2 },
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

test("legacy images-only policy is normalized to include usable video thumbnails", () => {
  assert.deepEqual(sourceImagesForPolicy(source("images-only")).map((image) => image.id), ["image-1", "image-2", "video-thumb"]);
});

test("images-and-video-thumbnails includes usable thumbnails but not raw video", () => {
  assert.deepEqual(sourceImagesForPolicy(source("images-and-video-thumbnails")).map((image) => image.id), ["image-1", "image-2", "video-thumb"]);
});


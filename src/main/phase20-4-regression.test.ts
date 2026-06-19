import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createDefaultSourceState, createPlaceholder, createProject, selectImageForLayer } from "../renderer/project.js";
import type { ImageSource } from "../shared/types.js";

test("Phase 20.4 dropped transparent sources are not forced into fixed mode", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const placeBlock = renderer.match(/async function placeSourcesAtCanvasPoint[\s\S]*?async function importDroppedPathsAtCanvasPoint/)?.[0] ?? "";
  assert.match(placeBlock, /const overlayLike = sourceLooksLikeTransparentOverlay\(source\)/);
  assert.match(placeBlock, /next = assigned;/);
  assert.doesNotMatch(placeBlock, /mode: "fixed" as const/);
  assert.doesNotMatch(placeBlock, /preventDuplicates: false/);
});

test("Phase 20.4 next image cycles a transparent dropped source like a normal placeholder", () => {
  const project = createProject();
  const source: ImageSource = {
    id: "source-transparent-set",
    providerId: "local-file",
    type: "local-file",
    name: "Transparent Stickers",
    images: [
      { id: "image-a", name: "a.png", path: "/tmp/a.png", url: "file:///tmp/a.png", mediaType: "image" },
      { id: "image-b", name: "b.png", path: "/tmp/b.png", url: "file:///tmp/b.png", mediaType: "image" }
    ],
    importStatus: "ready",
    mediaPolicy: "images-only",
    mediaCounts: { total: 2, images: 2, videos: 0 },
    updatedAt: "now"
  };
  const layer = {
    ...createPlaceholder(project.canvas, 1),
    sourceId: source.id,
    sourceState: {
      ...createDefaultSourceState(),
      sourceIds: [source.id],
      mode: "shuffle" as const,
      shuffleQueue: ["image-a", "image-b"],
      preventDuplicates: true
    }
  };
  const first = selectImageForLayer({ ...project, sources: [source], layers: [layer] }, layer, new Set());
  assert.equal(first.imageId, "image-a");
  assert.equal(first.layer.sourceState.mode, "shuffle");
  const second = selectImageForLayer({ ...project, sources: [source], layers: [first.layer] }, first.layer, new Set());
  assert.equal(second.imageId, "image-b");
  assert.notEqual(second.imageId, first.imageId);
});

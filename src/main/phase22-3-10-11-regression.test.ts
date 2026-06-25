import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), "utf8");

test("Phase 22.3.10.11 restores fixed-shape fill immediately after Adaptive Aspect", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf("function patchFrameMode");
  const end = renderer.indexOf("function patchSimpleDropShadow", start);
  const block = renderer.slice(start, end);
  assert.match(block, /frameMode === "adaptive"/);
  assert.match(block, /cropMode: "contain"/);
  assert.match(block, /frameMode: "fixed", cropMode: "cover", alignment: "center", crop: \{ offsetX: 0, offsetY: 0, zoom: 1 \}/);
});

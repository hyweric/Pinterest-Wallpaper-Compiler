import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), "utf8");

test("export clips Polaroid frame texture to the visible paper frame", async () => {
  const exporter = await source("src/renderer/exporter.ts");
  const start = exporter.indexOf("if (frameTextureIntensity > 0)");
  const end = exporter.indexOf("const warmth =", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const textureBlock = exporter.slice(start, end);

  assert.match(textureBlock, /context\.save\(\)/);
  assert.match(textureBlock, /roughPaperPath\(/);
  assert.match(textureBlock, /context\.clip\(\)/);
  assert.match(textureBlock, /await drawSurfaceTexture\(/);
  assert.match(textureBlock, /context\.restore\(\)/);

  assert.ok(
    textureBlock.indexOf("context.clip()") <
      textureBlock.indexOf("await drawSurfaceTexture"),
    "The paper-frame clip must be active before drawing its texture."
  );
});

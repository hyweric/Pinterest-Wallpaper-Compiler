import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const renderer = resolve("src/renderer/main.tsx");
const project = resolve("src/renderer/project.ts");
const styles = resolve("src/renderer/styles.css");

test("Phase 28.5 exposes Add Object with frame and text without placeholder wording", async () => {
  const source = await readFile(renderer, "utf8");
  assert.match(source, /Add Object/);
  assert.match(source, />Frame/);
  assert.match(source, />Text/);
  assert.doesNotMatch(source, /Add Placeholder/);
});

test("Phase 28.5 creates persistent text layers and preserves custom current size", async () => {
  const source = await readFile(project, "utf8");
  const rendererSource = await readFile(renderer, "utf8");
  assert.match(source, /objectKind:\s*"text"/);
  assert.match(source, /fontSize/);
  assert.match(rendererSource, /if \(id === "custom"\)/);
  assert.match(rendererSource, /presetId:\s*"custom"/);
});

test("Phase 28.5 compacts source cards and raises toolbar menus", async () => {
  const css = await readFile(styles, "utf8");
  assert.match(css, /source-detail-card[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /toolbar-overflow,[\s\S]*add-object-menu[\s\S]*z-index:\s*10000/);
  assert.match(css, /text-layer-content/);
});

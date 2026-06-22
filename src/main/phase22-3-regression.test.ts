import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("phase 22.3 normal source drops use fill while only managed overlays use contain", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /import \{ imageBackgroundColor, sourceIsManagedOverlay \} from "\.\.\/shared\/image-transparency"/);
  assert.match(renderer, /const overlayLike = sourceIsManagedOverlay\(source\)/);
  assert.match(renderer, /Object\.assign\(layer, placement, \{ name: source\.name, cropMode: "cover" as const, maskShape: "rounded" as const \}\)/);
  assert.match(renderer, /cropMode: overlayLike \? "contain" as const : "cover" as const/);
  assert.match(renderer, /crop: \{ offsetX: 0, offsetY: 0, zoom: 1 \}/);
  assert.match(renderer, /alignment: "center" as const/);
});

test("phase 22.3.1 quick canvas toolbar is compact but keeps layer controls", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const styles = await readFile(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
  assert.match(renderer, /className="context-toolbar compact-context-toolbar"/);
  assert.match(renderer, /aria-label="Layer controls"/);
  assert.match(renderer, /aria-label="Move layer up"/);
  assert.match(renderer, /aria-label="Move layer down"/);
  assert.match(renderer, /aria-label="Duplicate layer"/);
  assert.doesNotMatch(renderer.match(/function ContextToolbar[\s\S]*?function CropToolbar/)?.[0] ?? "", /aria-label="Lock layer"/);
  assert.doesNotMatch(renderer, /<button disabled=\{layer\.locked\} onClick=\{\(\) => onPatch\(\{ crop: \{ offsetX: 0, offsetY: 0, zoom: 1 \}, cropMode: "original"/);
  assert.match(styles, /\.context-toolbar\.compact-context-toolbar \{[\s\S]*max-width: min\(560px, calc\(100vw - 56px\)\)/);
  assert.match(styles, /\.workspace-fixed-controls \{[\s\S]*width: auto;/);
});

test("phase 22.3.1 effects tab removes the extra frame style section but keeps simple frame controls", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /<summary>Paper <ChevronDown size=\{15\} \/><\/summary>/);
  assert.doesNotMatch(renderer, /<summary>Frame Style <ChevronDown size=\{15\} \/><\/summary>/);
  assert.match(renderer, /<summary>Shadow and Blend <ChevronDown size=\{15\} \/><\/summary>/);
  assert.match(renderer, /<PolaroidInspector/);
  assert.match(renderer, /<TornPaperInspector/);
  assert.doesNotMatch(renderer, /Choose Clean Paper, Polaroid, or Torn Paper to show frame controls/);
});

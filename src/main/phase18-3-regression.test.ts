import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("resize controls isolate pointerdown from the layer move gesture", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function startControlDrag\(event: PointerEvent, mode: DragMode\)/);
  assert.match(renderer, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*event\.nativeEvent\.stopImmediatePropagation\(\);/);
  assert.match(renderer, /onPointerDown=\{\(event\) => startControlDrag\(event, handle\)\}/);
  assert.match(renderer, /resizeRectAroundCenter\(/);
  assert.doesNotMatch(renderer, /function resizeLayer[\s\S]*x \+= dx;[\s\S]*width -= dx;/);
});

test("Add Source transitions from plus to a down chevron while expanded", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /className=\{`add-source-trigger-icon \$\{open \? "open" : ""\}`\}/);
  assert.match(renderer, /className="add-source-trigger-plus"/);
  assert.match(renderer, /className="add-source-trigger-chevron"/);
  assert.match(styles, /\.add-source-trigger-icon > svg \{[\s\S]*transition: opacity 140ms ease, transform 160ms ease;/);
  assert.match(styles, /\.add-source-trigger-icon\.open \.add-source-trigger-plus \{[\s\S]*opacity: 0;/);
  assert.match(styles, /\.add-source-trigger-icon\.open \.add-source-trigger-chevron \{[\s\S]*opacity: 1;/);
});

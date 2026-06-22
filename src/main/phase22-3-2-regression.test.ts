import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("Phase 22.3.2 Add Placeholder no longer has a second backing rectangle", async () => {
  const css = await source("src/renderer/styles.css");
  assert.match(css, /Phase 22\.3\.2: remove the extra backing rectangle behind Add Placeholder/);
  assert.match(css, /\.minimal-toolbar \.toolbar-create-actions \{[\s\S]*background: transparent !important/);
  assert.match(css, /\.minimal-toolbar \.toolbar-create-actions \.compact-top-action \{[\s\S]*background: rgba\(255, 255, 255, 0\.86\)/);
});

test("Phase 22.3.2 constrained numbers allow typing before soft validation", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /function SoftNumberInput/);
  assert.match(renderer, /notifySoftNumberConstraint\(`At least/);
  assert.match(renderer, /type="text"/);
  assert.match(renderer, /inputMode="decimal"/);
  assert.ok(renderer.includes('<SoftNumberInput value={draftWidth} min={64} onCommit={changeWidth}'));
  assert.ok(renderer.includes('<SoftNumberInput value={state.count} min={1} max={500}'));
  assert.doesNotMatch(renderer, /Variations<input type="number" min="1" max="500"/);
  assert.match(renderer, /soft-number-notice/);
});

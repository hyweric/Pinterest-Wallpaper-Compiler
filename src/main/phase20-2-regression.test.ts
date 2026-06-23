import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Phase 20.2 keeps unassigned placeholders neutral and removes the Add Overlay button", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /const hasAssignedImage = Boolean\(image\)/);
  assert.match(renderer, /const visualPaperActive = hasAssignedImage && paperFrame\.type !== "none"/);
  assert.match(renderer, /!hasAssignedImage \? "unassigned" : ""/);
  assert.doesNotMatch(renderer, /<button[^>]*>[^<]*Add Overlay/);
});

test("Phase 20.2 restyles active background tabs, surface cards, sliders, and scrollable menus", async () => {
  const styles = await readFile(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
  assert.match(styles, /\.sidebar\.right \.segmented-control\.two-options button\.active \{[\s\S]*background: #dfeef0/);
  assert.match(styles, /compact-texture-grid \.texture-choice \{[\s\S]*min-height: 44px/);
  assert.match(styles, /\.filter-slider input\[type="range"\]::-webkit-slider-runnable-track[\s\S]*height: 3px/);
  assert.match(styles, /\.popover-menu,[\s\S]*\.add-source-menu \{[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.placeholder\.unassigned \{[\s\S]*rgba\(229, 230, 228, 0\.78\)/);
});

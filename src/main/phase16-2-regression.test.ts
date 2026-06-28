import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("the Sources header exposes one labeled Add Source control instead of three icon buttons", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const start = renderer.indexOf('<div className="library-heading add-source-heading">');
  const end = renderer.indexOf('<div className="source-tabs"', start);
  const heading = renderer.slice(start, end);

  assert.match(heading, /<AddSourceControl/);
  assert.match(heading, /onAddFolder=\{\(\) => void addFolderSource\(\)\}/);
  assert.match(heading, /onAddImages=\{\(\) => void addLocalImagesSource\(\)\}/);
  assert.match(heading, /onAddPinterest=/);
  assert.doesNotMatch(heading, /Add folder pool/);
  assert.doesNotMatch(heading, /Add local image collection/);
  assert.doesNotMatch(heading, /className="compact-actions"/);
});

test("Add Source menu keeps every existing source workflow with visible labels and descriptions", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /<span>Add Source<\/span>/);
  assert.match(renderer, /label: "Local Folder"/);
  assert.match(renderer, /description: "Use images from a folder"/);
  assert.match(renderer, /label: "Local Images"/);
  assert.match(renderer, /description: "Select one or more image files"/);
  assert.match(renderer, /label: "Pinterest Board"/);
  assert.match(renderer, /description: "Import images from a board"/);
  assert.match(renderer, /action: onAddFolder/);
  assert.match(renderer, /action: onAddImages/);
  assert.match(renderer, /action: onAddPinterest/);
});

test("Add Source menu supports click toggling, outside clicks, and keyboard navigation without hover-opening", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");

  assert.match(renderer, /window\.setTimeout\([\s\S]*?, 220\)/);
  assert.doesNotMatch(renderer, /onPointerEnter=\{scheduleOpen\}/);
  assert.match(renderer, /onPointerLeave=\{scheduleClose\}/);
  assert.match(renderer, /document\.addEventListener\("pointerdown", outsidePointer, true\)/);
  assert.match(renderer, /aria-haspopup="menu"/);
  assert.match(renderer, /aria-expanded=\{open\}/);
  assert.match(renderer, /role="menu"/);
  assert.match(renderer, /role="menuitem"/);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) {
    assert.match(renderer, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(styles, /\.add-source-menu-item:focus-visible/);
});

test("Add Source menu is portaled and clamped inside the application viewport", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");

  assert.match(renderer, /createPortal\(/);
  assert.match(renderer, /buttonRef\.current\.getBoundingClientRect\(\)/);
  assert.match(renderer, /menuRef\.current\.getBoundingClientRect\(\)/);
  assert.match(renderer, /window\.innerWidth - menu\.width - margin/);
  assert.match(renderer, /window\.innerHeight - menu\.height - margin/);
  assert.match(styles, /\.add-source-menu \{[\s\S]*position: fixed;/);
  assert.match(styles, /z-index: 100010/);
});

test("Settings is shown only by the inspector tab and not repeated inside the panel", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /\[ \["settings", "Settings"\] \]/);
  assert.equal(renderer.match(/<h2>Settings<\/h2>/g)?.length ?? 0, 0);
  assert.match(renderer, /<summary>Canvas /);
  assert.match(renderer, /<summary>Background /);
  assert.match(renderer, /<summary>Surface /);
  assert.doesNotMatch(renderer, /<h2>Settings<\/h2>/);
});

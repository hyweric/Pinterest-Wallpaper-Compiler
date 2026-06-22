import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("current desktop preview resolves assigned source pools before rendering", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const previewStart = renderer.indexOf("async function previewOnCurrentDesktop()");
  const historyStart = renderer.indexOf("async function applyHistoryAt", previewStart);
  const preview = renderer.slice(previewStart, historyStart);

  assert.doesNotMatch(preview, /advancePreviewProjectImages\(previewBase\)/);
  assert.match(preview, /prepareGeneratedProject\(previewBase, previewBase\.templates\.activeTemplateId\)/);
  assert.match(preview, /applyCandidate\(normalizeProject\(prepared\.project\), prepared\.combination/);
  assert.match(preview, /targetMode: "current-desktop"/);
  assert.match(preview, /scope: "current-desktop"/);
  assert.doesNotMatch(preview, /createCombination\(assignments/);
});

test("current desktop apply falls back to System Events and stops folder rotation", async () => {
  const wallpaper = await source("src/main/wallpaper.ts");

  assert.match(wallpaper, /macos-system-events-apply-current-desktop/);
  assert.match(wallpaper, /set picture rotation to 0/);
  assert.match(wallpaper, /set random order to false/);
  assert.match(wallpaper, /set picture to requestedPath/);
  assert.match(wallpaper, /mode === "current-desktop"/);
  assert.match(wallpaper, /applyMacCurrentDesktopWithSystemEvents/);
  assert.match(wallpaper, /System Events current visible desktop picture/);
});


test("automation denial provides an actionable preview error", async () => {
  const main = await source("src/main/main.ts");
  assert.match(main, /Privacy & Security > Automation/);
  assert.match(main, /then try Preview again/);
});

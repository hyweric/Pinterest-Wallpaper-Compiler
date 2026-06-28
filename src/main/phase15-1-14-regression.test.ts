import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("current-desktop preview is explicit and never follows the saved all-Space target", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /Preview on Current Desktop/);
  assert.match(renderer, /async function previewOnCurrentDesktop/);
  assert.match(renderer, /targetMode: "current-desktop"/);
  assert.match(renderer, /scope: "current-desktop"/);
  assert.match(renderer, /monitorMode: "primary"/);
  assert.match(renderer, /Previewed on current desktop/);
});

test("app scheduling controls and tray rotation commands are removed", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const main = await source("src/main/main.ts");
  assert.doesNotMatch(renderer, /<summary>Schedule/);
  assert.doesNotMatch(renderer, /SingleRunScheduler/);
  assert.doesNotMatch(main, /Pause Rotation|Resume Rotation|Current interval:|Next update:/);
  assert.match(main, /Preview on Current Desktop/);
  assert.match(renderer, /Create a Wallpaper Set, then choose that folder in macOS Wallpaper Settings/);
});

test("wallpaper settings opens only from the explicit setup button", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const main = await source("src/main/main.ts");
  const types = await source("src/shared/types.ts");
  assert.match(renderer, /Open Wallpaper Settings/);
  assert.match(renderer, /Open Wallpaper Settings/);
  assert.match(renderer, /Wallpaper Set Ready/);
  assert.match(renderer, /finalizeExportSet\(\{ sessionId \}\)/);
  assert.doesNotMatch(types, /openWallpaperSettings: boolean/);
  assert.doesNotMatch(types, /revealInFinder: boolean/);
  assert.doesNotMatch(main, /payload\.openWallpaperSettings|payload\.revealInFinder/);
  assert.match(main, /export-set:open-wallpaper-settings/);
});

test("setup dialog keeps the exact folder path and readable numbered instructions", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /Folder to select/);
  assert.match(renderer, /setup-step-number/);
  assert.match(renderer, /Show Set in Finder/);
  assert.match(renderer, /Click Add Folder or Album, then Choose Folder/);
  assert.match(renderer, /Turn on Shuffle and Show on all Spaces/);
  assert.match(styles, /wallpaper-setup-steps/);
  assert.match(styles, /text-align: center/);
});

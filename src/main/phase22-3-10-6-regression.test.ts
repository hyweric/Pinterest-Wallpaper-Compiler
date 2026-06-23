import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), "utf8");

test("Phase 22.3.10.6 removes source media/details UI labels", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.doesNotMatch(renderer, />Media<|Images \+ video thumbnails|Source details|view its details|source-technical-details|source-media-policy/);
  assert.doesNotMatch(styles, /source-technical-details|source-media-policy|source-exclusion-note/);
});

test("Phase 22.3.10.6 removes duplicate background color text and bottom status bars", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /className="color-input-only" aria-label="Background color"/);
  assert.doesNotMatch(renderer, /canvas\.backgroundBaseMode === "color" && <label>Color<input/);
  assert.doesNotMatch(renderer, /className="status"|className="home-status"|message=\{message\}/);
  assert.doesNotMatch(styles, /\.status\s*\{|home-status/);
});

test("Phase 22.3.10.6 removes visible Pinterest web refresh flow", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const providers = await source("src/main/providers.ts");
  assert.doesNotMatch(renderer, new RegExp(["Update from", "Web"].join(" ") + "|" + ["Update from", "web"].join(" ") + "|" + ["Resume", "Update"].join(" ") + "|onUpdate"));
  assert.match(renderer, /<button className="pill-button primary" disabled=\{state\.busy\} onClick=\{onImport\}>Import Board<\/button>/);
  assert.doesNotMatch(providers, new RegExp(["Update from", "Web"].join(" ") + "|" + ["Update from", "web"].join(" ")));
  assert.match(providers, /Import this board again to resume/);
});

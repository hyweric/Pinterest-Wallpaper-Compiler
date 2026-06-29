import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("phase 22.3.10 removes the duplicate outer Polaroid border", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");

  assert.match(renderer, /\["--layer-border-width" as string\]:\s*paperActive \? "0px" : `\$\{Math\.max\(0, layer\.borderWidth\)\}px`/);
  assert.match(renderer, /\["--layer-border-color" as string\]:\s*paperActive \? "transparent" : hexWithOpacity/);
  assert.match(styles, /\.placeholder::after \{[\s\S]*box-shadow:\s*inset 0 0 0 var\(--layer-border-width/);
  assert.match(styles, /\.placeholder\.paper-frame::after \{[\s\S]*box-shadow:\s*none !important;/);
  assert.doesNotMatch(styles, /\.placeholder\.polaroid \{[\s\S]*border:\s*16px solid #fffdf8 !important;/);
  assert.match(styles, /\.placeholder\.paper-frame\.polaroid \{[\s\S]*border-width:\s*0 !important;[\s\S]*border-color:\s*transparent !important;/);
});

test("phase 22.3.10 keeps image step buttons text-only", async () => {
  const renderer = await source("src/renderer/main.tsx");

  assert.match(renderer, />Previous Image<\/button>/);
  assert.match(renderer, />Next Image<\/button>/);
  assert.doesNotMatch(renderer, /← Previous Image/);
  assert.doesNotMatch(renderer, /Next Image →/);
});

test("phase 22.3.10 enlarges tear regeneration and photo reset buttons", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");

  assert.match(renderer, /polaroid-reset-placement-button/);
  assert.match(renderer, /torn-paper-regenerate-button/);
  assert.match(styles, /\.polaroid-placement-row \.button,[\s\S]*min-height:\s*44px;/);
  assert.match(styles, /\.torn-paper-action-row \.button,[\s\S]*min-height:\s*40px;/);
});

test("phase 22.3.10 strengthens visible frame texture", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");

  assert.match(renderer, /intensity:\s*textureVisible \? Math\.max\(textureType === "crumpled-paper" \? 100 : 92, textureIntensity\) : 0/);
  assert.match(renderer, /opacity:\s*textureVisible \? Math\.max\(textureType === "crumpled-paper" \? 0\.9 : 0\.74, textureIntensity \/ 100\) : 0/);
  assert.match(styles, /\.paper-frame\.polaroid \.paper-frame-texture \{[\s\S]*opacity:\s*1;/);
});

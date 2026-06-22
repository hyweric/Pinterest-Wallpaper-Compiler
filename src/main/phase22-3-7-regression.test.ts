import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

test("phase 22.3.7 removes internal helper copy from the visible effects inspector", async () => {
  const renderer = await source("src/renderer/main.tsx");
  for (const copy of [
    "Pick an effect style below",
    "Clean Paper only needs",
    "Torn Paper works best",
    "Polaroid keeps",
    "Canvas controls do the photo positioning",
    "Only the two controls that change the edge shape"
  ]) {
    assert.doesNotMatch(renderer, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("phase 22.3.7+ keeps texture wording without the old wrinkles label", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.match(renderer, /<label>Texture<select/);
  assert.doesNotMatch(renderer, /label="Wrinkles"/);
});

test("phase 22.3.7 keeps the single Settings tab visually neutral", async () => {
  const styles = await source("src/renderer/styles.css");
  assert.match(styles, /settings-inspector-tabs button\.active:not\(\.panel-local-toggle\)/);
  assert.match(styles, /settings-inspector-tabs button\.active:not\(\.panel-local-toggle\) \{[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
});

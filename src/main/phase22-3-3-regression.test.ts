import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const renderer = readFileSync(join(process.cwd(), "src/renderer/main.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");

describe("phase 22.3.3 toolbar and dropdown polish", () => {
  it("removes hide layer from the selected-image floating toolbar only", () => {
    const toolbar = renderer.match(/function ContextToolbar[\s\S]*?function CropToolbar/)?.[0] ?? "";
    assert.match(toolbar, /aria-label="Move layer up"/);
    assert.match(toolbar, /aria-label="Move layer down"/);
    assert.match(toolbar, /aria-label="Duplicate layer"/);
    assert.match(toolbar, /aria-label="Lock layer"/);
    assert.doesNotMatch(toolbar, /aria-label="Hide layer"/);
    assert.doesNotMatch(toolbar, /data-tooltip="Hide layer"/);
  });

  it("keeps one final dropdown padding standard for inspector and sidebar selects", () => {
    assert.match(styles, /Phase 22\.3\.3: standardize dropdown padding/);
    assert.match(styles, /select,[\s\S]*?\.source-media-policy select \{[\s\S]*?height: 35px !important;/);
    assert.match(styles, /padding: 0 38px 0 12px !important;/);
    assert.match(styles, /line-height: 35px !important;/);
    assert.match(styles, /background-position: right 0 center, right 12px center !important;/);
    assert.match(styles, /text-overflow: ellipsis !important;/);
  });
});

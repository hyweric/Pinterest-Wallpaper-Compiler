import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const styles = readFileSync("src/renderer/styles.css", "utf8");

test("phase 22.3.6 keeps the white selected-toolbar shell while removing inner blue capsules", () => {
  assert.match(styles, /\/\* Phase 22\.3\.6: keep the main white floating toolbar shell/);
  assert.match(styles, /\.context-toolbar\.compact-context-toolbar \{[\s\S]*padding: 7px !important;[\s\S]*border: 1px solid rgba\(58, 49, 42, 0\.12\) !important;[\s\S]*background: rgba\(255, 255, 255, 0\.90\) !important;[\s\S]*box-shadow: 0 18px 50px rgba\(80, 82, 86, 0\.10\) !important;/);
  assert.match(styles, /\.context-toolbar\.compact-context-toolbar \.context-toolbar-button-group \{[\s\S]*background: transparent !important;[\s\S]*border-color: transparent !important;[\s\S]*box-shadow: none !important;[\s\S]*padding: 0 !important;/);
});

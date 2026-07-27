import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Phase 30.26 removes the Pinterest pin-limit reset button", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const panelStart = renderer.indexOf("function CanvasDesignPanel(");
  const panelEnd = renderer.indexOf("const alignmentOptions", panelStart);

  assert.ok(panelStart >= 0 && panelEnd > panelStart, "CanvasDesignPanel should be present");
  const panel = renderer.slice(panelStart, panelEnd);

  assert.match(panel, /Maximum Pinterest pins/);
  assert.doesNotMatch(panel, /Reset to \{DEFAULT_PIN_IMPORT_LIMIT/);
  assert.doesNotMatch(panel, /onPinterestPinLimitChange\(DEFAULT_PIN_IMPORT_LIMIT\)/);
});

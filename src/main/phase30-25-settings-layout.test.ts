import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Phase 30.25 keeps Imports as the final canvas settings group without helper copy", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const panelStart = renderer.indexOf("function CanvasDesignPanel(");
  const panelEnd = renderer.indexOf("const alignmentOptions", panelStart);

  assert.ok(panelStart >= 0 && panelEnd > panelStart, "CanvasDesignPanel should be present");
  const panel = renderer.slice(panelStart, panelEnd);

  assert.doesNotMatch(
    panel,
    /Applies to new Pinterest board imports and refreshes\./
  );

  const canvasIndex = panel.indexOf("<summary>Canvas ");
  const backgroundIndex = panel.indexOf("<summary>Background ");
  const surfaceIndex = panel.indexOf("<summary>Surface ");
  const importsIndex = panel.indexOf("<summary>Imports ");

  assert.ok(canvasIndex >= 0);
  assert.ok(backgroundIndex > canvasIndex);
  assert.ok(surfaceIndex > backgroundIndex);
  assert.ok(importsIndex > surfaceIndex, "Imports should be the final settings group");
  assert.equal(panel.indexOf("<summary>", importsIndex + 1), -1, "No settings group should follow Imports");

});

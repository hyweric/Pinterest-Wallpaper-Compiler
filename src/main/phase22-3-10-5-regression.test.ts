import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) => readFile(path.join(process.cwd(), relativePath), "utf8");

test("Phase 22.3.10.5 uses inline-safe Pin Paper branding inside the renderer", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const icon = await source("src/renderer/brand-icon.ts");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /import \{ pinPaperIcon \} from "\.\/brand-icon"/);
  assert.doesNotMatch(renderer, /\.\.\/assets\/pin-paper-icon\.png/);
  assert.match(icon, /data:image\/png;base64,/);
  assert.match(styles, /brand-mark\.pin-paper-mark[\s\S]*object-fit: contain/);
});

test("Phase 22.3.10.5 tightens import modal copy and gives close buttons wider shorter hit areas", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /className="modal import-modal"/);
  assert.match(renderer, /className="button secondary import-dialog-close-button"/);
  assert.match(renderer, /Cached locally for offline wallpaper rotation/);
  assert.doesNotMatch(renderer, /The app will cache imported images locally/);
  assert.match(styles, /modal-title-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /import-dialog-close-button[\s\S]*min-width: 132px/);
  assert.match(styles, /import-modal \.dialog-actions \.pill-button[\s\S]*min-width: 142px/);
});

test("Phase 22.3.10.5 places the supporting home copy on its own line", async () => {
  const renderer = await source("src/renderer/main.tsx");
  const styles = await source("src/renderer/styles.css");
  assert.match(renderer, /Wallpaper, made personal/);
  assert.match(renderer, /Wallpapers made out of collections you love\./);
  assert.match(styles, /home-hero h2[\s\S]*display: block !important/);
  assert.match(styles, /home-hero h2 small[\s\S]*display: block/);
  assert.match(styles, /home-hero h2 small[\s\S]*margin-top: 12px/);
});

test("Phase 22.3.10.5 removes the opened-template bottom status toast", async () => {
  const renderer = await source("src/renderer/main.tsx");
  assert.doesNotMatch(renderer, /Opened template/);
  assert.match(renderer, /setView\("editor"\);\n    setMessage\(""\);/);
});

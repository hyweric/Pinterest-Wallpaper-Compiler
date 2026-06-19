import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  imageBackgroundColor,
  imageMayContainTransparency,
  sourceIsManagedOverlay,
  sourceLooksLikeTransparentOverlay
} from "../shared/image-transparency.js";

test("transparent-capable imported images render without a forced white background", () => {
  assert.equal(imageMayContainTransparency({ name: "sticker.png", path: "/tmp/sticker.png", url: "file:///tmp/sticker.png", mediaType: "image" }), true);
  assert.equal(imageMayContainTransparency({ name: "photo.jpg", path: "/tmp/photo.jpg", url: "file:///tmp/photo.jpg", mediaType: "image" }), false);
  assert.equal(imageBackgroundColor("#ffffff", { name: "logo.webp", path: "/tmp/logo.webp", url: "file:///tmp/logo.webp", mediaType: "image" }), "transparent");
  assert.equal(imageBackgroundColor("#ffffff", { name: "photo.jpeg", path: "/tmp/photo.jpeg", url: "file:///tmp/photo.jpeg", mediaType: "image" }), "#ffffff");
});

test("managed overlay sources are treated as overlay-like and not temporary file placeholders", () => {
  const source = {
    id: "source-overlay",
    identityKey: "managed-overlay:abc",
    providerId: "local-file" as const,
    type: "local-file" as const,
    name: "Overlay · Logo",
    images: [{ id: "image-overlay", name: "logo.png", path: "/managed/logo.png", url: "file:///managed/logo.png", mediaType: "image" as const }],
    mediaPolicy: "images-only" as const,
    updatedAt: "now"
  };
  assert.equal(sourceIsManagedOverlay(source), true);
  assert.equal(sourceLooksLikeTransparentOverlay(source), true);
});

test("managed overlay import path reuses canvas drop placement instead of a square contain frame", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /const center = \{ x: projectRef\.current\.canvas\.width \/ 2, y: projectRef\.current\.canvas\.height \/ 2 \}/);
  assert.match(renderer, /await placeSourcesAtCanvasPoint\(\[result\.source\], center/);
  assert.doesNotMatch(renderer, /projectRef\.current\.canvas\.width \* 0\.42/);
  assert.doesNotMatch(renderer, /keepAspectRatio: true,[\s\S]*sourceId: source\.id/);
});

test("dropped transparent images and overlays get transparent, non-framed placement defaults", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /const overlayLike = sourceLooksLikeTransparentOverlay\(source\)/);
  assert.match(renderer, /cropMode: "cover" as const/);
  assert.match(renderer, /backgroundColor: imageBackgroundColor\(layer\.effects\.backgroundColor, firstImage\)/);
  assert.match(renderer, /backgroundColor: imageBackgroundColor\(layer\.effects\.backgroundColor, image\)/);

  const exporter = await readFile(path.join(process.cwd(), "src/renderer/exporter.ts"), "utf8");
  assert.match(exporter, /const innerBackground = imageBackgroundColor\(layer\.effects\.backgroundColor, imageRef\)/);
  assert.match(exporter, /if \(innerBackground !== "transparent"\)/);
});

test("background buttons have a clear active state and assign-source text is readable", async () => {
  const styles = await readFile(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
  assert.match(styles, /\.sidebar\.right \.segmented-control\.two-options button\.active \{[\s\S]*background: #dfeef0/);
  assert.match(styles, /\.placeholder-image-area > span:not\(\.texture-overlay\) \{[\s\S]*font-size: 16px;/);
});

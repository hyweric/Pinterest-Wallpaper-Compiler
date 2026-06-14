import finePaperUrl from "./assets/textures/bundled/fine-paper.webp";
import mattePaperUrl from "./assets/textures/bundled/matte-paper.webp";
import recycledPaperUrl from "./assets/textures/bundled/recycled-paper.webp";
import canvasUrl from "./assets/textures/bundled/canvas.webp";
import handmadePaperUrl from "./assets/textures/bundled/handmade-paper.webp";
import finePaperThumbUrl from "./assets/textures/bundled/thumbs/fine-paper.webp";
import mattePaperThumbUrl from "./assets/textures/bundled/thumbs/matte-paper.webp";
import recycledPaperThumbUrl from "./assets/textures/bundled/thumbs/recycled-paper.webp";
import canvasThumbUrl from "./assets/textures/bundled/thumbs/canvas.webp";
import handmadePaperThumbUrl from "./assets/textures/bundled/thumbs/handmade-paper.webp";
import type { PaperTextureEffect } from "../shared/types";
import { bundledSurfaceManifest } from "../shared/surfaces";

const urls: Record<string, string> = {
  "fine-grain": finePaperUrl,
  "matte-photo": mattePaperUrl,
  recycled: recycledPaperUrl,
  canvas: canvasUrl,
  handmade: handmadePaperUrl
};
const thumbs: Record<string, string> = {
  "fine-grain": finePaperThumbUrl,
  "matte-photo": mattePaperThumbUrl,
  recycled: recycledPaperThumbUrl,
  canvas: canvasThumbUrl,
  handmade: handmadePaperThumbUrl
};

export const bundledSurfaceChoices = [
  { type: "none" as const, label: "None", thumbnailUrl: undefined },
  ...bundledSurfaceManifest.map((entry) => ({ type: entry.paperType, label: entry.label, thumbnailUrl: thumbs[entry.paperType] }))
];

export function bundledSurfaceUrl(type: PaperTextureEffect["type"]) {
  return urls[type];
}

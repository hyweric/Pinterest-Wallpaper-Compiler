import paperUrl from "./assets/textures/bundled/paper.webp";
import crumpledPaperUrl from "./assets/textures/bundled/crumpled-paper.webp";
import gridPaperUrl from "./assets/textures/bundled/grid-paper.webp";
import dottedPaperUrl from "./assets/textures/bundled/dotted-paper.webp";
import paperThumbUrl from "./assets/textures/bundled/thumbs/paper.webp";
import crumpledPaperThumbUrl from "./assets/textures/bundled/thumbs/crumpled-paper.webp";
import gridPaperThumbUrl from "./assets/textures/bundled/thumbs/grid-paper.webp";
import dottedPaperThumbUrl from "./assets/textures/bundled/thumbs/dotted-paper.webp";
import type { PaperTextureEffect } from "../shared/types";
import { bundledSurfaceManifest, resolveBundledSurfaceType } from "../shared/surfaces";

const urls: Record<string, string> = {
  paper: paperUrl,
  "crumpled-paper": crumpledPaperUrl,
  "grid-paper": gridPaperUrl,
  "dotted-paper": dottedPaperUrl
};
const thumbs: Record<string, string> = {
  paper: paperThumbUrl,
  "crumpled-paper": crumpledPaperThumbUrl,
  "grid-paper": gridPaperThumbUrl,
  "dotted-paper": dottedPaperThumbUrl
};

export const bundledSurfaceChoices = [
  { type: "none" as const, label: "None", thumbnailUrl: undefined },
  ...bundledSurfaceManifest.map((entry) => ({ type: entry.paperType, label: entry.label, thumbnailUrl: thumbs[entry.paperType] }))
];

export function bundledSurfaceUrl(type: PaperTextureEffect["type"]) {
  const resolved = resolveBundledSurfaceType(type);
  return resolved ? urls[resolved] : undefined;
}

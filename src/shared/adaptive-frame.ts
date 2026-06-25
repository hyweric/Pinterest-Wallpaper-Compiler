import type { LocalImageRef, PlaceholderLayer } from "./types.js";

export interface LayerFrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSizeLike {
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function imageSizeFromRef(image?: LocalImageRef | ImageSizeLike): { width: number; height: number } | undefined {
  const sized = image as ImageSizeLike | undefined;
  const width = finitePositive(sized?.width) ? sized.width : finitePositive(sized?.naturalWidth) ? sized.naturalWidth : undefined;
  const height = finitePositive(sized?.height) ? sized.height : finitePositive(sized?.naturalHeight) ? sized.naturalHeight : undefined;
  return width && height ? { width, height } : undefined;
}

export function resolveLayerFrameBounds(layer: PlaceholderLayer, image?: LocalImageRef | ImageSizeLike): LayerFrameBounds {
  const targetWidth = Math.max(1, Number.isFinite(layer.width) ? layer.width : 1);
  const targetHeight = Math.max(1, Number.isFinite(layer.height) ? layer.height : 1);
  const fixed = { x: layer.x, y: layer.y, width: targetWidth, height: targetHeight };
  if (layer.frameMode !== "adaptive") return fixed;

  const size = imageSizeFromRef(image);
  if (!size) return fixed;

  const aspect = size.width / size.height;
  if (!Number.isFinite(aspect) || aspect <= 0) return fixed;

  const area = Math.max(1, targetWidth * targetHeight);
  const width = Math.max(1, Math.sqrt(area * aspect));
  const height = Math.max(1, Math.sqrt(area / aspect));
  const centerX = layer.x + targetWidth / 2;
  const centerY = layer.y + targetHeight / 2;

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height
  };
}

export function layerFrameCenter(layer: Pick<PlaceholderLayer, "x" | "y" | "width" | "height">) {
  return {
    x: layer.x + layer.width / 2,
    y: layer.y + layer.height / 2
  };
}

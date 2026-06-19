import type { CanvasSettings } from "./types";

export interface CanvasDropPoint {
  x: number;
  y: number;
}

export interface CanvasDropPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function defaultDroppedPlaceholderSize(canvas: Pick<CanvasSettings, "width" | "height">) {
  return {
    width: Math.max(40, Math.round(canvas.width * 0.28)),
    height: Math.max(40, Math.round(canvas.height * 0.42))
  };
}

export function droppedPlaceholderSizeForAspect(
  canvas: Pick<CanvasSettings, "width" | "height">,
  aspectRatio?: number
) {
  const base = defaultDroppedPlaceholderSize(canvas);
  if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return base;

  const baseArea = base.width * base.height;
  let width = Math.sqrt(baseArea * aspectRatio);
  let height = width / aspectRatio;
  const maxWidth = Math.max(40, canvas.width * 0.48);
  const maxHeight = Math.max(40, canvas.height * 0.48);
  const scale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
  width *= scale;
  height *= scale;

  return {
    width: Math.max(40, Math.round(width)),
    height: Math.max(40, Math.round(height))
  };
}

/**
 * Centers a new placeholder on the user's drop point. Additional placeholders
 * are offset slightly so a mixed or multi-folder drop remains visible and can
 * be separated immediately.
 */
export function placementForCanvasDrop(
  canvas: Pick<CanvasSettings, "width" | "height">,
  point: CanvasDropPoint,
  offsetIndex = 0,
  aspectRatio?: number
): CanvasDropPlacement {
  const { width, height } = droppedPlaceholderSizeForAspect(canvas, aspectRatio);
  const cascadeStep = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) * 0.024));
  const offset = Math.max(0, offsetIndex) * cascadeStep;
  const maxX = Math.max(0, canvas.width - width);
  const maxY = Math.max(0, canvas.height - height);
  return {
    x: Math.round(clamp(point.x - width / 2 + offset, 0, maxX)),
    y: Math.round(clamp(point.y - height / 2 + offset, 0, maxY)),
    width,
    height
  };
}

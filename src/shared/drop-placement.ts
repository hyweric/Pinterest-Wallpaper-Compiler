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
  const fallback = defaultDroppedPlaceholderSize(canvas);
  let { width, height } = fallback;
  if (typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    const area = fallback.width * fallback.height;
    width = Math.round(Math.sqrt(area * aspectRatio));
    height = Math.round(width / aspectRatio);
    const maxWidth = Math.max(40, Math.round(canvas.width * 0.46));
    const maxHeight = Math.max(40, Math.round(canvas.height * 0.62));
    if (width > maxWidth) {
      width = maxWidth;
      height = Math.round(width / aspectRatio);
    }
    if (height > maxHeight) {
      height = maxHeight;
      width = Math.round(height * aspectRatio);
    }
    width = Math.max(40, width);
    height = Math.max(40, height);
  }
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

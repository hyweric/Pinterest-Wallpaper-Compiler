export type ResizeHandle =
  | "resize-n"
  | "resize-s"
  | "resize-e"
  | "resize-w"
  | "resize-ne"
  | "resize-nw"
  | "resize-se"
  | "resize-sw";

export interface ResizeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeBounds {
  width: number;
  height: number;
  minSize?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function resizeRectAroundCenter(
  rect: ResizeRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  preserveAspect: boolean,
  bounds: ResizeBounds
): ResizeRect {
  const minSize = Math.max(1, bounds.minSize ?? 40);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const direction = handle.slice("resize-".length);
  const affectsWidth = direction.includes("e") || direction.includes("w");
  const affectsHeight = direction.includes("n") || direction.includes("s");

  let width = rect.width;
  let height = rect.height;

  if (direction.includes("e")) width += dx * 2;
  if (direction.includes("w")) width -= dx * 2;
  if (direction.includes("s")) height += dy * 2;
  if (direction.includes("n")) height -= dy * 2;

  const maxWidth = Math.max(minSize, Math.min(bounds.width, centerX * 2, (bounds.width - centerX) * 2));
  const maxHeight = Math.max(minSize, Math.min(bounds.height, centerY * 2, (bounds.height - centerY) * 2));

  if (preserveAspect && (affectsWidth || affectsHeight)) {
    const aspect = rect.width / Math.max(1, rect.height);
    if (affectsWidth && affectsHeight) {
      const widthChange = Math.abs(width - rect.width) / Math.max(1, rect.width);
      const heightChange = Math.abs(height - rect.height) / Math.max(1, rect.height);
      if (widthChange >= heightChange) height = width / aspect;
      else width = height * aspect;
    } else if (affectsWidth) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }

    const fitScale = Math.min(1, maxWidth / Math.max(minSize, width), maxHeight / Math.max(minSize, height));
    width *= fitScale;
    height *= fitScale;
  }

  width = clamp(width, minSize, maxWidth);
  height = clamp(height, minSize, maxHeight);

  return {
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
    width: Math.round(width),
    height: Math.round(height)
  };
}

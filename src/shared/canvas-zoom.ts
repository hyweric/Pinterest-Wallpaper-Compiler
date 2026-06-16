export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 5;
export const CANVAS_ZOOM_STEP = 1.15;

export type CanvasPoint = { x: number; y: number };
export type ClientRectLike = Pick<DOMRect, "left" | "top" | "width" | "height">;

export function clampCanvasZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, value));
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, viewportHeight = 800): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
  const pixels = deltaY * unit;
  return Math.min(240, Math.max(-240, pixels));
}

export function zoomAfterWheel(currentZoom: number, normalizedDeltaY: number): number {
  return clampCanvasZoom(currentZoom * Math.exp(-normalizedDeltaY * 0.0012));
}

export function zoomAfterStep(currentZoom: number, direction: -1 | 1): number {
  return clampCanvasZoom(direction > 0 ? currentZoom * CANVAS_ZOOM_STEP : currentZoom / CANVAS_ZOOM_STEP);
}

export function fitCanvasZoom(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  horizontalPadding = 88,
  verticalPadding = 130
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return 1;
  const availableWidth = Math.max(1, viewportWidth - horizontalPadding);
  const availableHeight = Math.max(1, viewportHeight - verticalPadding);
  return clampCanvasZoom(Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight));
}

export function canvasPointAtClient(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number
): CanvasPoint {
  const safeZoom = Math.max(MIN_CANVAS_ZOOM, zoom);
  return {
    x: Math.min(canvasWidth, Math.max(0, (clientX - rect.left) / safeZoom)),
    y: Math.min(canvasHeight, Math.max(0, (clientY - rect.top) / safeZoom))
  };
}

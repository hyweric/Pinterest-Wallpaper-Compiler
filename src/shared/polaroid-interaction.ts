export interface Point2D {
  x: number;
  y: number;
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function rotatePoint(point: Point2D, degrees: number): Point2D {
  const radians = finite(degrees) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos
  };
}

export function screenDeltaToFrameDelta(dx: number, dy: number, frameRotation: number): Point2D {
  return rotatePoint({ x: finite(dx), y: finite(dy) }, -finite(frameRotation));
}

export function distanceBetween(a: Point2D, b: Point2D) {
  return Math.hypot(finite(a.x) - finite(b.x), finite(a.y) - finite(b.y));
}

export function polaroidScaleFromPointerDistance(startScale: number, startDistance: number, currentDistance: number) {
  const safeStartScale = Math.min(20, Math.max(0.05, finite(startScale, 1)));
  const rawStartDistance = finite(startDistance, 0);
  if (rawStartDistance < 8) return safeStartScale;
  const safeStartDistance = rawStartDistance;
  const ratio = Math.max(0.05, finite(currentDistance, safeStartDistance) / safeStartDistance);
  return Math.min(20, Math.max(0.05, safeStartScale * ratio));
}

export function pointerAngleDegrees(point: Point2D, center: Point2D) {
  return Math.atan2(finite(point.y) - finite(center.y), finite(point.x) - finite(center.x)) * 180 / Math.PI;
}

export function shortestAngleDelta(startDegrees: number, currentDegrees: number) {
  let delta = finite(currentDegrees) - finite(startDegrees);
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function clampPolaroidRotation(value: number) {
  let result = finite(value);
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

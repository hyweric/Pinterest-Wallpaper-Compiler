import type { PaperTextureEffect } from "./types";

export const MAX_SURFACE_TILE_CACHE_ENTRIES = 24;
export const MAX_SURFACE_IMAGE_CACHE_ENTRIES = 12;
export const SURFACE_PREVIEW_MAX_DIMENSION = 1024;
export const SURFACE_PREVIEW_MAX_PIXELS = 1_200_000;

export interface NormalizedSurfaceEffect extends PaperTextureEffect {
  enabled: boolean;
  noise: number;
  roughness: number;
  tone: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function normalizeSurfaceEffect(effect: PaperTextureEffect): NormalizedSurfaceEffect {
  const type = effect.type ?? "none";
  return {
    ...effect,
    type,
    enabled: effect.enabled ?? type !== "none",
    intensity: clamp(effect.intensity ?? 0, 0, 100),
    scale: clamp(effect.scale ?? 1, 0.2, 5),
    rotation: clamp(effect.rotation ?? 0, -180, 180),
    opacity: clamp(effect.opacity ?? 0, 0, 1),
    blendMode: effect.blendMode ?? "multiply",
    seed: Math.max(1, Math.floor(Number.isFinite(effect.seed) ? effect.seed : 1)),
    noise: clamp(effect.noise ?? 18, 0, 100),
    roughness: clamp(effect.roughness ?? 20, 0, 100),
    tone: clamp(effect.tone ?? 0, -100, 100)
  };
}

export function surfaceEffectIsVisible(effect: PaperTextureEffect) {
  const normalized = normalizeSurfaceEffect(effect);
  return normalized.enabled && normalized.type !== "none" && normalized.intensity > 0 && normalized.opacity > 0;
}

export function surfaceCompositeAlpha(effect: PaperTextureEffect) {
  const normalized = normalizeSurfaceEffect(effect);
  if (!surfaceEffectIsVisible(normalized)) return 0;
  const opacity = normalized.opacity <= 0 ? 0 : Math.min(1, 0.28 + normalized.opacity * 0.86);
  const intensity = Math.min(1, 0.68 + (normalized.intensity / 100) * 0.42);
  return Math.min(1, opacity * intensity);
}

export function surfaceTileCacheKey(effect: PaperTextureEffect, customFingerprint = "") {
  const normalized = normalizeSurfaceEffect(effect);
  return [
    normalized.type,
    normalized.seed,
    Math.round(normalized.noise),
    Math.round(normalized.roughness),
    Math.round(normalized.tone),
    customFingerprint
  ].join(":");
}

export function nextSurfaceSeed(seed: number) {
  return ((Math.imul(Math.max(1, Math.floor(seed || 1)), 1664525) + 1013904223) >>> 0) || 1;
}

export function surfaceSeedOffset(seed: number) {
  const normalized = Math.max(1, Math.floor(seed || 1)) >>> 0;
  return {
    x: ((Math.imul(normalized, 1103515245) + 12345) >>> 8) % 256,
    y: ((Math.imul(normalized, 214013) + 2531011) >>> 8) % 256
  };
}

export function surfacePreviewDimensions(width: number, height: number) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const dimensionScale = Math.min(1, SURFACE_PREVIEW_MAX_DIMENSION / Math.max(safeWidth, safeHeight));
  const pixelScale = Math.min(1, Math.sqrt(SURFACE_PREVIEW_MAX_PIXELS / (safeWidth * safeHeight)));
  const scale = Math.min(dimensionScale, pixelScale);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
    scale
  };
}

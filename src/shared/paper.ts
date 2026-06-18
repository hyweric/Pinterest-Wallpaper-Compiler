import type { PaperFrameEffect, PolaroidEffect, TornPaperEffect } from "./types.js";
import {
  normalizePolaroidEffect,
  normalizeTornPaperEffect,
  polaroidInsets,
  polygonPointsToCss,
  tornPaperInsets,
  tornPaperPolygonPoints
} from "./frame-effects.js";

export interface PaperInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function paperFrameInsets(effect: PaperFrameEffect, width: number, height: number, polaroid?: PolaroidEffect, tornPaper?: TornPaperEffect): PaperInsets {
  if (effect.type === "none") return { top: 0, right: 0, bottom: 0, left: 0 };
  if (effect.type === "polaroid") return polaroidInsets(normalizePolaroidEffect(polaroid, effect), width, height);
  if (effect.type === "torn" || effect.type === "deckle") return tornPaperInsets(normalizeTornPaperEffect(tornPaper, effect), width, height);
  const base = Math.max(0, Math.min(Math.min(width, height) * 0.28, effect.borderWidth + effect.innerPadding));
  if (effect.type === "newsprint") return { top: base * 0.75, right: base * 0.75, bottom: base * 0.75, left: base * 0.75 };
  if (effect.type === "clean") return { top: base * 0.65, right: base * 0.65, bottom: base * 0.65, left: base * 0.65 };
  return { top: base, right: base, bottom: base, left: base };
}

export function paperFrameRotation(effect: PaperFrameEffect, polaroid?: PolaroidEffect) {
  if (effect.type === "polaroid") return normalizePolaroidEffect(polaroid, effect).frameRotation;
  if (!effect.rotationVariation) return 0;
  const value = Math.sin((effect.seed || 1) * 999.91) * 0.5 + 0.5;
  return (value * 2 - 1) * effect.rotationVariation;
}

export function paperFrameIsRough(effect: PaperFrameEffect) {
  return effect.type === "torn" || effect.type === "deckle";
}

export function paperFrameLabel(effect: PaperFrameEffect) {
  if (effect.type === "clean") return "Clean";
  if (effect.type === "polaroid") return "Polaroid";
  if (effect.type === "torn") return "Torn";
  if (effect.type === "deckle") return "Deckle";
  if (effect.type === "newsprint") return "Newsprint";
  return "None";
}

function seededRandom(seed: number) {
  let state = Math.max(1, Math.floor(seed || 1)) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function legacyPaperFrameClipPath(effect: PaperFrameEffect) {
  const random = seededRandom(effect.seed);
  const torn = effect.type === "torn";
  const steps = torn ? 12 : 42;
  const amplitude = torn
    ? 0.8 + Math.max(0, effect.edgeRoughness) * 0.055
    : 0.15 + Math.max(0, effect.edgeRoughness) * 0.012;
  const points: string[] = [];
  const jitter = (allowTear = false) => {
    const base = (random() - 0.5) * amplitude * 2;
    const tear = torn && allowTear && random() > 0.82 ? amplitude * (1.6 + random() * 2.3) : 0;
    return Math.max(-8, Math.min(8, base + tear));
  };
  for (let index = 0; index <= steps; index += 1) {
    const x = (index / steps) * 100;
    points.push(`${x.toFixed(2)}% ${Math.max(0, jitter(true)).toFixed(2)}%`);
  }
  for (let index = 1; index <= steps; index += 1) {
    const y = (index / steps) * 100;
    points.push(`${Math.min(100, 100 - jitter(true)).toFixed(2)}% ${y.toFixed(2)}%`);
  }
  for (let index = steps - 1; index >= 0; index -= 1) {
    const x = (index / steps) * 100;
    points.push(`${x.toFixed(2)}% ${Math.min(100, 100 - jitter(true)).toFixed(2)}%`);
  }
  for (let index = steps - 1; index > 0; index -= 1) {
    const y = (index / steps) * 100;
    points.push(`${Math.max(0, jitter(true)).toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${points.join(", ")})`;
}

export function paperFrameClipPath(effect: PaperFrameEffect, tornPaper?: TornPaperEffect, width = 100, height = 100) {
  if (!paperFrameIsRough(effect)) return undefined;
  if (!tornPaper) return legacyPaperFrameClipPath(effect);
  const normalized = normalizeTornPaperEffect(tornPaper, effect);
  return polygonPointsToCss(tornPaperPolygonPoints(normalized, width, height), width, height);
}

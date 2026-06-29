import type {
  PaperFrameEffect,
  PolaroidCaptionEffect,
  PolaroidEffect,
  ShadowEffect,
  TearEdgeEffect,
  TornPaperEffect,
  TornPaperPreset,
  TornPaperPresetSettings
} from "./types.js";

export const POLAROID_EFFECT_SCHEMA_VERSION = 1;
export const TORN_PAPER_EFFECT_SCHEMA_VERSION = 1;

export type FrameInsets = { top: number; right: number; bottom: number; left: number };
export type FramePoint = { x: number; y: number };

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K];
};

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return Math.min(max, Math.max(min, finite(value, fallback)));
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function createDefaultShadowEffect(enabled = false): ShadowEffect {
  return {
    enabled,
    x: 0,
    y: enabled ? 8 : 0,
    blur: enabled ? 28 : 0,
    spread: 0,
    opacity: enabled ? 0.22 : 0,
    color: "#0f172a"
  };
}

export function normalizeShadowEffect(input: PartialDeep<ShadowEffect> | undefined, fallback = createDefaultShadowEffect()): ShadowEffect {
  return {
    enabled: bool(input?.enabled, fallback.enabled),
    x: clamp(input?.x, -200, 200, fallback.x),
    y: clamp(input?.y, -200, 200, fallback.y),
    blur: clamp(input?.blur, 0, 300, fallback.blur),
    spread: clamp(input?.spread, -100, 200, fallback.spread),
    opacity: clamp(input?.opacity, 0, 1, fallback.opacity),
    color: text(input?.color, fallback.color)
  };
}

export function createDefaultPolaroidCaption(): PolaroidCaptionEffect {
  return {
    enabled: false,
    text: "",
    fontFamily: "Avenir Next",
    fontSize: 28,
    fontWeight: 600,
    color: "#2f3033",
    alignment: "center",
    x: 0,
    y: 0
  };
}

export function normalizePolaroidCaption(input?: PartialDeep<PolaroidCaptionEffect>): PolaroidCaptionEffect {
  const fallback = createDefaultPolaroidCaption();
  const alignment = input?.alignment === "left" || input?.alignment === "right" || input?.alignment === "center"
    ? input.alignment
    : fallback.alignment;
  return {
    enabled: bool(input?.enabled, fallback.enabled),
    text: text(input?.text, fallback.text),
    fontFamily: text(input?.fontFamily, fallback.fontFamily),
    fontSize: clamp(input?.fontSize, 6, 240, fallback.fontSize),
    fontWeight: clamp(input?.fontWeight, 100, 900, fallback.fontWeight),
    color: text(input?.color, fallback.color),
    alignment,
    x: clamp(input?.x, -1000, 1000, fallback.x),
    y: clamp(input?.y, -1000, 1000, fallback.y)
  };
}

function legacyFrameBase(frame?: PaperFrameEffect) {
  return Math.max(0, finite(frame?.borderWidth, 0) + finite(frame?.innerPadding, 0));
}

function legacyFrameRotation(frame?: PaperFrameEffect) {
  if (!frame?.rotationVariation) return 0;
  const value = Math.sin((frame.seed || 1) * 999.91) * 0.5 + 0.5;
  return (value * 2 - 1) * frame.rotationVariation;
}

function shadowFromLegacyStrength(strength: number, enabledOverride?: boolean): ShadowEffect {
  const amount = clamp(strength, 0, 100, 0);
  const enabled = enabledOverride ?? amount > 0;
  return normalizeShadowEffect({
    enabled,
    x: 0,
    y: 3 + amount * 0.22,
    blur: 8 + amount * 0.55,
    spread: 0,
    opacity: Math.min(0.45, amount / 180),
    color: "#0f172a"
  });
}

export function createDefaultPolaroidEffect(frame?: PaperFrameEffect): PolaroidEffect {
  const requestedBase = legacyFrameBase(frame);
  const base = requestedBase > 0 ? requestedBase : 28;
  const bottom = Math.max(base + 34, base * 1.85);
  const strength = finite(frame?.shadowStrength, 22);
  return {
    schemaVersion: POLAROID_EFFECT_SCHEMA_VERSION,
    enabled: frame?.type === "polaroid",
    borderTop: base,
    borderRight: base,
    borderBottom: bottom,
    borderLeft: base,
    captionHeight: Math.max(0, bottom - base),
    imageInset: 6,
    imageScale: 1,
    imageOffsetX: 0,
    imageOffsetY: 0,
    imageRotation: 0,
    frameRotation: legacyFrameRotation(frame),
    frameColor: frame?.paperColor ?? "#fffdf8",
    frameOpacity: 1,
    grain: finite(frame?.textureIntensity, 12),
    warmth: 8,
    cornerRadius: Math.min(16, Math.max(8, finite(frame?.borderWidth, 20) * 0.35)),
    dropShadow: shadowFromLegacyStrength(strength),
    innerShadow: createDefaultShadowEffect(false),
    caption: createDefaultPolaroidCaption()
  };
}

export function normalizePolaroidEffect(input: PartialDeep<PolaroidEffect> | undefined, frame?: PaperFrameEffect, legacyInnerShadow = false): PolaroidEffect {
  const fallback = createDefaultPolaroidEffect(frame);
  return {
    schemaVersion: POLAROID_EFFECT_SCHEMA_VERSION,
    enabled: bool(input?.enabled, fallback.enabled),
    borderTop: clamp(input?.borderTop, 0, 1000, fallback.borderTop),
    borderRight: clamp(input?.borderRight, 0, 1000, fallback.borderRight),
    borderBottom: clamp(input?.borderBottom, 0, 1000, fallback.borderBottom),
    borderLeft: clamp(input?.borderLeft, 0, 1000, fallback.borderLeft),
    captionHeight: clamp(input?.captionHeight, 0, 1000, fallback.captionHeight),
    imageInset: clamp(input?.imageInset, 0, 1000, fallback.imageInset),
    imageScale: clamp(input?.imageScale, 0.05, 20, fallback.imageScale),
    imageOffsetX: clamp(input?.imageOffsetX, -5000, 5000, fallback.imageOffsetX),
    imageOffsetY: clamp(input?.imageOffsetY, -5000, 5000, fallback.imageOffsetY),
    imageRotation: clamp(input?.imageRotation, -360, 360, fallback.imageRotation),
    frameRotation: clamp(input?.frameRotation, -360, 360, fallback.frameRotation),
    frameColor: text(input?.frameColor, fallback.frameColor),
    frameOpacity: clamp(input?.frameOpacity, 0, 1, fallback.frameOpacity),
    grain: clamp(input?.grain, 0, 100, fallback.grain),
    warmth: clamp(input?.warmth, -100, 100, fallback.warmth),
    cornerRadius: clamp(input?.cornerRadius, 0, 500, fallback.cornerRadius),
    dropShadow: normalizeShadowEffect(input?.dropShadow, fallback.dropShadow),
    innerShadow: normalizeShadowEffect(input?.innerShadow, legacyInnerShadow ? {
      enabled: true,
      x: 0,
      y: 0,
      blur: 20,
      spread: 0,
      opacity: 0.34,
      color: "#0f172a"
    } : fallback.innerShadow),
    caption: normalizePolaroidCaption(input?.caption)
  };
}

export function createDefaultTearEdge(enabled = true): TearEdgeEffect {
  return {
    enabled,
    depth: 30,
    frequency: 18,
    scale: 1,
    waviness: 44,
    roughness: 34
  };
}

export function normalizeTearEdge(input?: PartialDeep<TearEdgeEffect>, fallback = createDefaultTearEdge()): TearEdgeEffect {
  return {
    enabled: bool(input?.enabled, fallback.enabled),
    depth: clamp(input?.depth, 0, 100, fallback.depth),
    frequency: Math.round(clamp(input?.frequency, 2, 128, fallback.frequency)),
    scale: clamp(input?.scale, 0.1, 8, fallback.scale),
    waviness: clamp(input?.waviness, 0, 100, fallback.waviness),
    roughness: clamp(input?.roughness, 0, 100, fallback.roughness)
  };
}

export function createDefaultTornPaperEffect(frame?: PaperFrameEffect): TornPaperEffect {
  const edge = createDefaultTearEdge(true);
  const edgeRoughness = finite(frame?.edgeRoughness, 34);
  const migratedEdge = { ...edge, depth: edgeRoughness, roughness: edgeRoughness, frequency: 18 };
  const shadowStrength = finite(frame?.shadowStrength, 22);
  return {
    schemaVersion: TORN_PAPER_EFFECT_SCHEMA_VERSION,
    enabled: frame?.type === "torn" || frame?.type === "deckle",
    seed: Math.max(1, Math.floor(finite(frame?.seed, 1))),
    edges: {
      top: { ...migratedEdge },
      right: { ...migratedEdge },
      bottom: { ...migratedEdge },
      left: { ...migratedEdge }
    },
    paperColor: frame?.paperColor ?? "#fffdf8",
    paperOpacity: 1,
    grain: finite(frame?.textureIntensity, 20),
    fibers: Math.round(edgeRoughness * 0.75),
    wrinkles: 0,
    stains: 0,
    speckles: 0,
    edgeDarkening: 0,
    imageInset: legacyFrameBase(frame),
    imageScale: 1,
    imageOffsetX: 0,
    imageOffsetY: 0,
    innerShadow: createDefaultShadowEffect(false),
    outerShadow: shadowFromLegacyStrength(shadowStrength),
    presetId: "soft-paper"
  };
}


export function tornPaperPresetSettings(effect: TornPaperEffect): TornPaperPresetSettings {
  return {
    edges: {
      top: { ...effect.edges.top },
      right: { ...effect.edges.right },
      bottom: { ...effect.edges.bottom },
      left: { ...effect.edges.left }
    },
    paperColor: effect.paperColor,
    paperOpacity: effect.paperOpacity,
    grain: effect.grain,
    fibers: effect.fibers,
    wrinkles: effect.wrinkles,
    stains: effect.stains,
    speckles: effect.speckles,
    edgeDarkening: effect.edgeDarkening,
    imageInset: effect.imageInset,
    imageScale: effect.imageScale,
    imageOffsetX: effect.imageOffsetX,
    imageOffsetY: effect.imageOffsetY,
    innerShadow: { ...effect.innerShadow },
    outerShadow: { ...effect.outerShadow }
  };
}

function presetEffect(overrides: PartialDeep<TornPaperEffect>): TornPaperEffect {
  return normalizeTornPaperEffect({ ...createDefaultTornPaperEffect({ type: "torn" } as PaperFrameEffect), ...overrides });
}

export const bundledTornPaperPresets: TornPaperPreset[] = [
  {
    id: "soft-paper",
    name: "Soft Paper",
    bundled: true,
    settings: tornPaperPresetSettings(presetEffect({
      edges: {
        top: { depth: 18, frequency: 20, scale: 1, waviness: 34, roughness: 22 },
        right: { depth: 18, frequency: 20, scale: 1, waviness: 34, roughness: 22 },
        bottom: { depth: 18, frequency: 20, scale: 1, waviness: 34, roughness: 22 },
        left: { depth: 18, frequency: 20, scale: 1, waviness: 34, roughness: 22 }
      },
      paperColor: "#fffaf2",
      grain: 18,
      fibers: 24,
      wrinkles: 4,
      stains: 0,
      speckles: 4,
      edgeDarkening: 8,
      imageInset: 22,
      outerShadow: { enabled: true, x: 0, y: 5, blur: 18, spread: 0, opacity: .16, color: "#0f172a" }
    }))
  },
  {
    id: "natural-torn",
    name: "Natural Torn",
    bundled: true,
    settings: tornPaperPresetSettings(presetEffect({
      edges: {
        top: { depth: 34, frequency: 14, scale: 1, waviness: 48, roughness: 42 },
        right: { depth: 34, frequency: 14, scale: 1, waviness: 48, roughness: 42 },
        bottom: { depth: 34, frequency: 14, scale: 1, waviness: 48, roughness: 42 },
        left: { depth: 34, frequency: 14, scale: 1, waviness: 48, roughness: 42 }
      },
      paperColor: "#f7efdF",
      grain: 32,
      fibers: 38,
      wrinkles: 10,
      stains: 5,
      speckles: 12,
      edgeDarkening: 22,
      imageInset: 26,
      outerShadow: { enabled: true, x: 1, y: 7, blur: 24, spread: 0, opacity: .22, color: "#1f2937" }
    }))
  },
  {
    id: "aged-scrap",
    name: "Aged Scrap",
    bundled: true,
    settings: tornPaperPresetSettings(presetEffect({
      edges: {
        top: { depth: 42, frequency: 12, scale: 1.08, waviness: 52, roughness: 55 },
        right: { depth: 42, frequency: 12, scale: 1.08, waviness: 52, roughness: 55 },
        bottom: { depth: 42, frequency: 12, scale: 1.08, waviness: 52, roughness: 55 },
        left: { depth: 42, frequency: 12, scale: 1.08, waviness: 52, roughness: 55 }
      },
      paperColor: "#ead8b8",
      paperOpacity: .96,
      grain: 48,
      fibers: 42,
      wrinkles: 24,
      stains: 20,
      speckles: 26,
      edgeDarkening: 38,
      imageInset: 30,
      outerShadow: { enabled: true, x: 2, y: 9, blur: 28, spread: 1, opacity: .26, color: "#2a2118" }
    }))
  }
];

export function applyTornPaperPreset(effect: TornPaperEffect, preset: TornPaperPreset): TornPaperEffect {
  return normalizeTornPaperEffect({
    ...effect,
    ...structuredClone(preset.settings),
    seed: effect.seed,
    enabled: true,
    presetId: preset.id,
    customPresets: effect.customPresets
  });
}

export function createCustomTornPaperPreset(effect: TornPaperEffect, name: string, id = `torn-preset-${crypto.randomUUID()}`): TornPaperPreset {
  return {
    id,
    name: name.trim() || "Custom Torn Paper",
    bundled: false,
    settings: tornPaperPresetSettings(effect)
  };
}

export function normalizeTornPaperEffect(input: PartialDeep<TornPaperEffect> | undefined, frame?: PaperFrameEffect, legacyInnerShadow = false): TornPaperEffect {
  const fallback = createDefaultTornPaperEffect(frame);
  return {
    schemaVersion: TORN_PAPER_EFFECT_SCHEMA_VERSION,
    enabled: bool(input?.enabled, fallback.enabled),
    seed: Math.max(1, Math.floor(clamp(input?.seed, 1, 0xffffffff, fallback.seed))),
    edges: {
      top: normalizeTearEdge(input?.edges?.top, fallback.edges.top),
      right: normalizeTearEdge(input?.edges?.right, fallback.edges.right),
      bottom: normalizeTearEdge(input?.edges?.bottom, fallback.edges.bottom),
      left: normalizeTearEdge(input?.edges?.left, fallback.edges.left)
    },
    paperColor: text(input?.paperColor, fallback.paperColor),
    paperOpacity: clamp(input?.paperOpacity, 0, 1, fallback.paperOpacity),
    grain: clamp(input?.grain, 0, 100, fallback.grain),
    fibers: clamp(input?.fibers, 0, 100, fallback.fibers),
    wrinkles: clamp(input?.wrinkles, 0, 100, fallback.wrinkles),
    stains: clamp(input?.stains, 0, 100, fallback.stains),
    speckles: clamp(input?.speckles, 0, 100, fallback.speckles),
    edgeDarkening: clamp(input?.edgeDarkening, 0, 100, fallback.edgeDarkening),
    imageInset: clamp(input?.imageInset, 0, 1000, fallback.imageInset),
    imageScale: clamp(input?.imageScale, 0.05, 20, fallback.imageScale),
    imageOffsetX: clamp(input?.imageOffsetX, -5000, 5000, fallback.imageOffsetX),
    imageOffsetY: clamp(input?.imageOffsetY, -5000, 5000, fallback.imageOffsetY),
    innerShadow: normalizeShadowEffect(input?.innerShadow, legacyInnerShadow ? {
      enabled: true,
      x: 0,
      y: 0,
      blur: 20,
      spread: 0,
      opacity: 0.34,
      color: "#0f172a"
    } : fallback.innerShadow),
    outerShadow: normalizeShadowEffect(input?.outerShadow, fallback.outerShadow),
    presetId: typeof input?.presetId === "string" ? input.presetId : fallback.presetId,
    customPresets: Array.isArray(input?.customPresets)
      ? input.customPresets.filter((preset): preset is TornPaperPreset => Boolean(preset && typeof preset.id === "string" && typeof preset.name === "string" && preset.settings)).map((preset) => ({
          id: preset.id,
          name: preset.name,
          bundled: false,
          settings: structuredClone(preset.settings)
        }))
      : []
  };
}

export function polaroidInsets(effect: PolaroidEffect, width: number, height: number): FrameInsets {
  const maxHorizontal = Math.max(0, width - 1);
  const maxVertical = Math.max(0, height - 1);
  const top = Math.min(maxVertical, effect.borderTop + effect.imageInset);
  const right = Math.min(maxHorizontal, effect.borderRight + effect.imageInset);
  const bottom = Math.min(maxVertical, Math.max(effect.borderBottom, effect.borderTop + effect.captionHeight) + effect.imageInset);
  const left = Math.min(maxHorizontal, effect.borderLeft + effect.imageInset);
  return { top, right, bottom, left };
}

export function tornPaperInsets(effect: TornPaperEffect, width: number, height: number): FrameInsets {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const baseInset = Math.max(0, Math.min(Math.min(safeWidth, safeHeight) * 0.45, effect.imageInset));
  const aspect = safeWidth / safeHeight;
  const horizontalEdgeBoost = aspect > 1 ? Math.min(baseInset * 0.28, baseInset * (aspect - 1) * 0.1) : 0;
  const verticalEdgeBoost = aspect < 1 ? Math.min(baseInset * 0.28, baseInset * ((1 / aspect) - 1) * 0.1) : 0;
  return {
    top: Math.min(safeHeight * 0.45, baseInset + horizontalEdgeBoost),
    right: Math.min(safeWidth * 0.45, baseInset + verticalEdgeBoost),
    bottom: Math.min(safeHeight * 0.45, baseInset + horizontalEdgeBoost),
    left: Math.min(safeWidth * 0.45, baseInset + verticalEdgeBoost)
  };
}

export function shadowToCss(effect: ShadowEffect) {
  if (!effect.enabled || effect.opacity <= 0) return "";
  const color = effect.color.startsWith("#") && effect.color.length === 7
    ? `${effect.color}${Math.round(effect.opacity * 255).toString(16).padStart(2, "0")}`
    : effect.color;
  return `${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${color}`;
}

function seedHash(seed: number, edge: number) {
  let state = (Math.max(1, Math.floor(seed)) ^ Math.imul(edge + 1, 0x9e3779b9)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function edgeOffsets(edge: TearEdgeEffect, length: number, seed: number, edgeIndex: number) {
  const count = Math.max(2, Math.round(edge.frequency * edge.scale));
  const random = seedHash(seed, edgeIndex);
  const depthPx = Math.min(length * 0.2, 0.5 + edge.depth * 0.12 * edge.scale);
  const waveAmount = depthPx * (edge.waviness / 100);
  const roughAmount = depthPx * (edge.roughness / 100);
  const values: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    if (!edge.enabled) {
      values.push(0);
      continue;
    }
    const t = index / count;
    const wave = Math.sin((t * Math.PI * 2 * Math.max(1, edge.scale)) + random() * 0.55) * waveAmount * 0.42;
    const rough = (random() - 0.5) * roughAmount * 2;
    const occasional = random() > 0.87 ? random() * depthPx * 0.9 : 0;
    values.push(Math.max(0, Math.min(depthPx * 2.2, depthPx * 0.2 + wave + rough + occasional)));
  }
  return values;
}

export function tornPaperPolygonPoints(effect: TornPaperEffect, width: number, height: number): FramePoint[] {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const top = edgeOffsets(effect.edges.top, safeWidth, effect.seed, 0);
  const right = edgeOffsets(effect.edges.right, safeHeight, effect.seed, 1);
  const bottom = edgeOffsets(effect.edges.bottom, safeWidth, effect.seed, 2);
  const left = edgeOffsets(effect.edges.left, safeHeight, effect.seed, 3);
  const points: FramePoint[] = [];
  for (let i = 0; i < top.length; i += 1) points.push({ x: (i / (top.length - 1)) * safeWidth, y: top[i] });
  for (let i = 1; i < right.length; i += 1) points.push({ x: safeWidth - right[i], y: (i / (right.length - 1)) * safeHeight });
  for (let i = bottom.length - 2; i >= 0; i -= 1) points.push({ x: (i / (bottom.length - 1)) * safeWidth, y: safeHeight - bottom[i] });
  for (let i = left.length - 2; i > 0; i -= 1) points.push({ x: left[i], y: (i / (left.length - 1)) * safeHeight });
  return points;
}

export function polygonPointsToCss(points: FramePoint[], width: number, height: number) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return `polygon(${points.map((point) => `${((point.x / safeWidth) * 100).toFixed(3)}% ${((point.y / safeHeight) * 100).toFixed(3)}%`).join(", ")})`;
}



function textureRandom(seed: number, salt: number) {
  let state = (Math.max(1, Math.floor(seed)) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function tornPaperTextureSvg(effect: TornPaperEffect, width: number, height: number) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const elements: string[] = [];
  const fibers = textureRandom(effect.seed, 20);
  const fiberCount = Math.round(effect.fibers * 1.2);
  for (let index = 0; index < fiberCount; index += 1) {
    const x = fibers() * safeWidth;
    const y = fibers() * safeHeight;
    const length = 4 + fibers() * (8 + effect.fibers * .32);
    const angle = fibers() * Math.PI * 2;
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    const alpha = (.025 + effect.fibers / 900).toFixed(3);
    const color = fibers() > .5 ? `rgba(255,255,255,${alpha})` : `rgba(83,65,44,${alpha})`;
    elements.push(`<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="${(.35 + fibers() * 1.2).toFixed(2)}"/>`);
  }
  const wrinkles = textureRandom(effect.seed, 21);
  const wrinkleCount = Math.round(effect.wrinkles * .3);
  for (let index = 0; index < wrinkleCount; index += 1) {
    const x = wrinkles() * safeWidth;
    const y = wrinkles() * safeHeight;
    const dx = (wrinkles() - .5) * safeWidth * .35;
    const dy = (wrinkles() - .5) * safeHeight * .35;
    const cx = x + dx * .45 + (wrinkles() - .5) * 20;
    const cy = y + dy * .45 + (wrinkles() - .5) * 20;
    elements.push(`<path d="M ${x.toFixed(2)} ${y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)}" fill="none" stroke="rgba(72,58,44,${(.018 + effect.wrinkles / 900).toFixed(3)})" stroke-width="${(.5 + wrinkles() * 2.2).toFixed(2)}"/>`);
    elements.push(`<path d="M ${(x + 1).toFixed(2)} ${(y + 1).toFixed(2)} Q ${(cx + 1).toFixed(2)} ${(cy + 1).toFixed(2)} ${(x + dx + 1).toFixed(2)} ${(y + dy + 1).toFixed(2)}" fill="none" stroke="rgba(255,255,255,${(.012 + effect.wrinkles / 1200).toFixed(3)})" stroke-width="${(.4 + wrinkles() * 1.4).toFixed(2)}"/>`);
  }
  const stains = textureRandom(effect.seed, 22);
  const stainCount = Math.round(effect.stains * .12);
  for (let index = 0; index < stainCount; index += 1) {
    const x = stains() * safeWidth;
    const y = stains() * safeHeight;
    const radius = 5 + stains() * (12 + effect.stains * .45);
    elements.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="rgba(105,70,38,${(.012 + effect.stains / 1100).toFixed(3)})"/>`);
  }
  const speckles = textureRandom(effect.seed, 23);
  const speckleCount = Math.round(effect.speckles * 1.8);
  for (let index = 0; index < speckleCount; index += 1) {
    const x = speckles() * safeWidth;
    const y = speckles() * safeHeight;
    const radius = .25 + speckles() * (1 + effect.speckles * .018);
    elements.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="rgba(70,50,31,${(.025 + effect.speckles / 750).toFixed(3)})"/>`);
  }
  if (effect.edgeDarkening > 0) {
    const widthValue = Math.max(1, effect.edgeDarkening * .16);
    elements.push(`<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" fill="none" stroke="rgba(55,38,24,${Math.min(.55, effect.edgeDarkening / 180).toFixed(3)})" stroke-width="${widthValue.toFixed(2)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">${elements.join("")}</svg>`;
}

export function tornPaperTextureDataUrl(effect: TornPaperEffect, width: number, height: number) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tornPaperTextureSvg(effect, width, height))}`;
}

export function paperWarmthOverlay(warmth: number) {
  const normalized = Math.max(-100, Math.min(100, Number.isFinite(warmth) ? warmth : 0));
  if (normalized === 0) return undefined;
  return {
    color: normalized > 0 ? "#d89a5b" : "#6f9bd8",
    opacity: Math.min(0.42, Math.abs(normalized) / 260)
  };
}

export function nextStableSeed(seed: number) {
  return ((Math.imul(Math.max(1, Math.floor(seed || 1)), 1664525) + 1013904223) >>> 0) || 1;
}

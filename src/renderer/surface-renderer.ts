import type { CustomTextureAsset, PaperTextureEffect } from "../shared/types";
import {
  MAX_SURFACE_IMAGE_CACHE_ENTRIES,
  MAX_SURFACE_TILE_CACHE_ENTRIES,
  normalizeSurfaceEffect,
  surfaceCompositeAlpha,
  surfaceEffectIsVisible,
  surfacePreviewDimensions,
  surfaceSeedOffset,
  surfaceTileCacheKey
} from "../shared/surface-rendering";
import { isRenderableLocalFileUrl, renderableLocalFileUrl } from "../shared/local-file-url";
import { bundledSurfaceUrl } from "./surface-textures";

const TILE_SIZE = 512;
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const tileCache = new Map<string, Promise<HTMLCanvasElement>>();

function enforceBoundedCache<K, V>(cache: Map<K, V>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const first = cache.keys().next().value as K | undefined;
    if (first === undefined) break;
    cache.delete(first);
  }
}

function loadSurfaceImage(src: string, cache = true) {
  const renderSrc = renderableLocalFileUrl(src);
  if (!cache) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load surface texture ${src}`));
      if (isRenderableLocalFileUrl(renderSrc)) image.crossOrigin = "anonymous";
      image.src = renderSrc;
    });
  }
  const existing = imageCache.get(renderSrc);
  if (existing) {
    imageCache.delete(renderSrc);
    imageCache.set(renderSrc, existing);
    return existing;
  }
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load surface texture ${src}`));
    if (isRenderableLocalFileUrl(renderSrc)) image.crossOrigin = "anonymous";
    image.src = renderSrc;
  });
  imageCache.set(renderSrc, promise);
  enforceBoundedCache(imageCache, MAX_SURFACE_IMAGE_CACHE_ENTRIES);
  return promise;
}

function seeded(seed: number) {
  let state = Math.max(1, Math.floor(seed || 1)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function customFingerprint(custom?: CustomTextureAsset) {
  return custom ? `${custom.id}:${custom.path}:${custom.url}` : "";
}

function textureSource(effect: PaperTextureEffect, custom?: CustomTextureAsset) {
  if (effect.type === "custom") return custom?.url;
  return bundledSurfaceUrl(effect.type);
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / Math.max(1, image.naturalWidth), height / Math.max(1, image.naturalHeight));
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawProceduralBase(context: CanvasRenderingContext2D, effect: ReturnType<typeof normalizeSurfaceEffect>) {
  const random = seeded(effect.seed);
  context.clearRect(0, 0, TILE_SIZE, TILE_SIZE);

  if (effect.type === "paper" || effect.type === "fine-grain" || effect.type === "matte-photo" || effect.type === "recycled") {
    context.fillStyle = "#ece6de";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < 1600; i += 1) {
      const x = random() * TILE_SIZE;
      const y = random() * TILE_SIZE;
      const radius = .4 + random() * 1.2;
      const alpha = .05 + random() * .12;
      context.fillStyle = random() > .6 ? `rgba(255,255,255,${alpha})` : `rgba(90,74,60,${alpha * .75})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    return;
  }

  if (effect.type === "crumpled-paper" || effect.type === "handmade" || effect.type === "canvas") {
    context.fillStyle = "#f2f1ef";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < 48; i += 1) {
      const startX = random() * TILE_SIZE;
      const startY = random() * TILE_SIZE;
      context.strokeStyle = random() > .5 ? "rgba(255,255,255,.28)" : "rgba(124,124,124,.18)";
      context.lineWidth = 2 + random() * 4;
      context.beginPath();
      context.moveTo(startX, startY);
      for (let step = 0; step < 5; step += 1) {
        context.lineTo(startX + (random() - .5) * 150, startY + (random() - .5) * 150);
      }
      context.stroke();
    }
    return;
  }

  if (effect.type === "grid-paper") {
    context.fillStyle = "#efe9e0";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    const spacing = 44;
    for (let n = 0; n <= TILE_SIZE; n += spacing) {
      const major = Math.round(n / spacing) % 5 === 0;
      context.strokeStyle = major ? "rgba(122,154,187,.42)" : "rgba(122,154,187,.26)";
      context.lineWidth = major ? 1.4 : 1;
      context.beginPath();
      context.moveTo(n, 0);
      context.lineTo(n, TILE_SIZE);
      context.moveTo(0, n);
      context.lineTo(TILE_SIZE, n);
      context.stroke();
    }
    return;
  }

  if (effect.type === "dotted-paper") {
    context.fillStyle = "#efe9e0";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    const spacing = 42;
    const radius = 2.35;
    context.fillStyle = "rgba(92,112,142,.82)";
    for (let y = spacing / 2; y < TILE_SIZE; y += spacing) {
      for (let x = spacing / 2; x < TILE_SIZE; x += spacing) {
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
    return;
  }

  if (effect.type === "halftone" || effect.type === "newspaper") {
    const spacing = effect.type === "halftone" ? 12 : 8;
    for (let y = 0; y < TILE_SIZE; y += spacing) {
      for (let x = 0; x < TILE_SIZE; x += spacing) {
        const radius = Math.max(.8, spacing * (.08 + random() * .18));
        context.fillStyle = random() > .5 ? "rgba(20,20,20,.45)" : "rgba(255,255,255,.34)";
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
    return;
  }

  if (effect.type === "fold-marks") {
    context.strokeStyle = "rgba(30,24,20,.28)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(TILE_SIZE * .5, 0);
    context.lineTo(TILE_SIZE * .48, TILE_SIZE);
    context.moveTo(0, TILE_SIZE * .52);
    context.lineTo(TILE_SIZE, TILE_SIZE * .49);
    context.stroke();
    return;
  }

  if (effect.type === "dust-scratches") {
    for (let i = 0; i < 140; i += 1) {
      const x = random() * TILE_SIZE;
      const y = random() * TILE_SIZE;
      context.strokeStyle = random() > .5 ? "rgba(255,255,255,.54)" : "rgba(30,24,20,.38)";
      context.lineWidth = .4 + random() * 1.2;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + (random() - .5) * 24, y + random() * 35);
      context.stroke();
    }
  }
}

function drawNoiseAndRoughness(context: CanvasRenderingContext2D, effect: ReturnType<typeof normalizeSurfaceEffect>) {
  const random = seeded(effect.seed ^ 0x9e3779b9);
  const noise = effect.noise / 100;
  const roughness = effect.roughness / 100;

  if (noise > 0) {
    const noiseCanvas = document.createElement("canvas");
    noiseCanvas.width = TILE_SIZE;
    noiseCanvas.height = TILE_SIZE;
    const noiseContext = noiseCanvas.getContext("2d", { alpha: true });
    if (noiseContext) {
      const image = noiseContext.createImageData(TILE_SIZE, TILE_SIZE);
      for (let index = 0; index < image.data.length; index += 4) {
        const value = random();
        const light = value > .5;
        image.data[index] = light ? 255 : 24;
        image.data[index + 1] = light ? 255 : 24;
        image.data[index + 2] = light ? 255 : 24;
        image.data[index + 3] = Math.round((.015 + Math.abs(value - .5) * .11) * noise * 255);
      }
      noiseContext.putImageData(image, 0, 0);
      context.drawImage(noiseCanvas, 0, 0);
    }
  }

  if (roughness > 0) {
    const fibers = Math.round(18 + roughness * 90);
    for (let i = 0; i < fibers; i += 1) {
      const x = random() * TILE_SIZE;
      const y = random() * TILE_SIZE;
      const length = 5 + random() * (18 + roughness * 44);
      const angle = random() * Math.PI * 2;
      context.strokeStyle = random() > .53
        ? `rgba(255,255,255,${.04 + roughness * .16})`
        : `rgba(42,34,28,${.035 + roughness * .14})`;
      context.lineWidth = .35 + random() * (1.3 + roughness * 1.6);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      context.stroke();
    }
  }

  if (effect.tone !== 0) {
    context.save();
    context.globalCompositeOperation = effect.tone > 0 ? "screen" : "multiply";
    context.globalAlpha = Math.min(.62, Math.abs(effect.tone) / 150);
    context.fillStyle = effect.tone > 0 ? "#fffaf0" : "#211b17";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    context.restore();
  }
}

async function createSurfaceTile(effect: PaperTextureEffect, custom?: CustomTextureAsset) {
  const normalized = normalizeSurfaceEffect(effect);
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Surface rendering is unavailable.");

  const src = textureSource(normalized, custom);
  if (src) {
    try {
      const image = await loadSurfaceImage(src, normalized.type !== "custom");
      drawCover(context, image, TILE_SIZE, TILE_SIZE);
    } catch (error) {
      console.warn(`Surface asset could not be loaded: ${normalized.type}`, error);
      drawProceduralBase(context, normalized);
    }
  } else {
    drawProceduralBase(context, normalized);
  }
  if (normalized.type === "dotted-paper") {
    context.save();
    context.globalAlpha = 0.82;
    const spacing = 42;
    context.fillStyle = "rgba(45,64,92,.92)";
    for (let y = spacing / 2; y < TILE_SIZE; y += spacing) {
      for (let x = spacing / 2; x < TILE_SIZE; x += spacing) {
        context.beginPath();
        context.arc(x, y, 2.55, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }
  drawNoiseAndRoughness(context, normalized);
  return canvas;
}

async function cachedSurfaceTile(effect: PaperTextureEffect, custom?: CustomTextureAsset) {
  const key = surfaceTileCacheKey(effect, customFingerprint(custom));
  const existing = tileCache.get(key);
  if (existing) {
    tileCache.delete(key);
    tileCache.set(key, existing);
    return existing;
  }
  const promise = createSurfaceTile(effect, custom);
  tileCache.set(key, promise);
  enforceBoundedCache(tileCache, MAX_SURFACE_TILE_CACHE_ENTRIES);
  return promise;
}

export function clearSurfaceTextureCaches(customUrl?: string) {
  tileCache.clear();
  if (!customUrl) imageCache.clear();
  else imageCache.delete(renderableLocalFileUrl(customUrl));
}

export function surfaceTextureCacheStats() {
  return { tiles: tileCache.size, images: imageCache.size };
}

export async function drawSurfaceTexture(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  effect: PaperTextureEffect,
  custom?: CustomTextureAsset
) {
  const normalized = normalizeSurfaceEffect(effect);
  if (!surfaceEffectIsVisible(normalized)) return;
  const tile = await cachedSurfaceTile(normalized, custom);
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) return;

  const offset = surfaceSeedOffset(normalized.seed);
  const transform = new DOMMatrix()
    .translate(offset.x, offset.y)
    .rotate(normalized.rotation)
    .scale(normalized.scale, normalized.scale);
  pattern.setTransform(transform);

  context.save();
  context.globalAlpha = surfaceCompositeAlpha(normalized);
  context.globalCompositeOperation = normalized.blendMode === "normal" ? "source-over" : normalized.blendMode;
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
  context.restore();
}

export async function drawSurfacePreview(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  effect: PaperTextureEffect,
  custom?: CustomTextureAsset
) {
  const preview = surfacePreviewDimensions(logicalWidth, logicalHeight);
  if (canvas.width !== preview.width) canvas.width = preview.width;
  if (canvas.height !== preview.height) canvas.height = preview.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, preview.width, preview.height);
  context.setTransform(preview.scale, 0, 0, preview.scale, 0, 0);
  await drawSurfaceTexture(context, logicalWidth, logicalHeight, effect, custom);
}

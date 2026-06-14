import type { CanvasSettings, CustomTextureAsset, PaperFrameEffect, PaperTextureEffect, PlaceholderLayer, WallpaperProject } from "../shared/types";
import { computeImagePlacement, resolveMaskGeometry } from "../shared/geometry";
import { paperFrameInsets, paperFrameIsRough, paperFrameRotation } from "../shared/paper";
import { getImageForLayer } from "./project";
import { bundledSurfaceUrl } from "./surface-textures";

const imageLoadTimeoutMs = 12_000;

function renderLog(stage: string, details: Record<string, unknown>) {
  console.error(`[render:${stage}]`, details);
}

function loadImage(src: string, context?: Record<string, unknown>): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      callback();
    };
    const timeout = window.setTimeout(() => finish(() => reject(new Error(`Timed out loading image: ${src}`))), imageLoadTimeoutMs);
    image.onload = () => finish(() => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error(`Image decoded with invalid dimensions: ${src}`));
        return;
      }
      resolve(image);
    });
    image.onerror = () => finish(() => reject(new Error(`Unable to load image: ${src}`)));
    if (/^https?:/i.test(src)) image.crossOrigin = "anonymous";
    try {
      image.src = src;
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(`Unable to assign image source: ${src}`)));
    }
  }).catch((error) => {
    renderLog("image-load", { src, ...context, error: error instanceof Error ? error.message : String(error) });
    throw error;
  });
}

function filterString(layer: PlaceholderLayer) {
  const filters = layer.effects.filters;
  const brightness = filters.brightness + filters.exposure * 6 + filters.highlights * 0.8;
  const contrast = filters.contrast + filters.shadows * -0.35;
  const saturation = filters.saturation + filters.temperature * 0.35;
  return [
    `brightness(${Math.max(0, brightness)}%)`,
    `contrast(${Math.max(0, contrast)}%)`,
    `saturate(${Math.max(0, saturation)}%)`,
    `sepia(${filters.sepia}%)`,
    `grayscale(${filters.grayscale}%)`,
    `blur(${filters.blur}px)`,
    `opacity(${Math.max(0, 100 - filters.fade)}%)`
  ].join(" ");
}

function roundedPath(context: CanvasRenderingContext2D, width: number, height: number, radius: number, ellipse = false) {
  context.beginPath();
  if (ellipse) {
    context.ellipse(width / 2, height / 2, Math.max(0, width / 2), Math.max(0, height / 2), 0, 0, Math.PI * 2);
    context.closePath();
    return;
  }
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(r, 0);
  context.lineTo(width - r, 0);
  context.quadraticCurveTo(width, 0, width, r);
  context.lineTo(width, height - r);
  context.quadraticCurveTo(width, height, width - r, height);
  context.lineTo(r, height);
  context.quadraticCurveTo(0, height, 0, height - r);
  context.lineTo(0, r);
  context.quadraticCurveTo(0, 0, r, 0);
  context.closePath();
}

function shapePath(context: CanvasRenderingContext2D, layer: Pick<PlaceholderLayer, "width" | "height" | "borderRadius" | "maskShape">) {
  const geometry = resolveMaskGeometry(layer.maskShape, layer.width, layer.height, layer.borderRadius);
  roundedPath(context, layer.width, layer.height, geometry.radius, geometry.ellipse);
}

function seeded(seed: number) {
  let state = Math.max(1, Math.floor(seed || 1));
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function roughPaperPath(context: CanvasRenderingContext2D, width: number, height: number, effect: PaperFrameEffect) {
  if (!paperFrameIsRough(effect)) {
    roundedPath(context, width, height, Math.min(18, effect.borderWidth * 0.4));
    return;
  }
  const random = seeded(effect.seed);
  const torn = effect.type === "torn";
  const amplitude = torn
    ? Math.max(4, effect.edgeRoughness * 0.22)
    : Math.max(0.8, effect.edgeRoughness * 0.045);
  const step = torn
    ? Math.max(18, Math.min(width, height) / 12)
    : Math.max(3, Math.min(width, height) / 62);
  const point = (base: number, allowTear = false) => {
    const jitter = (random() - 0.5) * amplitude * 2;
    const tear = torn && allowTear && random() > 0.82 ? (0.35 + random() * 0.65) * amplitude * 2.2 : 0;
    return base + jitter + tear;
  };
  context.beginPath();
  context.moveTo(0, point(0, true));
  for (let x = step; x <= width; x += step) context.lineTo(Math.min(width, x), point(0, true));
  for (let y = step; y <= height; y += step) context.lineTo(point(width, true), Math.min(height, y));
  for (let x = width - step; x >= 0; x -= step) context.lineTo(Math.max(0, x), point(height, true));
  for (let y = height - step; y >= 0; y -= step) context.lineTo(point(0, true), Math.max(0, y));
  context.closePath();
}
function drawPlacedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frameWidth: number,
  frameHeight: number,
  mode: Parameters<typeof computeImagePlacement>[4],
  alignment: Parameters<typeof computeImagePlacement>[5],
  crop: Parameters<typeof computeImagePlacement>[6]
) {
  const placement = computeImagePlacement(image.naturalWidth, image.naturalHeight, frameWidth, frameHeight, mode, alignment, crop);
  if (placement.tile) {
    let startX = placement.x;
    let startY = placement.y;
    while (startX > 0) startX -= placement.width;
    while (startY > 0) startY -= placement.height;
    while (startX + placement.width <= 0) startX += placement.width;
    while (startY + placement.height <= 0) startY += placement.height;
    for (let y = startY; y < frameHeight; y += placement.height) {
      for (let x = startX; x < frameWidth; x += placement.width) context.drawImage(image, x, y, placement.width, placement.height);
    }
    return;
  }
  context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
}

function customTexture(project: WallpaperProject, paper: PaperTextureEffect): CustomTextureAsset | undefined {
  return paper.type === "custom" ? project.customTextures.find((texture) => texture.id === paper.customTextureId) : undefined;
}

async function drawPaperTexture(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  paper: PaperTextureEffect,
  grain = 0,
  custom?: CustomTextureAsset
) {
  const amount = Math.max(grain, paper.intensity);
  if ((paper.type === "none" || paper.opacity <= 0) && amount <= 0) return;
  context.save();
  context.globalAlpha = Math.max(paper.opacity, amount / 100) * 0.42;
  context.globalCompositeOperation = paper.blendMode === "normal" ? "source-over" : paper.blendMode;
  if (paper.type === "custom") {
    try {
      if (!custom) throw new Error("The selected custom texture is no longer available.");
      const image = await loadImage(custom.url, { stage: "custom-texture", textureId: custom.id, texturePath: custom.path });
      const pattern = context.createPattern(image, "repeat");
      if (pattern) {
        const scale = Math.max(0.05, paper.scale);
        pattern.setTransform(new DOMMatrix().scale(scale, scale).rotate(paper.rotation));
        context.fillStyle = pattern;
        context.fillRect(0, 0, width, height);
      }
    } catch (error) {
      renderLog("custom-texture-fallback", {
        textureId: paper.customTextureId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    context.restore();
    return;
  }

  const bundledUrl = bundledSurfaceUrl(paper.type);
  if (bundledUrl) {
    try {
      const image = await loadImage(bundledUrl);
      const pattern = context.createPattern(image, "repeat");
      if (pattern) {
        const scale = Math.max(0.08, paper.scale * 0.45);
        pattern.setTransform(new DOMMatrix().scale(scale, scale).rotate(paper.rotation));
        context.fillStyle = pattern;
        context.fillRect(0, 0, width, height);
      }
    } catch (error) {
      console.warn(`Bundled surface texture could not be loaded: ${paper.type}`, error);
    }
    context.restore();
    return;
  }

  const random = seeded(paper.seed);
  const step = Math.max(4, 18 / Math.max(0.4, paper.scale));
  context.translate(width / 2, height / 2);
  context.rotate((paper.rotation * Math.PI) / 180);
  context.translate(-width / 2, -height / 2);
  for (let y = -step; y < height + step; y += step) {
    for (let x = -step; x < width + step; x += step) {
      const value = random();
      if (paper.type === "canvas") {
        context.strokeStyle = value > 0.5 ? "rgba(255,255,255,.34)" : "rgba(45,38,30,.22)";
        context.lineWidth = Math.max(0.6, step * 0.07);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + step, y);
        context.moveTo(x, y);
        context.lineTo(x, y + step);
        context.stroke();
      } else if (paper.type === "recycled") {
        context.fillStyle = value > 0.62 ? "rgba(96,78,52,.30)" : "rgba(255,255,255,.25)";
        context.fillRect(x, y, Math.max(1, step * 0.48), Math.max(0.7, step * 0.08));
      } else if (paper.type === "matte-photo") {
        context.fillStyle = value > 0.5 ? "rgba(255,255,255,.36)" : "rgba(20,20,20,.09)";
        context.fillRect(x, y, step, Math.max(0.7, step * 0.05));
      } else if (paper.type === "dust-scratches" || paper.type === "halftone" || paper.type === "newspaper") {
        context.fillStyle = value > 0.5 ? "rgba(255,255,255,.28)" : "rgba(30,25,20,.34)";
        context.beginPath();
        context.arc(x, y, Math.max(0.5, step * 0.1), 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillStyle = value > 0.5 ? "rgba(255,255,255,.48)" : "rgba(45,38,30,.26)";
        context.fillRect(x, y, Math.max(0.8, step * 0.12), Math.max(0.8, step * 0.12));
      }
    }
  }
  context.restore();
}

function drawCanvasVignette(context: CanvasRenderingContext2D, canvas: CanvasSettings) {
  if (canvas.backgroundVignette <= 0) return;
  const gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.2, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.72);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.8, canvas.backgroundVignette / 100)})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

async function drawBackground(context: CanvasRenderingContext2D, project: WallpaperProject, format: "png" | "jpeg") {
  const canvas = project.canvas;
  const baseMode = canvas.backgroundBaseMode ?? (canvas.backgroundTransparent ? "transparent" : canvas.backgroundImage ? "image" : "color");
  if (baseMode !== "transparent" || format === "jpeg") {
    context.fillStyle = baseMode === "transparent" && format === "jpeg" ? "#ffffff" : canvas.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (baseMode === "image" && canvas.backgroundImage) {
    try {
      const image = await loadImage(canvas.backgroundImage.url, {
        stage: "background",
        imageId: canvas.backgroundImage.id,
        imagePath: canvas.backgroundImage.path
      });
      context.save();
      context.globalAlpha = canvas.backgroundOpacity;
      context.filter = `brightness(${canvas.backgroundBrightness}%) contrast(${canvas.backgroundContrast}%) blur(${canvas.backgroundBlur}px)`;
      drawPlacedImage(context, image, canvas.width, canvas.height, canvas.backgroundMode, canvas.backgroundAlignment, { offsetX: canvas.backgroundOffsetX, offsetY: canvas.backgroundOffsetY, zoom: canvas.backgroundScale });
      context.restore();
      if (canvas.backgroundTemperature !== 0) {
        context.save();
        context.globalCompositeOperation = "soft-light";
        context.globalAlpha = Math.min(0.35, Math.abs(canvas.backgroundTemperature) / 280);
        context.fillStyle = canvas.backgroundTemperature > 0 ? "#ff9b55" : "#5e8dff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
      }
    } catch (error) {
      renderLog("background-fallback", {
        imageId: canvas.backgroundImage.id,
        imagePath: canvas.backgroundImage.path,
        error: error instanceof Error ? error.message : String(error)
      });
      // The base color was already painted, so a stale background image should
      // not prevent exporting or applying the rest of the composition.
    }
  }
  await drawPaperTexture(context, canvas.width, canvas.height, canvas.backgroundPaper, 0, customTexture(project, canvas.backgroundPaper));
}

function drawVignette(context: CanvasRenderingContext2D, layer: PlaceholderLayer) {
  const amount = layer.effects.filters.vignette;
  if (amount <= 0) return;
  const gradient = context.createRadialGradient(layer.width / 2, layer.height / 2, Math.min(layer.width, layer.height) * 0.18, layer.width / 2, layer.height / 2, Math.max(layer.width, layer.height) * 0.72);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.7, amount / 100)})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, layer.width, layer.height);
}

async function drawLayer(context: CanvasRenderingContext2D, project: WallpaperProject, layer: PlaceholderLayer) {
  if (layer.hidden) return;
  const imageRef = getImageForLayer(project, layer);
  const paperFrame = layer.effects.paperFrame;
  const insets = paperFrameInsets(paperFrame, layer.width, layer.height);
  const innerWidth = Math.max(1, layer.width - insets.left - insets.right);
  const innerHeight = Math.max(1, layer.height - insets.top - insets.bottom);

  context.save();
  context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  context.rotate(((layer.rotation + paperFrameRotation(paperFrame)) * Math.PI) / 180);
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = layer.effects.blendMode === "normal" ? "source-over" : layer.effects.blendMode;
  context.translate(-layer.width / 2, -layer.height / 2);

  const shadowStrength = Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength);
  if (shadowStrength > 0) {
    context.shadowColor = `rgba(15,23,42,${Math.min(0.45, shadowStrength / 180)})`;
    context.shadowBlur = 8 + shadowStrength * 0.55;
    context.shadowOffsetY = 3 + shadowStrength * 0.22;
  }

  if (paperFrame.type !== "none") {
    roughPaperPath(context, layer.width, layer.height, paperFrame);
    context.fillStyle = paperFrame.paperColor;
    context.fill();
    context.shadowColor = "transparent";
    if (paperFrame.textureIntensity > 0) {
      await drawPaperTexture(context, layer.width, layer.height, { ...layer.effects.paper, type: layer.effects.paper.type === "none" ? "fine-grain" : layer.effects.paper.type, intensity: paperFrame.textureIntensity, opacity: paperFrame.textureIntensity / 100 }, 0, customTexture(project, layer.effects.paper));
    }
  }

  context.save();
  context.translate(insets.left, insets.top);
  const innerRadius = layer.maskShape === "circle" ? 0 : Math.max(0, layer.borderRadius - Math.max(insets.left, insets.top));
  roundedPath(context, innerWidth, innerHeight, innerRadius, layer.maskShape === "circle");
  context.clip();
  context.shadowColor = "transparent";
  context.fillStyle = layer.effects.backgroundColor || "#ffffff";
  context.fillRect(0, 0, innerWidth, innerHeight);
  if (imageRef) {
    try {
      const image = await loadImage(imageRef.url, {
        stage: "layer",
        layerId: layer.id,
        layerName: layer.name,
        imageId: imageRef.id,
        imagePath: imageRef.path,
        mediaType: imageRef.mediaType
      });
      context.save();
      context.filter = filterString(layer);
      drawPlacedImage(context, image, innerWidth, innerHeight, layer.cropMode, layer.alignment, layer.crop);
      context.restore();
    } catch (error) {
      renderLog("layer-fallback", {
        layerId: layer.id,
        layerName: layer.name,
        imageId: imageRef.id,
        imagePath: imageRef.path,
        error: error instanceof Error ? error.message : String(error)
      });
      context.fillStyle = layer.effects.backgroundColor || "#d9d7d0";
      context.fillRect(0, 0, innerWidth, innerHeight);
    }
  } else {
    context.fillStyle = "#d9d7d0";
    context.fillRect(0, 0, innerWidth, innerHeight);
  }
  await drawPaperTexture(context, innerWidth, innerHeight, layer.effects.paper, layer.effects.filters.grain, customTexture(project, layer.effects.paper));
  if (layer.effects.innerShadow) {
    context.save();
    context.shadowColor = "rgba(15,23,42,.34)";
    context.shadowBlur = 20;
    context.lineWidth = 14;
    roundedPath(context, innerWidth, innerHeight, innerRadius, layer.maskShape === "circle");
    context.strokeStyle = "rgba(0,0,0,.01)";
    context.stroke();
    context.restore();
  }
  context.restore();
  context.restore();

  if (layer.borderWidth > 0) {
    context.save();
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate(((layer.rotation + paperFrameRotation(paperFrame)) * Math.PI) / 180);
    context.globalAlpha = layer.opacity * layer.borderOpacity;
    context.translate(-layer.width / 2, -layer.height / 2);
    shapePath(context, layer);
    context.strokeStyle = layer.borderColor;
    context.lineWidth = layer.borderWidth;
    context.stroke();
    context.restore();
  }
}

export async function renderProjectToDataUrl(project: WallpaperProject, format: "png" | "jpeg", quality = 0.92) {
  const width = Math.round(Number(project.canvas.width));
  const height = Math.round(Number(project.canvas.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(`Invalid canvas dimensions: ${project.canvas.width} × ${project.canvas.height}.`);
  }
  if (width > 16_384 || height > 16_384 || width * height > 100_000_000) {
    throw new Error(`Canvas dimensions are too large to render safely: ${width} × ${height}.`);
  }

  console.info("[render:start]", { projectId: project.id, projectName: project.name, width, height, format, layers: project.layers.length });
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");

  try {
    await drawBackground(context, project, format);
    for (const layer of project.layers) {
      try {
        await drawLayer(context, project, layer);
      } catch (error) {
        renderLog("layer-render", {
          projectId: project.id,
          layerId: layer.id,
          layerName: layer.name,
          error: error instanceof Error ? error.message : String(error)
        });
        // An optional effect or malformed legacy layer should not make the
        // entire wallpaper pipeline unusable. Continue with the other layers.
      }
    }
    const dataUrl = output.toDataURL(format === "png" ? "image/png" : "image/jpeg", Math.max(0, Math.min(1, quality)));
    if (!dataUrl.startsWith(`data:image/${format === "png" ? "png" : "jpeg"};base64,`) || dataUrl.length < 64) {
      throw new Error("Canvas serialization returned invalid image data.");
    }
    console.info("[render:complete]", { projectId: project.id, bytesApprox: Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75) });
    return dataUrl;
  } catch (error) {
    renderLog("fatal", {
      projectId: project.id,
      projectName: project.name,
      width,
      height,
      format,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

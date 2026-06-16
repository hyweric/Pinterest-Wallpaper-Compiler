import type { CanvasSettings, CustomTextureAsset, PaperFrameEffect, PaperTextureEffect, PlaceholderLayer, WallpaperProject } from "../shared/types";
import { computeImagePlacement, resolveMaskGeometry } from "../shared/geometry";
import { isRenderableLocalFileUrl, renderableLocalFileUrl } from "../shared/local-file-url";
import { paperFrameInsets, paperFrameIsRough, paperFrameRotation } from "../shared/paper";
import { getImageForLayer } from "./project";
import { drawSurfaceTexture } from "./surface-renderer";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const renderSrc = renderableLocalFileUrl(src);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    if (isRenderableLocalFileUrl(renderSrc)) image.crossOrigin = "anonymous";
    image.src = renderSrc;
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
    const image = await loadImage(canvas.backgroundImage.url);
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
  }
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
      await drawSurfaceTexture(context, layer.width, layer.height, { ...layer.effects.paper, enabled: true, type: layer.effects.paper.type === "none" ? "paper" : layer.effects.paper.type, intensity: paperFrame.textureIntensity, opacity: paperFrame.textureIntensity / 100 }, customTexture(project, layer.effects.paper));
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
    const image = await loadImage(imageRef.url);
    context.save();
    context.filter = filterString(layer);
    drawPlacedImage(context, image, innerWidth, innerHeight, layer.cropMode, layer.alignment, layer.crop);
    context.restore();
  } else {
    context.fillStyle = "#d9d7d0";
    context.fillRect(0, 0, innerWidth, innerHeight);
  }
  await drawSurfaceTexture(context, innerWidth, innerHeight, {
    ...layer.effects.paper,
    enabled: (layer.effects.paper.enabled ?? layer.effects.paper.type !== "none") || layer.effects.filters.grain > 0,
    type: layer.effects.paper.type === "none" && layer.effects.filters.grain > 0 ? "paper" : layer.effects.paper.type,
    intensity: Math.max(layer.effects.paper.intensity, layer.effects.filters.grain),
    opacity: Math.max(layer.effects.paper.opacity, layer.effects.filters.grain / 100)
  }, customTexture(project, layer.effects.paper));
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

function validateCanvasDimensions(project: WallpaperProject) {
  const width = Math.round(Number(project.canvas.width));
  const height = Math.round(Number(project.canvas.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(`Invalid canvas dimensions: ${project.canvas.width} × ${project.canvas.height}.`);
  }
  if (width > 16_384 || height > 16_384 || width * height > 100_000_000) {
    throw new Error(`Canvas dimensions are too large to render safely: ${width} × ${height}.`);
  }
  return { width, height };
}

async function renderProjectToCanvas(project: WallpaperProject, format: "png" | "jpeg") {
  const { width, height } = validateCanvasDimensions(project);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");

  await drawBackground(context, project, format);
  await drawSurfaceTexture(context, width, height, project.canvas.backgroundPaper, customTexture(project, project.canvas.backgroundPaper));
  for (const layer of project.layers) await drawLayer(context, project, layer);
  drawCanvasVignette(context, project.canvas);
  return output;
}

function canvasToBlob(canvas: HTMLCanvasElement, format: "png" | "jpeg", quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Canvas serialization returned no image data.")),
      format === "png" ? "image/png" : "image/jpeg",
      Math.max(0, Math.min(1, quality))
    );
  });
}

export async function renderProjectToArrayBuffer(project: WallpaperProject, format: "png" | "jpeg", quality = 0.92) {
  const output = await renderProjectToCanvas(project, format);
  const blob = await canvasToBlob(output, format, quality);
  const imageData = await blob.arrayBuffer();
  if (imageData.byteLength < 16) throw new Error("Canvas serialization returned empty image data.");
  return imageData;
}

export async function renderProjectToDataUrl(project: WallpaperProject, format: "png" | "jpeg", quality = 0.92) {
  const output = await renderProjectToCanvas(project, format);
  const blob = await canvasToBlob(output, format, quality);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read rendered image data."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      if (!result.startsWith("data:image/")) reject(new Error("Canvas serialization returned invalid image data."));
      else resolve(result);
    };
    reader.readAsDataURL(blob);
  });
}

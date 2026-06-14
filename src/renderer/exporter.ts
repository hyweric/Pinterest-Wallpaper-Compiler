import type { CanvasSettings, PaperTextureEffect, PlaceholderLayer, WallpaperProject } from "../shared/types";
import { computeImagePlacement, resolveMaskGeometry } from "../shared/geometry";
import { getImageForLayer } from "./project";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
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

function shapePath(context: CanvasRenderingContext2D, layer: Pick<PlaceholderLayer, "width" | "height" | "borderRadius" | "maskShape">) {
  const { width, height } = layer;
  context.beginPath();
  const geometry = resolveMaskGeometry(layer.maskShape, width, height, layer.borderRadius);
  if (geometry.ellipse) {
    context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.closePath();
    return;
  }
  const radius = geometry.radius;
  context.moveTo(radius, 0);
  context.lineTo(width - radius, 0);
  context.quadraticCurveTo(width, 0, width, radius);
  context.lineTo(width, height - radius);
  context.quadraticCurveTo(width, height, width - radius, height);
  context.lineTo(radius, height);
  context.quadraticCurveTo(0, height, 0, height - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
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
  const placement = computeImagePlacement(
    image.naturalWidth,
    image.naturalHeight,
    frameWidth,
    frameHeight,
    mode,
    alignment,
    crop
  );
  if (placement.tile) {
    let startX = placement.x;
    let startY = placement.y;
    while (startX > 0) startX -= placement.width;
    while (startY > 0) startY -= placement.height;
    while (startX + placement.width <= 0) startX += placement.width;
    while (startY + placement.height <= 0) startY += placement.height;
    for (let y = startY; y < frameHeight; y += placement.height) {
      for (let x = startX; x < frameWidth; x += placement.width) {
        context.drawImage(image, x, y, placement.width, placement.height);
      }
    }
    return;
  }
  context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
}

function drawPaperTexture(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  paper: PaperTextureEffect,
  grain = 0
) {
  const amount = Math.max(grain, paper.intensity);
  if ((paper.type === "none" || paper.opacity <= 0) && amount <= 0) return;
  context.save();
  context.globalAlpha = Math.max(paper.opacity, amount / 100) * 0.38;
  context.globalCompositeOperation = paper.blendMode === "normal" ? "source-over" : paper.blendMode;
  const step = Math.max(6, 18 / Math.max(0.5, paper.scale));
  context.translate(width / 2, height / 2);
  context.rotate((paper.rotation * Math.PI) / 180);
  context.translate(-width / 2, -height / 2);
  let seed = paper.seed || 1;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      seed = (seed * 9301 + 49297) % 233280;
      const value = seed / 233280;
      if (paper.type === "newspaper") {
        context.fillStyle = value > 0.48 ? "rgba(36,31,25,0.22)" : "rgba(255,255,255,0.18)";
        context.beginPath();
        context.arc(x, y, Math.max(0.8, step * 0.12), 0, Math.PI * 2);
        context.fill();
      } else if (paper.type === "canvas") {
        context.strokeStyle = value > 0.5 ? "rgba(255,255,255,0.24)" : "rgba(36,31,25,0.16)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + step * 0.8, y);
        context.moveTo(x, y);
        context.lineTo(x, y + step * 0.8);
        context.stroke();
      } else if (paper.type === "recycled") {
        context.fillStyle = value > 0.6 ? "rgba(92,79,60,0.22)" : "rgba(255,255,255,0.24)";
        context.fillRect(x, y, Math.max(1, step * 0.35), Math.max(1, step * 0.08));
      } else {
        context.fillStyle = value > 0.5 ? "rgba(255,255,255,0.45)" : "rgba(36,31,25,0.35)";
        context.fillRect(x, y, Math.max(1, step * 0.18), Math.max(1, step * 0.18));
      }
    }
  }
  if (paper.type === "fold-marks" || paper.type === "matte-photo") {
    context.strokeStyle = "rgba(255,255,255,0.5)";
    context.lineWidth = paper.type === "fold-marks" ? 2 : 1;
    context.beginPath();
    context.moveTo(width * 0.5, 0);
    context.lineTo(width * 0.52, height);
    context.stroke();
  }
  context.restore();
}

async function drawBackground(context: CanvasRenderingContext2D, canvas: CanvasSettings, format: "png" | "jpeg") {
  if (!canvas.backgroundTransparent || format === "jpeg") {
    context.fillStyle = canvas.backgroundTransparent && format === "jpeg" ? "#ffffff" : canvas.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (canvas.backgroundImage) {
    const image = await loadImage(canvas.backgroundImage.url);
    context.save();
    context.globalAlpha = canvas.backgroundOpacity;
    context.filter = `brightness(${canvas.backgroundBrightness}%) blur(${canvas.backgroundBlur}px)`;
    drawPlacedImage(
      context,
      image,
      canvas.width,
      canvas.height,
      canvas.backgroundMode,
      canvas.backgroundAlignment,
      { offsetX: canvas.backgroundOffsetX, offsetY: canvas.backgroundOffsetY, zoom: canvas.backgroundScale }
    );
    context.restore();
  }
  drawPaperTexture(context, canvas.width, canvas.height, canvas.backgroundPaper);
}

function drawVignette(context: CanvasRenderingContext2D, layer: PlaceholderLayer) {
  const amount = layer.effects.filters.vignette;
  if (amount <= 0) return;
  const gradient = context.createRadialGradient(
    layer.width / 2,
    layer.height / 2,
    Math.min(layer.width, layer.height) * 0.18,
    layer.width / 2,
    layer.height / 2,
    Math.max(layer.width, layer.height) * 0.72
  );
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.7, amount / 100)})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, layer.width, layer.height);
}

async function drawLayer(context: CanvasRenderingContext2D, project: WallpaperProject, layer: PlaceholderLayer) {
  if (layer.hidden) return;
  const imageRef = getImageForLayer(project, layer);

  context.save();
  context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  context.rotate((layer.rotation * Math.PI) / 180);
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = layer.effects.blendMode === "normal" ? "source-over" : layer.effects.blendMode;
  context.translate(-layer.width / 2, -layer.height / 2);

  if (layer.shadow) {
    context.shadowColor = "rgba(15, 23, 42, 0.28)";
    context.shadowBlur = 28;
    context.shadowOffsetY = 14;
  }

  shapePath(context, layer);
  context.clip();
  if (layer.effects.backgroundColor) {
    context.fillStyle = layer.effects.backgroundColor;
    context.fillRect(0, 0, layer.width, layer.height);
  }

  if (imageRef) {
    const image = await loadImage(imageRef.url);
    context.save();
    context.filter = filterString(layer);
    drawPlacedImage(context, image, layer.width, layer.height, layer.cropMode, layer.alignment, layer.crop);
    context.restore();
  } else {
    context.fillStyle = "#d9d7d0";
    context.fillRect(0, 0, layer.width, layer.height);
  }

  drawPaperTexture(context, layer.width, layer.height, layer.effects.paper, layer.effects.filters.grain);
  drawVignette(context, layer);

  if (layer.effects.innerShadow) {
    context.save();
    context.shadowColor = "rgba(15,23,42,.34)";
    context.shadowBlur = 20;
    context.lineWidth = 14;
    shapePath(context, layer);
    context.strokeStyle = "rgba(0,0,0,.01)";
    context.stroke();
    context.restore();
  }
  context.restore();

  if (layer.borderWidth > 0) {
    context.save();
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.globalAlpha = layer.opacity * layer.borderOpacity;
    context.translate(-layer.width / 2, -layer.height / 2);
    shapePath(context, layer);
    context.strokeStyle = layer.borderColor;
    context.lineWidth = layer.borderWidth;
    context.stroke();
    context.restore();
  }
}

export async function renderProjectToDataUrl(project: WallpaperProject, format: "png" | "jpeg") {
  const output = document.createElement("canvas");
  output.width = project.canvas.width;
  output.height = project.canvas.height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");

  await drawBackground(context, project.canvas, format);
  for (const layer of project.layers) await drawLayer(context, project, layer);
  return output.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
}

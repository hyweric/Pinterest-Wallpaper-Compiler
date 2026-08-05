import type { CanvasSettings, CustomTextureAsset, PaperFrameEffect, PaperTextureEffect, PlaceholderLayer, ShadowEffect, TornPaperEffect, WallpaperProject } from "../shared/types";
import { computeImagePlacement, resolveMaskGeometry } from "../shared/geometry";
import { resolveLayerFrameBounds } from "../shared/adaptive-frame";
import { isRenderableLocalFileUrl, renderableLocalFileUrl } from "../shared/local-file-url";
import { paperFrameInsets, paperFrameIsRough, paperFrameRotation } from "../shared/paper";
import { normalizePolaroidEffect, normalizeTornPaperEffect, paperWarmthOverlay, tornPaperPolygonPoints, tornPaperTextureDataUrl } from "../shared/frame-effects";
import { getImageForLayer, sourceImagesForPolicy } from "./project";
import { imageBackgroundColor } from "../shared/image-transparency";
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

async function loadLayerImage(project: WallpaperProject, layer: PlaceholderLayer) {
  const selected = getImageForLayer(project, layer);
  const sourceIds = layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
  const candidates = sourceIds.flatMap((sourceId) => {
    const source = project.sources.find((item) => item.id === sourceId);
    return source ? sourceImagesForPolicy(source) : [];
  });
  const ordered = selected ? [selected, ...candidates.filter((item) => item.id !== selected.id)] : candidates;
  const attempted = new Set<string>();
  for (const candidate of ordered) {
    if (attempted.has(candidate.id)) continue;
    attempted.add(candidate.id);
    try {
      return { imageRef: candidate, image: await loadImage(candidate.url) };
    } catch {
      // Deleted or unreadable cache entries are stale and should not abort the export.
    }
  }
  return { imageRef: undefined, image: undefined };
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

function innerShapePath(context: CanvasRenderingContext2D, layer: Pick<PlaceholderLayer, "width" | "height" | "borderRadius" | "maskShape">, inset: number) {
  const safeInset = Math.max(0, Math.min(inset, layer.width / 2, layer.height / 2));
  const width = Math.max(1, layer.width - safeInset * 2);
  const height = Math.max(1, layer.height - safeInset * 2);
  const geometry = resolveMaskGeometry(layer.maskShape, layer.width, layer.height, layer.borderRadius);
  context.save();
  context.translate(safeInset, safeInset);
  roundedPath(context, width, height, geometry.radius, geometry.ellipse);
  context.restore();
}

function outerStrokeShapePath(context: CanvasRenderingContext2D, layer: Pick<PlaceholderLayer, "width" | "height" | "borderRadius" | "maskShape">, outset: number) {
  const safeOutset = Math.max(0, outset);
  const width = Math.max(1, layer.width + safeOutset * 2);
  const height = Math.max(1, layer.height + safeOutset * 2);
  const geometry = resolveMaskGeometry(layer.maskShape, layer.width, layer.height, layer.borderRadius);
  const radius = geometry.ellipse ? geometry.radius : geometry.radius + safeOutset;
  context.save();
  context.translate(-safeOutset, -safeOutset);
  roundedPath(context, width, height, radius, geometry.ellipse);
  context.restore();
}

function seeded(seed: number) {
  let state = Math.max(1, Math.floor(seed || 1));
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function roughPaperPath(context: CanvasRenderingContext2D, width: number, height: number, effect: PaperFrameEffect, tornPaper?: TornPaperEffect, radius?: number) {
  if (!paperFrameIsRough(effect)) {
    roundedPath(context, width, height, radius ?? Math.min(18, effect.borderWidth * 0.4));
    return;
  }
  if (tornPaper) {
    const points = tornPaperPolygonPoints(normalizeTornPaperEffect(tornPaper, effect), width, height);
    context.beginPath();
    points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
    context.closePath();
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

function colorWithAlpha(color: string, opacity: number) {
  const alpha = Math.max(0, Math.min(1, opacity));
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
  }
  return color;
}

function applyCanvasShadow(context: CanvasRenderingContext2D, shadow: ShadowEffect) {
  if (!shadow.enabled || shadow.opacity <= 0) return false;
  context.shadowColor = colorWithAlpha(shadow.color, shadow.opacity);
  context.shadowBlur = shadow.blur;
  context.shadowOffsetX = shadow.x;
  context.shadowOffsetY = shadow.y;
  return true;
}

function drawInsetShadow(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
  ellipse: boolean,
  shadow: ShadowEffect
) {
  if (!shadow.enabled || shadow.opacity <= 0) return;
  context.save();
  context.shadowColor = colorWithAlpha(shadow.color, shadow.opacity);
  context.shadowBlur = shadow.blur;
  context.shadowOffsetX = shadow.x;
  context.shadowOffsetY = shadow.y;
  context.lineWidth = Math.max(12, shadow.spread * 2 + 14);
  roundedPath(context, width, height, radius, ellipse);
  context.strokeStyle = "rgba(0,0,0,.01)";
  context.stroke();
  context.restore();
}

async function drawLayer(context: CanvasRenderingContext2D, project: WallpaperProject, layer: PlaceholderLayer) {
  if (layer.hidden) return;
  if (layer.objectKind === "text") {
    context.save();
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.globalAlpha = layer.opacity;
    context.translate(-layer.width / 2, -layer.height / 2);
    context.fillStyle = layer.textColor ?? "#26313a";
    context.font = `${layer.fontWeight ?? 800} ${layer.fontSize ?? 72}px ${layer.fontFamily ?? "Inter, system-ui, sans-serif"}`;
    context.textAlign = layer.textAlign ?? "center";
    context.textBaseline = "middle";
    const lines = (layer.text ?? "Text").split(/\r?\n/);
    const lineHeight = (layer.fontSize ?? 72) * (layer.lineHeight ?? 1.12);
    const startY = layer.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    const x = (layer.textAlign ?? "center") === "left" ? 0 : (layer.textAlign ?? "center") === "right" ? layer.width : layer.width / 2;
    for (let index = 0; index < lines.length; index += 1) {
      context.fillText(lines[index], x, startY + index * lineHeight, layer.width);
    }
    context.restore();
    return;
  }
  const { imageRef, image } = await loadLayerImage(project, layer);
  const frame = resolveLayerFrameBounds(layer, image ?? imageRef);
  const visualLayer = { ...layer, x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  const paperFrame = layer.effects.paperFrame;
  const polaroid = normalizePolaroidEffect(layer.effects.polaroid, paperFrame, layer.effects.innerShadow);
  const tornPaper = normalizeTornPaperEffect(layer.effects.tornPaper, paperFrame, layer.effects.innerShadow);
  const polaroidActive = paperFrame.type === "polaroid";
  const tornActive = paperFrame.type === "torn" || paperFrame.type === "deckle";
  const insets = paperFrameInsets(paperFrame, frame.width, frame.height, polaroid, tornPaper);
  const innerWidth = Math.max(1, frame.width - insets.left - insets.right);
  const innerHeight = Math.max(1, frame.height - insets.top - insets.bottom);
  const frameRotation = paperFrameRotation(paperFrame, polaroid);
  const frameColor = polaroidActive ? polaroid.frameColor : tornActive ? tornPaper.paperColor : paperFrame.paperColor;
  const frameOpacity = polaroidActive ? polaroid.frameOpacity : tornActive ? tornPaper.paperOpacity : 1;
  const frameRadius = polaroidActive ? polaroid.cornerRadius : Math.min(18, paperFrame.borderWidth * 0.4);
  const frameTextureIntensity = polaroidActive ? polaroid.grain : tornActive ? tornPaper.grain : paperFrame.textureIntensity;
  const outerShadow = polaroidActive ? polaroid.dropShadow : tornActive ? tornPaper.outerShadow : undefined;
  const innerShadow = polaroidActive ? polaroid.innerShadow : tornActive ? tornPaper.innerShadow : undefined;
  const imageTransform = polaroidActive
    ? { scale: polaroid.imageScale, x: polaroid.imageOffsetX, y: polaroid.imageOffsetY, rotation: polaroid.imageRotation }
    : tornActive
      ? { scale: tornPaper.imageScale, x: tornPaper.imageOffsetX, y: tornPaper.imageOffsetY, rotation: 0 }
      : { scale: 1, x: 0, y: 0, rotation: 0 };

  context.save();
  context.translate(frame.x + frame.width / 2, frame.y + frame.height / 2);
  context.rotate(((layer.rotation + frameRotation) * Math.PI) / 180);
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = layer.effects.blendMode === "normal" ? "source-over" : layer.effects.blendMode;
  context.translate(-frame.width / 2, -frame.height / 2);

  const expandedShadowApplied = outerShadow ? applyCanvasShadow(context, outerShadow) : false;
  if (!expandedShadowApplied) {
    const shadowStrength = Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength);
    if (shadowStrength > 0) {
      context.shadowColor = `rgba(15,23,42,${Math.min(0.45, shadowStrength / 180)})`;
      context.shadowBlur = 8 + shadowStrength * 0.55;
      context.shadowOffsetY = 3 + shadowStrength * 0.22;
    }
  }

  if (paperFrame.type !== "none") {
    roughPaperPath(context, frame.width, frame.height, paperFrame, tornActive ? tornPaper : undefined, frameRadius);
    const previousAlpha = context.globalAlpha;
    context.globalAlpha = layer.opacity * frameOpacity;
    context.fillStyle = frameColor;
    context.fill();
    context.globalAlpha = previousAlpha;
    context.shadowColor = "transparent";
    if (frameTextureIntensity > 0) {
      context.save();
      roughPaperPath(
        context,
        frame.width,
        frame.height,
        paperFrame,
        tornActive ? tornPaper : undefined,
        frameRadius
      );
      context.clip();
      context.shadowColor = "transparent";
      await drawSurfaceTexture(context, frame.width, frame.height, {
        ...layer.effects.paper,
        enabled: true,
        type: layer.effects.paper.type === "none" ? "paper" : layer.effects.paper.type,
        intensity: frameTextureIntensity,
        opacity: frameTextureIntensity / 100,
        tone: 0
      }, customTexture(project, layer.effects.paper));
      context.restore();
    }
    const warmth = polaroidActive ? paperWarmthOverlay(polaroid.warmth) : undefined;
    if (warmth) {
      context.save();
      roughPaperPath(context, frame.width, frame.height, paperFrame, tornActive ? tornPaper : undefined, frameRadius);
      context.clip();
      context.globalCompositeOperation = "soft-light";
      context.globalAlpha = layer.opacity * warmth.opacity;
      context.fillStyle = warmth.color;
      context.fillRect(0, 0, frame.width, frame.height);
      context.restore();
    }
    if (tornActive && (tornPaper.fibers > 0 || tornPaper.wrinkles > 0 || tornPaper.stains > 0 || tornPaper.speckles > 0 || tornPaper.edgeDarkening > 0)) {
      const texture = await loadImage(tornPaperTextureDataUrl(tornPaper, frame.width, frame.height));
      context.save();
      roughPaperPath(context, frame.width, frame.height, paperFrame, tornPaper, frameRadius);
      context.clip();
      context.shadowColor = "transparent";
      context.globalAlpha = layer.opacity;
      context.globalCompositeOperation = "source-over";
      context.drawImage(texture, 0, 0, frame.width, frame.height);
      context.restore();
    }
  }

  context.save();
  context.translate(insets.left, insets.top);
  const innerRadius = polaroidActive ? Math.max(0, polaroid.cornerRadius - Math.max(insets.left, insets.top)) : tornActive ? 0 : layer.maskShape === "circle" ? 0 : layer.borderRadius;
  roundedPath(context, innerWidth, innerHeight, innerRadius, layer.maskShape === "circle");
  context.clip();
  context.shadowColor = "transparent";
  const innerBackground = imageBackgroundColor(layer.effects.backgroundColor, imageRef);
  if (innerBackground !== "transparent") {
    context.fillStyle = innerBackground;
    context.fillRect(0, 0, innerWidth, innerHeight);
  }
  if (image) {
    context.save();
    context.filter = filterString(layer);
    context.translate(innerWidth / 2 + imageTransform.x, innerHeight / 2 + imageTransform.y);
    context.rotate((imageTransform.rotation * Math.PI) / 180);
    context.scale(imageTransform.scale, imageTransform.scale);
    context.translate(-innerWidth / 2, -innerHeight / 2);
    drawPlacedImage(
      context,
      image,
      innerWidth,
      innerHeight,
      layer.frameMode === "adaptive" ? "contain" : layer.cropMode,
      layer.frameMode === "adaptive" ? "center" : layer.alignment,
      layer.frameMode === "adaptive" ? { offsetX: 0, offsetY: 0, zoom: 1 } : layer.crop
    );
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
  if (innerShadow) drawInsetShadow(context, innerWidth, innerHeight, innerRadius, layer.maskShape === "circle", innerShadow);
  else if (layer.effects.innerShadow) {
    drawInsetShadow(context, innerWidth, innerHeight, innerRadius, layer.maskShape === "circle", {
      enabled: true,
      x: 0,
      y: 0,
      blur: 20,
      spread: 0,
      opacity: .34,
      color: "#0f172a"
    });
  }
  context.restore();

  if (polaroidActive && polaroid.caption.enabled && polaroid.caption.text) {
    const captionTop = Math.max(insets.top + innerHeight, frame.height - Math.max(polaroid.captionHeight, polaroid.borderBottom - polaroid.borderTop));
    const captionWidth = Math.max(1, frame.width - polaroid.borderLeft - polaroid.borderRight);
    const captionHeight = Math.max(1, frame.height - captionTop);
    context.save();
    context.translate(polaroid.caption.x, polaroid.caption.y);
    context.fillStyle = polaroid.caption.color;
    context.font = `${polaroid.caption.fontWeight} ${polaroid.caption.fontSize}px "${polaroid.caption.fontFamily}", sans-serif`;
    context.textBaseline = "middle";
    context.textAlign = polaroid.caption.alignment;
    const x = polaroid.caption.alignment === "left"
      ? polaroid.borderLeft
      : polaroid.caption.alignment === "right"
        ? polaroid.borderLeft + captionWidth
        : polaroid.borderLeft + captionWidth / 2;
    context.fillText(polaroid.caption.text, x, captionTop + captionHeight / 2, captionWidth);
    context.restore();
  }

  context.restore();

  if (!polaroidActive && !tornActive && layer.borderWidth > 0) {
    context.save();
    context.translate(frame.x + frame.width / 2, frame.y + frame.height / 2);
    context.rotate(((layer.rotation + frameRotation) * Math.PI) / 180);
    context.globalAlpha = layer.opacity * layer.borderOpacity;
    context.translate(-frame.width / 2, -frame.height / 2);
    outerStrokeShapePath(context, visualLayer, layer.borderWidth / 2);
    context.strokeStyle = layer.borderColor;
    context.lineWidth = layer.borderWidth;
    context.lineJoin = "round";
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

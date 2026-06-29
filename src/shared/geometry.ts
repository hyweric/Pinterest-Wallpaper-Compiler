import type {
  BackgroundFitMode,
  CanvasResizeMode,
  CanvasSettings,
  CropMode,
  CropTransform,
  ImageAlignment,
  MaskShape,
  PlaceholderLayer,
  ProjectLayer
} from "./types.js";

export interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  tile: boolean;
}

const coverOverscanPx = 1;

function alignedOffset(frame: number, content: number, axis: "x" | "y", alignment: ImageAlignment) {
  if (axis === "x") {
    if (alignment.includes("left")) return 0;
    if (alignment.includes("right")) return frame - content;
  } else {
    if (alignment.includes("top")) return 0;
    if (alignment.includes("bottom")) return frame - content;
  }
  return (frame - content) / 2;
}

function clampPlacementOffset(frame: number, content: number, offset: number) {
  if (content <= frame) return (frame - content) / 2;
  return Math.min(0, Math.max(frame - content, offset));
}

function computeBaseImageSize(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  mode: CropMode | BackgroundFitMode
) {
  const safeImageWidth = Math.max(1, imageWidth);
  const safeImageHeight = Math.max(1, imageHeight);
  const safeFrameWidth = Math.max(1, frameWidth);
  const safeFrameHeight = Math.max(1, frameHeight);
  const imageRatio = safeImageWidth / safeImageHeight;
  const frameRatio = safeFrameWidth / safeFrameHeight;
  const normalizedMode = mode === "center" ? "original" : mode;

  let width: number;
  let height: number;

  if (normalizedMode === "stretch") {
    width = safeFrameWidth;
    height = safeFrameHeight;
  } else if (normalizedMode === "original" || normalizedMode === "tile") {
    width = safeImageWidth;
    height = safeImageHeight;
  } else {
    const cover = normalizedMode === "cover";
    const useFrameWidth = cover ? imageRatio < frameRatio : imageRatio > frameRatio;
    width = useFrameWidth ? safeFrameWidth : safeFrameHeight * imageRatio;
    height = width / imageRatio;
    if (cover) {
      const overscanScale = Math.max(
        1,
        (safeFrameWidth + coverOverscanPx * 2) / width,
        (safeFrameHeight + coverOverscanPx * 2) / height
      );
      width *= overscanScale;
      height *= overscanScale;
    }
  }

  return { width, height, normalizedMode, safeFrameWidth, safeFrameHeight };
}

export function clampCropTransform(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  mode: CropMode | BackgroundFitMode,
  alignment: ImageAlignment,
  crop: CropTransform = { offsetX: 0, offsetY: 0, zoom: 1 }
): CropTransform {
  const { width, height, normalizedMode, safeFrameWidth, safeFrameHeight } = computeBaseImageSize(
    imageWidth,
    imageHeight,
    frameWidth,
    frameHeight,
    mode
  );
  if (normalizedMode === "tile" || normalizedMode === "stretch") {
    return { ...crop, zoom: Math.max(0.01, crop.zoom || 1) };
  }

  const zoom = Math.max(normalizedMode === "cover" ? 1 : 0.01, crop.zoom || 1);
  const scaledWidth = width * zoom;
  const scaledHeight = height * zoom;
  const alignedX = alignedOffset(safeFrameWidth, scaledWidth, "x", alignment);
  const alignedY = alignedOffset(safeFrameHeight, scaledHeight, "y", alignment);
  const clampedX = clampPlacementOffset(safeFrameWidth, scaledWidth, alignedX + crop.offsetX);
  const clampedY = clampPlacementOffset(safeFrameHeight, scaledHeight, alignedY + crop.offsetY);

  return {
    offsetX: clampedX - alignedX,
    offsetY: clampedY - alignedY,
    zoom
  };
}

export function computeImagePlacement(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  mode: CropMode | BackgroundFitMode,
  alignment: ImageAlignment,
  crop: CropTransform = { offsetX: 0, offsetY: 0, zoom: 1 }
): ImagePlacement {
  const { width, height, normalizedMode, safeFrameWidth, safeFrameHeight } = computeBaseImageSize(
    imageWidth,
    imageHeight,
    frameWidth,
    frameHeight,
    mode
  );
  const clampedCrop = clampCropTransform(imageWidth, imageHeight, frameWidth, frameHeight, mode, alignment, crop);
  const zoom = clampedCrop.zoom;
  const scaledWidth = width * zoom;
  const scaledHeight = height * zoom;
  const alignedX = alignedOffset(safeFrameWidth, scaledWidth, "x", alignment);
  const alignedY = alignedOffset(safeFrameHeight, scaledHeight, "y", alignment);

  return {
    x: normalizedMode === "tile" ? alignedOffset(safeFrameWidth, scaledWidth, "x", alignment) + crop.offsetX : alignedX + clampedCrop.offsetX,
    y: normalizedMode === "tile" ? alignedOffset(safeFrameHeight, scaledHeight, "y", alignment) + crop.offsetY : alignedY + clampedCrop.offsetY,
    width: scaledWidth,
    height: scaledHeight,
    tile: normalizedMode === "tile"
  };
}

export function resolveMaskGeometry(shape: MaskShape, width: number, height: number, radius: number) {
  if (shape === "circle") return { ellipse: true, radius: Math.min(width, height) / 2 };
  if (shape === "rectangle") return { ellipse: false, radius: 0 };
  return { ellipse: false, radius: Math.min(Math.max(0, radius), width / 2, height / 2) };
}

export function removeBackgroundImage(canvas: CanvasSettings): CanvasSettings {
  return {
    ...canvas,
    backgroundImage: undefined,
    backgroundOffsetX: 0,
    backgroundOffsetY: 0,
    backgroundScale: 1
  };
}

export function resizeCanvasAndLayers(
  canvas: CanvasSettings,
  layers: ProjectLayer[],
  width: number,
  height: number,
  mode: CanvasResizeMode
): { canvas: CanvasSettings; layers: ProjectLayer[] } {
  const nextWidth = Math.max(64, Math.round(width));
  const nextHeight = Math.max(64, Math.round(height));
  const scaleX = nextWidth / Math.max(1, canvas.width);
  const scaleY = nextHeight / Math.max(1, canvas.height);
  const uniformScale = Math.min(scaleX, scaleY);
  const deltaX = (nextWidth - canvas.width) / 2;
  const deltaY = (nextHeight - canvas.height) / 2;

  const nextLayers = layers.map((layer) => {
    if (mode === "scale") {
      return {
        ...layer,
        x: Math.round(layer.x * scaleX),
        y: Math.round(layer.y * scaleY),
        width: Math.max(40, Math.round(layer.width * scaleX)),
        height: Math.max(40, Math.round(layer.height * scaleY)),
        borderRadius: Math.round(layer.borderRadius * uniformScale),
        borderWidth: Math.round(layer.borderWidth * uniformScale),
        crop: {
          ...layer.crop,
          offsetX: layer.crop.offsetX * scaleX,
          offsetY: layer.crop.offsetY * scaleY,
          zoom: layer.crop.zoom * uniformScale / Math.max(uniformScale, 0.0001)
        }
      } satisfies PlaceholderLayer;
    }
    if (mode === "center") {
      return {
        ...layer,
        x: Math.round(layer.x + deltaX),
        y: Math.round(layer.y + deltaY)
      } satisfies PlaceholderLayer;
    }
    return { ...layer } satisfies PlaceholderLayer;
  });

  return {
    canvas: {
      ...canvas,
      width: nextWidth,
      height: nextHeight,
      presetId: "custom",
      orientation: nextWidth > nextHeight ? "landscape" : nextWidth < nextHeight ? "portrait" : "square"
    },
    layers: nextLayers
  };
}

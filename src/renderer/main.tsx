import React, { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  BringToFront,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Grid2X2,
  GripVertical,
  Home,
  ImagePlus,
  Images,
  Layers,
  LayoutTemplate,
  Lock,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PencilLine,
  Plus,
  Repeat,
  RefreshCcw,
  RotateCw,
  Save,
  SendToBack,
  Star,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Wallpaper,
  Type,
  Link,
  Unlink
} from "lucide-react";
import type {
  CanvasResizeMode,
  CanvasSettings,
  CropMode,
  GeneratedCombination,
  ImageAlignment,
  ImageFilters,
  ImageSelectionMode,
  ImageSource,
  LocalImageRef,
  LocalImportSummary,
  PaperFrameType,
  SourceMediaPolicy,
  MaskShape,
  PaperTextureEffect,
  PolaroidEffect,
  ShadowEffect,
  TearEdgeEffect,
  TornPaperEffect,
  PinterestImportProgress,
  SourceImportProgress,
  PlaceholderLayer,
  WallpaperRuntimeStatus,
  WallpaperTarget,
  WallpaperTemplate,
  WallpaperProject
} from "../shared/types";
import {
  activeTemplateSourceIds,
  compactProjectForAutosave,
  createCombination,
  createDefaultEffects,
  createDefaultFilters,
  createDefaultPaperFrame,
  createDefaultSourceState,
  createPlaceholder,
  createTextLayer,
  defaultFrameCornerRadius,
  collectLayerImages,
  createProject,
  createWallpaperTemplate,
  getImageForLayer,
  linkSourceToActiveTemplate,
  normalizeProject,
  presets,
  selectImageForLayer,
  sourceImagesForPolicy,
  touchProject,
  uid,
  unlinkSourceFromActiveTemplate,
  updateActiveTemplateSnapshot,
  workspaceFromTemplate
} from "./project";
import { layerSelectionRange, moveLayerBlockToTarget, reorderLayerBlock, type LayerOrderAction } from "../shared/layers";
import { placeTooltip } from "../shared/ui";
import {
  canvasPointAtClient,
  clampCanvasZoom,
  fitCanvasZoom,
  normalizeWheelDelta,
  zoomAfterStep,
  zoomAfterWheel
} from "../shared/canvas-zoom";
import { clampCropTransform, computeImagePlacement, removeBackgroundImage, resizeCanvasAndLayers } from "../shared/geometry";
import { paperFrameClipPath, paperFrameInsets, paperFrameIsRough, paperFrameRotation } from "../shared/paper";
import { projectAfterExportSet } from "../shared/export-set";
import { renderableLocalFileUrl } from "../shared/local-file-url";
import {
  appendAppliedHistory,
  generationStateAfterApplication,
  nextHistoryIndex,
  planTemplateRotation,
  previousHistoryIndex,
  normalizeAllSpacesRefreshMode,
  selectWallpaperTargets,
  wallpaperTargetModeNeedsInactiveSpaces
} from "../shared/wallpaper";
import { renderProjectToArrayBuffer, renderProjectToDataUrl } from "./exporter";
import { imageBackgroundColor, sourceIsManagedOverlay } from "../shared/image-transparency";
import { applyGeneratedWallpaperFile, generateWallpaperFile, withWallpaperTimeout } from "../shared/wallpaper-pipeline";
import { SingleFlightWallpaperOperation } from "../shared/scheduler";
import { fallbackWallpaperTargetMode, platformKindFromNavigator, platformProfile } from "../shared/platform";
import { selectImagesForGeneration } from "../shared/source-selection";
import { advancePreviewProjectImages } from "../shared/preview-selection";
import { placementForCanvasDrop, type CanvasDropPoint } from "../shared/drop-placement";
import { resizeRectAroundCenter, type ResizeHandle } from "../shared/resize-geometry";
import { resolveLayerFrameBounds, type LayerFrameBounds } from "../shared/adaptive-frame";
import { bundledSurfaceChoices, bundledSurfaceUrl } from "./surface-textures";
import { surfaceDefaultsForType } from "../shared/surfaces";
import { clearSurfaceTextureCaches, drawSurfacePreview } from "./surface-renderer";
import { nextSurfaceSeed, normalizeSurfaceEffect, surfaceEffectIsVisible } from "../shared/surface-rendering";
import { applyTornPaperPreset, bundledTornPaperPresets, createCustomTornPaperPreset, createDefaultPolaroidEffect, createDefaultTornPaperEffect, nextStableSeed, normalizePolaroidEffect, normalizeTornPaperEffect, paperWarmthOverlay, shadowToCss, tornPaperTextureDataUrl } from "../shared/frame-effects";
import { clampPolaroidRotation, distanceBetween, pointerAngleDegrees, polaroidScaleFromPointerDistance, rotatePoint, screenDeltaToFrameDelta, shortestAngleDelta } from "../shared/polaroid-interaction";
import { pinPaperIcon } from "./brand-icon";
import "./styles.css";

const autosaveKey = "pwc.autosave.v2";
const filePathKey = "pwc.filePath.v1";
const layerClipboardKey = "pwc.layerClipboard.v1";
const historyLimit = 80;
const snapDistance = 8;
const hasDesktopRuntimeApi = Boolean((window as Window & { wallpaperApi?: unknown }).wallpaperApi);
const currentPlatform = platformProfile(hasDesktopRuntimeApi ? platformKindFromNavigator({
  userAgent: navigator.userAgent,
  platform: navigator.platform
}) : "web");
const platformCapabilities = currentPlatform.capabilities;
const platformCopy = currentPlatform.copy;
// Legacy regression markers for the macOS capability path:
// isMacOS && wallpaperTargetModeNeedsInactiveSpaces
const macOSPlatformLabelMarkers = {
  preview: "Preview on Current Desktop",
  previewApplied: "Preview applied to current desktop",
  previewCombination: "Previewed on current desktop",
  createSet: "Create Wallpaper Set",
  openSettings: "Open Wallpaper Settings",
  setReady: "Wallpaper Set Ready",
  showInFinder: "Show Set in Finder",
  cleanupSets: "Clean Up Wallpaper Sets…",
  rotationGuide: "Create a Wallpaper Set, then choose that folder in macOS Wallpaper Settings"
};

function pinterestPartialIsCloseEnough(imagesCached: number, total?: number, imagesFound?: number) {
  const reported = Math.max(0, total ?? 0, imagesFound ?? 0);
  if (!reported) return false;
  const missing = reported - imagesCached;
  return missing <= Math.max(4, Math.ceil(reported * 0.04));
}

function softenPinterestPartialError(error: string | undefined, completeEnough: boolean) {
  return completeEnough ? undefined : error;
}

type TextPresetId = "heading" | "caption" | "quote" | "label" | "soft";

const textStylePresets: Array<{ id: TextPresetId; label: string; text: string; fontFamily: string; fontWeight: number; sizeScale: number; lineHeight: number; letterSpacing: number; color: string }> = [
  { id: "heading", label: "Bold heading", text: "Add a heading", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", fontWeight: 850, sizeScale: 0.052, lineHeight: 1.02, letterSpacing: -0.4, color: "#26313a" },
  { id: "caption", label: "Small caption", text: "Add a caption", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", fontWeight: 650, sizeScale: 0.026, lineHeight: 1.16, letterSpacing: 0, color: "#4c5661" },
  { id: "quote", label: "Editorial quote", text: "Add a quote", fontFamily: "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif", fontWeight: 700, sizeScale: 0.044, lineHeight: 1.08, letterSpacing: -0.1, color: "#2c3137" },
  { id: "label", label: "Tiny label", text: "LABEL", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontWeight: 800, sizeScale: 0.018, lineHeight: 1.08, letterSpacing: 1.6, color: "#5a6470" },
  { id: "soft", label: "Soft title", text: "Add text here", fontFamily: "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif", fontWeight: 600, sizeScale: 0.04, lineHeight: 1.12, letterSpacing: 0.2, color: "#6f675e" }
];

const textFontOptions = [
  { label: "Avenir Next", value: "Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "Baskerville", value: "Baskerville, Georgia, Times New Roman, serif" },
  { label: "Brush Script MT", value: "Brush Script MT, Snell Roundhand, cursive" },
  { label: "Chalkboard SE", value: "Chalkboard SE, Comic Sans MS, cursive" },
  { label: "Comic Sans MS", value: "Comic Sans MS, Chalkboard SE, cursive" },
  { label: "Courier New", value: "Courier New, Menlo, SFMono-Regular, monospace" },
  { label: "Didot", value: "Didot, Bodoni 72, Georgia, serif" },
  { label: "Futura", value: "Futura, Avenir Next, Inter, sans-serif" },
  { label: "Garamond", value: "Garamond, Baskerville, Georgia, serif" },
  { label: "Georgia", value: "Georgia, Times New Roman, serif" },
  { label: "Gill Sans", value: "Gill Sans, Avenir Next, Inter, sans-serif" },
  { label: "Helvetica Neue", value: "Helvetica Neue, Inter, Arial, sans-serif" },
  { label: "Hoefler Text", value: "Hoefler Text, Georgia, serif" },
  { label: "Impact", value: "Impact, Haettenschweiler, Arial Narrow Bold, sans-serif" },
  { label: "Inter", value: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" },
  { label: "Marker Felt", value: "Marker Felt, Chalkboard SE, cursive" },
  { label: "Menlo", value: "Menlo, SFMono-Regular, Consolas, monospace" },
  { label: "Palatino", value: "Palatino, Palatino Linotype, Book Antiqua, serif" },
  { label: "SF Pro", value: "SF Pro Text, -apple-system, BlinkMacSystemFont, Inter, sans-serif" },
  { label: "Snell Roundhand", value: "Snell Roundhand, Brush Script MT, cursive" },
  { label: "Times New Roman", value: "Times New Roman, Times, serif" },
  { label: "Trebuchet MS", value: "Trebuchet MS, Inter, sans-serif" }
];

function estimateTextLayerHeight(layer: Pick<PlaceholderLayer, "text" | "fontSize" | "lineHeight">, minHeight = 42) {
  const lines = Math.max(1, (layer.text ?? "Text").split(/\r?\n/).length);
  const fontSize = layer.fontSize ?? 72;
  const lineHeight = layer.lineHeight ?? 1.12;
  return Math.max(minHeight, Math.ceil(lines * fontSize * lineHeight + Math.max(22, fontSize * 0.34)));
}

function textPresetForLayer(layer: PlaceholderLayer): TextPresetId {
  const fontSize = layer.fontSize ?? 72;
  if ((layer.letterSpacing ?? 0) >= 1) return "label";
  if ((layer.fontWeight ?? 800) <= 650 && fontSize < 52) return "caption";
  if ((layer.fontFamily ?? "").includes("Avenir") && (layer.fontWeight ?? 800) <= 650) return "soft";
  if ((layer.fontFamily ?? "").includes("Avenir")) return "quote";
  return "heading";
}

function applyTextPreset(canvas: CanvasSettings, presetId: TextPresetId, keepText?: string): Partial<PlaceholderLayer> {
  const preset = textStylePresets.find((item) => item.id === presetId) ?? textStylePresets.find((item) => item.id === "soft") ?? textStylePresets[0];
  const text = keepText?.trim() ? keepText : preset.text;
  const fontSize = Math.max(14, Math.round(canvas.width * preset.sizeScale));
  return {
    text,
    fontFamily: preset.fontFamily,
    fontSize,
    fontWeight: preset.fontWeight,
    textColor: preset.color,
    lineHeight: preset.lineHeight,
    letterSpacing: preset.letterSpacing,
    textAlign: "center",
    height: estimateTextLayerHeight({ text, fontSize, lineHeight: preset.lineHeight })
  };
}

function numberedCopyName(baseName: string, existingNames: Iterable<string>) {
  const names = new Set(existingNames);
  const root = baseName.replace(/\s+\(\d+\)$/u, "").trim() || baseName || "Layer";
  let index = 1;
  let candidate = `${root} (${index})`;
  while (names.has(candidate)) {
    index += 1;
    candidate = `${root} (${index})`;
  }
  names.add(candidate);
  return candidate;
}

function currentScreenCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(640, Math.round(window.screen.width * ratio));
  const height = Math.max(480, Math.round(window.screen.height * ratio));
  return {
    width,
    height,
    presetId: "custom" as const,
    orientation: width === height ? "square" as const : width > height ? "landscape" as const : "portrait" as const
  };
}

function projectWithCurrentScreenCanvas(project: WallpaperProject) {
  const canvas = { ...project.canvas, ...currentScreenCanvas() };
  return {
    ...project,
    canvas,
    templates: {
      ...project.templates,
      templates: project.templates.templates.map((template) => ({
        ...template,
        project: { ...template.project, canvas: { ...template.project.canvas, ...currentScreenCanvas() } }
      }))
    }
  };
}

function createProjectForCurrentScreen() {
  return projectWithCurrentScreenCanvas(createProject());
}

function cssImageUrl(src?: string) {
  if (!src) return undefined;
  return `url("${renderableLocalFileUrl(src).replace(/"/g, "\\\"")}")`;
}

function measuredLayerFrame(layer: PlaceholderLayer, image?: LocalImageRef, natural?: { width: number; height: number }): LayerFrameBounds {
  return resolveLayerFrameBounds(layer, natural ?? image);
}
function effectiveRoundedRadius(layer: PlaceholderLayer, canvas: CanvasSettings) {
  if (layer.maskShape !== "rounded") return layer.maskShape === "circle" ? Math.min(layer.width, layer.height) / 2 : 0;
  const adaptiveDefault = defaultFrameCornerRadius(canvas);
  return layer.borderRadius <= 24 ? adaptiveDefault : layer.borderRadius;
}


function layerFrameWithImage(project: WallpaperProject, layer: PlaceholderLayer, natural?: { width: number; height: number }) {
  return measuredLayerFrame(layer, getImageForLayer(project, layer), natural);
}

function selectionBoundsForLayers(project: WallpaperProject, layers: PlaceholderLayer[], naturalByLayer: Record<string, { width: number; height: number }>): LayerFrameBounds | undefined {
  const frames = layers.map((layer) => layerFrameWithImage(project, layer, naturalByLayer[layer.id]));
  if (frames.length === 0) return undefined;
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function oppositeCornerForResize(bounds: LayerFrameBounds, handle: ResizeHandle) {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  return {
    x: handle.includes("w") ? right : handle.includes("e") ? left : left + bounds.width / 2,
    y: handle.includes("n") ? bottom : handle.includes("s") ? top : top + bounds.height / 2
  };
}

function resizeBoundsFromOppositeCorner(
  bounds: LayerFrameBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  limits: { width: number; height: number; minSize: number; allowOverflow?: boolean; maxOverflowSize?: number }
) {
  const pivot = oppositeCornerForResize(bounds, handle);
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  let top = bounds.y;
  let bottom = bounds.y + bounds.height;
  const maxSize = Math.max(limits.minSize, limits.maxOverflowSize ?? Math.max(limits.width, limits.height) * 4);

  if (handle.includes("w")) left = Math.min(pivot.x - limits.minSize, bounds.x + dx);
  if (handle.includes("e")) right = Math.max(pivot.x + limits.minSize, bounds.x + bounds.width + dx);
  if (handle.includes("n")) top = Math.min(pivot.y - limits.minSize, bounds.y + dy);
  if (handle.includes("s")) bottom = Math.max(pivot.y + limits.minSize, bounds.y + bounds.height + dy);

  if (!limits.allowOverflow) {
    if (handle.includes("w")) left = Math.max(0, left);
    if (handle.includes("e")) right = Math.min(limits.width, right);
    if (handle.includes("n")) top = Math.max(0, top);
    if (handle.includes("s")) bottom = Math.min(limits.height, bottom);
    if (!handle.includes("w") && !handle.includes("e")) {
      left = Math.max(0, bounds.x);
      right = Math.min(limits.width, bounds.x + bounds.width);
    }
    if (!handle.includes("n") && !handle.includes("s")) {
      top = Math.max(0, bounds.y);
      bottom = Math.min(limits.height, bounds.y + bounds.height);
    }
  }

  if (right - left > maxSize) {
    if (handle.includes("w") && !handle.includes("e")) left = right - maxSize;
    else right = left + maxSize;
  }
  if (bottom - top > maxSize) {
    if (handle.includes("n") && !handle.includes("s")) top = bottom - maxSize;
    else bottom = top + maxSize;
  }

  const recoverable = clampRecoverablePosition(left, top, right - left, bottom - top, { width: limits.width, height: limits.height });
  return { x: recoverable.x, y: recoverable.y, width: right - left, height: bottom - top };
}


function fitLayerIntoResizedSelection(layer: PlaceholderLayer, originalLayer: PlaceholderLayer, groupBefore: LayerFrameBounds, groupAfter: LayerFrameBounds): Partial<PlaceholderLayer> {
  const relativeX = (originalLayer.x - groupBefore.x) / Math.max(1, groupBefore.width);
  const relativeY = (originalLayer.y - groupBefore.y) / Math.max(1, groupBefore.height);
  const relativeWidth = originalLayer.width / Math.max(1, groupBefore.width);
  const relativeHeight = originalLayer.height / Math.max(1, groupBefore.height);
  return {
    x: Math.round(groupAfter.x + relativeX * groupAfter.width),
    y: Math.round(groupAfter.y + relativeY * groupAfter.height),
    width: Math.max(40, Math.round(relativeWidth * groupAfter.width)),
    height: Math.max(40, Math.round(relativeHeight * groupAfter.height))
  };
}

type DragMode =
  | "move"
  | "rotate"
  | "crop"
  | "resize-n"
  | "resize-s"
  | "resize-e"
  | "resize-w"
  | "resize-ne"
  | "resize-nw"
  | "resize-se"
  | "resize-sw";

type DragState = {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  layer: PlaceholderLayer;
  groupLayers: PlaceholderLayer[];
  groupBounds?: LayerFrameBounds;
  historyProject: WallpaperProject;
  moved?: boolean;
};

type CanvasPanState = {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
};

type PolaroidImageDragMode = "move" | "scale" | "rotate";

type PolaroidImageDragState = {
  id: string;
  mode: PolaroidImageDragMode;
  startX: number;
  startY: number;
  layer: PlaceholderLayer;
  effect: PolaroidEffect;
  frameRotation: number;
  centerClient: { x: number; y: number };
  startPointerAngle: number;
  startPointerDistance: number;
  historyProject: WallpaperProject;
};

type ExternalDropTarget = "sources" | "canvas" | "placeholder";

type DropFeedback = {
  target: ExternalDropTarget;
  layerId?: string;
  label: string;
  valid: boolean;
  placementCount?: number;
  canvasPoint?: CanvasDropPoint;
};

type SelectionMarquee = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  baseIds: string[];
  additive: boolean;
  didMove?: boolean;
};

type PinterestDialogState = {
  open: boolean;
  url: string;
  progress: number;
  imagesFound: number;
  imagesCached: number;
  log: string[];
  error?: string;
  busy: boolean;
  jobId?: string;
  stage?: PinterestImportProgress["stage"];
  current?: number;
  total?: number;
};

type SourceImportDialogState = {
  open: boolean;
  title: string;
  message: string;
  current?: number;
  total?: number;
};

type SourceMenuState = {
  sourceId: string;
  x: number;
  y: number;
};

type LayerMenuState = {
  layerId: string;
  x: number;
  y: number;
};

type AppView = "home" | "editor";
type TemplateFilter = "all" | "favorites" | "recent" | "rotation";
type SourceLibraryView = "linked" | "global";
type LeftPanelTab = "sources" | "layers";
type InspectorTab = "settings" | "image" | "effects";
type RenameState =
  | { kind: "layer"; id: string; value: string }
  | { kind: "template"; id: string; value: string }
  | { kind: "source"; id: string; value: string };

type ExportSetState = {
  open: boolean;
  templateId?: string;
  setName: string;
  count: number;
  format: "png" | "jpeg";
  quality: number;
  destinationPath?: string;
  avoidRepeats: boolean;
  advanceLiveState: boolean;
  busy: boolean;
  cleanupBusy: boolean;
  cancelRequested: boolean;
  completed: number;
  skipped: number;
  failed: number;
  finalPath?: string;
  firstFilePath?: string;
  windowsCycleSeconds: number;
  error?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const OFF_CANVAS_RECOVERY_PX = 12;

function offCanvasRecoveryMargin(canvas: { width: number; height: number }) {
  return Math.round(clamp(Math.min(canvas.width, canvas.height) * 0.008, OFF_CANVAS_RECOVERY_PX, 28));
}

function clampRecoverablePosition(x: number, y: number, width: number, height: number, canvas: { width: number; height: number }) {
  const margin = offCanvasRecoveryMargin(canvas);
  return {
    x: clamp(x, -Math.max(0, width - margin), Math.max(margin, canvas.width - margin)),
    y: clamp(y, -Math.max(0, height - margin), Math.max(margin, canvas.height - margin))
  };
}

function clampRecoverableLayerPosition(layer: PlaceholderLayer, x: number, y: number, canvas: { width: number; height: number }) {
  return clampRecoverablePosition(x, y, layer.width, layer.height, canvas);
}

function maxOverflowLayerSize(canvas: { width: number; height: number }) {
  return Math.max(canvas.width, canvas.height, 1) * 4;
}

type AdaptiveControlMetrics = {
  handleHit: number;
  handleDot: number;
  handleBorder: number;
  handleOffset: number;
  rotateSize: number;
  rotateOffset: number;
  rotateTop: number;
  layerButtonSize: number;
  layerButtonOffset: number;
  iconSize: number;
};

function adaptiveControlMetrics(width: number, height: number, canvas: CanvasSettings): AdaptiveControlMetrics {
  const canvasMin = Math.max(1, Math.min(canvas.width, canvas.height));
  const frameMin = Math.max(1, Math.min(width, height));
  const maxDot = Math.max(13, Math.min(17, canvasMin * 0.017));
  const handleDot = Math.round(clamp(Math.min(width * 0.045, height * 0.075), 7, maxDot));
  const handleHit = Math.round(handleDot * 2.34);
  const rotateSize = Math.round(clamp(handleDot * 3.08, 28, Math.max(38, maxDot * 3.15)));
  const layerButtonSize = Math.round(clamp(frameMin * 0.18, 26, Math.max(38, maxDot * 3.05)));
  return {
    handleHit,
    handleDot,
    handleBorder: Math.max(1, Math.round(handleDot * 0.16)),
    handleOffset: Math.round(handleHit / 2),
    rotateSize,
    rotateOffset: Math.round(rotateSize / 2),
    rotateTop: Math.round(Math.max(handleDot * 4.3, rotateSize + handleDot * 1.25)),
    layerButtonSize,
    layerButtonOffset: Math.round(clamp(frameMin * 0.2, layerButtonSize + 4, Math.max(46, maxDot * 3.45))),
    iconSize: Math.round(clamp(handleDot * 1.35, 12, 22))
  };
}

function adaptiveControlStyle(metrics: AdaptiveControlMetrics): React.CSSProperties {
  return {
    ["--handle-hit" as string]: `${metrics.handleHit}px`,
    ["--handle-dot" as string]: `${metrics.handleDot}px`,
    ["--handle-border" as string]: `${metrics.handleBorder}px`,
    ["--handle-offset" as string]: `${metrics.handleOffset}px`,
    ["--rotate-size" as string]: `${metrics.rotateSize}px`,
    ["--rotate-offset" as string]: `${metrics.rotateOffset}px`,
    ["--rotate-top" as string]: `${metrics.rotateTop}px`,
    ["--layer-control-size" as string]: `${metrics.layerButtonSize}px`,
    ["--layer-control-offset" as string]: `${metrics.layerButtonOffset}px`,
    ["--layer-control-icon" as string]: `${metrics.iconSize}px`,
  } as React.CSSProperties;
}

function adaptiveDropPreviewStyle(width: number, height: number, canvas: CanvasSettings): React.CSSProperties {
  const canvasMin = Math.max(1, Math.min(canvas.width, canvas.height));
  const base = clamp(Math.min(width * 0.048, height * 0.075), 8, Math.max(13, Math.min(18, canvasMin * 0.018)));
  return {
    ["--drop-preview-border" as string]: `${Math.max(1, Math.round(base * 0.2))}px`,
    ["--drop-preview-radius" as string]: `${Math.round(base * 1.35)}px`,
    ["--drop-copy-gap" as string]: `${Math.round(clamp(base * 0.46, 4, 8))}px`,
    ["--drop-copy-pad-y" as string]: `${Math.round(clamp(base * 0.72, 7, 13))}px`,
    ["--drop-copy-pad-x" as string]: `${Math.round(clamp(base * 0.95, 10, 17))}px`,
    ["--drop-copy-radius" as string]: `${Math.round(clamp(base * 0.9, 8, 14))}px`,
    ["--drop-copy-title" as string]: `${Math.round(clamp(base * 1.03, 10, 14))}px`,
    ["--drop-copy-body" as string]: `${Math.round(clamp(base * 0.82, 8, 11))}px`,
    ["--drop-copy-icon" as string]: `${Math.round(clamp(base * 1.28, 12, 20))}px`,
  } as React.CSSProperties;
}

function hexWithOpacity(hex: string, opacity: number) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1)})`;
}

function cloneProject(project: WallpaperProject): WallpaperProject {
  return structuredClone(project);
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
    || Boolean(target.closest('[contenteditable="true"]'));
}

function isRichTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLTextAreaElement
    || target.isContentEditable
    || Boolean(target.closest('[contenteditable="true"]'));
}

function inputHasSelectedText(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return false;
  try {
    return typeof target.selectionStart === "number"
      && typeof target.selectionEnd === "number"
      && target.selectionStart !== target.selectionEnd;
  } catch {
    return false;
  }
}

function shouldUseNativeClipboardShortcut(target: EventTarget | null, key: "c" | "v", hasLayerClipboard: boolean) {
  if (isRichTextEditingTarget(target)) return true;
  if (target instanceof HTMLInputElement) {
    if (key === "c" && inputHasSelectedText(target)) return true;
    if (key === "v" && !hasLayerClipboard) return true;
    return false;
  }
  return target instanceof HTMLSelectElement && !hasLayerClipboard;
}

function sourceKindLabel(source: ImageSource) {
  if (source.type === "pinterest-board") return "Pinterest board";
  if (source.type === "local-file") return "Images";
  return "Folder";
}

function sourceLocationLabel(source: ImageSource) {
  return source.path ?? source.url ?? source.cachePath ?? "Stored in project";
}

function imageAspectRatio(image?: LocalImageRef) {
  if (!image?.width || !image.height) return undefined;
  const ratio = image.width / image.height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}

function sourcePreferredAspectRatio(source?: ImageSource) {
  if (!source) return undefined;
  return imageAspectRatio(sourceImagesForPolicy(source)[0]);
}

function randomImageFromSource(source: ImageSource) {
  const images = sourceImagesForPolicy(source);
  if (images.length === 0) return undefined;
  return images[Math.floor(Math.random() * images.length)];
}

function imageIndexInSource(source: ImageSource, image?: LocalImageRef) {
  if (!image) return 0;
  return Math.max(0, sourceImagesForPolicy(source).findIndex((item) => item.id === image.id));
}

async function decodedImageAspectRatio(image?: LocalImageRef) {
  const stored = imageAspectRatio(image);
  if (stored || !image?.url) return stored;
  try {
    const element = new Image();
    element.decoding = "async";
    element.src = image.url;
    await element.decode();
    const width = element.naturalWidth || element.width;
    const height = element.naturalHeight || element.height;
    const ratio = width / Math.max(1, height);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
  } catch {
    return undefined;
  }
}

function projectWithMeasuredImage(project: WallpaperProject, image: LocalImageRef | undefined, aspectRatio: number | undefined) {
  if (!image || image.width || image.height || !aspectRatio) return project;
  const measuredHeight = 1000;
  const measuredWidth = Math.round(measuredHeight * aspectRatio);
  return {
    ...project,
    sources: project.sources.map((source) => ({
      ...source,
      images: source.images.map((item) => item.id === image.id ? { ...item, width: measuredWidth, height: measuredHeight } : item)
    }))
  };
}

function webImagePasteFingerprint(candidates: WebImageCandidate[]) {
  return candidates
    .map((candidate) => candidate.url
      ? `url:${candidate.url}`
      : `file:${candidate.name ?? ""}:${candidate.mimeType ?? ""}:${candidate.file?.size ?? 0}:${candidate.file?.lastModified ?? 0}`)
    .join("|");
}

const finderDropImageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);

function getDroppedPaths(event: React.DragEvent) {
  const filePaths = Array.from(event.dataTransfer.files)
    .map((file) => {
      try {
        return window.wallpaperApi.getPathForFile(file);
      } catch {
        return "";
      }
    })
    .filter((filePath): filePath is string => Boolean(filePath));
  if (filePaths.length > 0) return [...new Set(filePaths)];
  const textPaths = event.dataTransfer.getData("text/plain")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith("/"));
  return [...new Set(textPaths)];
}

type FinderEntryLike = { isDirectory?: boolean; isFile?: boolean };

function describeDrop(dataTransfer: DataTransfer, target: ExternalDropTarget): Pick<DropFeedback, "label" | "valid" | "placementCount"> {
  const types = Array.from(dataTransfer.types);
  if (types.includes("application/x-pwc-source-id")) {
    return target === "placeholder"
      ? { label: "Assign source to this frame", valid: true, placementCount: 1 }
      : target === "canvas"
        ? { label: "Release to place source here", valid: true, placementCount: 1 }
        : { label: "", valid: true, placementCount: 0 };
  }

  let folders = 0;
  let supportedImages = 0;
  let unsupported = 0;
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FinderEntryLike | null }).webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      folders += 1;
      continue;
    }
    const file = item.getAsFile();
    const extension = file?.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
    if (finderDropImageExtensions.has(extension)) supportedImages += 1;
    else if (!extension && !file?.type) folders += 1;
    else unsupported += 1;
  }

  if (folders === 0 && supportedImages === 0 && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (finderDropImageExtensions.has(extension)) supportedImages += 1;
    }
  }

  const valid = folders > 0 || supportedImages > 0;
  if (!valid && hasWebImageTransfer(dataTransfer)) {
    return target === "placeholder"
      ? { label: "Assign web image to this frame", valid: true, placementCount: 1 }
      : target === "canvas"
        ? { label: "Release to place web image here", valid: true, placementCount: 1 }
        : { label: "Add web image as source", valid: true, placementCount: 1 };
  }
  if (!valid && types.includes("text/uri-list") && target === "sources") return { label: "Add linked source", valid: true };
  if (!valid) return { label: unsupported > 0 ? "Unsupported files cannot be imported" : "Drop image files, folders, or web images", valid: false };

  // Finder groups all loose images into one reusable source. Each folder is
  // its own source, so mixed and multi-folder drops can place several frames.
  const placementCount = folders + (supportedImages > 0 ? 1 : 0);
  if (target === "placeholder") {
    if (folders > 0 && supportedImages > 0) return { label: "Assign folders and images to this frame", valid: true, placementCount };
    if (folders > 1) return { label: `Assign ${folders} folders to this frame`, valid: true, placementCount };
    if (folders === 1) return { label: "Assign folder to this frame", valid: true, placementCount: 1 };
    if (supportedImages === 1) return { label: "Assign image to this frame", valid: true, placementCount: 1 };
    return { label: `Assign ${supportedImages} images to this frame`, valid: true, placementCount: 1 };
  }
  if (target === "canvas") {
    if (folders > 0 && supportedImages > 0) return { label: "Release to place imported sources here", valid: true, placementCount };
    if (folders > 1) return { label: `Release to place ${folders} folder sources here`, valid: true, placementCount };
    if (folders === 1) return { label: "Release to place folder here", valid: true, placementCount: 1 };
    if (supportedImages === 1) return { label: "Release to place image here", valid: true, placementCount: 1 };
    return { label: `Release to place ${supportedImages} images here`, valid: true, placementCount: 1 };
  }
  if (folders > 0 && supportedImages > 0) return { label: "Add folders and images as sources", valid: true, placementCount };
  if (folders > 1) return { label: `Add ${folders} folders as sources`, valid: true, placementCount };
  if (folders === 1) return { label: "Add folder as source", valid: true, placementCount: 1 };
  if (supportedImages === 1) return { label: "Add image as source", valid: true, placementCount: 1 };
  return { label: `Add ${supportedImages} images as source`, valid: true, placementCount: 1 };
}

function getTransferText(dataTransfer: DataTransfer, type: string) {
  try {
    return dataTransfer.getData(type).trim();
  } catch {
    return "";
  }
}

function firstUrlFromText(value: string) {
  const match = value.match(/https?:\/\/[^\s<>"']+|data:image\/[^\s<>"']+/i);
  return match?.[0]?.replace(/&amp;/g, "&");
}

function firstImageUrlFromHtml(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1]?.replace(/&amp;/g, "&");
}

type WebImageCandidate = { url?: string; file?: File; name?: string; mimeType?: string };

function webImageCandidatesFromTransfer(dataTransfer: DataTransfer | null): WebImageCandidate[] {
  if (!dataTransfer) return [];
  const candidates: WebImageCandidate[] = [];
  const seen = new Set<string>();
  for (const file of Array.from(dataTransfer.files ?? [])) {
    if (!file.type.startsWith("image/")) continue;
    let localPath = "";
    try {
      localPath = window.wallpaperApi.getPathForFile(file);
    } catch {
      localPath = "";
    }
    if (localPath) continue;
    const key = `file:${file.name}:${file.size}:${file.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ file, name: file.name || "web image", mimeType: file.type });
  }

  const addUrl = (raw?: string, name?: string) => {
    const url = raw?.trim();
    if (!url || seen.has(url)) return;
    if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) return;
    seen.add(url);
    candidates.push({ url, name });
  };

  addUrl(firstImageUrlFromHtml(getTransferText(dataTransfer, "text/html")));
  addUrl(firstUrlFromText(getTransferText(dataTransfer, "text/uri-list")));
  addUrl(firstUrlFromText(getTransferText(dataTransfer, "text/plain")));
  return candidates.slice(0, 24);
}

function hasWebImageTransfer(dataTransfer: DataTransfer) {
  return webImageCandidatesFromTransfer(dataTransfer).length > 0;
}

function readImageFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read copied image."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}


function browserFileInput(directory: boolean): Promise<File[] | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,image/*";
    if (directory) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.opacity = "0";
    document.body.appendChild(input);
    const cleanup = () => window.setTimeout(() => input.remove(), 0);
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files.length > 0 ? files : undefined);
    }, { once: true });
    input.click();
  });
}

function browserSourceNameFromFiles(files: File[], fallback: string) {
  const firstPath = files.find((file) => file.webkitRelativePath)?.webkitRelativePath;
  const root = firstPath?.split(/[\\/]/).filter(Boolean)[0];
  if (root) return root;
  if (files.length === 1) return files[0]?.name?.replace(/\.[^.]+$/, "") || fallback;
  return fallback;
}

async function browserImageSourceFromFiles(files: File[], fallbackName: string, directoryMode: BrowserDirectoryImportMode = "all"): Promise<{ source?: ImageSource; summary: LocalImportSummary; warnings: string[] }> {
  const importFiles = directoryMode === "top-level-only" ? topLevelBrowserDirectoryFiles(files) : files;
  const skippedNestedDirectoryCount = Math.max(0, files.length - importFiles.length);
  const supported = importFiles.filter((file) => {
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
    return file.type.startsWith("image/") || finderDropImageExtensions.has(extension);
  });
  const warnings: string[] = [];
  const images: LocalImageRef[] = [];
  for (const file of supported) {
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      const relativePath = file.webkitRelativePath || file.name;
      const id = uid("web-image");
      images.push({
        id,
        name: file.name || "browser image",
        path: `web-file:${relativePath}:${file.size}:${file.lastModified}`,
        url: dataUrl,
        modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString(),
        size: file.size,
        mediaType: "image"
      });
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `Unable to read ${file.name}.`);
    }
  }
  if (skippedNestedDirectoryCount > 0) warnings.push(`Skipped ${skippedNestedDirectoryCount} image${skippedNestedDirectoryCount === 1 ? "" : "s"} inside subfolders. Browser folder import uses only the top level for now.`);
  const summary: LocalImportSummary = {
    requestedPathCount: files.length,
    importedFolderCount: importFiles.some((file) => file.webkitRelativePath) ? 1 : 0,
    importedLooseImageCount: images.length,
    discoveredImageCount: supported.length,
    skippedUnsupportedCount: Math.max(0, importFiles.length - supported.length) + skippedNestedDirectoryCount,
    skippedUnreadableCount: Math.max(0, supported.length - images.length),
    skippedMissingCount: 0,
    duplicatePathCount: 0,
    emptyFolders: []
  };
  if (images.length === 0) return { summary, warnings: warnings.length ? warnings : ["No supported images were selected." ] };
  const sourceName = browserSourceNameFromFiles(importFiles, fallbackName);
  const source: ImageSource = {
    id: uid("source"),
    identityKey: `browser-files:${images.map((image) => image.path).sort().join("|")}`,
    providerId: "local-file",
    type: "local-file",
    name: sourceName,
    images,
    mediaPolicy: "images-and-video-thumbnails",
    mediaCounts: { total: images.length, images: images.length, videos: 0 },
    importStatus: "ready",
    importLog: [`Imported ${images.length} browser file${images.length === 1 ? "" : "s"}.`],
    updatedAt: new Date().toISOString()
  };
  return { source, summary, warnings };
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function safeBrowserFileName(value: string, fallback = "pin-paper") {
  const clean = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || fallback;
}


const webAutosaveDbName = "pin-paper-web-projects";
const webAutosaveStoreName = "projects";
const webAutosaveProjectKey = "autosave";

type BrowserDirectoryImportMode = "all" | "top-level-only";

function openWebAutosaveDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser project storage is unavailable."));
      return;
    }
    const request = indexedDB.open(webAutosaveDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(webAutosaveStoreName)) db.createObjectStore(webAutosaveStoreName);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open browser project storage."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readWebAutosaveProject(): Promise<WallpaperProject | undefined> {
  try {
    const db = await openWebAutosaveDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(webAutosaveStoreName, "readonly");
      const store = tx.objectStore(webAutosaveStoreName);
      const request = store.get(webAutosaveProjectKey);
      request.onerror = () => reject(request.error ?? new Error("Unable to read browser project storage."));
      request.onsuccess = () => {
        const value = request.result;
        resolve(value && typeof value === "object" ? compactProjectForAutosave(normalizeProject(value as WallpaperProject)) : undefined);
      };
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error ?? new Error("Unable to read browser project storage."));
    });
  } catch (error) {
    console.warn("Browser project restore failed", error);
    return undefined;
  }
}

async function writeWebAutosaveProject(project: WallpaperProject): Promise<void> {
  const db = await openWebAutosaveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(webAutosaveStoreName, "readwrite");
    tx.objectStore(webAutosaveStoreName).put(compactProjectForAutosave(project), webAutosaveProjectKey);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Unable to save browser project storage."));
    };
  });
}

async function deleteWebAutosaveProject(): Promise<void> {
  try {
    const db = await openWebAutosaveDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(webAutosaveStoreName, "readwrite");
      tx.objectStore(webAutosaveStoreName).delete(webAutosaveProjectKey);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("Unable to reset browser project storage."));
      };
    });
  } catch (error) {
    console.warn("Browser project storage reset failed", error);
  }
}

function topLevelBrowserDirectoryFiles(files: File[]): File[] {
  const directoryFiles = files.filter((file) => file.webkitRelativePath);
  if (directoryFiles.length === 0) return files;
  return files.filter((file) => {
    if (!file.webkitRelativePath) return true;
    const parts = file.webkitRelativePath.split(/[\\/]/).filter(Boolean);
    return parts.length <= 2;
  });
}

async function importWebImageCandidates(candidates: WebImageCandidate[]) {
  const sources: ImageSource[] = [];
  const warnings: string[] = [];
  for (const candidate of candidates) {
    if (window.wallpaperApi?.importWebImage) {
      const payload = candidate.file
        ? {
            dataUrl: await readImageFileAsDataUrl(candidate.file),
            name: candidate.name || candidate.file.name || "copied image",
            mimeType: candidate.mimeType || candidate.file.type
          }
        : { url: candidate.url, name: candidate.name, mimeType: candidate.mimeType };
      const result = await window.wallpaperApi.importWebImage(payload);
      if (result.source) sources.push(result.source);
      else if (result.error) warnings.push(result.error);
      continue;
    }

    if (candidate.file) {
      const result = await browserImageSourceFromFiles([candidate.file], candidate.name || "Browser Image");
      if (result.source) sources.push(result.source);
      warnings.push(...result.warnings);
      continue;
    }

    if (candidate.url?.startsWith("data:image/")) {
      const id = uid("web-image");
      const image: LocalImageRef = { id, name: candidate.name || "browser image", path: `web-data-url:${id}`, url: candidate.url, mediaType: "image" };
      sources.push({
        id: uid("source"),
        identityKey: `browser-data-url:${candidate.url.slice(0, 96)}`,
        providerId: "local-file",
        type: "local-file",
        name: candidate.name || "Browser Image",
        images: [image],
        mediaPolicy: "images-and-video-thumbnails",
        mediaCounts: { total: 1, images: 1, videos: 0 },
        importStatus: "ready",
        importLog: ["Imported a browser image."],
        updatedAt: new Date().toISOString()
      });
      continue;
    }

    warnings.push("Linked web images need the desktop app for caching. Download the image, then import it as a file in the web version.");
  }
  return { sources, warnings };
}

function getDroppedPinterestUrl(event: React.DragEvent) {
  const text = getTransferText(event.dataTransfer, "text/uri-list") || getTransferText(event.dataTransfer, "text/plain");
  return text.includes("pinterest.") || text.includes("pin.it") ? text.trim() : undefined;
}

function getDroppedSourceId(event: React.DragEvent) {
  return event.dataTransfer.getData("application/x-pwc-source-id") || undefined;
}

function normalizedSourcePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$|\s+$/g, "");
  return /^\/?[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function sourceIdentity(source: ImageSource) {
  if (source.identityKey) return source.identityKey;
  if (source.type === "local-folder" && source.path) return `local-folder:${normalizedSourcePath(source.path)}`;
  if (source.type === "pinterest-board" && source.url) return `pinterest:${source.url.replace(/\/$/, "").toLowerCase()}`;
  if (source.type === "local-file") {
    return `local-file:${source.images.map((image) => normalizedSourcePath(image.path)).sort().join("|")}`;
  }
  return `${source.type}:${source.id}`;
}

function localFilePathSet(source: ImageSource) {
  return new Set(source.images.map((image) => normalizedSourcePath(image.path)));
}

function reusableSourceIndex(sources: ImageSource[], candidate: ImageSource) {
  const exactKey = sourceIdentity(candidate);
  const exact = sources.findIndex((source) => sourceIdentity(source) === exactKey);
  if (exact >= 0) return exact;
  if (candidate.type !== "local-file") return -1;
  const candidatePaths = localFilePathSet(candidate);
  return sources.findIndex((source) => {
    if (source.type !== "local-file") return false;
    const currentPaths = localFilePathSet(source);
    return candidatePaths.size > 0 && [...candidatePaths].every((item) => currentPaths.has(item));
  });
}

function mergeReusableSources(existing: ImageSource[], incoming: ImageSource[]) {
  const sources = [...existing];
  const resolved: ImageSource[] = [];
  const addedIds = new Set<string>();
  const reusedIds = new Set<string>();
  for (const candidate of incoming) {
    const index = reusableSourceIndex(sources, candidate);
    if (index >= 0) {
      const current = sources[index];
      const exactMatch = sourceIdentity(current) === sourceIdentity(candidate);
      const updated = exactMatch
        ? { ...current, ...candidate, id: current.id, name: current.name, identityKey: current.identityKey ?? candidate.identityKey }
        : current;
      sources[index] = updated;
      resolved.push(updated);
      reusedIds.add(updated.id);
    } else {
      sources.push(candidate);
      resolved.push(candidate);
      addedIds.add(candidate.id);
    }
  }
  return { sources, resolved, addedIds, reusedIds };
}

function prepareGeneratedProject(current: WallpaperProject, templateId = current.templates.activeTemplateId) {
  const selected = selectImagesForGeneration(current);
  const combination = createCombination(selected.assignments, templateId);
  return { project: selected.project, combination };
}

function prepareGeneratedProjectWithUsed(current: WallpaperProject, templateId: string | undefined, _used: Set<string>) {
  return prepareGeneratedProject(current, templateId);
}

function applyCombinationToProject(current: WallpaperProject, combination: GeneratedCombination) {
  return {
    ...current,
    layers: current.layers.map((layer) => ({
      ...layer,
      generatedImageId: combination.assignments[layer.id] ?? layer.generatedImageId
    }))
  };
}


function notifySoftNumberConstraint(message: string) {
  window.dispatchEvent(new CustomEvent("pwc-soft-number-notice", { detail: message }));
}

function SoftNumberNotice() {
  const [notice, setNotice] = useState<string | undefined>();
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onNotice = (event: Event) => {
      const text = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : "Check the minimum value.";
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      setNotice(text);
      timerRef.current = window.setTimeout(() => setNotice(undefined), 1800);
    };
    window.addEventListener("pwc-soft-number-notice", onNotice);
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      window.removeEventListener("pwc-soft-number-notice", onNotice);
    };
  }, []);

  if (!notice) return null;
  return createPortal(<div className="soft-number-notice" role="status">{notice}</div>, document.body);
}

function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<{ text: string; shortcut?: string; left: number; top: number; placement: "top" | "bottom" }>();
  const timerRef = useRef<number | undefined>(undefined);
  const anchorRef = useRef<HTMLElement | undefined>(undefined);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      anchorRef.current = undefined;
      setTooltip(undefined);
    };
    const resolveAnchor = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>("[data-tooltip], [title]") ?? undefined
      : undefined;
    const show = (anchor: HTMLElement) => {
      const nativeTitle = anchor.getAttribute("title");
      if (nativeTitle && !anchor.dataset.tooltip) {
        anchor.dataset.tooltip = nativeTitle;
        anchor.dataset.nativeTitle = nativeTitle;
        anchor.removeAttribute("title");
      }
      const text = anchor.dataset.tooltip?.trim();
      if (!text) return;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      anchorRef.current = anchor;
      timerRef.current = window.setTimeout(() => {
        if (anchorRef.current !== anchor || !document.body.contains(anchor)) return;
        const rect = anchor.getBoundingClientRect();
        const position = placeTooltip(rect, { width: window.innerWidth, height: window.innerHeight }, Math.min(280, Math.max(100, text.length * 7.2)));
        setTooltip({
          text,
          shortcut: anchor.dataset.shortcut,
          ...position
        });
      }, 125);
    };
    const over = (event: Event) => {
      const anchor = resolveAnchor(event.target);
      if (anchor && anchor !== anchorRef.current) show(anchor);
    };
    const out = (event: MouseEvent) => {
      const anchor = resolveAnchor(event.target);
      const related = resolveAnchor(event.relatedTarget);
      if (!anchor || anchor !== related) clear();
    };
    const focusIn = (event: FocusEvent) => {
      const anchor = resolveAnchor(event.target);
      if (anchor) show(anchor);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focusIn, true);
    document.addEventListener("focusout", clear, true);
    document.addEventListener("pointerdown", clear, true);
    return () => {
      clear();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focusIn, true);
      document.removeEventListener("focusout", clear, true);
      document.removeEventListener("pointerdown", clear, true);
    };
  }, []);

  if (!tooltip) return null;
  return createPortal(
    <div
      className={`global-tooltip ${tooltip.placement}`}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      <span>{tooltip.text}</span>{tooltip.shortcut && <kbd>{tooltip.shortcut}</kbd>}
    </div>,
    document.body
  );
}


type AddSourceControlProps = {
  onAddFolder: () => void;
  onAddImages: () => void;
  onAddPinterest: () => void;
  pinterestEnabled: boolean;
};

type AddSourceMenuPosition = {
  left: number;
  top: number;
  ready: boolean;
};

function AddSourceControl({ onAddFolder, onAddImages, onAddPinterest, pinterestEnabled }: AddSourceControlProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<AddSourceMenuPosition>({ left: 0, top: 0, ready: false });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const pendingFocusRef = useRef<number | undefined>(undefined);
  const menuId = "add-source-menu";

  const items = useMemo(() => [
    {
      id: "folder",
      label: "Folder",
      description: "Use images from a folder",
      icon: <FolderOpen size={18} />,
      action: onAddFolder
    },
    {
      id: "images",
      label: "Images",
      description: "Select one or more image files",
      icon: <ImagePlus size={18} />,
      action: onAddImages
    },
    ...(pinterestEnabled ? [{
      id: "pinterest",
      label: "Pinterest Board",
      description: "Import images from a board",
      icon: <Sparkles size={18} />,
      action: onAddPinterest
    }] : [])
  ], [onAddFolder, onAddImages, onAddPinterest, pinterestEnabled]);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== undefined) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = undefined;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    clearOpenTimer();
    clearCloseTimer();
    pendingFocusRef.current = undefined;
    setOpen(false);
    setPosition((current) => ({ ...current, ready: false }));
    if (restoreFocus) requestAnimationFrame(() => buttonRef.current?.focus());
  }, [clearCloseTimer, clearOpenTimer]);

  const openMenu = useCallback((focusIndex?: number) => {
    clearOpenTimer();
    clearCloseTimer();
    pendingFocusRef.current = focusIndex;
    setOpen(true);
  }, [clearCloseTimer, clearOpenTimer]);

  const scheduleOpen = useCallback(() => {
    clearCloseTimer();
    if (open || openTimerRef.current !== undefined) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = undefined;
      setOpen(true);
    }, 120);
  }, [clearCloseTimer, open]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setOpen(false);
      setPosition((current) => ({ ...current, ready: false }));
    }, 220);
  }, [clearCloseTimer, clearOpenTimer]);

  const updatePosition = useCallback(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const margin = 10;
    const gap = 8;
    let left = anchor.right - menu.width;
    left = clamp(left, margin, Math.max(margin, window.innerWidth - menu.width - margin));
    const below = anchor.bottom + gap;
    const above = anchor.top - menu.height - gap;
    let top = below;
    if (below + menu.height > window.innerHeight - margin && above >= margin) top = above;
    top = clamp(top, margin, Math.max(margin, window.innerHeight - menu.height - margin));
    setPosition({ left, top, ready: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      updatePosition();
      const focusIndex = pendingFocusRef.current;
      pendingFocusRef.current = undefined;
      if (focusIndex !== undefined) itemRefs.current[focusIndex]?.focus();
    });
    const reposition = () => updatePosition();
    const outsidePointer = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu(false);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", outsidePointer, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", outsidePointer, true);
    };
  }, [closeMenu, open, updatePosition]);

  useEffect(() => () => {
    clearOpenTimer();
    clearCloseTimer();
  }, [clearCloseTimer, clearOpenTimer]);

  function runAction(action: () => void) {
    closeMenu(false);
    action();
  }

  function focusMenuItem(index: number) {
    const count = items.length;
    if (!count) return;
    itemRefs.current[(index + count) % count]?.focus();
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const currentIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem(currentIndex < 0 ? 0 : currentIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(items.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu(false);
    }
  }

  const menu = open ? createPortal(
    <div
      id={menuId}
      ref={menuRef}
      className={`add-source-menu ${position.ready ? "ready" : ""}`}
      role="menu"
      aria-label="Add source options"
      style={{ left: position.left, top: position.top }}
      onPointerEnter={clearCloseTimer}
      onPointerLeave={scheduleClose}
      onKeyDown={handleMenuKeyDown}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => { itemRefs.current[index] = element; }}
          type="button"
          role="menuitem"
          className="add-source-menu-item"
          onClick={() => runAction(item.action)}
        >
          <span className="add-source-menu-icon" aria-hidden="true">{item.icon}</span>
          <span className="add-source-menu-copy">
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </span>
        </button>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div
      ref={rootRef}
      className="add-source-control"
      onPointerLeave={scheduleClose}
      onFocus={clearCloseTimer}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && (rootRef.current?.contains(next) || menuRef.current?.contains(next))) return;
        scheduleClose();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="add-source-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => open ? closeMenu(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu(0);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(items.length - 1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(false);
          }
        }}
      >
        <span className={`add-source-trigger-icon ${open ? "open" : ""}`} aria-hidden="true">
          <Plus className="add-source-trigger-plus" size={15} />
          <ChevronDown className="add-source-trigger-chevron" size={15} />
        </span>
        <span>Add Source</span>
      </button>
      {menu}
    </div>
  );
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error?: string }> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("Renderer error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="renderer-recovery">
        <section>
          <h1>The editor hit an error</h1>
          <p>{this.state.error}</p>
          <div>
            <button className="button primary" onClick={() => window.location.reload()}>Reload Editor</button>
            <button className="button secondary" onClick={() => { localStorage.removeItem(autosaveKey); void deleteWebAutosaveProject().finally(() => window.location.reload()); }}>Reset Autosave and Reload</button>
          </div>
          <small>Reset Autosave removes only crash-recovery state, not explicitly saved project files.</small>
        </section>
      </main>
    );
  }
}

function App() {
  const [project, setProject] = useState<WallpaperProject>(() => {
    const autosaved = hasDesktopRuntimeApi ? localStorage.getItem(autosaveKey) : null;
    if (!autosaved) return createProjectForCurrentScreen();
    try {
      const restored = compactProjectForAutosave(normalizeProject(JSON.parse(autosaved) as WallpaperProject));
      if (!localStorage.getItem(filePathKey)
        && restored.canvas.presetId === "custom"
        && restored.canvas.width === 1920
        && restored.canvas.height === 1080) {
        return projectWithCurrentScreenCanvas(restored);
      }
      return restored;
    } catch {
      return createProjectForCurrentScreen();
    }
  });
  const [view, setView] = useState<AppView>("home");
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("all");
  const [selectedLayerId, setSelectedLayerId] = useState<string | undefined>(project.layers[0]?.id);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>(project.layers[0]?.id ? [project.layers[0].id] : []);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | undefined>(project.layers[0]?.id);
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(project.sources[0]?.id);
  const [projectPath, setProjectPath] = useState<string | undefined>(() => localStorage.getItem(filePathKey) ?? undefined);
  const webAutosaveHydratedRef = useRef(hasDesktopRuntimeApi);
  const [message, setMessage] = useState("Ready");
  const [zoom, setZoom] = useState(0.36);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [cropModeLayerId, setCropModeLayerId] = useState<string | undefined>();
  const [clipboardLayers, setClipboardLayers] = useState<PlaceholderLayer[]>([]);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | undefined>();
  const [dropFeedback, setDropFeedback] = useState<DropFeedback | undefined>();
  const [wallpaperHistoryIndex, setWallpaperHistoryIndex] = useState(0);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [addObjectMenuOpen, setAddObjectMenuOpen] = useState(false);
  const toolbarMenuCloseTimerRef = useRef<number | undefined>(undefined);
  const addObjectMenuCloseTimerRef = useRef<number | undefined>(undefined);
  const [sourceMenu, setSourceMenu] = useState<SourceMenuState | undefined>();
  const [layerMenu, setLayerMenu] = useState<LayerMenuState | undefined>();
  const [layerDropIndicator, setLayerDropIndicator] = useState<{ targetId: string; before: boolean } | undefined>();
  const [sourceLibraryView, setSourceLibraryView] = useState<SourceLibraryView>("linked");
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>("sources");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("settings");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [renameState, setRenameState] = useState<RenameState | undefined>();
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | undefined>();
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  const selectedLayerIdRef = useRef(selectedLayerId);
  const clipboardLayersRef = useRef<PlaceholderLayer[]>([]);
  const viewRef = useRef(view);
  const pasteEventVersionRef = useRef(0);
  const pasteFallbackTimerRef = useRef<number | undefined>(undefined);
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [wallpaperStatus, setWallpaperStatus] = useState<WallpaperRuntimeStatus>("idle");
  const [wallpaperTargets, setWallpaperTargets] = useState<WallpaperTarget[]>([]);
  const [history, setHistory] = useState<{ past: WallpaperProject[]; future: WallpaperProject[] }>({ past: [], future: [] });
  const [pinterestDialog, setPinterestDialog] = useState<PinterestDialogState>({
    open: false,
    url: "",
    progress: 0,
    imagesFound: 0,
    imagesCached: 0,
    log: [],
    busy: false
  });
  const [sourceImportDialog, setSourceImportDialog] = useState<SourceImportDialogState>({
    open: false,
    title: "Importing images",
    message: "Preparing import…"
  });
  const sourceImportRunIdRef = useRef(0);
  const [exportSet, setExportSet] = useState<ExportSetState>({
    open: false,
    setName: "Wallpaper Set",
    count: 10,
    format: "png",
    quality: 0.92,
    avoidRepeats: true,
    advanceLiveState: false,
    busy: false,
    cleanupBusy: false,
    cancelRequested: false,
    completed: 0,
    skipped: 0,
    failed: 0,
    windowsCycleSeconds: 60
  });
  const dragRef = useRef<DragState | undefined>(undefined);
  const lastPasteRef = useRef<{ fingerprint: string; at: number } | undefined>(undefined);
  const polaroidImageDragRef = useRef<PolaroidImageDragState | undefined>(undefined);
  const canvasPanRef = useRef<CanvasPanState | undefined>(undefined);
  const marqueeRef = useRef<SelectionMarquee | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasZoomShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const zoomFrameRef = useRef<number | undefined>(undefined);
  const zoomCommitTimerRef = useRef<number | undefined>(undefined);
  const wheelDeltaRef = useRef(0);
  const wheelAnchorRef = useRef({ clientX: 0, clientY: 0 });
  const imageNaturalRef = useRef<Record<string, { width: number; height: number }>>({});
  const [, setNaturalImageVersion] = useState(0);
  const projectRef = useRef(project);
  const applyInFlightRef = useRef(false);
  const wallpaperOperationRef = useRef<SingleFlightWallpaperOperation | undefined>(undefined);
  if (!wallpaperOperationRef.current) wallpaperOperationRef.current = new SingleFlightWallpaperOperation(() => Date.now());
  const exportCancelRef = useRef(false);
  const sourceApplyTimerRef = useRef<number | undefined>(undefined);
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const sourceApplyVersionRef = useRef(0);
  const selectedLayers = project.layers.filter((layer) => selectedLayerIds.includes(layer.id));
  const selectedLayer = project.layers.find((layer) => layer.id === selectedLayerId) ?? selectedLayers.at(-1);
  const linkedSourceIds = activeTemplateSourceIds(project);
  const linkedSources = project.sources.filter((source) => linkedSourceIds.includes(source.id));
  const visibleSources = sourceLibraryView === "linked" ? linkedSources : project.sources;
  const selectedSource = project.sources.find((source) => source.id === selectedSourceId);
  const visibleTemplates = useMemo(() => {
    const templates = [...project.templates.templates];
    if (templateFilter === "favorites") return templates.filter((template) => template.favorite);
    if (templateFilter === "rotation") return templates.filter((template) => template.enabledForRotation);
    if (templateFilter === "recent") {
      return templates
        .filter((template) => template.lastUsedAt)
        .sort((a, b) => Date.parse(b.lastUsedAt ?? b.updatedAt) - Date.parse(a.lastUsedAt ?? a.updatedAt));
    }
    return templates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [project.templates.templates, templateFilter]);

  useEffect(() => {
    if (!editingTextLayerId) return;
    const frame = requestAnimationFrame(() => {
      const editor = canvasRef.current?.querySelector(`[data-text-layer-id="${CSS.escape(editingTextLayerId)}"]`) as HTMLElement | null;
      if (!editor) return;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    return () => cancelAnimationFrame(frame);
  }, [editingTextLayerId]);

  useEffect(() => {
    const unsubscribe = window.wallpaperApi?.onSourceImportProgress?.((progress: SourceImportProgress) => {
      setSourceImportDialog({
        open: true,
        title: progress.title,
        message: progress.message ?? "Scanning and preparing images…",
        current: progress.current,
        total: progress.total
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  function beginSourceImportDialog(title: string, message: string) {
    const runId = sourceImportRunIdRef.current + 1;
    sourceImportRunIdRef.current = runId;
    setSourceImportDialog({ open: true, title, message });
    return runId;
  }

  function finishSourceImportDialog(runId: number) {
    window.setTimeout(() => {
      if (sourceImportRunIdRef.current !== runId) return;
      setSourceImportDialog((current) => ({ ...current, open: false }));
    }, 140);
  }


  function beginWallpaperOperation(kind: "manual" | "scheduled" | "history" | "source-change") {
    const lease = wallpaperOperationRef.current!.begin(kind);
    if (!lease) return undefined;
    applyInFlightRef.current = true;
    setWallpaperBusy(true);
    if (lease.recoveredStale) {
      setMessage("Recovered a stale wallpaper operation. Starting a fresh run.");
    }
    return lease.token;
  }

  function finishWallpaperOperation(token: number) {
    if (!wallpaperOperationRef.current!.finish(token)) return;
    applyInFlightRef.current = false;
    setWallpaperBusy(false);
  }

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds;
  }, [selectedLayerIds]);

  useEffect(() => {
    selectedLayerIdRef.current = selectedLayerId;
  }, [selectedLayerId]);

  useEffect(() => {
    clipboardLayersRef.current = clipboardLayers;
  }, [clipboardLayers]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    setInspectorTab((current) => {
      if (selectedLayer) return current === "effects" ? "effects" : "image";
      return "settings";
    });
  }, [selectedLayer?.id]);

  useEffect(() => () => {
    if (sourceApplyTimerRef.current !== undefined) window.clearTimeout(sourceApplyTimerRef.current);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    if (zoomFrameRef.current !== undefined) window.cancelAnimationFrame(zoomFrameRef.current);
    if (zoomCommitTimerRef.current !== undefined) window.clearTimeout(zoomCommitTimerRef.current);
    wallpaperOperationRef.current?.clear();
    applyInFlightRef.current = false;
  }, []);

  useEffect(() => {
    const clearDropFeedback = () => setDropFeedback(undefined);
    window.addEventListener("dragend", clearDropFeedback);
    window.addEventListener("drop", clearDropFeedback);
    return () => {
      window.removeEventListener("dragend", clearDropFeedback);
      window.removeEventListener("drop", clearDropFeedback);
    };
  }, []);

  useEffect(() => {
    if (!platformCapabilities.canUseNativeTray || !window.wallpaperApi?.setTrayState) return;
    void window.wallpaperApi.setTrayState({
      enabled: false,
      paused: false,
      interval: "manual",
      nextScheduledAt: undefined,
      status: wallpaperStatus,
      lastError: project.wallpaper.lastError
    });
  }, [project.wallpaper.lastError, wallpaperStatus]);

  useEffect(() => {
    if (!platformCapabilities.canApplyWallpaper || !window.wallpaperApi?.getWallpaperTargets) {
      setWallpaperTargets([]);
      return;
    }
    window.wallpaperApi.getWallpaperTargets()
      .then(setWallpaperTargets)
      .catch(() => setWallpaperTargets([]));
  }, []);

  useEffect(() => {
    if (!project.wallpaper.enabled && !project.wallpaper.paused && project.wallpaper.interval === "manual" && !project.wallpaper.nextScheduledAt) return;
    const next = {
      ...project,
      wallpaper: {
        ...project.wallpaper,
        enabled: false,
        paused: false,
        interval: "manual" as const,
        nextScheduledAt: undefined
      }
    };
    projectRef.current = next;
    setProject(next);
  }, [project.wallpaper.enabled, project.wallpaper.paused, project.wallpaper.interval, project.wallpaper.nextScheduledAt]);

  useEffect(() => {
    if (!platformCapabilities.canUseNativeTray || !window.wallpaperApi?.onTrayCommand) return;
    return window.wallpaperApi.onTrayCommand((command) => {
      if (command === "generate-apply" && platformCapabilities.canPreviewCurrentDesktop) void previewOnCurrentDesktop();
      if (command === "previous" && platformCapabilities.canApplyWallpaper) void applyPreviousWallpaper();
    });
  }, []);

  useEffect(() => {
    if (!platformCapabilities.canUseStartupBehavior || !window.wallpaperApi?.applyStartupBehavior) return;
    void window.wallpaperApi.applyStartupBehavior(projectRef.current.wallpaper.startMinimized);
  }, []);

  useEffect(() => {
    if (!platformCapabilities.canUsePinterestImport || !window.wallpaperApi?.onPinterestProgress) return;
    return window.wallpaperApi.onPinterestProgress((progress) => {
      setPinterestDialog((current) => {
        if (current.jobId && current.jobId !== progress.jobId) return current;
        const discovering = progress.stage === "discovering" || progress.stage === "paginating";
        const caching = progress.stage === "downloading" || progress.stage === "complete" || progress.stage === "partial";
        return {
          ...current,
          jobId: progress.jobId,
          stage: progress.stage,
          current: discovering ? progress.current : current.current,
          total: progress.total ?? current.total,
          progress: progress.progress,
          imagesFound: discovering ? Math.max(current.imagesFound, progress.current) : current.imagesFound,
          imagesCached: caching ? Math.max(current.imagesCached, progress.current) : current.imagesCached,
          log: current.log.at(-1) === progress.message ? current.log : [...current.log, progress.message]
        };
      });
    });
  }, []);

  useEffect(() => {
    const valid = selectedLayerIds.filter((id) => project.layers.some((layer) => layer.id === id));
    if (valid.length !== selectedLayerIds.length) {
      setSelectedLayerIds(valid);
      setSelectedLayerId((current) => current && valid.includes(current) ? current : valid.at(-1));
    }
  }, [project.layers, selectedLayerIds]);

  useEffect(() => {
    if (hasDesktopRuntimeApi) return;
    let canceled = false;
    readWebAutosaveProject().then((restored) => {
      if (canceled) return;
      if (restored) {
        projectRef.current = restored;
        setProject(restored);
        selectOnlyLayer(restored.layers[0]?.id);
        setSelectedSourceId(restored.sources[0]?.id);
        setMessage("Restored browser project from this device.");
      }
    }).finally(() => {
      if (!canceled) webAutosaveHydratedRef.current = true;
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      if (!hasDesktopRuntimeApi) {
        if (!webAutosaveHydratedRef.current) return;
        void writeWebAutosaveProject(project).catch((error) => {
          console.error("Browser autosave failed", error);
          setMessage("Browser autosave could not be updated. Try exporting the project file manually.");
        });
        return;
      }
      try {
        localStorage.setItem(autosaveKey, JSON.stringify(compactProjectForAutosave(project)));
      } catch (error) {
        console.error("Autosave failed", error);
        setMessage("Autosave could not be updated. Save the project file manually.");
      }
    }, 250);
    return () => {
      if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [project]);

  useEffect(() => {
    if (projectPath) localStorage.setItem(filePathKey, projectPath);
    else localStorage.removeItem(filePathKey);
  }, [projectPath]);

  const commitProject = useCallback((
    updater: (current: WallpaperProject) => WallpaperProject,
    historyEnabled = true,
    syncActiveTemplate = true
  ) => {
    setProject((current) => {
      let next = touchProject(normalizeProject(updater(current)));
      if (syncActiveTemplate) next = updateActiveTemplateSnapshot(next);
      if (historyEnabled) {
        setHistory((stack) => ({
          past: [...stack.past, cloneProject(current)].slice(-historyLimit),
          future: []
        }));
      }
      return next;
    });
  }, []);

  function setLayerSelection(ids: string[], primaryId?: string) {
    const validIds = [...new Set(ids)].filter((id) => project.layers.some((layer) => layer.id === id));
    const nextPrimary = primaryId && validIds.includes(primaryId) ? primaryId : validIds.at(-1);
    setSelectedLayerIds(validIds);
    setSelectedLayerId(nextPrimary);
    setSelectionAnchorId(nextPrimary);
  }

  function clearLayerSelection() {
    setSelectedLayerIds([]);
    setSelectedLayerId(undefined);
    setSelectionAnchorId(undefined);
    setLayerMenu(undefined);
  }

  function selectOnlyLayer(id?: string) {
    if (!id) {
      clearLayerSelection();
      return;
    }
    setSelectedLayerIds([id]);
    setSelectedLayerId(id);
    setSelectionAnchorId(id);
  }

  function selectLayerFromPanel(id: string, event: React.MouseEvent) {
    if (event.shiftKey && selectionAnchorId) {
      const range = layerSelectionRange(project.layers, selectionAnchorId, id);
      setSelectedLayerIds(range);
      setSelectedLayerId(id);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const exists = selectedLayerIds.includes(id);
      const next = exists ? selectedLayerIds.filter((item) => item !== id) : [...selectedLayerIds, id];
      setSelectedLayerIds(next);
      setSelectedLayerId(exists ? next.at(-1) : id);
      setSelectionAnchorId(id);
      return;
    }
    selectOnlyLayer(id);
  }

  function actionLayerIds(layerId?: string) {
    if (layerId && !selectedLayerIds.includes(layerId)) return [layerId];
    return selectedLayerIds.length ? selectedLayerIds : layerId ? [layerId] : [];
  }

  function patchLayers(ids: string[], patch: Partial<PlaceholderLayer>, historyEnabled = true) {
    const selected = new Set(ids);
    if (selected.size === 0) return;
    commitProject(
      (current) => ({
        ...current,
        layers: current.layers.map((layer) => (selected.has(layer.id) && !layer.locked ? { ...layer, ...patch } : layer))
      }),
      historyEnabled
    );
  }

  function patchLayer(id: string, patch: Partial<PlaceholderLayer>, historyEnabled = true, allowLocked = false) {
    commitProject(
      (current) => ({
        ...current,
        layers: current.layers.map((layer) => (layer.id === id && (allowLocked || !layer.locked) ? { ...layer, ...patch } : layer))
      }),
      historyEnabled
    );
  }

  function patchSelectedLayer(patch: Partial<PlaceholderLayer>, historyEnabled = true) {
    const editableIds = selectedLayerIds.length ? selectedLayerIds : selectedLayer ? [selectedLayer.id] : [];
    if (editableIds.length > 1) patchLayers(editableIds, patch, historyEnabled);
    else if (editableIds[0]) patchLayer(editableIds[0], patch, historyEnabled);
  }

  function patchWallpaper(patch: Partial<WallpaperProject["wallpaper"]>) {
    commitProject((current) => ({
      ...current,
      wallpaper: {
        ...current.wallpaper,
        ...patch,
        enabled: false,
        paused: false,
        interval: "manual",
        nextScheduledAt: undefined
      }
    }));
  }

  function patchCanvas(patch: Partial<CanvasSettings>) {
    commitProject((current) => ({ ...current, canvas: { ...current.canvas, ...patch } }));
  }

  function resizeCanvas(width: number, height: number, mode: CanvasResizeMode) {
    commitProject((current) => {
      const resized = resizeCanvasAndLayers(current.canvas, current.layers, width, height, mode);
      return { ...current, ...resized, canvas: { ...resized.canvas, presetId: "custom", orientation: "custom" } };
    });
  }

  function undo() {
    setHistory((stack) => {
      const previous = stack.past.at(-1);
      if (!previous) return stack;
      setProject((current) => normalizeProject(previous));
      return { past: stack.past.slice(0, -1), future: [cloneProject(project), ...stack.future].slice(0, historyLimit) };
    });
  }

  function redo() {
    setHistory((stack) => {
      const next = stack.future[0];
      if (!next) return stack;
      setProject(normalizeProject(next));
      return { past: [...stack.past, cloneProject(project)].slice(-historyLimit), future: stack.future.slice(1) };
    });
  }

  function addPlaceholder() {
    setAddObjectMenuOpen(false);
    commitProject((current) => {
      const frameCount = current.layers.filter((layer) => (layer.objectKind ?? "frame") !== "text").length;
      const layer = createPlaceholder(current.canvas, frameCount + 1);
      selectOnlyLayer(layer.id);
      return { ...current, layers: [...current.layers, layer] };
    });
  }

  function addTextLayer(presetId: TextPresetId = "soft") {
    setAddObjectMenuOpen(false);
    commitProject((current) => {
      const textCount = current.layers.filter((layer) => layer.objectKind === "text").length;
      const layer = { ...createTextLayer(current.canvas, textCount + 1), ...applyTextPreset(current.canvas, presetId) };
      selectOnlyLayer(layer.id);
      return { ...current, layers: [...current.layers, layer] };
    });
  }

  function clearAddObjectCloseTimer() {
    if (addObjectMenuCloseTimerRef.current !== undefined) {
      window.clearTimeout(addObjectMenuCloseTimerRef.current);
      addObjectMenuCloseTimerRef.current = undefined;
    }
  }

  function scheduleAddObjectClose() {
    clearAddObjectCloseTimer();
    addObjectMenuCloseTimerRef.current = window.setTimeout(() => setAddObjectMenuOpen(false), 650);
  }

  function clearToolbarMenuCloseTimer() {
    if (toolbarMenuCloseTimerRef.current !== undefined) {
      window.clearTimeout(toolbarMenuCloseTimerRef.current);
      toolbarMenuCloseTimerRef.current = undefined;
    }
  }

  function scheduleToolbarMenuClose() {
    clearToolbarMenuCloseTimer();
    toolbarMenuCloseTimerRef.current = window.setTimeout(() => setToolbarMenuOpen(false), 650);
  }

  function deleteLayers(ids: string[]) {
    const idSet = new Set(ids);
    const deletable = project.layers.filter((layer) => idSet.has(layer.id) && !layer.locked).map((layer) => layer.id);
    if (deletable.length === 0) {
      if (ids.length) setMessage("Unlock the selected layer before deleting it.");
      return;
    }
    const deleteSet = new Set(deletable);
    commitProject((current) => ({ ...current, layers: current.layers.filter((layer) => !deleteSet.has(layer.id)) }));
    const remainingSelection = selectedLayerIds.filter((id) => !deleteSet.has(id));
    setSelectedLayerIds(remainingSelection);
    setSelectedLayerId(remainingSelection.at(-1));
    if (cropModeLayerId && deleteSet.has(cropModeLayerId)) setCropModeLayerId(undefined);
    setLayerMenu(undefined);
  }

  function deleteSelectedLayer() {
    deleteLayers(selectedLayerIds);
  }

  function duplicateLayers(ids: string[]) {
    const idSet = new Set(ids);
    const existingNames = new Set(project.layers.map((layer) => layer.name));
    const copies = project.layers
      .filter((layer) => idSet.has(layer.id) && !layer.locked)
      .map((layer) => {
        const name = numberedCopyName(layer.name, existingNames);
        existingNames.add(name);
        return {
          ...structuredClone(layer),
          id: uid("placeholder"),
          name,
          x: layer.x + 32,
          y: layer.y + 32
        };
      });
    if (copies.length === 0) {
      if (ids.length) setMessage("Unlock the selected layer before duplicating it.");
      return;
    }
    commitProject((current) => ({ ...current, layers: [...current.layers, ...copies] }));
    setSelectedLayerIds(copies.map((layer) => layer.id));
    setSelectedLayerId(copies.at(-1)?.id);
    setSelectionAnchorId(copies.at(-1)?.id);
    setLayerMenu(undefined);
  }

  function duplicateSelectedLayer() {
    duplicateLayers(selectedLayerIds);
  }

  function selectedLayersFromCurrentProject() {
    const ids = selectedLayerIdsRef.current.length
      ? selectedLayerIdsRef.current
      : selectedLayerIdRef.current
        ? [selectedLayerIdRef.current]
        : [];
    const idSet = new Set(ids);
    return projectRef.current.layers.filter((layer) => idSet.has(layer.id) && !layer.locked);
  }

  function persistLayerClipboard(layers: PlaceholderLayer[]) {
    try {
      if (layers.length) localStorage.setItem(layerClipboardKey, clipboardLayerPayload(layers));
      else localStorage.removeItem(layerClipboardKey);
    } catch {
      // Browser storage can fail in private windows or under quota pressure.
      // The in-memory clipboard ref remains the primary desktop clipboard path.
    }
  }

  function readPersistedLayerClipboard() {
    try {
      return parseClipboardLayers(localStorage.getItem(layerClipboardKey) ?? undefined) ?? [];
    } catch {
      return [];
    }
  }

  function layerClipboardForPaste() {
    if (clipboardLayersRef.current.length) return clipboardLayersRef.current;
    const restored = readPersistedLayerClipboard();
    if (restored.length) {
      clipboardLayersRef.current = restored;
      setClipboardLayers(restored);
    }
    return restored;
  }

  function storeCopiedLayers(layers: PlaceholderLayer[]) {
    const cloned = structuredClone(layers);
    clipboardLayersRef.current = cloned;
    setClipboardLayers(cloned);
    persistLayerClipboard(cloned);
    if (cloned.length) setMessage(`Copied ${cloned.length} layer${cloned.length === 1 ? "" : "s"}.`);
    return cloned.length > 0;
  }

  function copySelectedLayersForClipboard() {
    const layers = selectedLayersFromCurrentProject();
    if (layers.length === 0) {
      if (selectedLayerIdsRef.current.length || selectedLayerIdRef.current) setMessage("Unlock the selected layer before copying it.");
      return false;
    }
    return storeCopiedLayers(layers);
  }

  function parseClipboardLayers(raw: string | undefined) {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { app?: string; version?: number; layers?: PlaceholderLayer[] };
      if (parsed?.app !== "pin-paper" || !Array.isArray(parsed.layers)) return undefined;
      return parsed.layers;
    } catch {
      return undefined;
    }
  }

  function clipboardLayerPayload(layers: PlaceholderLayer[]) {
    return JSON.stringify({ app: "pin-paper", version: 1, layers });
  }

  function pasteCopiedLayers(layers = layerClipboardForPaste()) {
    if (viewRef.current !== "editor" || layers.length === 0) return false;
    const existingNames = new Set(projectRef.current.layers.map((layer) => layer.name));
    const pasted = layers.map((layer) => {
      const name = numberedCopyName(layer.name, existingNames);
      existingNames.add(name);
      return {
        ...structuredClone(layer),
        id: uid("placeholder"),
        name,
        x: layer.x + 28,
        y: layer.y + 28
      };
    });
    commitProject((current) => ({ ...current, layers: [...current.layers, ...pasted] }));
    setSelectedLayerIds(pasted.map((layer) => layer.id));
    setSelectedLayerId(pasted.at(-1)?.id);
    setSelectionAnchorId(pasted.at(-1)?.id);
    return true;
  }

  function reorderLayers(ids: string[], action: LayerOrderAction) {
    const movableIds = ids.filter((id) => !project.layers.find((layer) => layer.id === id)?.locked);
    if (movableIds.length === 0) {
      if (ids.length) setMessage("Unlock the selected layer before changing its order.");
      return;
    }
    commitProject((current) => ({ ...current, layers: reorderLayerBlock(current.layers, movableIds, action) }));
    setLayerMenu(undefined);
  }

  function reorderSelectedLayer(action: LayerOrderAction) {
    reorderLayers(selectedLayerIds, action);
  }

  function stepLayerImage(layer: PlaceholderLayer, direction: "previous" | "next") {
    const current = projectRef.current;
    const pool = collectLayerImages(current, layer);
    if (pool.length < 2) {
      setMessage("This source only has one available image.");
      return;
    }
    const currentImageId = layer.generatedImageId ?? layer.selectedImageId ?? getImageForLayer(current, layer)?.id ?? pool[0].image.id;
    const currentIndex = Math.max(0, pool.findIndex((item) => item.image.id === currentImageId));
    const nextIndex = direction === "next"
      ? (currentIndex + 1) % pool.length
      : (currentIndex - 1 + pool.length) % pool.length;
    const choice = pool[nextIndex];
    patchLayer(layer.id, {
      sourceId: choice.source.id,
      generatedImageId: choice.image.id,
      cropMode: "cover"
    });
    setMessage(`${direction === "next" ? "Next" : "Previous"} image: ${choice.image.name}`);
  }

  function renameLayer(layerId: string) {
    const layer = project.layers.find((item) => item.id === layerId);
    if (!layer) return;
    setRenameState({ kind: "layer", id: layer.id, value: layer.name });
    setLayerMenu(undefined);
  }

  function finishRename(save: boolean) {
    const state = renameState;
    if (!state) return;
    const name = state.value.trim();
    if (save && !name) {
      setMessage("Names cannot be empty.");
      return;
    }
    setRenameState(undefined);
    if (!save) return;
    if (state.kind === "layer") patchLayer(state.id, { name });
    if (state.kind === "template") patchTemplate(state.id, { name });
    if (state.kind === "source") {
      commitProject((current) => ({
        ...current,
        sources: current.sources.map((item) => (item.id === state.id ? { ...item, name, updatedAt: new Date().toISOString() } : item))
      }));
    }
  }

  function toggleLayerVisibility(layerId: string) {
    const anchor = project.layers.find((item) => item.id === layerId);
    if (!anchor) return;
    const ids = selectedLayerIds.includes(layerId) && selectedLayerIds.length > 1 ? selectedLayerIds : [layerId];
    const nextHidden = !anchor.hidden;
    commitProject((current) => ({
      ...current,
      layers: current.layers.map((layer) => ids.includes(layer.id) ? { ...layer, hidden: nextHidden } : layer)
    }));
    if (nextHidden) {
      const remaining = selectedLayerIds.filter((id) => !ids.includes(id));
      setSelectedLayerIds(remaining);
      setSelectedLayerId(remaining.at(-1));
      setSelectionAnchorId(remaining.at(-1));
    }
  }

  function toggleLayerLock(layerId: string) {
    const anchor = project.layers.find((item) => item.id === layerId);
    if (!anchor) return;
    const ids = selectedLayerIds.includes(layerId) && selectedLayerIds.length > 1 ? selectedLayerIds : [layerId];
    const nextLocked = !anchor.locked;
    commitProject((current) => ({
      ...current,
      layers: current.layers.map((layer) => ids.includes(layer.id) ? { ...layer, locked: nextLocked } : layer)
    }));
  }

  async function chooseBackground() {
    const result = await window.wallpaperApi.chooseImageFile();
    if (result.canceled) return;
    if (result.error || !result.image) {
      setMessage(result.error ?? "The selected image could not be read.");
      return;
    }
    commitProject((current) => ({
      ...current,
      canvas: {
        ...current.canvas,
        backgroundImage: result.image,
        backgroundBaseMode: "image",
        backgroundTransparent: false,
        backgroundOffsetX: 0,
        backgroundOffsetY: 0,
        backgroundScale: 1
      }
    }));
  }

  function clearBackgroundImage() {
    commitProject((current) => ({ ...current, canvas: { ...removeBackgroundImage(current.canvas), backgroundBaseMode: "color", backgroundTransparent: false } }));
  }

  async function importCustomTexture() {
    const result = await window.wallpaperApi.importCustomTexture();
    if (result.canceled) return;
    if (result.error || !result.texture) {
      setMessage(result.error ?? "Unable to import texture.");
      return;
    }
    commitProject((current) => ({
      ...current,
      customTextures: [...current.customTextures.filter((texture) => texture.id !== result.texture!.id), result.texture!],
      canvas: {
        ...current.canvas,
        backgroundPaper: { ...current.canvas.backgroundPaper, enabled: true, type: "custom", customTextureId: result.texture!.id, intensity: Math.max(45, current.canvas.backgroundPaper.intensity), opacity: Math.max(0.5, current.canvas.backgroundPaper.opacity) }
      }
    }));
    setMessage(`Imported texture ${result.texture.name}.`);
  }


  async function addTransparentOverlay() {
    const result = await window.wallpaperApi.importOverlayImage();
    if (result.canceled) return;
    if (result.error || !result.source) {
      setMessage(result.error ?? "Unable to import overlay image.");
      return;
    }
    const center = { x: projectRef.current.canvas.width / 2, y: projectRef.current.canvas.height / 2 };
    const placed = await placeSourcesAtCanvasPoint([result.source], center, result.summary, result.warnings);
    if (placed) {
      setInspectorTab("image");
      setMessage(`Added managed overlay image: ${result.image?.name ?? result.source.name}.`);
    }
  }

  async function removeCustomTextureAsset(textureId: string) {
    const texture = projectRef.current.customTextures.find((item) => item.id === textureId);
    if (!texture) return;
    await window.wallpaperApi.removeCustomTexture(texture.path);
    clearSurfaceTextureCaches(texture.url);
    commitProject((current) => ({
      ...current,
      customTextures: current.customTextures.filter((item) => item.id !== textureId),
      canvas: current.canvas.backgroundPaper.customTextureId === textureId
        ? { ...current.canvas, backgroundPaper: { ...current.canvas.backgroundPaper, enabled: false, type: "none", customTextureId: undefined, intensity: 0, opacity: 0 } }
        : current.canvas,
      layers: current.layers.map((layer) => layer.effects.paper.customTextureId === textureId
        ? { ...layer, effects: { ...layer.effects, paper: { ...layer.effects.paper, enabled: false, type: "none", customTextureId: undefined, intensity: 0, opacity: 0 } } }
        : layer)
    }));
    setMessage(`Removed texture ${texture.name}.`);
  }

  async function revealCustomTexture(textureId: string) {
    const texture = projectRef.current.customTextures.find((item) => item.id === textureId);
    if (texture) await window.wallpaperApi.revealCustomTexture(texture.path);
  }

  async function matchFrameToImage(layer: PlaceholderLayer) {
    const imageRef = getImageForLayer(project, layer);
    if (!imageRef) {
      setMessage("Assign or generate an image before matching the frame.");
      return;
    }
    try {
      const image = new Image();
      image.src = imageRef.url;
      await image.decode();
      const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
      const centerX = layer.x + layer.width / 2;
      const centerY = layer.y + layer.height / 2;
      let width = layer.width;
      let height = width / aspect;
      if (height > project.canvas.height) {
        height = Math.min(project.canvas.height, layer.height);
        width = height * aspect;
      }
      const nextWidth = Math.round(Math.max(40, Math.min(maxOverflowLayerSize(project.canvas), width)));
      const nextHeight = Math.round(Math.max(40, Math.min(maxOverflowLayerSize(project.canvas), height)));
      const nextPosition = clampRecoverablePosition(centerX - nextWidth / 2, centerY - nextHeight / 2, nextWidth, nextHeight, project.canvas);
      patchLayer(layer.id, {
        width: nextWidth,
        height: nextHeight,
        x: Math.round(nextPosition.x),
        y: Math.round(nextPosition.y),
        keepAspectRatio: true
      });
    } catch {
      setMessage("Unable to read the current image dimensions.");
    }
  }

  function resetFrame(layer: PlaceholderLayer) {
    const defaults = createPlaceholder(project.canvas, 0);
    const centerX = layer.x + layer.width / 2;
    const centerY = layer.y + layer.height / 2;
    const nextPosition = clampRecoverablePosition(centerX - defaults.width / 2, centerY - defaults.height / 2, defaults.width, defaults.height, project.canvas);
    patchLayer(layer.id, {
      width: defaults.width,
      height: defaults.height,
      x: Math.round(nextPosition.x),
      y: Math.round(nextPosition.y)
    });
  }

  async function addFolderSource() {
    if (window.wallpaperApi?.chooseFolder) {
      const importRunId = beginSourceImportDialog("Choose image folder", "Select a folder. Pin Paper will show progress here while it scans and converts images.");
      try {
        const result = await window.wallpaperApi.chooseFolder();
        if (result.canceled) return;
        if (result.error || !result.source) {
          setMessage(result.error ?? "Unable to add folder.");
          return;
        }
        const merged = addSourcesToProjectDetailed([result.source], true, false);
        const resolved = merged.resolved[0];
        if (resolved) {
          setSelectedSourceId(resolved.id);
          setMessage(importResultMessage(result.summary, merged, result.warnings));
        }
      } finally {
        finishSourceImportDialog(importRunId);
      }
      return;
    }

    const files = await browserFileInput(true);
    if (!files) return;
    const importRunId = beginSourceImportDialog("Importing folder", "Reading selected images and preparing previews…");
    try {
      const result = await browserImageSourceFromFiles(files, "Browser Folder", "top-level-only");
      if (!result.source) {
        setMessage(result.warnings[0] ?? "No supported images were selected.");
        return;
      }
      const merged = addSourcesToProjectDetailed([result.source], true, false);
      const resolved = merged.resolved[0];
      if (resolved) {
        setSelectedSourceId(resolved.id);
        setMessage(importResultMessage(result.summary, merged, result.warnings));
      }
    } finally {
      finishSourceImportDialog(importRunId);
    }
  }

  function addSourcesToProjectDetailed(sources: ImageSource[], linkToTemplate = true, announce = true) {
    const before = projectRef.current;
    if (sources.length === 0) return { sources: before.sources, resolved: [] as ImageSource[], addedIds: new Set<string>(), reusedIds: new Set<string>() };
    const merged = mergeReusableSources(before.sources, sources);
    let next = { ...before, sources: merged.sources };
    if (linkToTemplate) {
      for (const source of merged.resolved) next = linkSourceToActiveTemplate(next, source.id);
    }
    next = touchProject(updateActiveTemplateSnapshot(normalizeProject(next)));
    setHistory((stack) => ({ past: [...stack.past, cloneProject(before)].slice(-historyLimit), future: [] }));
    projectRef.current = next;
    setProject(next);
    setSelectedSourceId(merged.resolved[0]?.id);
    if (linkToTemplate) setSourceLibraryView("linked");
    if (announce) {
      setMessage(`${merged.resolved.length} reusable source${merged.resolved.length === 1 ? "" : "s"} ready${linkToTemplate ? " and linked to this template" : ""}.`);
    }
    return merged;
  }

  function addSourcesToProject(sources: ImageSource[], images: LocalImageRef[] = [], linkToTemplate = true) {
    const imageSource: ImageSource | undefined = images.length > 0 ? {
      id: uid("source"),
      providerId: "local-file",
      type: "local-file",
      name: images.length === 1 ? images[0].name : `${images.length} local images`,
      images,
      importStatus: "ready",
      mediaPolicy: "images-and-video-thumbnails",
      mediaCounts: { total: images.length, images: images.filter((image) => image.mediaType !== "video").length, videos: images.filter((image) => image.mediaType === "video").length },
      importLog: [`Imported ${images.length} local files as one collection.`],
      updatedAt: new Date().toISOString()
    } : undefined;
    return addSourcesToProjectDetailed([...sources, ...(imageSource ? [imageSource] : [])], linkToTemplate).resolved;
  }

  function projectWithSourcesAssignment(base: WallpaperProject, sources: ImageSource[], layerId: string) {
    const layer = base.layers.find((item) => item.id === layerId);
    if (!layer || layer.locked) return undefined;
    const eligibleImages = sources.flatMap(sourceImagesForPolicy);
    if (eligibleImages.length === 0) return undefined;
    const singleImage = eligibleImages.length === 1;
    const linkedIds = new Set(activeTemplateSourceIds(base));
    let next = base;
    for (const source of sources) {
      if (!linkedIds.has(source.id)) next = linkSourceToActiveTemplate(next, source.id);
    }
    next = {
      ...next,
      layers: next.layers.map((item) => item.id === layerId ? {
        ...item,
        sourceId: sources[0]?.id,
        selectedImageId: singleImage ? eligibleImages[0]?.id : undefined,
        generatedImageId: undefined,
        sourceState: {
          ...item.sourceState,
          sourceIds: sources.map((source) => source.id),
          mode: singleImage ? "fixed" : "shuffle",
          currentIndex: 0,
          shuffleQueue: [],
          usedImageIds: [],
          preventDuplicates: eligibleImages.length > 1
        }
      } : item)
    };
    const assigned = next.layers.find((item) => item.id === layerId);
    if (!assigned) return undefined;
    const selection = selectImageForLayer(next, assigned, new Set<string>());
    next = {
      ...next,
      layers: next.layers.map((item) => item.id === layerId ? selection.layer : item)
    };
    return touchProject(updateActiveTemplateSnapshot(normalizeProject(next)));
  }

  function projectWithSourceAssignment(base: WallpaperProject, source: ImageSource, layerId: string) {
    return projectWithSourcesAssignment(base, [source], layerId);
  }

  function projectWithDropImageAssignment(base: WallpaperProject, source: ImageSource, layerId: string, chosenImage: LocalImageRef) {
    const layer = base.layers.find((item) => item.id === layerId);
    if (!layer || layer.locked) return undefined;
    const eligibleImages = sourceImagesForPolicy(source);
    if (eligibleImages.length === 0) return undefined;
    const chosen = eligibleImages.find((image) => image.id === chosenImage.id) ?? eligibleImages[0];
    const linkedIds = new Set(activeTemplateSourceIds(base));
    let next = linkedIds.has(source.id) ? base : linkSourceToActiveTemplate(base, source.id);
    const chosenIndex = imageIndexInSource(source, chosen);
    const nextIndex = eligibleImages.length > 0 ? (chosenIndex + 1) % eligibleImages.length : 0;
    next = {
      ...next,
      layers: next.layers.map((item) => item.id === layerId ? {
        ...item,
        sourceId: source.id,
        selectedImageId: eligibleImages.length === 1 ? chosen.id : undefined,
        generatedImageId: chosen.id,
        cropMode: "cover" as const,
        crop: { offsetX: 0, offsetY: 0, zoom: 1 },
        alignment: "center" as const,
        sourceState: {
          ...item.sourceState,
          sourceIds: [source.id],
          mode: eligibleImages.length === 1 ? "fixed" : "shuffle",
          currentIndex: nextIndex,
          shuffleQueue: eligibleImages.map((image) => image.id).filter((id) => id !== chosen.id),
          usedImageIds: [chosen.id],
          preventDuplicates: eligibleImages.length > 1
        }
      } : item)
    };
    return touchProject(updateActiveTemplateSnapshot(normalizeProject(next)));
  }

  function assignSourcesToLayer(sources: ImageSource[], layer: PlaceholderLayer, messageOverride?: string) {
    if (layer.locked) {
      setMessage("Unlock the layer before changing its source.");
      return false;
    }
    const before = projectRef.current;
    const next = projectWithSourcesAssignment(before, sources, layer.id);
    if (!next) {
      setMessage("The imported source has no images allowed by its media filter.");
      return false;
    }
    setHistory((stack) => ({ past: [...stack.past, cloneProject(before)].slice(-historyLimit), future: [] }));
    projectRef.current = next;
    setProject(next);
    setSelectedSourceId(sources[0]?.id);
    setMessage(messageOverride ?? (sources.length === 1
      ? `Assigned ${sources[0].name} to ${layer.name}.`
      : `Assigned ${sources.length} sources to ${layer.name}.`));
    return true;
  }

  function assignSourceToLayer(source: ImageSource, layer: PlaceholderLayer) {
    return assignSourcesToLayer([source], layer);
  }

  function handleSourceClick(source: ImageSource) {
    setSelectedSourceId(source.id);
    if (!selectedLayer) {
      setMessage(`Inspecting ${source.name}. Select an unlocked image to assign it.`);
      return;
    }
    if (selectedLayer.locked) {
      setMessage("Unlock the selected layer before assigning a source.");
      return;
    }
    if (selectedLayer.objectKind === "text") {
      setMessage("Select a frame before assigning a source.");
      return;
    }
    const before = cloneProject(projectRef.current);
    const candidate = projectWithSourceAssignment(before, source, selectedLayer.id);
    if (!candidate) {
      setMessage(`${source.name} has no items allowed by its media filter.`);
      return;
    }
    setHistory((stack) => ({ past: [...stack.past, before].slice(-historyLimit), future: [] }));
    projectRef.current = candidate;
    setProject(candidate);
    setMessage(`Switching ${selectedLayer.name} to ${source.name}…`);

    sourceApplyVersionRef.current += 1;
    const version = sourceApplyVersionRef.current;
    if (sourceApplyTimerRef.current !== undefined) window.clearTimeout(sourceApplyTimerRef.current);
    const runLatestSourceApply = async () => {
      if (version !== sourceApplyVersionRef.current) return;
      if (applyInFlightRef.current) {
        sourceApplyTimerRef.current = window.setTimeout(() => void runLatestSourceApply(), 120);
        return;
      }
      const activeLayer = candidate.layers.find((item) => item.id === selectedLayer.id);
      const assignments = Object.fromEntries(candidate.layers.map((item) => [item.id, item.generatedImageId ?? item.selectedImageId]).filter((entry): entry is [string, string] => Boolean(entry[1])));
      const combination = createCombination(assignments, candidate.templates.activeTemplateId);
      const applied = await applyCandidate(candidate, combination, { label: `Applied ${source.name}` });
      if (!applied && version === sourceApplyVersionRef.current) {
        projectRef.current = before;
        setProject(before);
        setMessage(`Could not apply ${source.name}; restored the previous source.`);
      } else if (applied && activeLayer) {
        setSelectedSourceId(source.id);
      }
    };
    sourceApplyTimerRef.current = window.setTimeout(() => void runLatestSourceApply(), 320);
  }

  function skippedImportCount(summary?: LocalImportSummary) {
    if (!summary) return 0;
    return summary.skippedUnsupportedCount + summary.skippedUnreadableCount + summary.skippedMissingCount;
  }

  function importResultMessage(
    summary: LocalImportSummary | undefined,
    merged: ReturnType<typeof mergeReusableSources>,
    warnings: string[] | undefined,
    assignmentLayer?: PlaceholderLayer
  ) {
    const reused = merged.reusedIds.size;
    const added = merged.addedIds.size;
    const skipped = skippedImportCount(summary);
    let message: string;
    if (assignmentLayer) {
      const plural = merged.resolved.length > 1;
      message = reused > 0 && added === 0
        ? `Existing source${plural ? "s" : ""} assigned to ${assignmentLayer.name}`
        : `Source${plural ? "s" : ""} assigned to ${assignmentLayer.name}`;
    } else if (merged.resolved.length === 1 && merged.resolved[0].type === "local-folder") {
      const source = merged.resolved[0];
      message = `${reused > 0 ? "Folder source reused" : "Folder source added"} — ${source.images.length} images`;
    } else if (merged.resolved.length === 1 && merged.resolved[0].type === "local-file") {
      const count = merged.resolved[0].images.length;
      message = reused > 0 ? `Existing image source reused — ${count} image${count === 1 ? "" : "s"}` : `${count} image${count === 1 ? "" : "s"} added as a source`;
    } else {
      message = `${added} source${added === 1 ? "" : "s"} added${reused ? `, ${reused} reused` : ""} — ${summary?.discoveredImageCount ?? merged.resolved.reduce((total, source) => total + source.images.length, 0)} images`;
    }
    if (skipped > 0) message += `; ${skipped} unsupported or unreadable item${skipped === 1 ? "" : "s"} skipped`;
    if (summary?.emptyFolders.length) message += `; ${summary.emptyFolders.length} empty folder${summary.emptyFolders.length === 1 ? "" : "s"} skipped`;
    if (!summary && warnings?.length) message += `; ${warnings[0]}`;
    return message;
  }

  async function importDroppedPaths(paths: string[]) {
    if (paths.length === 0) {
      setMessage("No Finder file paths were available for this drop.");
      return;
    }
    const importRunId = beginSourceImportDialog("Importing dropped items", "Scanning dropped folders/images and converting files if needed…");
    try {
      const result = await window.wallpaperApi.importPaths(paths);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      const merged = addSourcesToProjectDetailed(result.sources, true, false);
      setMessage(importResultMessage(result.summary, merged, result.warnings));
    } finally {
      finishSourceImportDialog(importRunId);
    }
  }

  async function assignDroppedPathsToLayer(paths: string[], layer: PlaceholderLayer) {
    if (paths.length === 0) {
      setMessage("No Finder file paths were available for this drop.");
      return;
    }
    const importRunId = beginSourceImportDialog("Importing dropped items", "Scanning dropped folders/images and converting files if needed…");
    try {
      const result = await window.wallpaperApi.importPaths(paths);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      const merged = addSourcesToProjectDetailed(result.sources, true, false);
      if (merged.resolved.length === 0) return;
      assignSourcesToLayer(merged.resolved, layer, importResultMessage(result.summary, merged, result.warnings, layer));
    } finally {
      finishSourceImportDialog(importRunId);
    }
  }

  async function importWebImagesAsSources(candidates: WebImageCandidate[]) {
    if (candidates.length === 0) {
      setMessage("No copied or dragged web image was available.");
      return;
    }
    const result = await importWebImageCandidates(candidates);
    if (result.sources.length === 0) {
      setMessage(result.warnings[0] ?? "Unable to cache the web image.");
      return;
    }
    const merged = addSourcesToProjectDetailed(result.sources, true, false);
    setMessage(`${merged.resolved.length} web image source${merged.resolved.length === 1 ? "" : "s"} cached and linked.${result.warnings[0] ? ` ${result.warnings[0]}` : ""}`);
  }

  async function assignWebImagesToLayer(candidates: WebImageCandidate[], layer: PlaceholderLayer) {
    if (candidates.length === 0) {
      setMessage("No copied or dragged web image was available.");
      return;
    }
    const result = await importWebImageCandidates(candidates);
    if (result.sources.length === 0) {
      setMessage(result.warnings[0] ?? "Unable to cache the web image.");
      return;
    }
    const merged = addSourcesToProjectDetailed(result.sources, true, false);
    if (merged.resolved.length === 0) return;
    assignSourcesToLayer(merged.resolved, layer, `Cached web image assigned to ${layer.name}.${result.warnings[0] ? ` ${result.warnings[0]}` : ""}`);
  }

  async function placeWebImagesAtCanvasPoint(candidates: WebImageCandidate[], point: CanvasDropPoint) {
    if (candidates.length === 0) {
      setMessage("No copied or dragged web image was available.");
      return;
    }
    const result = await importWebImageCandidates(candidates);
    if (result.sources.length === 0) {
      setMessage(result.warnings[0] ?? "Unable to cache the web image.");
      return;
    }
    await placeSourcesAtCanvasPoint(result.sources, point, undefined, result.warnings);
  }

  async function placeSourcesAtCanvasPoint(
    incomingSources: ImageSource[],
    point: CanvasDropPoint,
    summary?: LocalImportSummary,
    warnings?: string[]
  ) {
    const before = projectRef.current;
    const merged = mergeReusableSources(before.sources, incomingSources);
    if (merged.resolved.length === 0) {
      setMessage("No supported source was available to place.");
      return false;
    }

    let next: WallpaperProject = { ...before, sources: merged.sources };
    const createdLayerIds: string[] = [];
    const placedSourceNames: string[] = [];

    for (const source of merged.resolved) {
      const chosenDropImage = randomImageFromSource(source);
      if (!chosenDropImage) continue;
      const overlayLike = sourceIsManagedOverlay(source);
      const dropAspectRatio = await decodedImageAspectRatio(chosenDropImage) ?? sourcePreferredAspectRatio(source);
      next = projectWithMeasuredImage(next, chosenDropImage, dropAspectRatio);
      // Dropped sources behave like “Add Frame” first, then source assignment,
      // but start with the actual current image ratio instead of a desktop-HD rectangle.
      const placement = placementForCanvasDrop(next.canvas, point, createdLayerIds.length, dropAspectRatio);
      const layer = createPlaceholder(next.canvas, next.layers.length + 1);
      Object.assign(layer, placement, { name: source.name, cropMode: "cover" as const, maskShape: "rounded" as const });
      if (overlayLike) {
        Object.assign(layer, {
          cropMode: "contain" as const,
          maskShape: "rectangle" as const,
          borderWidth: 0,
          borderRadius: 0,
          shadow: false,
          keepAspectRatio: false,
          effects: {
            ...layer.effects,
            backgroundColor: imageBackgroundColor(layer.effects.backgroundColor, chosenDropImage)
          }
        });
      }
      next = { ...next, layers: [...next.layers, layer] };
      const assigned = projectWithDropImageAssignment(next, source, layer.id, chosenDropImage);
      if (!assigned) {
        next = { ...next, layers: next.layers.filter((item) => item.id !== layer.id) };
        continue;
      }
      const finalPlacement = placementForCanvasDrop(assigned.canvas, point, createdLayerIds.length, dropAspectRatio);
      next = {
        ...assigned,
        layers: assigned.layers.map((item) => item.id === layer.id ? {
          ...item,
          ...finalPlacement,
          cropMode: overlayLike ? "contain" as const : "cover" as const,
          crop: { offsetX: 0, offsetY: 0, zoom: 1 },
          alignment: "center" as const,
          maskShape: overlayLike ? "rectangle" as const : "rounded" as const,
          selectedImageId: overlayLike ? chosenDropImage.id : item.selectedImageId,
          generatedImageId: chosenDropImage.id,
          sourceState: overlayLike ? {
            ...item.sourceState,
            mode: "fixed" as const,
            preventDuplicates: false
          } : item.sourceState
        } : item)
      };
      createdLayerIds.push(layer.id);
      placedSourceNames.push(source.name);
    }

    if (createdLayerIds.length === 0) {
      setMessage("The dropped source has no images allowed by its media filter.");
      return false;
    }

    setHistory((stack) => ({ past: [...stack.past, cloneProject(before)].slice(-historyLimit), future: [] }));
    projectRef.current = next;
    setProject(next);
    setSelectedLayerIds(createdLayerIds);
    setSelectedLayerId(createdLayerIds.at(-1));
    setSelectedSourceId(merged.resolved[0]?.id);
    setSourceLibraryView("linked");

    const added = merged.addedIds.size;
    const reused = merged.reusedIds.size;
    const skipped = skippedImportCount(summary);
    let message = createdLayerIds.length === 1
      ? `Placed ${placedSourceNames[0]} at the drop position.`
      : `Placed ${createdLayerIds.length} sources at the drop position.`;
    if (added > 0) message += ` ${added} source${added === 1 ? " was" : "s were"} added to the library.`;
    else if (reused > 0) message += ` Existing source${reused === 1 ? " was" : "s were"} reused.`;
    if (skipped > 0) message += ` ${skipped} unsupported or unreadable item${skipped === 1 ? " was" : "s were"} skipped.`;
    if (summary?.emptyFolders.length) message += ` ${summary.emptyFolders.length} empty folder${summary.emptyFolders.length === 1 ? " was" : "s were"} skipped.`;
    if (!summary && warnings?.length) message += ` ${warnings[0]}`;
    setMessage(message);
    return true;
  }

  async function importDroppedPathsAtCanvasPoint(paths: string[], point: CanvasDropPoint) {
    if (paths.length === 0) {
      setMessage("No Finder file paths were available for this drop.");
      return;
    }
    const result = await window.wallpaperApi.importPaths(paths);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    await placeSourcesAtCanvasPoint(result.sources, point, result.summary, result.warnings);
  }

  async function addLocalImagesSource() {
    if (window.wallpaperApi?.chooseImageFiles) {
      const importRunId = beginSourceImportDialog("Choose images", "Select images. Pin Paper will show progress here while it imports and converts files.");
      try {
        const result = await window.wallpaperApi.chooseImageFiles();
        if (result.canceled) return;
        if (result.error || !result.source) {
          setMessage(result.error ?? "No images selected.");
          return;
        }
        const merged = addSourcesToProjectDetailed([result.source], true, false);
        const resolved = merged.resolved[0];
        if (resolved) {
          setSelectedSourceId(resolved.id);
          setMessage(importResultMessage(result.summary, merged, result.warnings));
        }
      } finally {
        finishSourceImportDialog(importRunId);
      }
      return;
    }

    const files = await browserFileInput(false);
    if (!files) return;
    const importRunId = beginSourceImportDialog("Importing images", "Reading selected images and preparing previews…");
    try {
      const result = await browserImageSourceFromFiles(files, files.length === 1 ? files[0]?.name?.replace(/\.[^.]+$/, "") || "Browser Image" : "Browser Images");
      if (!result.source) {
        setMessage(result.warnings[0] ?? "No supported images were selected.");
        return;
      }
      const merged = addSourcesToProjectDetailed([result.source], true, false);
      const resolved = merged.resolved[0];
      if (resolved) {
        setSelectedSourceId(resolved.id);
        setMessage(importResultMessage(result.summary, merged, result.warnings));
      }
    } finally {
      finishSourceImportDialog(importRunId);
    }
  }

  async function runPinterestImport(mode: "import" | "update") {
    const pinterestApi = mode === "import" ? window.wallpaperApi?.importPinterestBoard : window.wallpaperApi?.updatePinterestBoard;
    if (!platformCapabilities.canUsePinterestImport || !pinterestApi) {
      const message = "Pinterest import is unavailable in the web version. Use the desktop app, or download images and import them as files.";
      setPinterestDialog((current) => ({ ...current, busy: false, stage: "error", error: message, log: [...current.log, message] }));
      setMessage(message);
      return;
    }
    const url = pinterestDialog.url.trim();
    const existing = project.sources.find(
      (source) => source.type === "pinterest-board" && source.url?.replace(/\/$/, "").toLowerCase() === url.replace(/\/$/, "").toLowerCase()
    );
    const jobId = uid("pinterest-job");
    setPinterestDialog((current) => ({
      ...current,
      busy: true,
      jobId,
      stage: "validating",
      current: 0,
      total: existing?.expectedItemCount,
      error: undefined,
      log: ["Validating Pinterest URL..."],
      progress: 2,
      imagesFound: 0,
      imagesCached: existing?.images.length ?? 0
    }));
    const request = {
      url,
      mode,
      jobId,
      existingSource: existing,
      resumeBookmark: existing?.importCursor
    } as const;
    try {
      const result = await pinterestApi(request);

      setPinterestDialog((current) => {
        const completeEnough = Boolean(result.partial && pinterestPartialIsCloseEnough(result.imagesCached, current.total, result.imagesFound));
        return {
          ...current,
          busy: false,
          stage: result.canceled ? "canceled" : completeEnough || result.ok ? "complete" : result.partial ? "partial" : "error",
          progress: completeEnough ? 100 : result.progress,
          imagesFound: result.imagesFound,
          imagesCached: result.imagesCached,
          log: result.log,
          current: result.imagesCached,
          total: completeEnough || !result.partial ? Math.max(result.imagesFound, result.imagesCached) : current.total,
          error: softenPinterestPartialError(result.error, completeEnough)
        };
      });

      const importCompleteEnough = Boolean(result.partial && pinterestPartialIsCloseEnough(result.imagesCached, pinterestDialog.total ?? existing?.expectedItemCount, result.imagesFound));
      if (result.source && result.source.images.length > 0) {
        const sourceForProject = importCompleteEnough ? { ...result.source, importStatus: "ready" as const, expectedItemCount: Math.max(result.source.expectedItemCount ?? 0, result.imagesCached, result.imagesFound) } : result.source;
        const [resolved] = addSourcesToProject([sourceForProject], [], true);
        setSelectedSourceId(resolved?.id ?? result.source.id);
      }
      setMessage(softenPinterestPartialError(result.error, importCompleteEnough) ?? `Pinterest board ready with ${result.imagesCached} cached pins.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pinterest import failed.";
      setPinterestDialog((current) => ({ ...current, busy: false, stage: "error", error: message, log: [...current.log, message] }));
      setMessage(message);
    }
  }

  async function cancelPinterestImport() {
    const jobId = pinterestDialog.jobId;
    if (!jobId) return;
    await window.wallpaperApi?.cancelPinterestImport?.(jobId);
    setPinterestDialog((current) => ({ ...current, busy: false, stage: "canceled", error: "Import canceled. Cached pins were preserved." }));
  }

  function recordWallpaperFailure(error: string, _automatic = false) {
    const failures = (projectRef.current.wallpaper.consecutiveFailures ?? 0) + 1;
    setWallpaperStatus("failed");
    setProject((current) => {
      const next = {
        ...current,
        wallpaper: {
          ...current.wallpaper,
          lastError: error,
          consecutiveFailures: failures,
          enabled: false,
          paused: false,
          interval: "manual" as const,
          nextScheduledAt: undefined
        }
      };
      projectRef.current = next;
      return next;
    });
    setMessage(error);
  }

  async function applyCandidate(
    candidate: WallpaperProject,
    combination: GeneratedCombination,
    options: { automatic?: boolean; label?: string } = {}
  ) {
    const operationToken = beginWallpaperOperation(options.automatic ? "scheduled" : "manual");
    if (operationToken === undefined) {
      setMessage("A wallpaper operation is already running.");
      return false;
    }
    try {
      const generated = await generateWallpaperFile<ArrayBuffer>({
        render: () => renderProjectToArrayBuffer(candidate, "png"),
        persist: (imageData) => window.wallpaperApi.generateWallpaper({
          imageData,
          mimeType: "image/png",
          suggestedName: `${candidate.name.replace(/[^\w.-]+/g, "-")}-${Date.now()}.png`
        }),
        onStatus: setWallpaperStatus
      });

      const generatedProject = touchProject(updateActiveTemplateSnapshot({
        ...candidate,
        wallpaper: {
          ...candidate.wallpaper,
          lastGeneratedAt: generated.generatedAt ?? new Date().toISOString(),
          lastGeneratedFilePath: generated.filePath,
          lastError: undefined
        }
      }));
      projectRef.current = generatedProject;
      setProject(generatedProject);
      setWallpaperHistoryIndex(0);
      setMessage(`Generated successfully: ${generated.filePath}`);

      const result = await applyGeneratedWallpaperFile({
        filePath: generated.filePath,
        apply: (filePath) => window.wallpaperApi.applyWallpaperFile({
          filePath,
          monitorMode: candidate.wallpaper.monitorMode,
          displayMode: candidate.wallpaper.displayMode,
          scope: candidate.wallpaper.scope,
          targetMode: candidate.wallpaper.targetMode,
          monitorId: candidate.wallpaper.monitorId,
          allSpacesRefreshMode: normalizeAllSpacesRefreshMode(candidate.wallpaper.allSpacesRefreshMode),
          transitionEnabled: candidate.wallpaper.transitionEnabled,
          transitionDurationMs: candidate.wallpaper.transitionDurationMs
        }),
        onStatus: setWallpaperStatus,
        timeouts: { applyMs: wallpaperTargetModeNeedsInactiveSpaces(candidate.wallpaper.targetMode) ? 120_000 : 45_000 }
      });

      const appliedAt = result.appliedAt ?? new Date().toISOString();
      const templateId = combination.templateId ?? candidate.templates.activeTemplateId;
      const templateName = candidate.templates.templates.find((item) => item.id === templateId)?.name ?? candidate.name;
      const historyEntry: GeneratedCombination = {
        ...combination,
        filePath: result.filePath,
        appliedAt,
        templateId,
        templateName,
        monitorMode: candidate.wallpaper.monitorMode
      };
      const committedCandidate = generationStateAfterApplication(projectRef.current, generatedProject, true);
      const finalProject = touchProject(updateActiveTemplateSnapshot({
        ...committedCandidate,
        wallpaper: {
          ...generatedProject.wallpaper,
          lastGeneratedAt: generated.generatedAt ?? appliedAt,
          lastGeneratedFilePath: generated.filePath,
          lastUpdatedAt: appliedAt,
          lastAppliedFilePath: result.filePath,
          lastAppliedTemplateId: templateId,
          lastError: undefined,
          consecutiveFailures: 0,
          enabled: false,
          paused: false,
          interval: "manual",
          nextScheduledAt: undefined
        },
        recentCombinations: appendAppliedHistory(generatedProject.recentCombinations, historyEntry)
      }));
      projectRef.current = finalProject;
      setProject(finalProject);
      setWallpaperHistoryIndex(0);
      setWallpaperStatus("applied");
      setMessage(`${options.label ?? "Wallpaper applied"}: ${result.filePath}`);
      return true;
    } catch (error) {
      setWallpaperStatus("failed");
      recordWallpaperFailure(error instanceof Error ? error.message : "Unable to generate and apply wallpaper.", Boolean(options.automatic));
      return false;
    } finally {
      finishWallpaperOperation(operationToken);
    }
  }

  function targetTemplateFor(base: WallpaperProject) {
    const templateId = base.templates.activeTemplateId;
    return base.templates.templates.find((template) => template.id === templateId) ?? base.templates.templates[0];
  }

  async function applyDifferentWallpapers(base: WallpaperProject, options: { automatic?: boolean; label?: string } = {}) {
    if (!platformCapabilities.canApplyWallpaper) {
      setMessage(`${platformCopy.applyWallpaper} is not available here. Use Export PNG or ${platformCopy.createWallpaperPack}.`);
      return false;
    }
    if (!platformCapabilities.supportsMultipleWallpaperTargets) {
      const safeBase = normalizeProject({
        ...base,
        wallpaper: {
          ...base.wallpaper,
          targetMode: fallbackWallpaperTargetMode(currentPlatform.kind, base.wallpaper.targetMode),
          targetTemplateMode: "single-template"
        }
      });
      const prepared = prepareGeneratedProject(safeBase, safeBase.templates.activeTemplateId);
      return applyCandidate(normalizeProject(prepared.project), prepared.combination, {
        automatic: options.automatic,
        label: options.label ?? platformCopy.applyWallpaper
      });
    }
    const operationToken = beginWallpaperOperation(options.automatic ? "scheduled" : "manual");
    if (operationToken === undefined) {
      setMessage("A wallpaper operation is already running.");
      return false;
    }
    setWallpaperStatus("generating");
    try {
      const targets = wallpaperTargets.length ? wallpaperTargets : await window.wallpaperApi.getWallpaperTargets();
      setWallpaperTargets(targets);
      const applyTargets = selectWallpaperTargets(targets, base.wallpaper.targetMode, base.wallpaper.monitorId);
      if (applyTargets.length === 0) {
        recordWallpaperFailure("No matching visible monitor target is available.", Boolean(options.automatic));
        return false;
      }

      let working = normalizeProject(base);
      const used = new Set<string>();
      const rendered: Array<{ target: WallpaperTarget; combination: GeneratedCombination; imageData: ArrayBuffer; templateName: string }> = [];
      for (const [index, target] of applyTargets.entries()) {
        const template = targetTemplateFor(working);
        const workspace = template ? normalizeProject(workspaceFromTemplate({ ...working, templates: { ...working.templates, activeTemplateId: template.id } }, template)) : working;
        const prepared = prepareGeneratedProjectWithUsed(workspace, template?.id ?? workspace.templates.activeTemplateId, used);
        working = normalizeProject(prepared.project);
        setWallpaperStatus("rendering");
        const imageData = await withWallpaperTimeout(
          renderProjectToArrayBuffer(working, "png"),
          60_000,
          `Rendering ${target.label} timed out.`
        );
        rendered.push({
          target,
          combination: prepared.combination,
          imageData,
          templateName: template?.name ?? working.name
        });
      }

      setWallpaperStatus("applying");
      const applyTimeoutMs = wallpaperTargetModeNeedsInactiveSpaces(working.wallpaper.targetMode) ? 120_000 : 45_000;
      const result = await withWallpaperTimeout(window.wallpaperApi.applyWallpaperTargets({
        scope: "different-per-desktop",
        targetMode: working.wallpaper.targetMode,
        monitorId: working.wallpaper.monitorId,
        allSpacesRefreshMode: normalizeAllSpacesRefreshMode(working.wallpaper.allSpacesRefreshMode),
        displayMode: working.wallpaper.displayMode,
        transitionEnabled: working.wallpaper.transitionEnabled,
        transitionDurationMs: working.wallpaper.transitionDurationMs,
        items: rendered.map(({ target, imageData, templateName }) => ({
          targetId: target.id,
          targetLabel: target.label,
          displayId: target.displayId,
          current: target.current,
          imageData,
          mimeType: "image/png",
          suggestedName: `${templateName.replace(/[^\w.-]+/g, "-")}-${target.id}-${Date.now()}.png`
        }))
      }), applyTimeoutMs, "Applying desktop wallpapers timed out.");
      setWallpaperStatus("verifying");
      if (!result.ok || !result.targets?.length) {
        recordWallpaperFailure(result.error ?? "One or more desktop wallpapers failed to apply.", Boolean(options.automatic));
        setWallpaperStatus("failed");
        return false;
      }

      const appliedAt = result.appliedAt ?? new Date().toISOString();
      const entries = rendered.map((item) => {
        const targetResult = result.targets?.find((targetResultItem) => targetResultItem.targetId === item.target.id);
        return {
          ...item.combination,
          filePath: targetResult?.filePath,
          appliedAt,
          templateName: `${item.templateName}\n${item.target.label}`,
          templateId: item.combination.templateId,
          monitorMode: working.wallpaper.monitorMode
        } satisfies GeneratedCombination;
      });
      const finalProject = touchProject(updateActiveTemplateSnapshot({
        ...generationStateAfterApplication(projectRef.current, working, true),
        wallpaper: {
          ...working.wallpaper,
          lastUpdatedAt: appliedAt,
          lastError: undefined,
          consecutiveFailures: 0,
          enabled: false,
          paused: false,
          interval: "manual",
          nextScheduledAt: undefined
        },
        recentCombinations: entries.reduce((history, entry) => appendAppliedHistory(history, entry), working.recentCombinations)
      }));
      projectRef.current = finalProject;
      setProject(finalProject);
      setWallpaperHistoryIndex(0);
      setWallpaperStatus("applied");
      setMessage(`${options.label ?? "Wallpapers applied"}: ${result.targets.length} desktop target${result.targets.length === 1 ? "" : "s"}.`);
      return true;
    } catch (error) {
      setWallpaperStatus("failed");
      recordWallpaperFailure(error instanceof Error ? error.message : "Unable to render and apply wallpapers.", Boolean(options.automatic));
      return false;
    } finally {
      finishWallpaperOperation(operationToken);
    }
  }

  async function generateAndApply(options: { rotateTemplate?: boolean; automatic?: boolean; templateId?: string } = {}) {
    if (!platformCapabilities.canApplyWallpaper) {
      setMessage(`${platformCopy.applyWallpaper} is not available in this version. Use Export PNG or ${platformCopy.createWallpaperPack}.`);
      return;
    }
    const current = normalizeProject(projectRef.current);
    let base = normalizeProject(updateActiveTemplateSnapshot(current));
    const safeTargetMode = fallbackWallpaperTargetMode(currentPlatform.kind, base.wallpaper.targetMode);
    if (safeTargetMode !== base.wallpaper.targetMode) {
      base = normalizeProject({
        ...base,
        wallpaper: {
          ...base.wallpaper,
          targetMode: safeTargetMode,
          scope: safeTargetMode === "current-desktop" ? "current-desktop" : base.wallpaper.scope
        }
      });
      setMessage(`${currentPlatform.label} does not support the selected desktop target mode, so this run will use ${platformCopy.previewCurrentDesktop}.`);
    }
    let targetTemplateId = options.templateId ?? base.templates.activeTemplateId;

    if (options.rotateTemplate) {
      const plan = planTemplateRotation(base.templates, base.templates.templates);
      if (!plan) {
        recordWallpaperFailure("No templates are enabled for wallpaper rotation.", Boolean(options.automatic));
        return;
      }
      targetTemplateId = plan.templateId;
      base = { ...base, templates: { ...plan.nextLibrary, activeTemplateId: targetTemplateId } };
    }

    if (targetTemplateId && targetTemplateId !== base.templates.activeTemplateId) {
      base = { ...base, templates: { ...base.templates, activeTemplateId: targetTemplateId } };
    }
    const target = targetTemplateId ? base.templates.templates.find((item) => item.id === targetTemplateId) : undefined;
    if (target) base = normalizeProject(workspaceFromTemplate(base, target));

    if (platformCapabilities.canUseMacSpaces && wallpaperTargetModeNeedsInactiveSpaces(base.wallpaper.targetMode)) {
      if (options.automatic) {
        recordWallpaperFailure("Automatic all-desktop application is replaced by macOS folder shuffle. Create a wallpaper set and let macOS rotate it across Spaces.", true);
        return;
      }
      openExportSet(targetTemplateId);
      setMessage(platformCopy.rotationGuideBody);
      return;
    }

    if (base.wallpaper.targetTemplateMode !== "single-template" && !options.templateId) {
      await applyDifferentWallpapers(base, {
        automatic: options.automatic,
        label: options.automatic ? "Wallpaper targets rotated" : "Desktop wallpapers applied"
      });
      return;
    }

    const prepared = prepareGeneratedProject(base, targetTemplateId);
    await applyCandidate(normalizeProject(prepared.project), prepared.combination, {
      automatic: options.automatic,
      label: options.automatic ? "Wallpaper rotated" : target ? `Applied “${target.name}”` : "Wallpaper applied"
    });
  }

  async function previewOnCurrentDesktop() {
    if (!platformCapabilities.canPreviewCurrentDesktop) {
      setMessage(`${platformCopy.previewCurrentDesktop} is not available in this version. Use Export PNG instead.`);
      return;
    }
    const current = normalizeProject(projectRef.current);
    const previewBase = normalizeProject({
      ...current,
      wallpaper: {
        ...current.wallpaper,
        enabled: false,
        paused: false,
        interval: "manual",
        nextScheduledAt: undefined,
        targetMode: "current-desktop",
        scope: "current-desktop",
        monitorMode: "primary",
        monitorId: undefined,
        targetTemplateMode: "single-template"
      }
    });
    // Preview on current desktop is an intentional one-step preview advance.
    // Keep it separate from generic generation so a source-dropped layer cannot
    // select the same image again or advance twice before the render.
    const advanced = advancePreviewProjectImages(previewBase);
    const assignments = Object.fromEntries(
      advanced.layers
        .map((layer) => [layer.id, layer.generatedImageId ?? layer.selectedImageId] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    );
    const ok = await applyCandidate(advanced, createCombination(assignments, advanced.templates.activeTemplateId), {
      label: platformCopy.previewCurrentDesktop
    });
    if (ok) setMessage(`${platformCopy.previewCurrentDesktop} completed at ${new Date().toLocaleTimeString()}.`);
  }

  function showNextVariation() {
    const advanced = normalizeProject(advancePreviewProjectImages(projectRef.current));
    projectRef.current = advanced;
    setProject(advanced);
    setMessage("Showing next variation.");
  }

  async function applyHistoryAt(index: number) {
    const current = projectRef.current;
    const entry = current.recentCombinations[index];
    if (!entry?.filePath) {
      setMessage("That wallpaper file is no longer available in history.");
      return;
    }
    const operationToken = beginWallpaperOperation("history");
    if (operationToken === undefined) {
      setMessage("A wallpaper operation is already running.");
      return;
    }
    try {
      const result = await applyGeneratedWallpaperFile({
        filePath: entry.filePath,
        apply: (filePath) => window.wallpaperApi.applyWallpaperFile({
          filePath,
          monitorMode: "primary",
          displayMode: current.wallpaper.displayMode,
          scope: "current-desktop",
          targetMode: "current-desktop",
          monitorId: undefined,
          allSpacesRefreshMode: normalizeAllSpacesRefreshMode(current.wallpaper.allSpacesRefreshMode),
          transitionEnabled: current.wallpaper.transitionEnabled,
          transitionDurationMs: current.wallpaper.transitionDurationMs
        }),
        onStatus: setWallpaperStatus,
        timeouts: { applyMs: 45_000 }
      });
      const appliedAt = result.appliedAt ?? new Date().toISOString();
      setProject((state) => {
        const next = {
          ...state,
          wallpaper: {
            ...state.wallpaper,
            lastUpdatedAt: appliedAt,
            lastAppliedFilePath: entry.filePath,
            lastAppliedTemplateId: entry.templateId,
            lastError: undefined,
            consecutiveFailures: 0
          }
        };
        projectRef.current = next;
        return next;
      });
      setWallpaperHistoryIndex(index);
      setWallpaperStatus("applied");
      setMessage(`Previewed history on current desktop: ${entry.templateName ?? entry.name}`);
    } catch (error) {
      recordWallpaperFailure(error instanceof Error ? error.message : "Unable to apply wallpaper history item.", false);
    } finally {
      finishWallpaperOperation(operationToken);
    }
  }

  async function applyPreviousWallpaper() {
    const index = previousHistoryIndex(wallpaperHistoryIndex, projectRef.current.recentCombinations.length);
    if (index === undefined) {
      setMessage("No older wallpaper in history.");
      return;
    }
    await applyHistoryAt(index);
  }

  async function applyNextWallpaper() {
    const index = nextHistoryIndex(wallpaperHistoryIndex, projectRef.current.recentCombinations.length);
    if (index === undefined) {
      setMessage("No newer wallpaper in history.");
      return;
    }
    await applyHistoryAt(index);
  }

  async function refreshPreview() {
    try {
      setPreviewUrl(await renderProjectToDataUrl(project, "png"));
      setMessage("Preview rendered");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to render preview.");
    }
  }

  async function exportWallpaper(format: "png" | "jpeg") {
    try {
      const dataUrl = await renderProjectToDataUrl(project, format);
      const suggestedName = `${safeBrowserFileName(project.name)}.${format === "png" ? "png" : "jpg"}`;
      if (!window.wallpaperApi?.exportImage) {
        downloadDataUrl(dataUrl, suggestedName);
        setMessage(`Downloaded ${suggestedName}`);
        return;
      }
      const result = await window.wallpaperApi.exportImage({
        dataUrl,
        format,
        suggestedName
      });
      if (!result.canceled) setMessage(`Exported ${result.filePath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    }
  }

  function openExportSet(templateId = projectRef.current.templates.activeTemplateId) {
    exportCancelRef.current = false;
    const template = projectRef.current.templates.templates.find((item) => item.id === templateId)
      ?? projectRef.current.templates.templates.find((item) => item.id === projectRef.current.templates.activeTemplateId);
    setExportSet((current) => ({
      ...current,
      open: true,
      templateId,
      setName: template?.name || projectRef.current.name || "Wallpaper Set",
      busy: false,
      cancelRequested: false,
      completed: 0,
      skipped: 0,
      failed: 0,
      finalPath: undefined,
      firstFilePath: undefined,
      error: undefined
    }));
    if (!exportSet.destinationPath && window.wallpaperApi?.getDefaultExportSetFolder) {
      void window.wallpaperApi.getDefaultExportSetFolder().then((result) => {
        if (!result.canceled && result.filePath) {
          setExportSet((current) => current.open && !current.destinationPath ? { ...current, destinationPath: result.filePath } : current);
        }
      });
    }
  }

  async function chooseExportSetFolder() {
    if (!window.wallpaperApi?.chooseExportSetFolder) {
      setMessage("Choose-folder export is only available in the desktop app. The web version downloads wallpapers through the browser.");
      return;
    }
    const result = await window.wallpaperApi.chooseExportSetFolder();
    if (!result.canceled && result.filePath) setExportSet((current) => ({ ...current, destinationPath: result.filePath }));
  }

  function cancelExportSet() {
    exportCancelRef.current = true;
    setExportSet((current) => ({ ...current, cancelRequested: true }));
  }

  async function cleanupWallpaperSets() {
    setToolbarMenuOpen(false);
    if (!window.wallpaperApi?.cleanupExportSets) {
      setMessage("Native wallpaper pack cleanup is only available in the desktop app.");
      return;
    }
    setExportSet((current) => ({ ...current, cleanupBusy: true, error: undefined }));
    const result = await window.wallpaperApi.cleanupExportSets(exportSet.destinationPath);
    if (!result.ok) {
      const error = result.error ?? "Unable to delete wallpaper sets.";
      setMessage(error);
      setExportSet((current) => ({ ...current, cleanupBusy: false, error }));
      return;
    }
    if (result.canceled) {
      setExportSet((current) => ({ ...current, cleanupBusy: false }));
      return;
    }
    const deleted = result.deletedEntryCount ?? 0;
    setMessage(deleted
      ? `Deleted all ${deleted} item${deleted === 1 ? "" : "s"} inside the Wallpaper Sets folder.`
      : "The Wallpaper Sets folder is already empty.");
    setExportSet((current) => ({ ...current, cleanupBusy: false }));
  }

  async function revealWallpaperSet(folderPath?: string) {
    const target = folderPath ?? exportSet.finalPath ?? exportSet.destinationPath;
    if (!target) return;
    if (!window.wallpaperApi?.revealExportSet) {
      setMessage("Browser downloads were sent to your default Downloads folder.");
      return;
    }
    const result = await window.wallpaperApi.revealExportSet(target);
    if (!result.ok) setMessage(result.error ?? "Unable to open the wallpaper set folder.");
  }

  async function openMacOSWallpaperSettings() {
    if (!platformCapabilities.canOpenWallpaperSettings || !window.wallpaperApi?.openWallpaperSettings) {
      setMessage(`${platformCopy.openWallpaperSettings} is not available in this version.`);
      return;
    }
    const result = await window.wallpaperApi.openWallpaperSettings();
    if (!result.ok) setMessage(result.error ?? "Unable to open macOS Wallpaper Settings.");
  }

  async function applyExportedWallpaperPack(targetPath?: string, intervalSeconds?: number) {
    if (!targetPath) {
      setMessage("No exported wallpaper pack is available to set yet.");
      return;
    }
    if (!platformCapabilities.canApplyWallpaper) {
      setMessage(`${platformCopy.applyWallpaper} is not available in this version.`);
      return;
    }
    const operationToken = beginWallpaperOperation("manual");
    if (operationToken === undefined) {
      setMessage("A wallpaper operation is already running.");
      return;
    }
    try {
      setWallpaperStatus("applying");
      const cycleSeconds = clamp(Math.round(intervalSeconds ?? exportSet.windowsCycleSeconds ?? 60), 5, 86_400);
      const timeoutMs = currentPlatform.kind === "windows" ? 60_000 : 45_000;
      const result = currentPlatform.kind === "windows" && window.wallpaperApi?.applyWallpaperSet
        ? await withWallpaperTimeout(window.wallpaperApi.applyWallpaperSet({
            folderPath: targetPath,
            intervalSeconds: cycleSeconds,
            displayMode: projectRef.current.wallpaper.displayMode,
            transitionEnabled: true,
            transitionDurationMs: Math.max(450, projectRef.current.wallpaper.transitionDurationMs || 700)
          }), timeoutMs, "Starting Windows wallpaper rotation timed out.")
        : window.wallpaperApi?.applyWallpaperFile
          ? await withWallpaperTimeout(window.wallpaperApi.applyWallpaperFile({
              filePath: targetPath,
              monitorMode: "primary",
              displayMode: projectRef.current.wallpaper.displayMode,
              scope: "current-desktop",
              targetMode: "current-desktop",
              monitorId: undefined,
              allSpacesRefreshMode: normalizeAllSpacesRefreshMode(projectRef.current.wallpaper.allSpacesRefreshMode),
              transitionEnabled: projectRef.current.wallpaper.transitionEnabled,
              transitionDurationMs: projectRef.current.wallpaper.transitionDurationMs
            }), timeoutMs, "Setting the exported wallpaper timed out.")
          : { ok: false, error: `${platformCopy.applyWallpaper} is not available in this version.` };
      if (!result.ok) {
        recordWallpaperFailure(result.error ?? "Unable to set exported wallpaper.");
        return;
      }
      setWallpaperStatus("applied");
      setMessage(currentPlatform.kind === "windows"
        ? `Started Windows wallpaper rotation every ${cycleSeconds}s: ${result.filePath ?? targetPath}`
        : `${platformCopy.applyWallpaper}: ${result.filePath ?? targetPath}`);
    } catch (error) {
      setWallpaperStatus("failed");
      recordWallpaperFailure(error instanceof Error ? error.message : "Unable to set exported wallpaper.");
    } finally {
      finishWallpaperOperation(operationToken);
    }
  }

  async function runExportSet() {
    const options = exportSet;
    const count = clamp(Math.round(options.count), 1, 500);
    const template = projectRef.current.templates.templates.find((item) => item.id === options.templateId)
      ?? projectRef.current.templates.templates.find((item) => item.id === projectRef.current.templates.activeTemplateId);
    if (!template) {
      setExportSet((current) => ({ ...current, error: "Choose a template before creating a wallpaper set." }));
      return;
    }

    if (!window.wallpaperApi?.beginExportSet || !window.wallpaperApi?.writeExportSetFile || !window.wallpaperApi?.finalizeExportSet) {
      exportCancelRef.current = false;
      setExportSet((current) => ({
        ...current,
        busy: true,
        cancelRequested: false,
        completed: 0,
        skipped: 0,
        failed: 0,
        finalPath: undefined,
        firstFilePath: undefined,
        error: undefined
      }));
      let exportProject = workspaceFromTemplate(cloneProject(projectRef.current), template);
      const used = new Set<string>();
      const signatures = new Set<string>();
      let completed = 0;
      let failed = 0;
      let firstError: string | undefined;
      for (let index = 1; index <= count; index += 1) {
        if (exportCancelRef.current) break;
        let prepared = prepareGeneratedProjectWithUsed(exportProject, template.id, options.avoidRepeats ? used : new Set<string>());
        let signature = Object.values(prepared.combination.assignments).sort().join("|");
        let attempts = 0;
        while (options.avoidRepeats && signatures.has(signature) && attempts < 5) {
          prepared = prepareGeneratedProjectWithUsed(prepared.project, template.id, used);
          signature = Object.values(prepared.combination.assignments).sort().join("|");
          attempts += 1;
        }
        signatures.add(signature);
        exportProject = prepared.project;
        const fileName = `${safeBrowserFileName(options.setName || template.name || projectRef.current.name)}-${String(index).padStart(3, "0")}.png`;
        try {
          const dataUrl = await renderProjectToDataUrl(exportProject, "png", 1);
          downloadDataUrl(dataUrl, fileName);
          completed += 1;
        } catch (error) {
          failed = 1;
          firstError = error instanceof Error ? error.message : `Could not export ${fileName}.`;
          break;
        }
        setExportSet((current) => ({ ...current, completed, failed }));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (options.advanceLiveState && completed > 0) {
        const normalized = touchProject(updateActiveTemplateSnapshot(normalizeProject(exportProject)));
        const nextProject = projectAfterExportSet(projectRef.current, normalized, true);
        projectRef.current = nextProject;
        setProject(nextProject);
      }
      const canceled = exportCancelRef.current;
      setExportSet((current) => ({
        ...current,
        busy: false,
        cancelRequested: canceled,
        completed,
        failed,
        finalPath: canceled || failed ? undefined : "Browser Downloads",
        firstFilePath: undefined,
        error: failed ? firstError : undefined
      }));
      setMessage(canceled
        ? "Wallpaper pack download canceled."
        : failed
          ? firstError ?? "Wallpaper pack download failed."
          : `Downloaded ${completed} wallpaper${completed === 1 ? "" : "s"} from the web version.`);
      return;
    }

    let rootPath = options.destinationPath;
    if (!rootPath) {
      const result = await window.wallpaperApi.getDefaultExportSetFolder();
      if (result.canceled || !result.filePath) return;
      rootPath = result.filePath;
      setExportSet((current) => ({ ...current, destinationPath: rootPath }));
    }

    exportCancelRef.current = false;
    setExportSet((current) => ({
      ...current,
      busy: true,
      cancelRequested: false,
      completed: 0,
      skipped: 0,
      failed: 0,
      finalPath: undefined,
      firstFilePath: undefined,
      error: undefined
    }));

    const begin = await window.wallpaperApi.beginExportSet({
      rootPath,
      setName: options.setName || template.name,
      projectName: projectRef.current.name,
      templateName: template.name,
      format: "png",
      variationCount: count,
      canvasWidth: template.project.canvas.width,
      canvasHeight: template.project.canvas.height
    });
    if (!begin.ok || !begin.sessionId) {
      setExportSet((current) => ({ ...current, busy: false, error: begin.error ?? "Unable to prepare the wallpaper set." }));
      return;
    }

    const sessionId = begin.sessionId;
    let exportProject = workspaceFromTemplate(cloneProject(projectRef.current), template);
    const used = new Set<string>();
    const signatures = new Set<string>();
    let completed = 0;
    let failed = 0;
    let firstError: string | undefined;
    let firstFilePath: string | undefined;

    for (let index = 1; index <= count; index += 1) {
      if (exportCancelRef.current) break;
      let prepared = prepareGeneratedProjectWithUsed(exportProject, template.id, options.avoidRepeats ? used : new Set<string>());
      let signature = Object.values(prepared.combination.assignments).sort().join("|");
      let attempts = 0;
      while (options.avoidRepeats && signatures.has(signature) && attempts < 5) {
        prepared = prepareGeneratedProjectWithUsed(prepared.project, template.id, used);
        signature = Object.values(prepared.combination.assignments).sort().join("|");
        attempts += 1;
      }
      signatures.add(signature);
      exportProject = prepared.project;
      const fileName = `wallpaper-${String(index).padStart(3, "0")}.png`;
      try {
        const dataUrl = await renderProjectToDataUrl(exportProject, "png", 1);
        const result = await window.wallpaperApi.writeExportSetFile({ sessionId, dataUrl, fileName });
        if (!result.ok) throw new Error(result.error ?? `Could not write ${fileName}.`);
        firstFilePath ??= result.filePath;
        completed += 1;
      } catch (error) {
        failed = 1;
        firstError = error instanceof Error ? error.message : `Could not export ${fileName}.`;
        break;
      }
      setExportSet((current) => ({ ...current, completed, failed }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    if (exportCancelRef.current || failed) {
      await window.wallpaperApi.abortExportSet(sessionId);
      const summary = exportCancelRef.current
        ? `Wallpaper set canceled. No incomplete folder was published.`
        : `Wallpaper set failed. No incomplete folder was published.`;
      setMessage(summary);
      setExportSet((current) => ({
        ...current,
        busy: false,
        cancelRequested: exportCancelRef.current,
        completed,
        failed,
        error: failed ? firstError : undefined
      }));
      return;
    }

    if (options.advanceLiveState) {
      const normalized = touchProject(updateActiveTemplateSnapshot(normalizeProject(exportProject)));
      const nextProject = projectAfterExportSet(projectRef.current, normalized, true);
      projectRef.current = nextProject;
      setProject(nextProject);
    }

    const finalized = await window.wallpaperApi.finalizeExportSet({ sessionId });
    if (!finalized.ok || !finalized.finalPath) {
      await window.wallpaperApi.abortExportSet(sessionId);
      setExportSet((current) => ({ ...current, busy: false, failed: 1, error: finalized.error ?? "Unable to finalize the wallpaper set." }));
      return;
    }

    setMessage(`Created ${platformCopy.createWallpaperSet.toLowerCase()} with ${completed} variation${completed === 1 ? "" : "s"}: ${finalized.finalPath}`);
    setExportSet((current) => ({
      ...current,
      busy: false,
      cancelRequested: false,
      completed,
      failed: 0,
      finalPath: finalized.finalPath,
      firstFilePath: finalized.firstFilePath ?? (firstFilePath && finalized.finalPath ? `${finalized.finalPath}${firstFilePath.includes("\\") ? "\\" : "/"}${firstFilePath.split(/[\\/]/).pop()}` : firstFilePath),
      error: undefined
    }));
  }

  async function saveProject() {
    if (!window.wallpaperApi?.saveProject) {
      const data = encodeURIComponent(JSON.stringify(compactProjectForAutosave(projectRef.current), null, 2));
      downloadDataUrl(`data:application/json;charset=utf-8,${data}`, `${safeBrowserFileName(projectRef.current.name, "pin-paper-project")}.pwc.json`);
      setMessage("Downloaded project file. Browser autosave also stays on this device.");
      return;
    }
    const result = await window.wallpaperApi.saveProject(project, projectPath);
    if (result.canceled) return;
    setProjectPath(result.filePath);
    setMessage(`Saved ${result.filePath}`);
  }

  async function saveProjectAs() {
    if (!window.wallpaperApi?.saveProject) {
      await saveProject();
      return;
    }
    const result = await window.wallpaperApi.saveProject(project);
    if (result.canceled) return;
    setProjectPath(result.filePath);
    setMessage(`Saved ${result.filePath}`);
  }

  async function openProject() {
    if (!window.wallpaperApi?.openProject) {
      const files = await browserFileInput(false);
      const file = files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const opened = normalizeProject(JSON.parse(text) as WallpaperProject);
        projectRef.current = opened;
        setProject(opened);
        setProjectPath(undefined);
        selectOnlyLayer(opened.layers[0]?.id);
        setSelectedSourceId(opened.sources[0]?.id);
        setHistory({ past: [], future: [] });
        setView("home");
        setMessage(`Opened browser project file ${file.name}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to open browser project file.");
      }
      return;
    }
    const result = await window.wallpaperApi.openProject();
    if (result.canceled) return;
    if (result.error || !result.project) {
      setMessage(result.error ?? "Unable to open project.");
      return;
    }
    const opened = normalizeProject(result.project);
    setProject(opened);
    setProjectPath(result.filePath);
    selectOnlyLayer(opened.layers[0]?.id);
    setSelectedSourceId(opened.sources[0]?.id);
    setHistory({ past: [], future: [] });
    setView("home");
    setMessage(`Opened ${result.filePath}`);
  }

  function beginDrag(event: PointerEvent, layer: PlaceholderLayer, mode: DragMode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (layer.locked) return;

    if (event.shiftKey && mode === "move") {
      const next = selectedLayerIds.includes(layer.id)
        ? selectedLayerIds.filter((id) => id !== layer.id)
        : [...selectedLayerIds, layer.id];
      setSelectedLayerIds(next);
      setSelectedLayerId(next.includes(layer.id) ? layer.id : next.at(-1));
      setSelectionAnchorId(layer.id);
      return;
    }

    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    let nextSelection = selectedLayerIds;
    if (!selectedLayerIds.includes(layer.id)) {
      nextSelection = additive ? [...selectedLayerIds, layer.id] : [layer.id];
      setSelectedLayerIds(nextSelection);
      setSelectedLayerId(layer.id);
      setSelectionAnchorId(layer.id);
    } else if (!additive && selectedLayerId !== layer.id) {
      setSelectedLayerId(layer.id);
    }

    const resizeMode = mode.startsWith("resize-");
    const movableIds = mode === "move" || resizeMode ? nextSelection : [layer.id];
    const groupLayers = project.layers.filter((item) => movableIds.includes(item.id) && !item.locked);
    const groupBounds = resizeMode && groupLayers.length > 1
      ? selectionBoundsForLayers(project, groupLayers, imageNaturalRef.current)
      : undefined;
    dragRef.current = {
      id: layer.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      layer,
      groupLayers,
      groupBounds,
      historyProject: cloneProject(project)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function patchPolaroidImageDirect(id: string, patch: Partial<PolaroidEffect>) {
    commitProject(
      (current) => ({
        ...current,
        layers: current.layers.map((item) => {
          if (item.id !== id || item.locked) return item;
          const effect = normalizePolaroidEffect(item.effects.polaroid, item.effects.paperFrame, item.effects.innerShadow);
          return {
            ...item,
            effects: {
              ...item.effects,
              polaroid: normalizePolaroidEffect({ ...effect, ...patch }, item.effects.paperFrame, item.effects.innerShadow)
            }
          };
        })
      }),
      false
    );
  }

  function beginPolaroidImageDrag(
    event: PointerEvent,
    layer: PlaceholderLayer,
    effect: PolaroidEffect,
    mode: PolaroidImageDragMode,
    imageArea: { left: number; top: number; width: number; height: number }
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (layer.locked) return;
    if (!selectedLayerIds.includes(layer.id)) selectOnlyLayer(layer.id);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const outerCenter = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    const imageCenter = {
      x: layer.x + imageArea.left + imageArea.width / 2,
      y: layer.y + imageArea.top + imageArea.height / 2
    };
    const rotatedOffset = rotatePoint(
      { x: imageCenter.x - outerCenter.x, y: imageCenter.y - outerCenter.y },
      layer.rotation + effect.frameRotation
    );
    const centerClient = {
      x: canvasRect.left + (outerCenter.x + rotatedOffset.x) * zoomRef.current,
      y: canvasRect.top + (outerCenter.y + rotatedOffset.y) * zoomRef.current
    };
    const pointer = { x: event.clientX, y: event.clientY };
    polaroidImageDragRef.current = {
      id: layer.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      layer,
      effect,
      frameRotation: layer.rotation + effect.frameRotation,
      centerClient,
      startPointerAngle: pointerAngleDegrees(pointer, centerClient),
      startPointerDistance: distanceBetween(pointer, centerClient),
      historyProject: cloneProject(project)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function snapLayer(layer: PlaceholderLayer, x: number, y: number, groupLayers: PlaceholderLayer[] = [layer]) {
    const activeGroup = groupLayers.length ? groupLayers : [layer];
    const originalFrameById = new Map(activeGroup.map((item) => [item.id, layerFrameWithImage(project, item, imageNaturalRef.current[item.id])]));
    const primaryFrame = originalFrameById.get(layer.id) ?? layerFrameWithImage(project, layer, imageNaturalRef.current[layer.id]);
    const dx = x - layer.x;
    const dy = y - layer.y;
    const movedFrames = activeGroup.map((item) => {
      const frame = originalFrameById.get(item.id) ?? layerFrameWithImage(project, item, imageNaturalRef.current[item.id]);
      return { id: item.id, x: frame.x + dx, y: frame.y + dy, width: frame.width, height: frame.height };
    });
    const left = Math.min(...movedFrames.map((frame) => frame.x));
    const right = Math.max(...movedFrames.map((frame) => frame.x + frame.width));
    const top = Math.min(...movedFrames.map((frame) => frame.y));
    const bottom = Math.max(...movedFrames.map((frame) => frame.y + frame.height));
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const width = right - left;
    const height = bottom - top;
    const selectedIds = new Set(activeGroup.map((item) => item.id));
    const targetsX = [0, project.canvas.width / 2, project.canvas.width];
    const targetsY = [0, project.canvas.height / 2, project.canvas.height];
    for (const other of project.layers) {
      if (selectedIds.has(other.id) || other.hidden) continue;
      const frame = layerFrameWithImage(project, other, imageNaturalRef.current[other.id]);
      targetsX.push(frame.x, frame.x + frame.width / 2, frame.x + frame.width);
      targetsY.push(frame.y, frame.y + frame.height / 2, frame.y + frame.height);
    }

    let nextX = x;
    let nextY = y;
    let guideX: number | undefined;
    let guideY: number | undefined;
    const adaptiveSnapDistance = clamp(Math.min(project.canvas.width, project.canvas.height) * 0.0065, snapDistance, 24);
    const guideDistance = adaptiveSnapDistance * 3;
    for (const target of targetsX) {
      const points = [left, centerX, right];
      const visualHit = points.find((point) => Math.abs(point - target) <= guideDistance);
      if (visualHit !== undefined && guideX === undefined) guideX = target;
      const snapHit = points.find((point) => Math.abs(point - target) <= adaptiveSnapDistance);
      if (snapHit !== undefined) {
        nextX += target - snapHit;
        guideX = target;
        break;
      }
    }
    for (const target of targetsY) {
      const points = [top, centerY, bottom];
      const visualHit = points.find((point) => Math.abs(point - target) <= guideDistance);
      if (visualHit !== undefined && guideY === undefined) guideY = target;
      const snapHit = points.find((point) => Math.abs(point - target) <= adaptiveSnapDistance);
      if (snapHit !== undefined) {
        nextY += target - snapHit;
        guideY = target;
        break;
      }
    }
    setGuides({ x: guideX, y: guideY });
    return { x: nextX, y: nextY, width, height };
  }

  function beginCanvasPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 1 && event.button !== 2) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    canvasPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop
    };
    stage.classList.add("panning");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = canvasPanRef.current;
    if (!pan) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    stage.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    stage.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  }

  function endCanvasPan(event?: PointerEvent<HTMLDivElement>) {
    const pan = canvasPanRef.current;
    if (!pan) return;
    if (event && event.pointerId !== pan.pointerId) return;
    canvasPanRef.current = undefined;
    stageRef.current?.classList.remove("panning");
  }

  function onCanvasPointerMove(event: PointerEvent) {
    const marquee = marqueeRef.current;
    if (marquee) {
      const canvas = event.currentTarget as HTMLElement;
      const rect = canvas.getBoundingClientRect();
      const currentX = clamp((event.clientX - rect.left) / zoomRef.current, 0, project.canvas.width);
      const currentY = clamp((event.clientY - rect.top) / zoomRef.current, 0, project.canvas.height);
      const width = Math.abs(currentX - marquee.startX);
      const height = Math.abs(currentY - marquee.startY);
      const next: SelectionMarquee = {
        ...marquee,
        x: Math.min(marquee.startX, currentX),
        y: Math.min(marquee.startY, currentY),
        width,
        height,
        didMove: marquee.didMove || width > 3 || height > 3
      };
      marqueeRef.current = next;
      setSelectionMarquee(next);
      const hits = project.layers
        .filter((layer) => !layer.hidden && !layer.locked)
        .filter((layer) => {
          const frame = layerFrameWithImage(project, layer, imageNaturalRef.current[layer.id]);
          return frame.x < next.x + next.width
            && frame.x + frame.width > next.x
            && frame.y < next.y + next.height
            && frame.y + frame.height > next.y;
        })
        .map((layer) => layer.id);
      const ids = next.additive ? [...new Set([...next.baseIds, ...hits])] : hits;
      setSelectedLayerIds(ids);
      setSelectedLayerId(ids.at(-1));
      return;
    }
    const polaroidDrag = polaroidImageDragRef.current;
    if (polaroidDrag) {
      const pointer = { x: event.clientX, y: event.clientY };
      if (polaroidDrag.mode === "move") {
        const local = screenDeltaToFrameDelta(
          (event.clientX - polaroidDrag.startX) / zoomRef.current,
          (event.clientY - polaroidDrag.startY) / zoomRef.current,
          polaroidDrag.frameRotation
        );
        patchPolaroidImageDirect(polaroidDrag.id, {
          imageOffsetX: polaroidDrag.effect.imageOffsetX + local.x,
          imageOffsetY: polaroidDrag.effect.imageOffsetY + local.y
        });
        return;
      }
      if (polaroidDrag.mode === "scale") {
        patchPolaroidImageDirect(polaroidDrag.id, {
          imageScale: polaroidScaleFromPointerDistance(
            polaroidDrag.effect.imageScale,
            polaroidDrag.startPointerDistance,
            distanceBetween(pointer, polaroidDrag.centerClient)
          )
        });
        return;
      }
      const currentAngle = pointerAngleDegrees(pointer, polaroidDrag.centerClient);
      patchPolaroidImageDirect(polaroidDrag.id, {
        imageRotation: clampPolaroidRotation(
          polaroidDrag.effect.imageRotation + shortestAngleDelta(polaroidDrag.startPointerAngle, currentAngle)
        )
      });
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoomRef.current;
    const dy = (event.clientY - drag.startY) / zoomRef.current;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;

    if (drag.mode === "move") {
      const snapped = snapLayer(drag.layer, drag.layer.x + dx, drag.layer.y + dy, drag.groupLayers);
      const groupLeftOffset = drag.layer.x - Math.min(...drag.groupLayers.map((item) => item.x));
      const groupTopOffset = drag.layer.y - Math.min(...drag.groupLayers.map((item) => item.y));
      const recoverableGroup = clampRecoverablePosition(
        snapped.x - groupLeftOffset,
        snapped.y - groupTopOffset,
        snapped.width,
        snapped.height,
        project.canvas
      );
      const primaryX = Math.round(recoverableGroup.x + groupLeftOffset);
      const primaryY = Math.round(recoverableGroup.y + groupTopOffset);
      const appliedDx = primaryX - drag.layer.x;
      const appliedDy = primaryY - drag.layer.y;
      const originals = new Map(drag.groupLayers.map((layer) => [layer.id, layer]));
      commitProject(
        (current) => ({
          ...current,
          layers: current.layers.map((layer) => {
            const original = originals.get(layer.id);
            if (!original) return layer;
            const nextPosition = clampRecoverableLayerPosition(original, original.x + appliedDx, original.y + appliedDy, project.canvas);
            return {
              ...layer,
              x: Math.round(nextPosition.x),
              y: Math.round(nextPosition.y)
            };
          })
        }),
        false
      );
      return;
    }

    if (drag.mode === "crop") {
      const natural = imageNaturalRef.current[drag.id];
      const crop = { ...drag.layer.crop, offsetX: drag.layer.crop.offsetX + dx, offsetY: drag.layer.crop.offsetY + dy };
      const nextCrop = natural
        ? clampCropTransform(
            natural.width,
            natural.height,
            drag.layer.width,
            drag.layer.height,
            drag.layer.cropMode,
            drag.layer.alignment,
            crop
          )
        : crop;
      patchLayer(
        drag.id,
        { crop: nextCrop },
        false
      );
      return;
    }

    if (drag.mode === "rotate") {
      const cx = (drag.layer.x + drag.layer.width / 2) * zoomRef.current;
      const cy = (drag.layer.y + drag.layer.height / 2) * zoomRef.current;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const angle = Math.atan2(event.clientY - rect.top - cy, event.clientX - rect.left - cx) * (180 / Math.PI) + 90;
      patchLayer(drag.id, { rotation: Math.round(angle) }, false);
      return;
    }

    resizeLayer(drag, dx, dy, event.shiftKey || drag.layer.keepAspectRatio);
  }

  function resizeLayer(drag: DragState, dx: number, dy: number, preserveAspect: boolean) {
    if (drag.layer.objectKind === "text" && drag.mode.startsWith("resize-") && drag.groupLayers.length <= 1) {
      const handle = drag.mode as ResizeHandle;
      const minWidth = 36;
      const minHeight = Math.max(20, (drag.layer.fontSize ?? 72) * 0.45);
      if (handle === "resize-e" || handle === "resize-w") {
        const rawWidth = handle === "resize-e" ? drag.layer.width + dx : drag.layer.width - dx;
        const width = Math.max(minWidth, Math.round(rawWidth));
        patchLayer(drag.id, {
          width,
          x: handle === "resize-w" ? Math.round(drag.layer.x + drag.layer.width - width) : drag.layer.x
        }, false);
        return;
      }
      const pivot = oppositeCornerForResize(drag.layer, handle);
      const resized = resizeBoundsFromOppositeCorner(
        drag.layer,
        handle,
        dx,
        dy,
        { width: project.canvas.width, height: project.canvas.height, minSize: minWidth, allowOverflow: true, maxOverflowSize: maxOverflowLayerSize(project.canvas) }
      );
      const widthRatio = resized.width / Math.max(1, drag.layer.width);
      const heightRatio = resized.height / Math.max(1, drag.layer.height);
      const scale = clamp(Math.abs(widthRatio - 1) >= Math.abs(heightRatio - 1) ? widthRatio : heightRatio, 0.18, 6);
      const width = Math.max(minWidth, Math.round(drag.layer.width * scale));
      const height = Math.max(minHeight, Math.round(drag.layer.height * scale));
      const left = handle.includes("w") ? pivot.x - width : pivot.x;
      const top = handle.includes("n") ? pivot.y - height : pivot.y;
      const nextPosition = clampRecoverablePosition(left, top, width, height, project.canvas);
      patchLayer(drag.id, {
        x: Math.round(nextPosition.x),
        y: Math.round(nextPosition.y),
        width,
        height,
        fontSize: Math.max(8, Math.round((drag.layer.fontSize ?? 72) * scale))
      }, false);
      return;
    }
    if (drag.groupLayers.length > 1 && drag.groupBounds && drag.mode.startsWith("resize-")) {
      const handle = drag.mode as ResizeHandle;
      const rawGroup = resizeBoundsFromOppositeCorner(
        drag.groupBounds,
        handle,
        dx,
        dy,
        { width: project.canvas.width, height: project.canvas.height, minSize: 48, allowOverflow: true, maxOverflowSize: maxOverflowLayerSize(project.canvas) }
      );
      let nextGroup = rawGroup;
      if (handle.includes("e") || handle.includes("w") || handle.includes("n") || handle.includes("s")) {
        const pivot = oppositeCornerForResize(drag.groupBounds, handle);
        const widthRatio = rawGroup.width / Math.max(1, drag.groupBounds.width);
        const heightRatio = rawGroup.height / Math.max(1, drag.groupBounds.height);
        const horizontalWeight = Math.abs(widthRatio - 1);
        const verticalWeight = Math.abs(heightRatio - 1);
        const scale = Math.max(48 / Math.max(1, drag.groupBounds.width), 48 / Math.max(1, drag.groupBounds.height), horizontalWeight >= verticalWeight ? widthRatio : heightRatio);
        const scaledWidth = Math.round(drag.groupBounds.width * scale);
        const scaledHeight = Math.round(drag.groupBounds.height * scale);
        const left = handle.includes("w") ? pivot.x - scaledWidth : handle.includes("e") ? pivot.x : pivot.x - scaledWidth / 2;
        const top = handle.includes("n") ? pivot.y - scaledHeight : handle.includes("s") ? pivot.y : pivot.y - scaledHeight / 2;
        const nextPosition = clampRecoverablePosition(left, top, scaledWidth, scaledHeight, project.canvas);
        nextGroup = {
          x: Math.round(nextPosition.x),
          y: Math.round(nextPosition.y),
          width: Math.min(maxOverflowLayerSize(project.canvas), scaledWidth),
          height: Math.min(maxOverflowLayerSize(project.canvas), scaledHeight)
        };
      }
      const originals = new Map(drag.groupLayers.map((layer) => [layer.id, layer]));
      commitProject(
        (current) => ({
          ...current,
          layers: current.layers.map((layer) => {
            const original = originals.get(layer.id);
            if (!original || layer.locked) return layer;
            return { ...layer, ...fitLayerIntoResizedSelection(layer, original, drag.groupBounds!, nextGroup) };
          })
        }),
        false
      );
      return;
    }

    const next = resizeRectAroundCenter(
      drag.layer,
      drag.mode as ResizeHandle,
      dx,
      dy,
      preserveAspect,
      { width: project.canvas.width, height: project.canvas.height, minSize: 40, allowOverflow: true, maxOverflowSize: maxOverflowLayerSize(project.canvas) }
    );
    patchLayer(drag.id, next, false);
  }

  function endDrag() {
    const polaroidDrag = polaroidImageDragRef.current;
    if (polaroidDrag) {
      setHistory((stack) => ({ past: [...stack.past, polaroidDrag.historyProject].slice(-historyLimit), future: [] }));
      polaroidImageDragRef.current = undefined;
      return;
    }
    if (marqueeRef.current) {
      const marquee = marqueeRef.current;
      if (!marquee.didMove && !marquee.additive) clearLayerSelection();
      marqueeRef.current = undefined;
      setSelectionMarquee(undefined);
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      setHistory((stack) => ({ past: [...stack.past, drag.historyProject].slice(-historyLimit), future: [] }));
    }
    dragRef.current = undefined;
    setGuides({});
  }

  function setPreset(id: string, mode: CanvasResizeMode = "keep") {
    if (id === "custom") {
      commitProject((current) => ({ ...current, canvas: { ...current.canvas, presetId: "custom", orientation: "custom" } }));
      return;
    }
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    commitProject((current) => {
      const resized = resizeCanvasAndLayers(current.canvas, current.layers, preset.width, preset.height, mode);
      return { ...current, ...resized, canvas: { ...resized.canvas, presetId: id } };
    });
  }

  function canvasViewportCenter() {
    const stage = stageRef.current;
    if (!stage) return { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
    const rect = stage.getBoundingClientRect();
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  }

  function scheduleZoomCommit() {
    if (zoomCommitTimerRef.current !== undefined) window.clearTimeout(zoomCommitTimerRef.current);
    zoomCommitTimerRef.current = window.setTimeout(() => {
      const settledZoom = zoomRef.current;
      setZoom((current) => Math.abs(current - settledZoom) < 0.0001 ? current : settledZoom);
      stageRef.current?.classList.remove("zoom-gesture-active");
      zoomCommitTimerRef.current = undefined;
    }, 120);
  }

  function applyCanvasZoom(nextZoom: number, clientX: number, clientY: number) {
    const stage = stageRef.current;
    const shell = canvasZoomShellRef.current;
    const canvas = canvasRef.current;
    const normalized = clampCanvasZoom(nextZoom);
    const previous = zoomRef.current;
    if (Math.abs(previous - normalized) < 0.00001) return;

    if (!stage || !shell || !canvas) {
      zoomRef.current = normalized;
      setZoom(normalized);
      return;
    }

    const canvasSettings = projectRef.current.canvas;
    const beforeRect = canvas.getBoundingClientRect();
    const anchor = canvasPointAtClient(
      clientX,
      clientY,
      beforeRect,
      previous,
      canvasSettings.width,
      canvasSettings.height
    );

    stage.classList.add("zoom-gesture-active");
    shell.style.width = `${canvasSettings.width * normalized}px`;
    shell.style.height = `${canvasSettings.height * normalized}px`;
    canvas.style.transform = `scale(${normalized})`;
    zoomRef.current = normalized;

    const targetClientX = beforeRect.left + anchor.x * previous;
    const targetClientY = beforeRect.top + anchor.y * previous;
    const afterRect = canvas.getBoundingClientRect();
    const nextAnchorClientX = afterRect.left + anchor.x * normalized;
    const nextAnchorClientY = afterRect.top + anchor.y * normalized;
    stage.scrollLeft += nextAnchorClientX - targetClientX;
    stage.scrollTop += nextAnchorClientY - targetClientY;
    scheduleZoomCommit();
  }

  function zoomCanvasByStep(direction: -1 | 1) {
    const anchor = canvasViewportCenter();
    applyCanvasZoom(zoomAfterStep(zoomRef.current, direction), anchor.clientX, anchor.clientY);
  }

  function resetCanvasZoom() {
    const anchor = canvasViewportCenter();
    applyCanvasZoom(1, anchor.clientX, anchor.clientY);
  }

  function fitCanvas() {
    const stage = stageRef.current;
    const anchor = canvasViewportCenter();
    const canvasSettings = projectRef.current.canvas;
    const next = stage
      ? fitCanvasZoom(stage.clientWidth, stage.clientHeight, canvasSettings.width, canvasSettings.height)
      : 1;
    applyCanvasZoom(next, anchor.clientX, anchor.clientY);
  }

  function canvasPointFromClient(clientX: number, clientY: number): CanvasDropPoint | undefined {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return {
      x: clamp((clientX - rect.left) / zoomRef.current, 0, projectRef.current.canvas.width),
      y: clamp((clientY - rect.top) / zoomRef.current, 0, projectRef.current.canvas.height)
    };
  }

  function updateDropFeedback(event: React.DragEvent, target: ExternalDropTarget, layerId?: string) {
    event.preventDefault();
    if (target === "placeholder") event.stopPropagation();
    if (target === "sources" && getDroppedSourceId(event)) {
      event.dataTransfer.dropEffect = "none";
      setDropFeedback(undefined);
      return;
    }
    const described = describeDrop(event.dataTransfer, target);
    const canvasPoint = target === "canvas" && described.valid
      ? canvasPointFromClient(event.clientX, event.clientY)
      : undefined;
    event.dataTransfer.dropEffect = described.valid ? "copy" : "none";
    setDropFeedback((current) => {
      const next: DropFeedback = { target, layerId, ...described, canvasPoint };
      const samePoint = (!current?.canvasPoint && !next.canvasPoint)
        || (Boolean(current?.canvasPoint && next.canvasPoint)
          && Math.abs((current?.canvasPoint?.x ?? 0) - (next.canvasPoint?.x ?? 0)) < 1
          && Math.abs((current?.canvasPoint?.y ?? 0) - (next.canvasPoint?.y ?? 0)) < 1);
      return current?.target === next.target
        && current.layerId === next.layerId
        && current.label === next.label
        && current.valid === next.valid
        && current.placementCount === next.placementCount
        && samePoint
        ? current
        : next;
    });
  }

  function leaveDropTarget(event: React.DragEvent, target: ExternalDropTarget, layerId?: string) {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDropFeedback((current) => current?.target === target && current.layerId === layerId ? undefined : current);
  }

  async function handleSourceDrop(event: React.DragEvent) {
    event.preventDefault();
    const webCandidates = webImageCandidatesFromTransfer(event.dataTransfer);
    const paths = getDroppedPaths(event);
    setDropFeedback(undefined);
    if (getDroppedSourceId(event)) return;
    const pinterestUrl = getDroppedPinterestUrl(event);
    if (pinterestUrl) {
      if (!platformCapabilities.canUsePinterestImport || !window.wallpaperApi?.importPinterestBoard) {
        setMessage("Pinterest import is unavailable in the web version. Download images and import them as files, or use the desktop app.");
        return;
      }
      setPinterestDialog((current) => ({ ...current, open: true, url: pinterestUrl }));
      return;
    }
    if (paths.length > 0) await importDroppedPaths(paths);
    else await importWebImagesAsSources(webCandidates);
  }

  async function handleCanvasDrop(event: React.DragEvent) {
    event.preventDefault();
    const webCandidates = webImageCandidatesFromTransfer(event.dataTransfer);
    const paths = getDroppedPaths(event);
    const point = canvasPointFromClient(event.clientX, event.clientY);
    setDropFeedback(undefined);
    if (!point) {
      setMessage("Drop the source directly on the canvas to position it.");
      return;
    }

    const existingSourceId = getDroppedSourceId(event);
    if (existingSourceId) {
      const source = projectRef.current.sources.find((item) => item.id === existingSourceId);
      if (source) await placeSourcesAtCanvasPoint([source], point);
      return;
    }

    const pinterestUrl = getDroppedPinterestUrl(event);
    if (pinterestUrl) {
      if (!platformCapabilities.canUsePinterestImport || !window.wallpaperApi?.importPinterestBoard) {
        setMessage("Pinterest import is unavailable in the web version. Download images and import them as files, or use the desktop app.");
        return;
      }
      setPinterestDialog((current) => ({ ...current, open: true, url: pinterestUrl }));
      setMessage("Import the Pinterest board, then drag its source onto the canvas to position it.");
      return;
    }

    if (paths.length > 0) await importDroppedPathsAtCanvasPoint(paths, point);
    else await placeWebImagesAtCanvasPoint(webCandidates, point);
  }

  async function handlePlaceholderDrop(event: React.DragEvent, layer: PlaceholderLayer) {
    event.preventDefault();
    event.stopPropagation();
    const webCandidates = webImageCandidatesFromTransfer(event.dataTransfer);
    const paths = getDroppedPaths(event);
    setDropFeedback(undefined);
    const existingSourceId = getDroppedSourceId(event);
    if (existingSourceId) {
      const source = projectRef.current.sources.find((item) => item.id === existingSourceId);
      if (source) assignSourceToLayer(source, layer);
      return;
    }
    if (paths.length > 0) await assignDroppedPathsToLayer(paths, layer);
    else await assignWebImagesToLayer(webCandidates, layer);
  }

  async function goHome() {
    try {
      const thumbnail = await renderProjectToDataUrl(project, "jpeg");
      setProject((current) => touchProject(updateActiveTemplateSnapshot(current, thumbnail)));
    } catch {
      setProject((current) => touchProject(updateActiveTemplateSnapshot(current)));
    }
    setView("home");
    setMessage("Template saved.");
  }

  async function saveAsTemplate() {
    try {
      const thumbnail = await renderProjectToDataUrl(project, "jpeg");
      const template = createWallpaperTemplate(project, { thumbnailDataUrl: thumbnail });
      commitProject(
        (current) => ({
          ...current,
          templates: {
            ...current.templates,
            templates: [template, ...current.templates.templates],
            rotationTemplateIds: [template.id, ...current.templates.rotationTemplateIds],
            activeTemplateId: template.id
          }
        }),
        false,
        false
      );
      setMessage(`Saved template "${template.name}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save template.");
    }
  }

  function openTemplate(template: WallpaperTemplate) {
    setProject((current) => {
      const synced = updateActiveTemplateSnapshot(current);
      return touchProject(normalizeProject(workspaceFromTemplate(synced, template)));
    });
    selectOnlyLayer(template.project.layers[0]?.id);
    setSelectedSourceId(template.project.sourceIds[0]);
    setSourceLibraryView("linked");
    setHistory({ past: [], future: [] });
    setView("editor");
    setMessage("");
  }

  function createBlankTemplate() {
    const blank = createProjectForCurrentScreen();
    const name = `Untitled Template ${project.templates.templates.length + 1}`;
    setProject((current) => {
      const synced = updateActiveTemplateSnapshot(current);
      const blankWorkspace: WallpaperProject = {
        ...synced,
        name,
        canvas: structuredClone(blank.canvas),
        layers: [],
        wallpaper: structuredClone(blank.wallpaper),
        templates: { ...synced.templates, activeTemplateId: undefined }
      };
      const template = createWallpaperTemplate(blankWorkspace, { name });
      const withTemplate: WallpaperProject = {
        ...blankWorkspace,
        templates: {
          ...synced.templates,
          templates: [template, ...synced.templates.templates],
          rotationTemplateIds: [template.id, ...synced.templates.rotationTemplateIds],
          activeTemplateId: template.id
        }
      };
      return touchProject(normalizeProject(withTemplate));
    });
    clearLayerSelection();
    setSelectedSourceId(undefined);
    setSourceLibraryView("linked");
    setHistory({ past: [], future: [] });
    setView("editor");
    setMessage(`Created ${name}.`);
  }

  function duplicateTemplate(template: WallpaperTemplate) {
    const now = new Date().toISOString();
    const copy: WallpaperTemplate = {
      ...structuredClone(template),
      id: uid("template"),
      name: `${template.name} Copy`,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: undefined
    };
    commitProject(
      (current) => ({
        ...current,
        templates: {
          ...current.templates,
          templates: [copy, ...current.templates.templates]
        }
      }),
      false,
      false
    );
    setMessage(`Duplicated "${template.name}".`);
  }

  function renameTemplate(template: WallpaperTemplate) {
    setRenameState({ kind: "template", id: template.id, value: template.name });
  }

  function patchTemplate(templateId: string, patch: Partial<WallpaperTemplate>) {
    commitProject(
      (current) => ({
        ...current,
        templates: {
          ...current.templates,
          templates: current.templates.templates.map((template) =>
            template.id === templateId ? { ...template, ...patch, updatedAt: new Date().toISOString() } : template
          )
        }
      }),
      false,
      false
    );
  }

  function deleteTemplate(templateId: string) {
    if (project.templates.templates.length <= 1) {
      setMessage("Keep at least one template in the library.");
      return;
    }
    const template = project.templates.templates.find((item) => item.id === templateId);
    if (!template || !window.confirm(`Delete "${template.name}"?`)) return;
    commitProject(
      (current) => {
        const remaining = current.templates.templates.filter((item) => item.id !== templateId);
        return {
          ...current,
          templates: {
            ...current.templates,
            templates: remaining,
            rotationTemplateIds: current.templates.rotationTemplateIds.filter((id) => id !== templateId),
            activeTemplateId: current.templates.activeTemplateId === templateId ? remaining[0]?.id : current.templates.activeTemplateId
          }
        };
      },
      false,
      false
    );
    setMessage(`Deleted "${template.name}".`);
  }

  async function applyTemplate(template: WallpaperTemplate) {
    const current = normalizeProject(updateActiveTemplateSnapshot(projectRef.current));
    const workspace = normalizeProject(workspaceFromTemplate({
      ...current,
      templates: { ...current.templates, activeTemplateId: template.id }
    }, template));
    projectRef.current = workspace;
    setProject(workspace);
    setMessage("Template opened.");
  }

  function sourceAssignmentCount(sourceId: string) {
    return project.layers.filter((layer) => layer.objectKind !== "text" && (layer.sourceId === sourceId || layer.sourceState.sourceIds.includes(sourceId))).length;
  }

  function sourceTemplateUsageCount(sourceId: string) {
    return project.templates.templates.filter(
      (template) =>
        template.project.sourceIds.includes(sourceId) ||
        template.project.layers.some((layer) => layer.objectKind !== "text" && (layer.sourceId === sourceId || layer.sourceState.sourceIds.includes(sourceId)))
    ).length;
  }

  function linkSourceToTemplate(source: ImageSource) {
    commitProject((current) => linkSourceToActiveTemplate(current, source.id));
    setSelectedSourceId(source.id);
    setSourceLibraryView("linked");
    setMessage(`Linked ${source.name} to this template.`);
  }

  function unlinkSourceFromTemplate(source: ImageSource) {
    const assigned = sourceAssignmentCount(source.id);
    if (assigned > 0 && !window.confirm(`Unlink ${source.name} from this template? It is assigned to ${assigned} frame${assigned === 1 ? "" : "s"}, which will be cleared.`)) return;
    commitProject((current) => unlinkSourceFromActiveTemplate(current, source.id));
    if (selectedSourceId === source.id) setSelectedSourceId(undefined);
    setMessage(`Unlinked ${source.name}. The global source was kept.`);
  }

  function renameSource(source: ImageSource) {
    setRenameState({ kind: "source", id: source.id, value: source.name });
  }

  async function rescanSource(source: ImageSource) {
    if (source.type === "pinterest-board" && source.url) {
      const sourceUrl = source.url;
      const jobId = uid("pinterest-job");
      setPinterestDialog((current) => ({
        ...current,
        open: true,
        url: sourceUrl,
        busy: true,
        jobId,
        stage: "discovering",
        current: 0,
        total: source.expectedItemCount,
        error: undefined,
        log: ["Refreshing Pinterest board..."],
        progress: 5,
        imagesCached: source.images.length
      }));
      if (!platformCapabilities.canUsePinterestImport || !window.wallpaperApi?.updatePinterestBoard) {
        const message = "Pinterest refresh is unavailable in the web version. Use the desktop app, or download images and import them as files.";
        setPinterestDialog((current) => ({ ...current, busy: false, stage: "error", error: message, log: [...current.log, message] }));
        setMessage(message);
        return;
      }
      const result = await window.wallpaperApi.updatePinterestBoard({
        url: sourceUrl,
        mode: "update",
        jobId,
        existingSource: source,
        resumeBookmark: source.importCursor
      });
      setPinterestDialog((current) => {
        const completeEnough = Boolean(result.partial && pinterestPartialIsCloseEnough(result.imagesCached, current.total, result.imagesFound));
        return {
          ...current,
          busy: false,
          stage: result.canceled ? "canceled" : completeEnough || result.ok ? "complete" : result.partial ? "partial" : "error",
          progress: completeEnough ? 100 : result.progress,
          imagesFound: result.imagesFound,
          imagesCached: result.imagesCached,
          log: result.log,
          current: result.imagesCached,
          total: completeEnough || !result.partial ? Math.max(result.imagesFound, result.imagesCached) : current.total,
          error: softenPinterestPartialError(result.error, completeEnough)
        };
      });
      const refreshCompleteEnough = Boolean(result.partial && pinterestPartialIsCloseEnough(result.imagesCached, source.expectedItemCount, result.imagesFound));
      if (result.source && result.source.images.length > 0) {
        const sourceForProject = refreshCompleteEnough ? { ...result.source, importStatus: "ready" as const, expectedItemCount: Math.max(result.source.expectedItemCount ?? 0, result.imagesCached, result.imagesFound) } : result.source;
        commitProject((current) => ({
          ...current,
          sources: current.sources.map((item) => (item.id === source.id ? { ...sourceForProject, id: source.id, name: source.name } : item))
        }));
        setMessage(softenPinterestPartialError(result.error, refreshCompleteEnough) ?? `Refreshed ${result.source.images.length} Pinterest pins.`);
      } else {
        setMessage(result.error ?? "Pinterest import unavailable");
      }
      return;
    }
    if (!source.path || source.type !== "local-folder") {
      setMessage("Only local folder sources can be rescanned.");
      return;
    }
    try {
      const refreshed = await window.wallpaperApi.rescanFolder(source.path);
      commitProject((current) => ({
        ...current,
        sources: current.sources.map((item) => (item.id === source.id ? { ...refreshed, id: source.id, name: source.name } : item))
      }));
      setMessage(`Rescanned ${refreshed.images.length} images.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to rescan this folder.");
    }
  }

  async function showSourceInFolder(source: ImageSource) {
    const itemPath = source.path ?? source.cachePath ?? source.images[0]?.path;
    if (!itemPath) {
      setMessage("This source has no local folder to show.");
      return;
    }
    await window.wallpaperApi.showInFolder(itemPath);
  }

  async function copySourcePath(source: ImageSource) {
    const itemPath = source.path ?? source.cachePath ?? source.images[0]?.path ?? source.url;
    if (!itemPath) {
      setMessage("This source has no path to copy.");
      return;
    }
    const ok = await window.wallpaperApi.copyText(itemPath);
    setMessage(ok ? "Folder path copied." : "Unable to copy folder path.");
  }

  async function deleteSourceCache(source: ImageSource) {
    if (!source.cachePath) return;
    if (!window.confirm("Delete cached files for this source? Original local folders and images will not be deleted.")) return;
    await window.wallpaperApi.deleteCache(source.cachePath);
    commitProject((current) => ({
      ...current,
      sources: current.sources.map((item) => (item.id === source.id ? { ...item, images: [], importStatus: "idle" } : item))
    }));
    setMessage("Cached files deleted. Original local files were not deleted.");
  }

  function removeSource(source: ImageSource) {
    const templateUsage = sourceTemplateUsageCount(source.id);
    const warning = templateUsage > 0
      ? `Delete ${source.name} from the global source library? It is linked to ${templateUsage} template${templateUsage === 1 ? "" : "s"}. Those links and frame assignments will be cleared. Original local files will not be deleted.`
      : `Delete ${source.name} from the global source library? Original local files will not be deleted.`;
    if (!window.confirm(warning)) return;

    const clearLayerSource = (layer: PlaceholderLayer) => {
      const sourceIds = layer.sourceState.sourceIds.filter((id) => id !== source.id);
      const wasPrimary = layer.sourceId === source.id;
      return {
        ...layer,
        sourceId: wasPrimary ? sourceIds[0] : layer.sourceId,
        generatedImageId: wasPrimary ? undefined : layer.generatedImageId,
        selectedImageId: wasPrimary ? undefined : layer.selectedImageId,
        sourceState: { ...layer.sourceState, sourceIds }
      };
    };

    commitProject((current) => ({
      ...current,
      sources: current.sources.filter((item) => item.id !== source.id),
      layers: current.layers.map(clearLayerSource),
      templates: {
        ...current.templates,
        templates: current.templates.templates.map((template) => ({
          ...template,
          project: {
            ...template.project,
            sourceIds: template.project.sourceIds.filter((id) => id !== source.id),
            layers: template.project.layers.map(clearLayerSource)
          }
        }))
      }
    }));
    if (selectedSourceId === source.id) setSelectedSourceId(undefined);
    setSourceMenu(undefined);
    setMessage("Global source deleted. Original local files were not deleted.");
  }

  useEffect(() => {
    if (view !== "editor") return;
    const stage = stageRef.current;
    if (!stage) return;

    function onWheel(event: WheelEvent) {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (horizontal && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        stage!.scrollLeft += normalizeWheelDelta(event.deltaX, event.deltaMode, stage!.clientWidth);
        if (Math.abs(event.deltaY) > 0) stage!.scrollTop += normalizeWheelDelta(event.deltaY, event.deltaMode, stage!.clientHeight);
        return;
      }
      event.preventDefault();
      wheelDeltaRef.current += normalizeWheelDelta(event.deltaY, event.deltaMode, stage!.clientHeight);
      wheelAnchorRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (zoomFrameRef.current !== undefined) return;
      zoomFrameRef.current = window.requestAnimationFrame(() => {
        zoomFrameRef.current = undefined;
        const delta = Math.min(240, Math.max(-240, wheelDeltaRef.current));
        wheelDeltaRef.current = 0;
        const anchor = wheelAnchorRef.current;
        applyCanvasZoom(zoomAfterWheel(zoomRef.current, delta), anchor.clientX, anchor.clientY);
      });
    }

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
      if (zoomFrameRef.current !== undefined) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = undefined;
      }
      wheelDeltaRef.current = 0;
    };
  }, [view]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const isClipboardShortcut = command && (key === "c" || key === "v");
      const hasLayerClipboard = clipboardLayersRef.current.length > 0 || readPersistedLayerClipboard().length > 0;
      if (isClipboardShortcut && shouldUseNativeClipboardShortcut(event.target, key as "c" | "v", hasLayerClipboard)) return;
      if (isTypingTarget(event.target) && !(command && key === "s") && !isClipboardShortcut) return;
      if (view === "editor" && command && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        zoomCanvasByStep(1);
      } else if (view === "editor" && command && event.key === "-") {
        event.preventDefault();
        zoomCanvasByStep(-1);
      } else if (view === "editor" && command && event.shiftKey && event.key === "0") {
        event.preventDefault();
        fitCanvas();
      } else if (view === "editor" && command && event.key === "0") {
        event.preventDefault();
        resetCanvasZoom();
      } else if (view === "editor" && command && event.key === "1") {
        event.preventDefault();
        fitCanvas();
      } else if (command && key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (command && key === "z") {
        event.preventDefault();
        undo();
      } else if (event.ctrlKey && key === "y") {
        event.preventDefault();
        redo();
      } else if (command && key === "c") {
        if (copySelectedLayersForClipboard()) {
          // Do not prevent the native copy event. Let Electron/browser populate the
          // system clipboard with our custom app payload when possible; the
          // in-memory/localStorage layer clipboard above is the reliable fallback.
        }
      } else if (command && key === "v") {
        const layersToPaste = layerClipboardForPaste();
        const pasteVersion = pasteEventVersionRef.current;
        if (pasteFallbackTimerRef.current !== undefined) window.clearTimeout(pasteFallbackTimerRef.current);
        pasteFallbackTimerRef.current = window.setTimeout(() => {
          pasteFallbackTimerRef.current = undefined;
          if (pasteEventVersionRef.current === pasteVersion) pasteCopiedLayers(layersToPaste);
        }, 45);
      } else if (command && key === "d") {
        event.preventDefault();
        duplicateSelectedLayer();
      } else if (command && key === "s") {
        event.preventDefault();
        void saveProject();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedLayer();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (cropModeLayerId) setCropModeLayerId(undefined);
        else clearLayerSelection();
      } else if (selectedLayers.length && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const ids = new Set(selectedLayers.filter((layer) => !layer.locked).map((layer) => layer.id));
        commitProject((current) => ({
          ...current,
          layers: current.layers.map((layer) => ids.has(layer.id) ? {
            ...layer,
            ...clampRecoverableLayerPosition(layer, layer.x + dx, layer.y + dy, current.canvas)
          } : layer)
        }));
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (pasteFallbackTimerRef.current !== undefined) window.clearTimeout(pasteFallbackTimerRef.current);
    };
  }, [selectedLayer, selectedLayers, cropModeLayerId, projectPath, selectedLayerIds, view]);

  useEffect(() => {
    function onCopy(event: ClipboardEvent) {
      if (isTypingTarget(event.target)) return;
      const copied = selectedLayersFromCurrentProject();
      if (copied.length === 0) return;
      storeCopiedLayers(copied);
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData?.setData("application/x-pin-paper-layers", clipboardLayerPayload(copied));
      event.clipboardData?.setData("text/plain", `${copied.length} Pin Paper layer${copied.length === 1 ? "" : "s"}`);
    }

    function onPaste(event: ClipboardEvent) {
      if (isTypingTarget(event.target)) return;
      pasteEventVersionRef.current += 1;
      if (pasteFallbackTimerRef.current !== undefined) {
        window.clearTimeout(pasteFallbackTimerRef.current);
        pasteFallbackTimerRef.current = undefined;
      }
      const candidates = webImageCandidatesFromTransfer(event.clipboardData);
      if (candidates.length === 0) {
        const appLayers = parseClipboardLayers(event.clipboardData?.getData("application/x-pin-paper-layers"));
        const layersToPaste = appLayers ?? layerClipboardForPaste();
        if (viewRef.current !== "editor" || layersToPaste.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (appLayers) storeCopiedLayers(appLayers);
        pasteCopiedLayers(layersToPaste);
        return;
      }
      const fingerprint = webImagePasteFingerprint(candidates);
      const now = Date.now();
      if (lastPasteRef.current?.fingerprint === fingerprint && now - lastPasteRef.current.at < 650) return;
      lastPasteRef.current = { fingerprint, at: now };
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        if (viewRef.current === "editor") {
          const activeLayer = selectedLayerIdRef.current
            ? projectRef.current.layers.find((layer) => layer.id === selectedLayerIdRef.current)
            : undefined;
          if (activeLayer && !activeLayer.locked) {
            await assignWebImagesToLayer(candidates, activeLayer);
            return;
          }
          const canvas = projectRef.current.canvas;
          await placeWebImagesAtCanvasPoint(candidates, { x: canvas.width / 2, y: canvas.height / 2 });
          return;
        }
        await importWebImagesAsSources(candidates);
      })();
    }

    window.addEventListener("copy", onCopy, true);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy, true);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  if (view === "home") {
    return (
      <>
        <TemplateHome
          project={project}
          templates={visibleTemplates}
          filter={templateFilter}
          onFilter={setTemplateFilter}
          onCreate={createBlankTemplate}
          onOpen={openTemplate}
          onApply={(template) => void applyTemplate(template)}
          onDuplicate={duplicateTemplate}
          onRename={renameTemplate}
          onDelete={deleteTemplate}
          onToggleFavorite={(template) => patchTemplate(template.id, { favorite: !template.favorite })}
          onToggleRotation={(template) => patchTemplate(template.id, { enabledForRotation: !template.enabledForRotation })}
          onExportSet={(template) => openExportSet(template.id)}
          onOpenProject={() => void openProject()}
          onSaveProject={() => void saveProject()}
        />
        <SourceImportDialog state={sourceImportDialog} />
        <RenameDialog state={renameState?.kind === "layer" ? undefined : renameState} onChange={setRenameState} onFinish={finishRename} />
        <ExportSetDialog
          state={exportSet}
          onChange={setExportSet}
          onChooseFolder={() => void chooseExportSetFolder()}
          onRun={() => void runExportSet()}
          onCancel={cancelExportSet}
          onCleanup={() => void cleanupWallpaperSets()}
          onReveal={(folderPath) => void revealWallpaperSet(folderPath)}
          onOpenSettings={() => void openMacOSWallpaperSettings()}
          onApplyPack={(folderPath, intervalSeconds) => void applyExportedWallpaperPack(folderPath, intervalSeconds)}
          onClose={() => setExportSet((current) => ({ ...current, open: false }))}
        />
        <GlobalTooltip />
      </>
    );
  }

  return (
    <main className={`app-shell page-transition ${leftPanelOpen ? "" : "left-collapsed"} ${rightPanelOpen ? "" : "right-collapsed"}`}>
      <aside className={`sidebar left ${leftPanelOpen ? "" : "collapsed"}`}>
        <div className="brand compact-brand">
          <button className="brand-home-button tooltip-anchor" data-tooltip="Return home" aria-label="Return home" onClick={() => void goHome()}>
            <img className="brand-mark pin-paper-mark" src={pinPaperIcon} alt="Pin Paper" />
          </button>
          <div className="brand-copy">
            {projectNameEditing ? (
              <input
                className="project-name editing"
                value={project.name}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => setProjectNameEditing(false)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur(); }}
                onChange={(event) => commitProject((current) => ({ ...current, name: event.target.value }))}
              />
            ) : (
              <button className="project-name-display" title={project.name} onClick={() => setProjectNameEditing(true)}>{project.name}</button>
            )}

          </div>
          <button className="icon-button panel-local-toggle tooltip-anchor" data-tooltip="Hide source panel" aria-label="Hide source panel" onClick={() => setLeftPanelOpen(false)}><PanelLeft size={16} /></button>
        </div>

        <div className="panel-tabs" role="tablist" aria-label="Editor side panel">
          <button className={leftPanelTab === "sources" ? "active" : ""} onClick={() => setLeftPanelTab("sources")}><Images size={15} /> Sources</button>
          <button className={leftPanelTab === "layers" ? "active" : ""} onClick={() => setLeftPanelTab("layers")}><Layers size={15} /> Layers</button>
        </div>

        <section
          className={`source-library drop-zone ${leftPanelTab === "sources" ? "" : "hidden-panel"} ${dropFeedback?.target === "sources" ? `drag-active ${dropFeedback.valid ? "drop-valid" : "drop-invalid"}` : ""}`}
          onDragEnter={(event) => updateDropFeedback(event, "sources")}
          onDragOver={(event) => updateDropFeedback(event, "sources")}
          onDragLeave={(event) => leaveDropTarget(event, "sources")}
          onDrop={(event) => void handleSourceDrop(event)}
        >
          {dropFeedback?.target === "sources" && dropFeedback.valid && (
            <div className="drop-feedback-overlay source-drop-feedback valid">
              <Upload size={22} />
              <strong>{dropFeedback.label}</strong>
            </div>
          )}
          <div className="library-heading add-source-heading">
            <AddSourceControl
              onAddFolder={() => void addFolderSource()}
              onAddImages={() => void addLocalImagesSource()}
              pinterestEnabled={platformCapabilities.canUsePinterestImport}
              onAddPinterest={() => {
                if (!platformCapabilities.canUsePinterestImport || !window.wallpaperApi?.importPinterestBoard) {
                  setMessage("Pinterest import is unavailable in the web version. Use the desktop app, or download images and import them as files.");
                  return;
                }
                setPinterestDialog((current) => ({ ...current, open: true }));
              }}
            />
          </div>

          <div className="source-tabs" role="tablist" aria-label="Source library">
            <button className={sourceLibraryView === "linked" ? "active" : ""} onClick={() => setSourceLibraryView("linked")}>Linked <span>{linkedSources.length}</span></button>
            <button className={sourceLibraryView === "global" ? "active" : ""} onClick={() => setSourceLibraryView("global")}>Global <span>{project.sources.length}</span></button>
          </div>

          <div className="source-list collection-list">
            {visibleSources.length === 0 ? (
              <button className="empty-source-card" onClick={sourceLibraryView === "linked" ? () => setSourceLibraryView("global") : addFolderSource}>
                <FolderOpen size={20} />
                <strong>{sourceLibraryView === "linked" ? "No sources linked" : "Add a source collection"}</strong>
                <span>{sourceLibraryView === "linked" ? "Choose one from the global library" : platformCapabilities.canUsePinterestImport ? "Drop a folder here or import a Pinterest board" : "Drop images here or add a folder"}</span>
              </button>
            ) : visibleSources.map((source) => {
              const linked = linkedSourceIds.includes(source.id);
              const assigned = Boolean(selectedLayer && selectedLayer.objectKind !== "text" && (selectedLayer.sourceId === source.id || selectedLayer.sourceState.sourceIds.includes(source.id)));
              const eligibleCount = sourceImagesForPolicy(source).length;
              const countLabel = source.expectedItemCount && source.expectedItemCount > source.images.length
                ? `${source.images.length} / ${source.expectedItemCount} cached`
                : `${eligibleCount} items`;
              return (
                <div
                  className={`source-row ${selectedLayer && assigned ? "assigned" : ""}`}
                  key={source.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-pwc-source-id", source.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedSourceId(source.id);
                    setSourceMenu({ sourceId: source.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <button
                    className="source-row-main"
                    onClick={() => handleSourceClick(source)}
                  >
                    <span className="source-icon">{source.type === "local-folder" ? <FolderOpen size={17} /> : source.type === "pinterest-board" ? <Sparkles size={17} /> : <Images size={17} />}</span>
                    <span className="source-copy">
                      <strong>{source.name}</strong>
                      <span><span>{countLabel}{source.importStatus === "partial" ? " partial" : ""}</span></span>
                    </span>
                  </button>
                  <div className="source-row-actions">
                    <button className="icon-button source-row-icon-action" title="Refresh source" aria-label="Refresh source" onClick={() => void rescanSource(source)}><RefreshCcw size={15} /></button>
                    {sourceLibraryView === "linked" ? (
                      <button className="icon-button source-row-icon-action" title="Unlink from this template" aria-label="Unlink from this template" onClick={() => unlinkSourceFromTemplate(source)}><Unlink size={15} /></button>
                    ) : linked ? (
                      <span className="source-linked-badge icon-only" title="Linked to this template"><Link size={14} /></span>
                    ) : (
                      <button className="icon-button source-row-icon-action" title="Link to this template" aria-label="Link to this template" onClick={() => linkSourceToTemplate(source)}><Link size={15} /></button>
                    )}
                    {sourceLibraryView === "global" && (
                      <button className="icon-button source-delete" title="Delete global source" onClick={() => removeSource(source)}><Trash2 size={15} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>




          {sourceMenu && (
            <SourceContextMenu
              state={sourceMenu}
              source={project.sources.find((source) => source.id === sourceMenu.sourceId)}
              onClose={() => setSourceMenu(undefined)}
              onRename={renameSource}
              onRescan={(source) => void rescanSource(source)}
              onShow={(source) => void showSourceInFolder(source)}
              onRemove={removeSource}
              onDeleteCache={(source) => void deleteSourceCache(source)}
              onCopyPath={(source) => void copySourcePath(source)}
            />
          )}
        </section>

        <section className={`panel layers-panel ${leftPanelTab === "layers" ? "" : "hidden-panel"}`}>
          <div className="panel-title-row">
            <h2><Layers size={17} /> Layers</h2>
          </div>
          <div className="layers-list" aria-label="Layers from front to back">
            {[...project.layers].reverse().map((layer) => {
              const selected = selectedLayerIds.includes(layer.id);
              return (
                <div
                  className={`layer-row ${selected ? "active" : ""} ${layerDropIndicator?.targetId === layer.id ? (layerDropIndicator.before ? "drop-before" : "drop-after") : ""}`}
                  key={layer.id}
                  draggable={!layer.locked && renameState?.id !== layer.id}
                  onDragStart={(event) => {
                    const ids = (selected ? selectedLayerIds : [layer.id]).filter((id) => !project.layers.find((item) => item.id === id)?.locked);
                    if (!selected) selectOnlyLayer(layer.id);
                    event.dataTransfer.setData("application/x-pwc-layer-ids", JSON.stringify(ids));
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setLayerDropIndicator(undefined)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    setLayerDropIndicator({ targetId: layer.id, before: event.clientY < rect.top + rect.height / 2 });
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setLayerDropIndicator((current) => current?.targetId === layer.id ? undefined : current);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const raw = event.dataTransfer.getData("application/x-pwc-layer-ids");
                    let ids: string[] = [];
                    try { ids = JSON.parse(raw) as string[]; } catch { ids = []; }
                    setLayerDropIndicator(undefined);
                    if (!ids.length || ids.includes(layer.id)) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const beforeInPanel = event.clientY < rect.top + rect.height / 2;
                    commitProject((current) => ({ ...current, layers: moveLayerBlockToTarget(current.layers, ids, layer.id, beforeInPanel) }));
                    setSelectedLayerIds(ids);
                    setSelectedLayerId(ids.at(-1));
                  }}
                >
                  <span className="layer-drag-handle tooltip-anchor" data-tooltip="Drag to reorder"><GripVertical size={15} /></span>
                  <button
                    className="layer-main"
                    onClick={(event) => selectLayerFromPanel(layer.id, event)}
                    onDoubleClick={(event) => { event.stopPropagation(); renameLayer(layer.id); }}
                  >
                    <span className="layer-type-icon">{layer.objectKind === "text" ? <Type size={14} /> : <ImagePlus size={14} />}</span>
                    {renameState?.kind === "layer" && renameState.id === layer.id ? (
                      <input
                        className="layer-name-input"
                        value={renameState.value}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onChange={(event) => setRenameState({ ...renameState, value: event.target.value })}
                        onBlur={() => finishRename(true)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") finishRename(true);
                          if (event.key === "Escape") finishRename(false);
                        }}
                      />
                    ) : (
                      <span className="layer-name" title="Double-click to rename">{layer.name}</span>
                    )}
                    {layer.locked && <Lock size={12} className="layer-lock-indicator" />}
                  </button>
                  <button
                    className="layer-icon-button tooltip-anchor"
                    data-tooltip="Layer order, duplicate, delete"
                    aria-label="Layer order, duplicate, delete"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      if (!selected) selectOnlyLayer(layer.id);
                      setLayerMenu({ layerId: layer.id, x: Math.max(8, rect.right - 190), y: rect.bottom + 6 });
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        {layerMenu && (
          <LayerContextMenu
            state={layerMenu}
            layer={project.layers.find((item) => item.id === layerMenu.layerId)}
            selectionCount={actionLayerIds(layerMenu.layerId).length}
            onClose={() => setLayerMenu(undefined)}
            onRename={() => renameLayer(layerMenu.layerId)}
            onDuplicate={() => duplicateLayers(actionLayerIds(layerMenu.layerId))}
            onDelete={() => deleteLayers(actionLayerIds(layerMenu.layerId))}
            onOrder={(action) => reorderLayers(actionLayerIds(layerMenu.layerId), action)}
          />
        )}

        <section className="sidebar-bottom-actions">
          <button onClick={() => void goHome()}>← Return Home</button>
        </section>
      </aside>

      <section className="workspace">
        {!leftPanelOpen && <button className="panel-reopen left tooltip-anchor" data-tooltip="Show source panel" aria-label="Show source panel" onClick={() => setLeftPanelOpen(true)}><PanelLeft size={16} /></button>}
        {!rightPanelOpen && <button className="panel-reopen right tooltip-anchor" data-tooltip="Show inspector" aria-label="Show inspector" onClick={() => setRightPanelOpen(true)}><PanelRight size={16} /></button>}
        <header className="toolbar minimal-toolbar">
          <div className="toolbar-cluster">
            <button className="icon-button tooltip-anchor" data-tooltip="Return home" aria-label="Return home" onClick={() => void goHome()}><Home size={17} /></button>
            <button className="icon-button tooltip-anchor" data-tooltip="Undo" aria-label="Undo" onClick={undo} disabled={history.past.length === 0}>↶</button>
            <button className="icon-button tooltip-anchor" data-tooltip="Redo" aria-label="Redo" onClick={redo} disabled={history.future.length === 0}>↷</button>
          </div>
          <div className="toolbar-create-actions add-object-wrap" onMouseEnter={clearAddObjectCloseTimer} onMouseLeave={scheduleAddObjectClose}>
            <button className="secondary-action compact-top-action" onClick={() => { clearAddObjectCloseTimer(); setAddObjectMenuOpen((value) => !value); }}><Plus size={16} /> Add Object <ChevronDown size={14} /></button>
            {addObjectMenuOpen && (
              <div className="popover-menu add-object-menu" onMouseEnter={clearAddObjectCloseTimer} onMouseLeave={scheduleAddObjectClose}>
                <button onClick={addPlaceholder}><ImagePlus size={16} /> Frame</button>
                <button onClick={() => addTextLayer()}><Type size={16} /> Text</button>
              </div>
            )}
          </div>
          <div className="toolbar-cluster">
            <button className="secondary-action" disabled={wallpaperBusy} onClick={() => showNextVariation()}>
              <Shuffle size={17} />
              {wallpaperBusy ? "Working…" : "Next Variation"}
            </button>
            {platformCapabilities.canCreateExportPack && (
              <button className="primary-action" disabled={wallpaperBusy} onClick={() => openExportSet()}>
                <Images size={17} /> {platformCopy.createWallpaperSet}
              </button>
            )}
            <div className="overflow-wrap" onMouseEnter={clearToolbarMenuCloseTimer} onMouseLeave={scheduleToolbarMenuClose}>
              <button className="icon-button tooltip-anchor" data-tooltip="More actions" aria-label="More actions" onClick={() => { clearToolbarMenuCloseTimer(); setToolbarMenuOpen((value) => !value); }}><MoreHorizontal size={18} /></button>
              {toolbarMenuOpen && (
                <div className="popover-menu toolbar-overflow" onMouseEnter={clearToolbarMenuCloseTimer} onMouseLeave={scheduleToolbarMenuClose}>
                  <button onClick={openProject}><FolderOpen size={16} /> Open</button>
                  <button onClick={saveProject}><Save size={16} /> Save</button>
                  <button onClick={saveProjectAs}>Save as</button>
                  <button onClick={() => exportWallpaper("png")}><Download size={16} /> Export PNG</button>
                  {platformCapabilities.canCreateExportPack && <button onClick={() => openExportSet()}><Images size={16} /> {platformCopy.createWallpaperSet}</button>}
                  {platformCapabilities.canCleanNativeWallpaperSets && <button onClick={() => void cleanupWallpaperSets()}><Trash2 size={16} /> {platformCopy.cleanupWallpaperSets}</button>}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="workspace-fixed-controls">
          {selectedLayer && !selectedLayer.locked && selectedLayer.objectKind === "text" && (
            <TextTopBar
              layer={selectedLayer}
              onPatch={(patch) => patchLayer(selectedLayer.id, patch)}
            />
          )}
          {cropModeLayerId && (
            <div className="floating-canvas-status cropping">
              <button onClick={() => setCropModeLayerId(undefined)}>Done cropping</button>
            </div>
          )}
          {selectedLayer && !selectedLayer.locked && cropModeLayerId === selectedLayer.id ? (
            <CropToolbar
              layer={selectedLayer}
              onPatch={(patch) => patchSelectedLayer(patch)}
              onDone={() => setCropModeLayerId(undefined)}
            />
          ) : selectedLayer && !selectedLayer.locked && selectedLayer.objectKind !== "text" ? (
            <ContextToolbar
              layer={selectedLayer}
              onPatch={(patch) => patchSelectedLayer(patch)}
              onCrop={() => setCropModeLayerId(selectedLayer.id)}
              onDuplicate={duplicateSelectedLayer}
              onDelete={deleteSelectedLayer}
              onOrder={reorderSelectedLayer}
            />
          ) : null}
        </div>

        <div
          ref={stageRef}
          className="canvas-stage"
          onPointerDown={beginCanvasPan}
          onPointerMove={onStagePointerMove}
          onPointerUp={endCanvasPan}
          onPointerLeave={endCanvasPan}
          onContextMenu={(event) => { if (canvasPanRef.current) event.preventDefault(); }}
        >
          <div
            ref={canvasZoomShellRef}
            className="canvas-zoom-shell"
            style={{
              width: project.canvas.width * zoomRef.current,
              height: project.canvas.height * zoomRef.current
            }}
          >
          <div
            ref={canvasRef}
            className={`canvas ${cropModeLayerId ? "crop-active" : ""} ${dropFeedback?.target === "canvas" ? `drag-active ${dropFeedback.valid ? "drop-valid" : "drop-invalid"}` : ""}`}
            style={{
              width: project.canvas.width,
              height: project.canvas.height,
              transform: `scale(${zoomRef.current})`,
              backgroundColor: project.canvas.backgroundBaseMode === "transparent" ? "transparent" : project.canvas.backgroundColor,
              backgroundImage: project.canvas.backgroundBaseMode === "transparent"
                ? "linear-gradient(45deg, #f1f1ef 25%, transparent 25%), linear-gradient(-45deg, #f1f1ef 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f1ef 75%), linear-gradient(-45deg, transparent 75%, #f1f1ef 75%)"
                : undefined,
              backgroundSize: project.canvas.backgroundBaseMode === "transparent" ? "16px 16px" : undefined,
              backgroundPosition: project.canvas.backgroundBaseMode === "transparent" ? "0 0, 0 8px, 8px -8px, -8px 0px" : undefined,
            }}
            onDragEnter={(event) => updateDropFeedback(event, "canvas")}
            onDragOver={(event) => updateDropFeedback(event, "canvas")}
            onDragLeave={(event) => leaveDropTarget(event, "canvas")}
            onDrop={(event) => void handleCanvasDrop(event)}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              if (event.target !== event.currentTarget) return;
              const additive = event.shiftKey || event.metaKey || event.ctrlKey;
              const rect = event.currentTarget.getBoundingClientRect();
              const startX = clamp((event.clientX - rect.left) / zoomRef.current, 0, project.canvas.width);
              const startY = clamp((event.clientY - rect.top) / zoomRef.current, 0, project.canvas.height);
              const marquee: SelectionMarquee = { startX, startY, x: startX, y: startY, width: 0, height: 0, baseIds: additive ? selectedLayerIds : [], additive };
              marqueeRef.current = marquee;
              setSelectionMarquee(marquee);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
          >
            <BackgroundImageView canvas={project.canvas} />
            <CanvasSurfaceOverlay canvas={project.canvas} customTextures={project.customTextures} />
            {dropFeedback?.target === "canvas" && !dropFeedback.valid && (
              <div className="drop-feedback-overlay canvas-drop-feedback invalid">
                <Upload size={24} />
                <strong>{dropFeedback.label}</strong>
                <span>Drop a supported image file, folder, or existing source.</span>
              </div>
            )}
            {dropFeedback?.target === "canvas" && dropFeedback.valid && dropFeedback.canvasPoint &&
              Array.from({ length: Math.min(4, Math.max(1, dropFeedback.placementCount ?? 1)) }).map((_, index) => {
                const placement = placementForCanvasDrop(project.canvas, dropFeedback.canvasPoint!, index);
                const dropPreviewStyle = adaptiveDropPreviewStyle(placement.width, placement.height, project.canvas);
                const dropIconSize = Number.parseInt(String((dropPreviewStyle as unknown as Record<string, string>)["--drop-copy-icon"] ?? "18"), 10) || 18;
                return (
                  <div
                    className="canvas-drop-placement-preview"
                    key={`drop-preview-${index}`}
                    style={{
                      left: placement.x,
                      top: placement.y,
                      width: placement.width,
                      height: placement.height,
                      zIndex: 50 + index,
                      ...dropPreviewStyle
                    }}
                  >
                    {index === 0 && (
                      <div className="canvas-drop-placement-copy">
                        <Upload size={dropIconSize} />
                        <strong>{dropFeedback.label}</strong>
                        <span>Release to create and select the frame here.</span>
                        {(dropFeedback.placementCount ?? 1) > 1 && <b>{dropFeedback.placementCount} frames</b>}
                      </div>
                    )}
                  </div>
                );
              })}
            {selectionMarquee && <div className="selection-marquee" style={{ left: selectionMarquee.x, top: selectionMarquee.y, width: selectionMarquee.width, height: selectionMarquee.height }} />}
            <div className="canvas-artwork-clip" aria-hidden={false}>
            {project.layers.map((layer) => {
              const image = getImageForLayer(project, layer);
              if (layer.hidden) return null;
              if (layer.objectKind === "text") {
                const selected = selectedLayerIds.includes(layer.id);
                const editing = editingTextLayerId === layer.id;
                return (
                  <React.Fragment key={layer.id}>
                    <div
                      className={`placeholder text-layer ${selected ? "selected" : ""} ${layer.locked ? "locked" : ""}`}
                      style={{
                        left: layer.x,
                        top: layer.y,
                        width: layer.width,
                        height: layer.height,
                        transform: `rotate(${layer.rotation}deg)`,
                        opacity: layer.opacity,
                        zIndex: project.layers.findIndex((item) => item.id === layer.id) + 2
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (!layer.locked) {
                          selectOnlyLayer(layer.id);
                          setEditingTextLayerId(layer.id);
                        }
                      }}
                      onPointerDown={(event) => {
                        if (editing) return;
                        beginDrag(event, layer, "move");
                      }}
                    >
                      <div
                        className="text-layer-content"
                        data-text-layer-id={layer.id}
                        contentEditable={editing && !layer.locked}
                        suppressContentEditableWarning
                        style={{
                          color: layer.textColor ?? "#26313a",
                          fontFamily: layer.fontFamily,
                          fontSize: layer.fontSize,
                          fontWeight: layer.fontWeight,
                          textAlign: layer.textAlign,
                          lineHeight: layer.lineHeight,
                          letterSpacing: layer.letterSpacing
                        }}
                        onBlur={(event) => {
                          setEditingTextLayerId(undefined);
                          const text = event.currentTarget.innerText || "Text";
                          patchLayer(layer.id, { text, height: estimateTextLayerHeight({ text, fontSize: layer.fontSize, lineHeight: layer.lineHeight }) });
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingTextLayerId(undefined);
                          }
                        }}
                        onPaste={(event) => {
                          const text = event.clipboardData.getData("text/plain");
                          if (!text) return;
                          event.preventDefault();
                          document.execCommand("insertText", false, text);
                        }}
                      >{layer.text ?? "Text"}</div>
                    </div>
                  </React.Fragment>
                );
              }
              const natural = imageNaturalRef.current[layer.id];
              const frame = measuredLayerFrame(layer, image, natural);
              const selected = selectedLayerIds.includes(layer.id);
              const roundedRadius = effectiveRoundedRadius(layer, project.canvas);
              const cropping = cropModeLayerId === layer.id;
              const paperFrame = layer.effects.paperFrame ?? createDefaultPaperFrame();
              const polaroid = normalizePolaroidEffect(layer.effects.polaroid, paperFrame, layer.effects.innerShadow);
              const tornPaper = normalizeTornPaperEffect(layer.effects.tornPaper, paperFrame, layer.effects.innerShadow);
              const hasAssignedImage = Boolean(image);
              const visualPaperActive = hasAssignedImage && paperFrame.type !== "none";
              const insets = visualPaperActive ? paperFrameInsets(paperFrame, frame.width, frame.height, polaroid, tornPaper) : { top: 0, right: 0, bottom: 0, left: 0 };
              const innerWidth = Math.max(1, frame.width - insets.left - insets.right);
              const innerHeight = Math.max(1, frame.height - insets.top - insets.bottom);
              const paperActive = visualPaperActive;
              const rough = visualPaperActive && paperFrameIsRough(paperFrame);
              const polaroidActive = visualPaperActive && paperFrame.type === "polaroid";
              const tornActive = visualPaperActive && paperFrame.type === "torn";
              const expandedFrameRotation = visualPaperActive ? paperFrameRotation(paperFrame, polaroid) : 0;
              const expandedFrameColor = polaroidActive ? polaroid.frameColor : tornActive ? tornPaper.paperColor : paperFrame.paperColor;
              const expandedFrameOpacity = polaroidActive ? polaroid.frameOpacity : tornActive ? tornPaper.paperOpacity : 1;
              const expandedFrameRadius = polaroidActive ? polaroid.cornerRadius : Math.min(18, paperFrame.borderWidth * 0.4);
              const expandedFrameTexture = polaroidActive ? polaroid.grain : tornActive ? tornPaper.grain : paperFrame.textureIntensity;
              const expandedOuterShadow = polaroidActive ? shadowToCss(polaroid.dropShadow) : tornActive ? shadowToCss(tornPaper.outerShadow) : "";
              const expandedInnerShadow = polaroidActive ? shadowToCss(polaroid.innerShadow) : tornActive ? shadowToCss(tornPaper.innerShadow) : "";
              const polaroidWarmth = polaroidActive ? paperWarmthOverlay(polaroid.warmth) : undefined;
              const tornPaperTexture = tornActive ? tornPaperTextureDataUrl(tornPaper, frame.width, frame.height) : undefined;
              const imageTransform = polaroidActive
                ? { scale: polaroid.imageScale, x: polaroid.imageOffsetX, y: polaroid.imageOffsetY, rotation: polaroid.imageRotation }
                : tornActive
                  ? { scale: tornPaper.imageScale, x: tornPaper.imageOffsetX, y: tornPaper.imageOffsetY, rotation: 0 }
                  : undefined;
              const frameControlMetrics = adaptiveControlMetrics(frame.width, frame.height, project.canvas);
              const frameControlStyle = adaptiveControlStyle(frameControlMetrics);
              return (
                <React.Fragment key={layer.id}>
                <div
                  className={`placeholder ${selected ? "selected" : ""} ${layer.locked ? "locked" : ""} ${cropping ? "cropping" : ""} ${!hasAssignedImage ? "unassigned" : ""} ${paperActive ? `paper-frame ${paperFrame.type}` : ""} ${rough ? "rough-paper" : ""} ${dropFeedback?.target === "placeholder" && dropFeedback.layerId === layer.id ? `drop-target ${dropFeedback.valid ? "drop-valid" : "drop-invalid"}` : ""}`}
                  style={{
                    left: frame.x,
                    top: frame.y,
                    width: frame.width,
                    height: frame.height,
                    transform: `rotate(${layer.rotation + expandedFrameRotation}deg)`,
                    borderWidth: 0,
                    borderColor: "transparent",
                    ["--layer-border-width" as string]: paperActive ? "0px" : `${Math.max(0, layer.borderWidth)}px`,
                    ["--layer-border-inset" as string]: paperActive ? "0px" : `${Math.max(0, layer.borderWidth) * -1}px`,
                    ["--layer-border-radius" as string]: layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? "0px" : `${roundedRadius}px`,
                    ["--layer-border-color" as string]: paperActive ? "transparent" : hexWithOpacity(layer.borderColor, layer.borderOpacity),
                    ...frameControlStyle,
                    borderRadius: paperActive ? expandedFrameRadius : layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? 0 : roundedRadius,
                    overflow: rough || !paperActive ? "visible" : "hidden",
                    clipPath: rough ? paperFrameClipPath(paperFrame, tornPaper, frame.width, frame.height) : undefined,
                    opacity: layer.opacity,
                    backgroundColor: paperActive ? hexWithOpacity(expandedFrameColor, expandedFrameOpacity) : layer.effects.backgroundColor,
                    mixBlendMode: layer.effects.blendMode,
                    filter: rough && Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) > 0 ? `drop-shadow(0 ${Math.max(4, paperFrame.shadowStrength * 0.16)}px ${Math.max(10, paperFrame.shadowStrength * 0.58)}px rgba(15,23,42,${Math.min(0.35, Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) / 210)}))` : undefined,
                    boxShadow: [
                      layer.effects.glow ? "0 0 0 2px rgba(255,255,255,.8), 0 0 32px rgba(207,42,69,.38)" : "",
                      expandedOuterShadow,
                      !expandedOuterShadow && Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) > 0 ? `0 ${Math.max(4, paperFrame.shadowStrength * 0.18)}px ${Math.max(12, paperFrame.shadowStrength * 0.75)}px rgba(15,23,42,${Math.min(0.42, Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) / 180)})` : ""
                    ].filter(Boolean).join(", ") || "none"
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!layer.locked && layer.frameMode !== "adaptive") setCropModeLayerId(layer.id);
                  }}
                  onDragEnter={(event) => updateDropFeedback(event, "placeholder", layer.id)}
                  onDragOver={(event) => updateDropFeedback(event, "placeholder", layer.id)}
                  onDragLeave={(event) => leaveDropTarget(event, "placeholder", layer.id)}
                  onDrop={(event) => void handlePlaceholderDrop(event, layer)}
                  onPointerDown={(event) => beginDrag(event, layer, cropping ? "crop" : "move")}
                >
                  {dropFeedback?.target === "placeholder" && dropFeedback.layerId === layer.id && (
                    <div className={`placeholder-drop-label ${dropFeedback.valid ? "valid" : "invalid"}`}>
                      <Upload size={frameControlMetrics.iconSize} />
                      <span>{dropFeedback.label}</span>
                    </div>
                  )}
                  {paperActive && <FrameSurfaceTextureOverlay layer={layer} width={frame.width} height={frame.height} textureIntensity={expandedFrameTexture} customTextures={project.customTextures} />}
                  {polaroidWarmth && <span className="polaroid-warmth-overlay" style={{ backgroundColor: polaroidWarmth.color, opacity: polaroidWarmth.opacity }} />}
                  {tornPaperTexture && <span className="torn-paper-detail-overlay" style={{ backgroundImage: cssImageUrl(tornPaperTexture) }} />}
                  <div
                    className="placeholder-image-area"
                    style={{
                      left: insets.left,
                      top: insets.top,
                      width: innerWidth,
                      height: innerHeight,
                      borderRadius: paperActive ? (polaroidActive ? Math.max(0, polaroid.cornerRadius - Math.max(insets.left, insets.top)) : 0) : layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? 0 : roundedRadius,
                      backgroundColor: imageBackgroundColor(layer.effects.backgroundColor, image),
                      boxShadow: expandedInnerShadow ? `inset ${expandedInnerShadow}` : layer.effects.innerShadow ? "inset 0 0 22px rgba(15,23,42,.32)" : "none"
                    }}
                  >
                    {image ? (
                      <FramedImage
                        src={renderableLocalFileUrl(image.url)}
                        frameWidth={innerWidth}
                        frameHeight={innerHeight}
                        mode={layer.frameMode === "adaptive" ? "contain" : layer.cropMode}
                        alignment={layer.frameMode === "adaptive" ? "center" : layer.alignment}
                        crop={layer.frameMode === "adaptive" ? { offsetX: 0, offsetY: 0, zoom: 1 } : layer.crop}
                        filter={cssFilter(layer.effects.filters)}
                        imageTransform={imageTransform}
                        onNatural={(natural) => {
                          const previous = imageNaturalRef.current[layer.id];
                          imageNaturalRef.current[layer.id] = natural;
                          if (!previous || previous.width !== natural.width || previous.height !== natural.height) setNaturalImageVersion((value) => value + 1);
                        }}
                      />
                    ) : (
                      (() => {
                        const assignFont = clamp(Math.min(innerWidth * 0.12, innerHeight * 0.23), 10, Math.max(22, project.canvas.width * 0.018));
                        return <span className="assign-source-label" style={{ fontSize: `${assignFont}px` }}><ImagePlus size={Math.round(assignFont * 1.05)} /> Assign source</span>;
                      })()
                    )}
                    <span className={`texture-overlay surface-type-${layer.effects.paper.type}`} style={textureStyle(layer, project.customTextures)} />
                    {selected && polaroidActive && inspectorTab === "effects" && image && !cropping && (
                      <PolaroidDirectImageEditor
                        layer={layer}
                        effect={polaroid}
                        width={innerWidth}
                        height={innerHeight}
                        onBeginDrag={(event, mode) => beginPolaroidImageDrag(event, layer, polaroid, mode, {
                          left: insets.left,
                          top: insets.top,
                          width: innerWidth,
                          height: innerHeight
                        })}
                      />
                    )}
                  </div>
                  {polaroidActive && polaroid.caption.enabled && polaroid.caption.text && (
                    <div className={`polaroid-caption align-${polaroid.caption.alignment}`} style={{
                      left: polaroid.borderLeft,
                      right: polaroid.borderRight,
                      bottom: 0,
                      height: Math.max(polaroid.captionHeight, polaroid.borderBottom - polaroid.borderTop),
                      color: polaroid.caption.color,
                      fontFamily: polaroid.caption.fontFamily,
                      fontSize: polaroid.caption.fontSize,
                      fontWeight: polaroid.caption.fontWeight,
                      transform: `translate(${polaroid.caption.x}px, ${polaroid.caption.y}px)`
                    }}>{polaroid.caption.text}</div>
                  )}
                  {cropping && <span className="crop-mode-badge">CROP MODE</span>}
                </div>
                </React.Fragment>
              );
            })}
            </div>
            {project.layers.map((layer) => {
              if (layer.hidden || layer.locked || !selectedLayerIds.includes(layer.id)) return null;
              if (layer.objectKind === "text") {
                const metrics = adaptiveControlMetrics(layer.width, layer.height, project.canvas);
                return (
                  <div
                    key={`selection-${layer.id}`}
                    className="selection-handles-overlay"
                    style={{
                      left: layer.x,
                      top: layer.y,
                      width: layer.width,
                      height: layer.height,
                      transform: `rotate(${layer.rotation}deg)`,
                      ...adaptiveControlStyle(metrics)
                    }}
                  >
                    <SelectionHandles layer={layer} onBeginDrag={beginDrag} onDelete={() => deleteLayers([layer.id])} variant="text" iconSize={metrics.iconSize} />
                  </div>
                );
              }
              if (cropModeLayerId === layer.id) return null;
              const image = getImageForLayer(project, layer);
              const natural = imageNaturalRef.current[layer.id];
              const frame = measuredLayerFrame(layer, image, natural);
              const paperFrame = layer.effects.paperFrame ?? createDefaultPaperFrame();
              const polaroid = normalizePolaroidEffect(layer.effects.polaroid, paperFrame, layer.effects.innerShadow);
              const tornPaper = normalizeTornPaperEffect(layer.effects.tornPaper, paperFrame, layer.effects.innerShadow);
              const visualPaperActive = Boolean(image) && paperFrame.type !== "none";
              const expandedFrameRotation = visualPaperActive ? paperFrameRotation(paperFrame, polaroid) : 0;
              const frameControlMetrics = adaptiveControlMetrics(frame.width, frame.height, project.canvas);
              const frameControlStyle = adaptiveControlStyle(frameControlMetrics);
              return (
                <div
                  key={`selection-${layer.id}`}
                  className="selection-handles-overlay"
                  style={{
                    left: frame.x,
                    top: frame.y,
                    width: frame.width,
                    height: frame.height,
                    transform: `rotate(${layer.rotation + expandedFrameRotation}deg)`,
                    ...frameControlStyle
                  }}
                >
                  <SelectionHandles layer={layer} onBeginDrag={beginDrag} onDelete={() => deleteLayers([layer.id])} iconSize={frameControlMetrics.iconSize} />
                </div>
              );
            })}
            {guides.x !== undefined && <div className="guide vertical" style={{ left: guides.x }} />}
            {guides.y !== undefined && <div className="guide horizontal" style={{ top: guides.y }} />}
          </div>
          </div>
        </div>
      </section>

      <aside className={`sidebar right ${rightPanelOpen ? "" : "collapsed"}`}>
        <div className={`panel-tabs inspector-tabs ${selectedLayer ? "layer-inspector-tabs" : "settings-inspector-tabs"}`} role="tablist" aria-label="Inspector">
          {(selectedLayer
            ? (selectedLayer.objectKind === "text" ? ([ ["image", "Text"] ] as Array<[InspectorTab, string]>) : ([ ["image", "Image"], ["effects", "Effects"] ] as Array<[InspectorTab, string]>))
            : ([ ["settings", "Settings"] ] as Array<[InspectorTab, string]>))
            .map(([id, label]) => (
              <button key={id} className={inspectorTab === id ? "active" : ""} onClick={() => setInspectorTab(id)}>{label}</button>
            ))}
          <button className="icon-button panel-local-toggle tooltip-anchor" data-tooltip="Hide inspector" aria-label="Hide inspector" onClick={() => setRightPanelOpen(false)}><PanelRight size={16} /></button>
        </div>
        <div className="inspector-scroll-region">
        {!selectedLayer && inspectorTab === "settings" && (
          <>
            <CanvasDesignPanel
              canvas={project.canvas}
              customTextures={project.customTextures}
              onPatch={patchCanvas}
              onChooseBackground={() => void chooseBackground()}
              onClearBackground={clearBackgroundImage}
              onImportTexture={() => void importCustomTexture()}
              onRemoveTexture={(textureId) => void removeCustomTextureAsset(textureId)}
              onRevealTexture={(textureId) => void revealCustomTexture(textureId)}
              onResize={resizeCanvas}
              onPreset={setPreset}
            />
          </>
        )}
        <Properties
          layer={selectedLayer}
          canvas={project.canvas}
          activeTab={inspectorTab}
          sources={project.sources}
          onPatch={(patch) => patchSelectedLayer(patch)}
          onResetFrame={resetFrame}
          onMatchAspect={(layer) => void matchFrameToImage(layer)}
          onRegenerate={(layer) => {
            const selection = selectImageForLayer(project, layer, new Set<string>());
            if (!selection.imageId) return;
            patchLayer(layer.id, selection.layer);
          }}
          onStepImage={stepLayerImage}
        />
        </div>
      </aside>

      <SoftNumberNotice />
      <SourceImportDialog state={sourceImportDialog} />

      {pinterestDialog.open && (
        <PinterestDialog
          state={pinterestDialog}
          onChange={setPinterestDialog}
          onImport={() => void runPinterestImport("import")}
          onCancel={() => void cancelPinterestImport()}
          onClose={() => setPinterestDialog((current) => ({ ...current, open: false }))}
        />
      )}
      <RenameDialog state={renameState?.kind === "layer" ? undefined : renameState} onChange={setRenameState} onFinish={finishRename} />
      <ExportSetDialog
        state={exportSet}
        onChange={setExportSet}
        onChooseFolder={() => void chooseExportSetFolder()}
        onRun={() => void runExportSet()}
        onCancel={cancelExportSet}
        onCleanup={() => void cleanupWallpaperSets()}
        onReveal={(folderPath) => void revealWallpaperSet(folderPath)}
        onOpenSettings={() => void openMacOSWallpaperSettings()}
        onApplyPack={(folderPath, intervalSeconds) => void applyExportedWallpaperPack(folderPath, intervalSeconds)}
        onClose={() => setExportSet((current) => ({ ...current, open: false }))}
      />
      <GlobalTooltip />
    </main>
  );
}


function TemplateHome({
  project,
  templates,
  filter,
  onFilter,
  onCreate,
  onOpen,
  onApply,
  onDuplicate,
  onRename,
  onDelete,
  onToggleFavorite,
  onToggleRotation,
  onExportSet,
  onOpenProject,
  onSaveProject
}: {
  project: WallpaperProject;
  templates: WallpaperTemplate[];
  filter: TemplateFilter;
  onFilter: React.Dispatch<React.SetStateAction<TemplateFilter>>;
  onCreate: () => void;
  onOpen: (template: WallpaperTemplate) => void;
  onApply: (template: WallpaperTemplate) => void;
  onDuplicate: (template: WallpaperTemplate) => void;
  onRename: (template: WallpaperTemplate) => void;
  onDelete: (templateId: string) => void;
  onToggleFavorite: (template: WallpaperTemplate) => void;
  onToggleRotation: (template: WallpaperTemplate) => void;
  onExportSet: (template: WallpaperTemplate) => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
}) {
  const filterItems: Array<{ id: TemplateFilter; label: string }> = [
    { id: "all", label: "All Templates" },
    { id: "favorites", label: "Favorites" }
  ];

  return (
    <main className="template-home page-transition">
      <header className="home-header">
        <div className="home-brand">
          <img className="home-brand-mark pin-paper-mark" src={pinPaperIcon} alt="Pin Paper" />
          <div>
            <span className="home-kicker">PIN PAPER</span>
            <h1>Your templates</h1>
          </div>
        </div>
        <div className="home-header-actions">
          <button className="icon-button" title="Open project" onClick={onOpenProject}><FolderOpen size={17} /></button>
          <button className="icon-button" title="Save project" onClick={onSaveProject}><Save size={17} /></button>
          <button className="home-new-button" onClick={onCreate}><Plus size={17} /> New Template</button>
        </div>
      </header>

      <section className="home-hero">
        <div>
          <h2><span className="home-slogan">Wallpaper, made personal</span><small>Wallpapers made out of collections you love.</small></h2>
        </div>
      </section>

      <nav className="template-filter-bar" aria-label="Template views">
        {filterItems.map((item) => (
          <button key={item.id} className={filter === item.id ? "active" : ""} onClick={() => onFilter(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      <section className="template-gallery">
        {templates.length === 0 ? (
          <div className="template-empty-state">
            <Grid2X2 size={28} />
            <h3>No templates here yet</h3>
            <p>Create a blank template or switch to another view.</p>
            <button onClick={onCreate}><Plus size={16} /> New Template</button>
          </div>
        ) : templates.map((template) => (
          <article className="home-template-card" key={template.id} onClick={() => onOpen(template)}>
            <div className="home-template-preview-wrap">
              <TemplatePreview project={project} template={template} />
              <button
                className={`template-favorite ${template.favorite ? "active" : ""}`}
                title={template.favorite ? "Remove from favorites" : "Add to favorites"}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite(template);
                }}
              >
                <Star size={16} fill={template.favorite ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="home-template-copy">
              <div>
                <h3 title={template.name}>{template.name}</h3>
                <p><span>{template.project.canvas.width} × {template.project.canvas.height}</span><span>{template.project.layers.length} layers</span></p>
              </div>
              <time>{new Date(template.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
            </div>
            <div className="home-template-actions" onClick={(event) => event.stopPropagation()}>
              <button className="template-apply" onClick={() => onApply(template)}><Wallpaper size={15} /> Preview</button>
              <button onClick={() => onOpen(template)}>Edit</button>
              <button onClick={() => onDuplicate(template)}>Duplicate</button>
              <button onClick={() => onRename(template)}>Rename</button>
              <button onClick={() => onExportSet(template)}>Export Set</button>
              <button className="danger" onClick={() => onDelete(template.id)}>Delete</button>
            </div>
          </article>
        ))}
      </section>

    </main>
  );
}

function TemplatePreview({ project, template }: { project: WallpaperProject; template: WallpaperTemplate }) {
  const canvas = template.project.canvas;
  const [renderedPreview, setRenderedPreview] = useState<string | undefined>(template.thumbnailDataUrl);

  useEffect(() => {
    let canceled = false;
    const previewProject = normalizeProject(workspaceFromTemplate(project, template));
    renderProjectToDataUrl(previewProject, "png")
      .then((url) => {
        if (!canceled) setRenderedPreview(url);
      })
      .catch(() => {
        if (!canceled) setRenderedPreview(template.thumbnailDataUrl);
      });
    return () => { canceled = true; };
  }, [project.updatedAt, project.sources.length, template.id, template.updatedAt, template.thumbnailDataUrl, JSON.stringify(template.project.canvas), JSON.stringify(template.project.layers)]);

  return renderedPreview ? (
    <img
      className="home-template-image rendered-home-template-preview"
      src={renderedPreview}
      alt=""
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
    />
  ) : (
    <div
      className="generated-template-preview preview-render-pending"
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
    />
  );
}

function FramedImage({
  src,
  frameWidth,
  frameHeight,
  mode,
  alignment,
  crop,
  filter,
  imageTransform,
  onNatural
}: {
  src: string;
  frameWidth: number;
  frameHeight: number;
  mode: CropMode;
  alignment: ImageAlignment;
  crop: PlaceholderLayer["crop"];
  filter?: string;
  imageTransform?: { scale: number; x: number; y: number; rotation: number };
  onNatural?: (natural: { width: number; height: number }) => void;
}) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  function rememberNatural(image: HTMLImageElement) {
    const next = { width: image.naturalWidth, height: image.naturalHeight };
    setNatural(next);
    onNatural?.(next);
  }
  const placement = natural.width
    ? computeImagePlacement(natural.width, natural.height, frameWidth, frameHeight, mode, alignment, crop)
    : undefined;

  if (placement?.tile) {
    return (
      <div
        className="framed-image tiled-image"
        style={{
          backgroundImage: cssImageUrl(src),
          backgroundRepeat: "repeat",
          backgroundSize: `${placement.width}px ${placement.height}px`,
          backgroundPosition: `${placement.x}px ${placement.y}px`,
          filter,
          transform: imageTransform ? `translate(${imageTransform.x}px, ${imageTransform.y}px) rotate(${imageTransform.rotation}deg) scale(${imageTransform.scale})` : undefined,
          transformOrigin: "center"
        }}
      >
        <img className="image-dimension-probe" src={src} onLoad={(event) => rememberNatural(event.currentTarget)} />
      </div>
    );
  }

  return (
    <img
      src={src}
      className="framed-image"
      onLoad={(event) => rememberNatural(event.currentTarget)}
      style={placement ? {
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        filter,
        transform: imageTransform ? `translate(${imageTransform.x}px, ${imageTransform.y}px) rotate(${imageTransform.rotation}deg) scale(${imageTransform.scale})` : undefined,
        transformOrigin: "center"
      } : { opacity: 0 }}
    />
  );
}

function CanvasSurfaceOverlay({ canvas, customTextures }: { canvas: CanvasSettings; customTextures: WallpaperProject["customTextures"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paper = normalizeSurfaceEffect(canvas.backgroundPaper);
  const customTexture = paper.type === "custom"
    ? customTextures.find((texture) => texture.id === paper.customTextureId)
    : undefined;

  useEffect(() => {
    const target = canvasRef.current;
    if (!target || !surfaceEffectIsVisible(paper)) return;
    let canceled = false;
    let frame: number | undefined;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        void drawSurfacePreview(
          target,
          canvas.width,
          canvas.height,
          { ...paper, blendMode: "normal" },
          customTexture
        ).catch((error) => {
          if (!canceled) console.warn("Surface preview could not be rendered", error);
        });
      });
    }, 28);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [
    canvas.width,
    canvas.height,
    paper.enabled,
    paper.type,
    paper.intensity,
    paper.scale,
    paper.rotation,
    paper.opacity,
    paper.blendMode,
    paper.seed,
    paper.noise,
    paper.roughness,
    paper.tone,
    paper.customTextureId,
  ]);

  if (!surfaceEffectIsVisible(paper)) return null;
  return (
    <canvas
      ref={canvasRef}
      className={`canvas-surface-overlay surface-type-${paper.type}`}
      aria-hidden="true"
      style={{ width: canvas.width, height: canvas.height, mixBlendMode: paper.blendMode }}
    />
  );
}


function FrameSurfaceTextureOverlay({ layer, width, height, textureIntensity }: { layer: PlaceholderLayer; width: number; height: number; textureIntensity: number; customTextures: WallpaperProject["customTextures"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textureType: PaperTextureEffect["type"] = layer.effects.paper.enabled === false || layer.effects.paper.type === "none" ? "none" : layer.effects.paper.type === "crumpled-paper" ? "crumpled-paper" : "paper";
  const textureVisible = textureType !== "none" && textureIntensity > 0;
  const paper = normalizeSurfaceEffect({
    ...layer.effects.paper,
    enabled: textureVisible,
    type: textureVisible ? textureType : "none",
    customTextureId: undefined,
    intensity: textureVisible ? Math.max(textureType === "crumpled-paper" ? 100 : 92, textureIntensity) : 0,
    opacity: textureVisible ? Math.max(textureType === "crumpled-paper" ? 0.9 : 0.74, textureIntensity / 100) : 0,
    blendMode: "multiply",
    noise: textureVisible ? Math.max(layer.effects.paper.noise ?? 0, textureType === "crumpled-paper" ? 92 : 78) : 0,
    roughness: textureVisible ? Math.max(layer.effects.paper.roughness ?? 0, textureType === "crumpled-paper" ? 96 : 78) : 0,
    tone: textureVisible ? layer.effects.paper.tone || (textureType === "crumpled-paper" ? -4 : 6) : 0
  });

  useEffect(() => {
    const target = canvasRef.current;
    if (!target || !textureVisible || !surfaceEffectIsVisible(paper)) return;
    let canceled = false;
    let frame: number | undefined;
    frame = window.requestAnimationFrame(() => {
      void drawSurfacePreview(target, width, height, { ...paper, blendMode: "normal" }).catch((error) => {
        if (!canceled) console.warn("Frame texture preview could not be rendered", error);
      });
    });
    return () => {
      canceled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [
    width,
    height,
    paper.enabled,
    paper.type,
    paper.intensity,
    paper.scale,
    paper.rotation,
    paper.opacity,
    paper.blendMode,
    paper.seed,
    paper.noise,
    paper.roughness,
    paper.tone,
  ]);

  if (!textureVisible || !surfaceEffectIsVisible(paper)) return null;
  return <canvas ref={canvasRef} className={`paper-frame-texture surface-type-${paper.type}`} aria-hidden="true" style={{ width, height, mixBlendMode: "multiply" }} />;
}

function BackgroundImageView({ canvas }: { canvas: CanvasSettings }) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const showImage = canvas.backgroundBaseMode === "image" && Boolean(canvas.backgroundImage);
  const backgroundSrc = canvas.backgroundImage ? renderableLocalFileUrl(canvas.backgroundImage.url) : undefined;
  const placement = showImage && natural.width
    ? computeImagePlacement(
        natural.width,
        natural.height,
        canvas.width,
        canvas.height,
        canvas.backgroundMode,
        canvas.backgroundAlignment,
        { offsetX: canvas.backgroundOffsetX, offsetY: canvas.backgroundOffsetY, zoom: canvas.backgroundScale }
      )
    : undefined;
  const filter = `brightness(${canvas.backgroundBrightness}%) contrast(${canvas.backgroundContrast}%) blur(${canvas.backgroundBlur}px)`;
  return (
    <>
      {showImage && canvas.backgroundImage && (placement?.tile ? (
        <div
          className="canvas-background-image tiled-image"
          style={{
            backgroundImage: cssImageUrl(backgroundSrc),
            backgroundRepeat: "repeat",
            backgroundSize: `${placement.width}px ${placement.height}px`,
            backgroundPosition: `${placement.x}px ${placement.y}px`,
            filter,
            opacity: canvas.backgroundOpacity
          }}
        >
          <img className="image-dimension-probe" src={backgroundSrc} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        </div>
      ) : (
        <img
          className="canvas-background-image"
          src={backgroundSrc}
          onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          style={placement ? {
            left: placement.x,
            top: placement.y,
            width: placement.width,
            height: placement.height,
            filter,
            opacity: canvas.backgroundOpacity
          } : { opacity: 0 }}
        />
      ))}
      {canvas.backgroundTemperature !== 0 && <span className="canvas-background-temperature" style={{ backgroundColor: canvas.backgroundTemperature > 0 ? "#ff9b55" : "#5e8dff", opacity: Math.min(0.35, Math.abs(canvas.backgroundTemperature) / 280), mixBlendMode: "soft-light" }} />}
    </>
  );
}

function paperTextureBackground(paper: PaperTextureEffect, customTextures: WallpaperProject["customTextures"] = []) {
  if (paper.type === "none") return undefined;
  if (paper.type === "custom") {
    const texture = customTextures.find((item) => item.id === paper.customTextureId);
    return cssImageUrl(texture?.url);
  }
  const bundled = bundledSurfaceUrl(paper.type);
  if (bundled) return cssImageUrl(bundled);
  if (paper.type === "dust-scratches") {
    return "radial-gradient(circle at 20% 35%, rgba(30,25,20,.28) 0 .7px, transparent 1px), radial-gradient(circle at 72% 66%, rgba(255,255,255,.65) 0 .8px, transparent 1.2px)";
  }
  return "radial-gradient(circle, rgba(255,255,255,.82) 0 1px, transparent 1.2px), radial-gradient(circle at 70% 30%, rgba(40,32,26,.3) 0 .8px, transparent 1.1px)";
}

function cssFilter(filters: ImageFilters) {
  return [
    `brightness(${Math.max(0, filters.brightness + filters.exposure * 6 + filters.highlights * 0.8)}%)`,
    `contrast(${Math.max(0, filters.contrast - filters.shadows * 0.35)}%)`,
    `saturate(${Math.max(0, filters.saturation + filters.temperature * 0.35)}%)`,
    `sepia(${filters.sepia}%)`,
    `grayscale(${filters.grayscale}%)`,
    `blur(${filters.blur}px)`,
    `opacity(${Math.max(0, 100 - filters.fade)}%)`
  ].join(" ");
}

function textureStyle(layer: PlaceholderLayer, customTextures: WallpaperProject["customTextures"]): React.CSSProperties {
  const paper = layer.effects.paper;
  return {
    opacity: Math.max(paper.opacity, layer.effects.filters.grain / 100) * 0.55,
    mixBlendMode: paper.blendMode,
    backgroundImage: paperTextureBackground(paper, customTextures),
    backgroundSize: paper.type === "custom" ? `${Math.max(48, 220 * paper.scale)}px auto` : `${Math.max(96, 300 * paper.scale)}px ${Math.max(96, 300 * paper.scale)}px`,
    transform: `rotate(${paper.rotation}deg) scale(1.1)`
  };
}

function PolaroidDirectImageEditor({
  layer,
  effect,
  width,
  height,
  onBeginDrag
}: {
  layer: PlaceholderLayer;
  effect: PolaroidEffect;
  width: number;
  height: number;
  onBeginDrag: (event: PointerEvent, mode: PolaroidImageDragMode) => void;
}) {
  const visibleScale = Math.min(2.2, Math.max(.28, effect.imageScale));
  const editorWidth = Math.max(48, width * visibleScale);
  const editorHeight = Math.max(48, height * visibleScale);
  const start = (event: PointerEvent, mode: PolaroidImageDragMode) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    onBeginDrag(event, mode);
  };
  return (
    <div
      className="polaroid-direct-image-editor"
      aria-label={`Direct photo controls for ${layer.name}`}
      style={{
        left: width / 2 + effect.imageOffsetX - editorWidth / 2,
        top: height / 2 + effect.imageOffsetY - editorHeight / 2,
        width: editorWidth,
        height: editorHeight,
        transform: `rotate(${effect.imageRotation}deg)`
      }}
      onPointerDown={(event) => start(event, "move")}
    >
      <span className="polaroid-direct-image-hint">Drag photo</span>
      {(["nw", "ne", "se", "sw"] as const).map((corner) => (
        <button
          key={corner}
          type="button"
          className={`polaroid-image-scale-handle corner-${corner}`}
          aria-label={`Resize photo from ${corner.toUpperCase()} corner`}
          onPointerDown={(event) => start(event, "scale")}
        />
      ))}
      <button
        type="button"
        className="polaroid-image-rotate-handle"
        aria-label="Rotate photo"
        onPointerDown={(event) => start(event, "rotate")}
      ><RotateCw size={12} /></button>
    </div>
  );
}

function SelectionHandles({ layer, onBeginDrag, onDelete, variant, iconSize = 13 }: { layer: PlaceholderLayer; onBeginDrag: (event: PointerEvent, layer: PlaceholderLayer, mode: DragMode) => void; onDelete?: (event: React.PointerEvent<HTMLButtonElement>) => void; variant?: "text" | "frame"; iconSize?: number }) {
  const textMode = variant === "text" || layer.objectKind === "text";
  const handles: DragMode[] = textMode
    ? ["resize-nw", "resize-ne", "resize-se", "resize-sw", "resize-e", "resize-w"]
    : ["resize-nw", "resize-n", "resize-ne", "resize-e", "resize-se", "resize-s", "resize-sw", "resize-w"];
  function startControlDrag(event: PointerEvent, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    onBeginDrag(event, layer, mode);
  }
  return (
    <>
      {!textMode && <button className="rotate-handle" onPointerDown={(event) => startControlDrag(event, "rotate")} aria-label="Rotate"><RotateCw size={iconSize} /></button>}
      {onDelete && (
        <button
          type="button"
          className="selection-delete-handle"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            onDelete(event);
          }}
          aria-label="Delete"
        ><Trash2 size={iconSize} /></button>
      )}
      {handles.map((handle) => (
        <button key={handle} className={`resize-handle ${textMode ? "text-resize-handle" : ""} ${handle}`} onPointerDown={(event) => startControlDrag(event, handle)} aria-label={handle} />
      ))}
    </>
  );
}

function TextTopBar({ layer, onPatch }: { layer: PlaceholderLayer; onPatch: (patch: Partial<PlaceholderLayer>) => void }) {
  const fontSize = layer.fontSize ?? 72;
  const weight = layer.fontWeight ?? 800;
  const selectedFont = textFontOptions.some((font) => font.value === layer.fontFamily) ? layer.fontFamily : textFontOptions[0].value;
  return (
    <div className="context-toolbar compact-context-toolbar text-topbar" aria-label="Selected text quick controls">
      <select className="text-font-select" aria-label="Font" value={selectedFont} onChange={(event) => onPatch({ fontFamily: event.target.value })}>
        {textFontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
      </select>
      <div className="text-size-stepper" aria-label="Text size">
        <button aria-label="Decrease text size" onClick={() => { const next = Math.max(8, fontSize - 4); onPatch({ fontSize: next, height: estimateTextLayerHeight({ text: layer.text, fontSize: next, lineHeight: layer.lineHeight }) }); }}>−</button>
        <span>{Math.round(fontSize)}</span>
        <button aria-label="Increase text size" onClick={() => { const next = Math.min(420, fontSize + 4); onPatch({ fontSize: next, height: estimateTextLayerHeight({ text: layer.text, fontSize: next, lineHeight: layer.lineHeight }) }); }}>+</button>
      </div>
      <label className="text-color-control full-color-control" title="Text color"><input type="color" value={layer.textColor ?? "#26313a"} onChange={(event) => onPatch({ textColor: event.target.value })} /></label>
      <button className={weight >= 800 ? "active" : ""} onClick={() => onPatch({ fontWeight: weight >= 800 ? 600 : 850 })}>B</button>
      <button onClick={() => onPatch({ textAlign: layer.textAlign === "left" ? "center" : layer.textAlign === "center" ? "right" : "left" })}>{layer.textAlign === "left" ? "⫷" : layer.textAlign === "right" ? "⫸" : "☰"}</button>
    </div>
  );
}

function ContextToolbar({
  layer,
  onPatch,
  onCrop,
  onDuplicate,
  onOrder
}: {
  layer: PlaceholderLayer;
  onPatch: (patch: Partial<PlaceholderLayer>) => void;
  onCrop: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOrder: (action: "front" | "back" | "forward" | "backward") => void;
}) {
  return (
    <div className="context-toolbar compact-context-toolbar" aria-label="Selected image quick controls">
      <div className="context-toolbar-button-group crop-actions" aria-label="Image fit controls">
        <button className={layer.cropMode === "cover" && layer.frameMode !== "adaptive" ? "active" : ""} disabled={layer.locked || layer.frameMode === "adaptive"} onClick={() => onPatch({ cropMode: "cover" })}>Fill</button>
        <button className={layer.frameMode === "adaptive" || layer.cropMode === "contain" ? "active" : ""} disabled={layer.locked || layer.frameMode === "adaptive"} onClick={() => onPatch({ cropMode: "contain" })}>Fit</button>
        <button disabled={layer.locked || layer.frameMode === "adaptive"} onClick={onCrop}>Crop</button>
      </div>
      <label className="mini-slider">Zoom<input disabled={layer.locked || layer.frameMode === "adaptive"} type="range" min="0.5" max="3" step="0.05" value={layer.frameMode === "adaptive" ? 1 : layer.crop.zoom} onChange={(event) => onPatch({ crop: { ...layer.crop, zoom: Number(event.target.value) } })} /></label>
      <div className="context-toolbar-button-group layer-actions" aria-label="Layer controls">
        <button className="icon-button tooltip-anchor" data-tooltip="Move layer up" aria-label="Move layer up" disabled={layer.locked} onClick={() => onOrder("forward")}><LayerOrderIcon direction="up" /></button>
        <button className="icon-button tooltip-anchor" data-tooltip="Move layer down" aria-label="Move layer down" disabled={layer.locked} onClick={() => onOrder("backward")}><LayerOrderIcon direction="down" /></button>
        <button className="icon-button tooltip-anchor" data-tooltip="Duplicate layer" aria-label="Duplicate layer" disabled={layer.locked} onClick={onDuplicate}><Copy size={15} /></button>
      </div>
    </div>
  );
}

function CropToolbar({
  layer,
  onPatch,
  onDone
}: {
  layer: PlaceholderLayer;
  onPatch: (patch: Partial<PlaceholderLayer>) => void;
  onDone: () => void;
}) {
  return (
    <div className="context-toolbar crop-toolbar">
      <strong>CROP MODE</strong>
      <button className="primary-action" onClick={onDone}>Done</button>
      <button onClick={() => onPatch({ crop: { offsetX: 0, offsetY: 0, zoom: 1 }, alignment: "center" })}>Reset</button>
      <button onClick={() => onPatch({ cropMode: "cover" })}>Fill</button>
      <button onClick={() => onPatch({ cropMode: "contain" })}>Fit</button>
      <label className="mini-slider">Zoom<input type="range" min="0.5" max="3" step="0.05" value={layer.crop.zoom} onChange={(event) => onPatch({ crop: { ...layer.crop, zoom: Number(event.target.value) } })} /></label>
    </div>
  );
}

function LayerOrderIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="layer-order-icon clear-layer-order-icon">
      <path d="M3 12.25 8.2 15l5.2-2.75" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
      <path d="M3 8.7 8.2 11.45 13.4 8.7" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" opacity="0.68" />
      <path d="M3 5.15 8.2 7.9l5.2-2.75-5.2-2.75L3 5.15Z" fill="currentColor" opacity="0.78" />
      {direction === "up"
        ? <path d="M14.35 14.6V8.7M14.35 8.7l-2.05 2.05M14.35 8.7l2.05 2.05" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M14.35 8.2v5.9M14.35 14.1l-2.05-2.05M14.35 14.1l2.05-2.05" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function LayerContextMenu({
  state,
  layer,
  selectionCount,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onOrder
}: {
  state: LayerMenuState;
  layer?: PlaceholderLayer;
  selectionCount: number;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOrder: (action: LayerOrderAction) => void;
}) {
  if (!layer) return null;
  const label = selectionCount > 1 ? `${selectionCount} layers` : layer.name;
  return (
    <>
      <button className="context-scrim" aria-label="Close layer menu" onClick={onClose} />
      <div className="layer-context-menu popover-menu" style={{ left: state.x, top: state.y }}>
        <span className="context-menu-label">{label}</span>
        <button onClick={onRename} disabled={selectionCount > 1}><PencilLine size={15} /> Rename</button>
        <button onClick={() => onOrder("front")}><BringToFront size={15} /> Bring to Front</button>
        <button onClick={() => onOrder("forward")}><LayerOrderIcon direction="up" /> Bring Forward</button>
        <button onClick={() => onOrder("backward")}><LayerOrderIcon direction="down" /> Send Backward</button>
        <button onClick={() => onOrder("back")}><SendToBack size={15} /> Send to Back</button>
        <button onClick={onDuplicate}><Copy size={15} /> Duplicate</button>
      </div>
    </>
  );
}

function SourceContextMenu({
  state,
  source,
  onClose,
  onRename,
  onRescan,
  onShow,
  onRemove,
  onDeleteCache,
  onCopyPath
}: {
  state: SourceMenuState;
  source?: ImageSource;
  onClose: () => void;
  onRename: (source: ImageSource) => void;
  onRescan: (source: ImageSource) => void;
  onShow: (source: ImageSource) => void;
  onRemove: (source: ImageSource) => void;
  onDeleteCache: (source: ImageSource) => void;
  onCopyPath: (source: ImageSource) => void;
}) {
  if (!source) return null;
  return (
    <>
      <button className="context-scrim" aria-label="Close source menu" onClick={onClose} />
      <div className="source-context-menu popover-menu" style={{ left: state.x, top: state.y }}>
        <button onClick={() => { onRename(source); onClose(); }}>Rename</button>
        <button onClick={() => { onRescan(source); onClose(); }}>{source.type === "pinterest-board" ? "Refresh" : "Rescan"}</button>
        <button onClick={() => { onShow(source); onClose(); }}>Show in Folder</button>
        {(source.path || source.cachePath) && <button onClick={() => { onCopyPath(source); onClose(); }}>Copy Folder Path</button>}
        {source.cachePath && <button onClick={() => { onDeleteCache(source); onClose(); }}>Delete Cached Files</button>}
        <button className="danger" onClick={() => onRemove(source)}>Remove Source</button>
      </div>
    </>
  );
}

function RenameDialog({
  state,
  onChange,
  onFinish
}: {
  state?: RenameState;
  onChange: React.Dispatch<React.SetStateAction<RenameState | undefined>>;
  onFinish: (save: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state) return;
    window.setTimeout(() => inputRef.current?.select(), 0);
  }, [state?.kind, state?.id]);
  if (!state) return null;
  const label = state.kind === "template" ? "Rename template" : state.kind === "source" ? "Rename source" : "Rename item";
  return (
    <div className="modal-backdrop rename-backdrop" onMouseDown={() => onFinish(true)}>
      <section className="modal rename-modal" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{label}</h2>
        <input
          ref={inputRef}
          value={state.value}
          onChange={(event) => onChange({ ...state, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onFinish(true);
            if (event.key === "Escape") onFinish(false);
          }}
        />
        <div className="dialog-actions">
          <button className="pill-button primary" onClick={() => onFinish(true)}>Save</button>
          <button className="pill-button" onClick={() => onFinish(false)}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function ExportSetDialog({
  state,
  onChange,
  onChooseFolder,
  onRun,
  onCancel,
  onCleanup,
  onReveal,
  onOpenSettings,
  onApplyPack,
  onClose
}: {
  state: ExportSetState;
  onChange: React.Dispatch<React.SetStateAction<ExportSetState>>;
  onChooseFolder: () => void;
  onRun: () => void;
  onCancel: () => void;
  onCleanup: () => void;
  onReveal: (folderPath?: string) => void;
  onOpenSettings: () => void;
  onApplyPack: (folderPath?: string, intervalSeconds?: number) => void;
  onClose: () => void;
}) {
  if (!state.open) return null;
  const totalFinished = state.completed + state.failed;
  const progress = Math.min(100, (totalFinished / Math.max(1, state.count)) * 100);
  const ready = Boolean(state.finalPath);
  return (
    <div className="modal-backdrop" onMouseDown={() => !state.busy && onClose()}>
      <section className={`modal export-set-modal ${ready ? "setup-mode wallpaper-ready-modal" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title-row">
          <div>
            <h2>{ready ? platformCopy.wallpaperSetReadyTitle : platformCopy.createWallpaperSet}</h2>
          </div>
          <button className="button ghost" disabled={state.busy} onClick={onClose}>Close</button>
        </div>

        {ready && state.finalPath ? (
          <div className="wallpaper-ready-layout">
            <section className="wallpaper-ready-main">
              <div className="wallpaper-set-path-card">
                <span>{platformCapabilities.canOpenWallpaperSettings ? "Folder to select" : "Pack folder"}</span>
                <code>{state.finalPath}</code>
                <button className="button ghost" onClick={() => {
                  if (!state.finalPath) return;
                  if (window.wallpaperApi?.copyText) void window.wallpaperApi.copyText(state.finalPath);
                  else void navigator.clipboard?.writeText(state.finalPath).catch(() => undefined);
                }}>Copy Folder Path</button>
              </div>

              {platformCapabilities.canOpenWallpaperSettings ? (
                <>
                  <div className="wallpaper-setup-steps" aria-label="Wallpaper setup instructions">
                    <div className="wallpaper-setup-step"><span className="setup-step-number">1</span><strong>{platformCopy.openWallpaperSettings}</strong></div>
                    <div className="wallpaper-setup-step"><span className="setup-step-number">2</span><strong>Click Add Folder or Album, then Choose Folder</strong></div>
                    <div className="wallpaper-setup-step"><span className="setup-step-number">3</span><strong>Select the Pin Paper Sets folder on your Desktop</strong></div>
                    <div className="wallpaper-setup-step"><span className="setup-step-number">4</span><strong>Turn on Shuffle and Show on all Spaces</strong></div>
                  </div>

                  <div className="wallpaper-setup-actions">
                    <button className="button secondary" onClick={() => onReveal(state.finalPath)}>{platformCopy.showSetInFileManager}</button>
                    <button className="button primary" onClick={onOpenSettings}>{platformCopy.openWallpaperSettings}</button>
                  </div>
                </>
              ) : (
                <>
                  {currentPlatform.kind === "windows" && platformCapabilities.canApplyWallpaper && (
                    <div className="export-set-grid simplified windows-rotation-options">
                      <label>Time between images (seconds)<SoftNumberInput value={state.windowsCycleSeconds} min={5} max={86400} disabled={state.busy} onCommit={(seconds) => onChange((current) => ({ ...current, windowsCycleSeconds: clamp(Math.round(seconds), 5, 86400) }))} /></label>
                    </div>
                  )}
                  <div className="wallpaper-setup-actions">
                    {currentPlatform.kind === "windows" && platformCapabilities.canApplyWallpaper && (
                      <button className="button primary" onClick={() => onApplyPack(state.finalPath, state.windowsCycleSeconds)}>Start Rotation on All Desktops</button>
                    )}
                    <button className={currentPlatform.kind === "windows" && platformCapabilities.canApplyWallpaper ? "button secondary" : "button primary"} onClick={() => onReveal(state.finalPath)}>{platformCopy.showSetInFileManager}</button>
                  </div>
                </>
              )}
            </section>
            <div className="dialog-actions wallpaper-ready-actions">
              <button className="button secondary" onClick={() => onChange((current) => ({
                ...current,
                finalPath: undefined,
                firstFilePath: undefined,
                completed: 0,
                failed: 0,
                error: undefined
              }))}>Back to Set Options</button>
              <button className="button ghost" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="export-set-grid simplified">
              <label>Set name<input value={state.setName} maxLength={100} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, setName: event.target.value }))} placeholder="My Wallpaper Rotation" /></label>
              <label>Image variation count<SoftNumberInput value={state.count} min={1} max={500} disabled={state.busy} onCommit={(count) => onChange((current) => ({ ...current, count: clamp(Math.round(count), 1, 500) }))} /></label>
              {currentPlatform.kind === "windows" && <label>Time between images (seconds)<SoftNumberInput value={state.windowsCycleSeconds} min={5} max={86400} disabled={state.busy} onCommit={(seconds) => onChange((current) => ({ ...current, windowsCycleSeconds: clamp(Math.round(seconds), 5, 86400) }))} /></label>}
            </div>

            <details className="advanced-wallpaper-set-options">
              <summary><ChevronRight size={14} /> More options</summary>
              <div className="destination-row wallpaper-set-destination">
                <div>
                  <strong>Save location</strong>
                  <span title={state.destinationPath}>{state.destinationPath ?? "Loading default Pictures folder…"}</span>
                </div>
                <div className="destination-actions">
                  <button className="button secondary" disabled={state.busy} onClick={onChooseFolder}>Choose</button>
                  <button className="button ghost" disabled={!state.destinationPath || state.busy} onClick={() => onReveal(state.destinationPath)}>Open</button>
                  {platformCapabilities.canCleanNativeWallpaperSets && <button className="button destructive" disabled={state.busy || state.cleanupBusy} onClick={onCleanup}>{state.cleanupBusy ? "Inspecting…" : "Clean Up Folder…"}</button>}
                </div>
              </div>

            </details>

            {(state.busy || totalFinished > 0) && <>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
              <div className="export-summary"><span>{state.completed} of {state.count} generated</span><span>{state.failed} failed</span></div>
            </>}
            {state.error && <p className="dialog-error">{state.error}</p>}

            <div className="dialog-actions">
              {state.busy
                ? <button className="button destructive" onClick={onCancel}>Cancel and Remove Temporary Files</button>
                : <button className="button primary" onClick={onRun}>{`Create ${Math.max(1, Math.round(state.count))} Wallpapers`}</button>}
              {!state.busy && <button className="button ghost" onClick={onClose}>Cancel</button>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SourceImportDialog({ state }: { state: SourceImportDialogState }) {
  if (!state.open) return null;
  const hasProgress = typeof state.current === "number" && typeof state.total === "number" && state.total > 0;
  const progress = hasProgress ? clamp((state.current! / Math.max(1, state.total!)) * 100, 0, 100) : undefined;
  return (
    <div className="modal-backdrop source-import-backdrop" role="status" aria-busy="true">
      <section className="modal source-import-modal">
        <div className="source-import-spinner" aria-hidden="true" />
        <div className="modal-title-copy">
          <h2>{state.title}</h2>
          <p>{state.message}</p>
        </div>
        <div className={`progress-track ${hasProgress ? "" : "indeterminate"}`}><span style={hasProgress ? { width: `${progress}%` } : undefined} /></div>
        {hasProgress && <div className="import-stats"><span>{state.current} / {state.total}</span></div>}
        <small>Large folders and HEIC conversion can take a bit. Keep Pin Paper open while this finishes.</small>
      </section>
    </div>
  );
}

function PinterestDialog({
  state,
  onChange,
  onImport,
  onCancel,
  onClose
}: {
  state: PinterestDialogState;
  onChange: React.Dispatch<React.SetStateAction<PinterestDialogState>>;
  onImport: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal import-modal">
        <div className="modal-title-row import-title-row">
          <div className="modal-title-copy">
            <h2>Import Pinterest Board</h2>
            <p>Paste a public board URL. Cached locally for offline rotation.</p>
          </div>
          <button className="button secondary import-dialog-close-button" onClick={state.busy ? onCancel : onClose}>{state.busy ? "Stop Import" : "Close"}</button>
        </div>
        <label>Pinterest board URL<input value={state.url} onChange={(event) => onChange((current) => ({ ...current, url: event.target.value }))} placeholder="https://www.pinterest.com/user/board-name/" /></label>
        <div className="dialog-actions">
          <button className="pill-button primary" disabled={state.busy} onClick={onImport}>Import Board</button>
        </div>
        <div className="progress-track"><span style={{ width: `${state.progress}%` }} /></div>
        <div className="import-stats">
          <span>{state.stage === "complete" ? state.imagesCached : state.current ?? state.imagesFound}{state.stage !== "complete" && state.total ? ` / ${state.total}` : ""} pins discovered</span>
          <span>{state.imagesCached} cached</span>
          {state.stage && <span className={`import-stage ${state.stage}`}>{state.stage}</span>}
        </div>
        {state.stage === "complete" && !state.error && (
          <div className="pinterest-complete-card">
            <strong>Import complete</strong>
            <p>{state.imagesCached} image{state.imagesCached === 1 ? "" : "s"} cached and ready to use.</p>
            <div className="dialog-actions"><button className="pill-button primary" onClick={onClose}>Done</button></div>
          </div>
        )}
        {state.error && state.stage !== "partial" && (
          <div className="pinterest-error">
            <strong>{state.stage === "canceled" ? "Pinterest import stopped" : "Pinterest import unavailable"}</strong>
            <p>{state.error}</p>
            <div className="dialog-actions">
              <button className="pill-button primary" disabled={state.busy} onClick={onImport}>{state.stage === "canceled" ? "Resume Import" : "Retry"}</button>
              <button className="pill-button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function WallpaperPanel({ project }: { project: WallpaperProject }) {
  return (
    <section className="panel wallpaper-panel settings-section rotation-guide-panel">
      <details open>
        <summary>Wallpaper Rotation <ChevronDown size={15} /></summary>
        <div className="rotation-guide-card">
          {platformCapabilities.canUseMacSpaces ? <strong>Use macOS to rotate exported sets</strong> : <strong>{platformCopy.rotationGuideTitle}</strong>}
          <p>{platformCopy.rotationGuideBody}</p>
          <ol>
            {platformCapabilities.canUseMacSpaces ? <li>Click <b>Create Wallpaper Set</b>.</li> : <li>Click <b>{platformCopy.createWallpaperSet}</b>.</li>}
            <li>Generate the set.</li>
            {platformCapabilities.canOpenWallpaperSettings && <li>Choose the Desktop Pin Paper Sets folder.</li>}
            {platformCapabilities.canUseMacSpaces && <li>Turn on Shuffle and Show on all Spaces.</li>}
          </ol>
        </div>
        {project.wallpaper.lastError && <p className="status-error">{project.wallpaper.lastError}</p>}
      </details>
    </section>
  );
}

function CanvasDesignPanel({
  canvas,
  customTextures,
  onPatch,
  onChooseBackground,
  onClearBackground,
  onImportTexture,
  onRemoveTexture,
  onRevealTexture,
  onResize,
  onPreset
}: {
  canvas: CanvasSettings;
  customTextures: WallpaperProject["customTextures"];
  onPatch: (patch: Partial<CanvasSettings>) => void;
  onChooseBackground: () => void;
  onClearBackground: () => void;
  onImportTexture: () => void;
  onRemoveTexture: (textureId: string) => void;
  onRevealTexture: (textureId: string) => void;
  onResize: (width: number, height: number, mode: CanvasResizeMode) => void;
  onPreset: (id: string, mode: CanvasResizeMode) => void;
}) {
  const [draftWidth, setDraftWidth] = useState(canvas.width);
  const [draftHeight, setDraftHeight] = useState(canvas.height);
  const [resizeMode, setResizeMode] = useState<CanvasResizeMode>("scale");
  const [lockAspect, setLockAspect] = useState(true);
  const aspect = canvas.width / Math.max(1, canvas.height);

  useEffect(() => { setDraftWidth(canvas.width); setDraftHeight(canvas.height); }, [canvas.width, canvas.height]);
  function applyCanvasSize(width: number, height: number, mode = resizeMode) {
    const nextWidth = Math.max(64, Math.round(width));
    const nextHeight = Math.max(64, Math.round(height));
    setDraftWidth(nextWidth);
    setDraftHeight(nextHeight);
    onResize(nextWidth, nextHeight, mode);
  }
  function changeWidth(value: number) {
    const width = Math.max(64, value);
    const height = lockAspect ? Math.max(64, Math.round(width / aspect)) : draftHeight;
    applyCanvasSize(width, height);
  }
  function changeHeight(value: number) {
    const height = Math.max(64, value);
    const width = lockAspect ? Math.max(64, Math.round(height * aspect)) : draftWidth;
    applyCanvasSize(width, height);
  }
  function patchPaper(patch: Partial<PaperTextureEffect>) { onPatch({ backgroundPaper: { ...canvas.backgroundPaper, ...patch } }); }

  const surfaces = bundledSurfaceChoices;
  const surface = normalizeSurfaceEffect(canvas.backgroundPaper);

  function setSurfaceEnabled(enabled: boolean) {
    if (!enabled) {
      patchPaper({ enabled: false });
      return;
    }
    const targetType = surface.type === "none" ? "paper" : surface.type;
    patchPaper({
      enabled: true,
      type: targetType,
      ...(surface.type === "none" ? surfaceDefaultsForType(targetType) : undefined)
    });
  }

  function selectSurface(type: PaperTextureEffect["type"], customTextureId?: string) {
    if (type === "none") {
      patchPaper({ enabled: false, type: "none", customTextureId: undefined });
      return;
    }
    patchPaper({
      ...surfaceDefaultsForType(type),
      enabled: true,
      type,
      customTextureId,
      seed: surface.seed
    });
  }

  function resetSurface() {
    if (surface.type === "none") return;
    patchPaper({
      ...(surfaceDefaultsForType(surface.type) ?? {}),
      enabled: true,
      type: surface.type,
      customTextureId: surface.type === "custom" ? surface.customTextureId : undefined,
      seed: 1
    });
  }

  return (
    <section className="panel canvas-design-panel settings-section">
      <details>
        <summary>Canvas <ChevronDown size={15} /></summary>
        <label>Preset<select value={canvas.presetId} onChange={(event) => onPreset(event.target.value, resizeMode)}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <div className="two-col"><label>Width<SoftNumberInput value={draftWidth} min={64} onCommit={changeWidth} /></label><label>Height<SoftNumberInput value={draftHeight} min={64} onCommit={changeHeight} /></label></div>
        <label>Resize content<select value={resizeMode} onChange={(event) => { const mode = event.target.value as CanvasResizeMode; setResizeMode(mode); onResize(draftWidth, draftHeight, mode); }}><option value="scale">Scale proportionally</option><option value="center">Center content</option><option value="keep">Keep position</option></select></label>
        <div className="compact-action-row three-up">
          <button className={lockAspect ? "button selected" : "button secondary"} onClick={() => setLockAspect((value) => !value)}>Lock Ratio</button>
          <button className="button secondary" onClick={() => applyCanvasSize(canvas.height, canvas.width)}>Swap</button>
          <button className="button secondary" onClick={() => { const ratio = window.devicePixelRatio || 1; applyCanvasSize(Math.round(window.screen.width * ratio), Math.round(window.screen.height * ratio)); }}>Use Current</button>
        </div>
      </details>

      <details open>
        <summary>Background <ChevronDown size={15} /></summary>
        <div className="segmented-control two-options" role="group" aria-label="Background base">
          <button className={canvas.backgroundBaseMode === "color" ? "active" : ""} onClick={() => onPatch({ backgroundBaseMode: "color", backgroundTransparent: false })}>Color</button>
          <button className={canvas.backgroundBaseMode === "image" ? "active" : ""} onClick={() => canvas.backgroundImage ? onPatch({ backgroundBaseMode: "image", backgroundTransparent: false }) : onChooseBackground()}>Image</button>
        </div>
        {canvas.backgroundBaseMode === "color" && <label className="color-input-only" aria-label="Background color"><input type="color" value={canvas.backgroundColor} onChange={(event) => onPatch({ backgroundColor: event.target.value, backgroundTransparent: false })} /></label>}
        {canvas.backgroundBaseMode === "image" && <>
          <div className="compact-action-row"><button className="button secondary" onClick={onChooseBackground}><ImagePlus size={15} /> {canvas.backgroundImage ? "Replace" : "Choose"}</button><button className="button ghost" disabled={!canvas.backgroundImage} onClick={onClearBackground}>Remove</button></div>
          <label>Fit<select value={canvas.backgroundMode} onChange={(event) => onPatch({ backgroundMode: event.target.value as CanvasSettings["backgroundMode"] })}><option value="cover">Fill</option><option value="contain">Fit</option><option value="stretch">Stretch</option><option value="original">Original</option><option value="center">Center</option><option value="tile">Tile</option></select></label>
          <FilterSlider label="Opacity" value={canvas.backgroundOpacity} min={0} max={1} step={0.05} onChange={(value) => onPatch({ backgroundOpacity: value })} />
        </>}
      </details>

      <details open>
        <summary>Surface <ChevronDown size={15} /></summary>
        <div className="texture-picker-grid compact-texture-grid">
          {surfaces.map((choice) => (
            <button
              key={choice.type}
              className={(choice.type === "none" ? !surface.enabled || surface.type === "none" : surface.enabled && surface.type === choice.type) ? "texture-choice active" : "texture-choice"}
              onClick={() => selectSurface(choice.type)}
            >
              <span>{choice.label}</span>
            </button>
          ))}
          {customTextures.map((texture) => (
            <div className={surface.enabled && surface.type === "custom" && surface.customTextureId === texture.id ? "texture-choice custom active" : "texture-choice custom"} key={texture.id}>
              <button onClick={() => selectSurface("custom", texture.id)}>
                <span>{texture.name}</span>
              </button>
              <div className="texture-actions"><button onClick={() => onRemoveTexture(texture.id)}>Remove</button></div>
            </div>
          ))}
        </div>
        <button className="button secondary full-width surface-import-button" onClick={onImportTexture}>Import Custom Surface</button>
        {surface.enabled && surface.type !== "none" && (
          <div className="surface-controls">
            <FilterSlider label="Opacity" value={surface.opacity} min={0} max={1} step={.02} onChange={(value) => patchPaper({ opacity: value, intensity: 100 })} />
            <FilterSlider label="Scale" value={surface.scale} min={.2} max={5} step={.05} onChange={(value) => patchPaper({ scale: value })} />
            <FilterSlider label="Noise / grain" value={surface.noise} min={0} max={100} onChange={(value) => patchPaper({ noise: value })} />
            <FilterSlider label="Roughness" value={surface.roughness} min={0} max={100} onChange={(value) => patchPaper({ roughness: value })} />
            <FilterSlider label="Light / dark" value={surface.tone} min={-100} max={100} onChange={(value) => patchPaper({ tone: value })} />
            <FilterSlider label="Rotation" value={surface.rotation} min={-180} max={180} step={1} onChange={(value) => patchPaper({ rotation: value })} />
            <label>Blend mode<select value={surface.blendMode} onChange={(event) => patchPaper({ blendMode: event.target.value as PaperTextureEffect["blendMode"] })}><option value="normal">No blend</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft Light</option></select></label>
            <div className="surface-action-row">
              <button className="button ghost compact" onClick={resetSurface}>Reset Surface</button>
              <button className="button secondary compact" onClick={() => patchPaper({ seed: nextSurfaceSeed(surface.seed) })}><RefreshCcw size={14} /> Regenerate Texture</button>
            </div>
          </div>
        )}
      </details>

    </section>
  );
}

const alignmentOptions: Array<[ImageAlignment, string]> = [
  ["center", "Center"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"],
  ["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]
];

function Properties({
  layer,
  canvas,
  activeTab,
  sources,
  onPatch,
  onRegenerate,
  onStepImage,
  onResetFrame,
  onMatchAspect
}: {
  layer?: PlaceholderLayer;
  canvas: CanvasSettings;
  activeTab: InspectorTab;
  sources: ImageSource[];
  onPatch: (patch: Partial<PlaceholderLayer>) => void;
  onRegenerate: (layer: PlaceholderLayer) => void;
  onStepImage: (layer: PlaceholderLayer, direction: "previous" | "next") => void;
  onResetFrame: (layer: PlaceholderLayer) => void;
  onMatchAspect: (layer: PlaceholderLayer) => void;
}) {
  if (!layer) return null;
  const activeLayer = layer;
  const sourceId = layer.sourceState.sourceIds[0] ?? layer.sourceId;
  const source = sources.find((item) => item.id === sourceId);
  const imageChoiceCount = (layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : sourceId ? [sourceId] : [])
    .flatMap((id) => {
      const item = sources.find((sourceItem) => sourceItem.id === id);
      return item ? sourceImagesForPolicy(item) : [];
    })
    .length;

  if (layer.locked) {
    return <section className="panel muted-panel"><h2>{layer.name}</h2><p>This layer is locked. Use the lock control on the canvas to edit it.</p></section>;
  }

  function numeric<K extends keyof PlaceholderLayer>(key: K) {
    return (event: React.ChangeEvent<HTMLInputElement>) => onPatch({ [key]: Number(event.target.value) } as Partial<PlaceholderLayer>);
  }

  if (layer.objectKind === "text") {
    return (
      <section className="panel properties text-properties">
        <details open>
          <summary>Text <ChevronDown size={15} /></summary>
          <label>Content<textarea value={layer.text ?? "Text"} rows={4} onChange={(event) => { const text = event.target.value; onPatch({ text, height: estimateTextLayerHeight({ text, fontSize: layer.fontSize, lineHeight: layer.lineHeight }) }); }} /></label>
          <div className="two-col">
            <label>Font<select value={textFontOptions.some((font) => font.value === layer.fontFamily) ? layer.fontFamily : textFontOptions[0].value} onChange={(event) => onPatch({ fontFamily: event.target.value })}>{textFontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
            <label>Size<SoftNumberInput value={layer.fontSize ?? 72} min={8} max={400} onCommit={(value) => { const fontSize = Math.round(value); onPatch({ fontSize, height: estimateTextLayerHeight({ text: layer.text, fontSize, lineHeight: layer.lineHeight }) }); }} /></label>
            <label>Weight<SoftNumberInput value={layer.fontWeight ?? 800} min={100} max={900} step={100} onCommit={(value) => onPatch({ fontWeight: Math.round(value) })} /></label>
            <label>Color<input type="color" value={layer.textColor ?? "#26313a"} onChange={(event) => onPatch({ textColor: event.target.value })} /></label>
            <label>Align<select value={layer.textAlign ?? "center"} onChange={(event) => onPatch({ textAlign: event.target.value as PlaceholderLayer["textAlign"] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          </div>
          <FilterSlider label="Opacity" value={layer.opacity} min={0} max={1} step={.05} onChange={(value) => onPatch({ opacity: value })} />
        </details>
        <details open>
          <summary>Frame Position <ChevronDown size={15} /></summary>
          <div className="two-col"><label>X<input type="number" value={Math.round(layer.x)} onChange={numeric("x")} /></label><label>Y<input type="number" value={Math.round(layer.y)} onChange={numeric("y")} /></label><label>Width<SoftNumberInput value={Math.round(layer.width)} min={16} onCommit={(value) => onPatch({ width: Math.round(value) })} /></label><label>Height<SoftNumberInput value={Math.round(layer.height)} min={16} onCommit={(value) => onPatch({ height: Math.round(value) })} /></label></div>
          <FilterSlider label="Rotation" value={layer.rotation} min={-180} max={180} onChange={(value) => onPatch({ rotation: value })} />
        </details>
      </section>
    );
  }
  function patchFilters(patch: Partial<ImageFilters>) { onPatch({ effects: { ...activeLayer.effects, filters: { ...activeLayer.effects.filters, ...patch } } }); }
  function patchPaperFrame(patch: Partial<PlaceholderLayer["effects"]["paperFrame"]>) {
    const paperFrame = { ...activeLayer.effects.paperFrame, ...patch };
    const polaroid = normalizePolaroidEffect(activeLayer.effects.polaroid, paperFrame, activeLayer.effects.innerShadow);
    const tornPaper = normalizeTornPaperEffect(activeLayer.effects.tornPaper, paperFrame, activeLayer.effects.innerShadow);
    const base = Math.max(0, paperFrame.borderWidth + paperFrame.innerPadding);
    if (patch.type !== undefined) {
      polaroid.enabled = patch.type === "polaroid";
      tornPaper.enabled = patch.type === "torn";
    }
    if (patch.borderWidth !== undefined || patch.innerPadding !== undefined) {
      polaroid.borderTop = base;
      polaroid.borderRight = base;
      polaroid.borderLeft = base;
      polaroid.borderBottom = base * 2.2;
      polaroid.captionHeight = Math.max(0, polaroid.borderBottom - base);
    }
    if (patch.paperColor !== undefined) {
      polaroid.frameColor = patch.paperColor;
      tornPaper.paperColor = patch.paperColor;
    }
    if (patch.textureIntensity !== undefined) {
      polaroid.grain = patch.textureIntensity;
      tornPaper.grain = patch.textureIntensity;
    }
    if (patch.shadowStrength !== undefined) {
      const amount = Math.max(0, patch.shadowStrength);
      const shadow = { enabled: amount > 0, x: 0, y: 3 + amount * .22, blur: 8 + amount * .55, spread: 0, opacity: Math.min(.45, amount / 180), color: "#0f172a" };
      polaroid.dropShadow = shadow;
      tornPaper.outerShadow = shadow;
    }
    if (patch.edgeRoughness !== undefined) {
      tornPaper.edges = Object.fromEntries(Object.entries(tornPaper.edges).map(([edge, value]) => [edge, { ...value, depth: patch.edgeRoughness, roughness: patch.edgeRoughness }])) as typeof tornPaper.edges;
      tornPaper.fibers = Math.round(patch.edgeRoughness * .75);
    }
    if (patch.seed !== undefined) tornPaper.seed = Math.max(1, Math.floor(patch.seed));
    onPatch({ effects: { ...activeLayer.effects, paperFrame, polaroid, tornPaper } });
  }
  const frameType = layer.effects.paperFrame.type;
  const shapeControlsDisabled = frameType === "polaroid" || frameType === "torn" || frameType === "deckle";
  const polaroid = normalizePolaroidEffect(layer.effects.polaroid, layer.effects.paperFrame, layer.effects.innerShadow);
  function patchPolaroid(patch: Partial<PolaroidEffect>) {
    onPatch({ effects: { ...activeLayer.effects, polaroid: normalizePolaroidEffect({ ...polaroid, ...patch }, activeLayer.effects.paperFrame, activeLayer.effects.innerShadow) } });
  }
  function patchPolaroidCaption(patch: Partial<PolaroidEffect["caption"]>) {
    patchPolaroid({ caption: { ...polaroid.caption, ...patch } });
  }
  function resetPolaroid() {
    const defaults = createDefaultPolaroidEffect({ ...createDefaultPaperFrame(), type: "polaroid" });
    onPatch({ effects: { ...activeLayer.effects, paperFrame: { ...activeLayer.effects.paperFrame, type: "polaroid" }, polaroid: { ...defaults, enabled: true } } });
  }
  const tornPaper = normalizeTornPaperEffect(layer.effects.tornPaper, layer.effects.paperFrame, layer.effects.innerShadow);
  function patchTornPaper(patch: Partial<TornPaperEffect>, markCustom = true) {
    onPatch({ effects: { ...activeLayer.effects, tornPaper: normalizeTornPaperEffect({ ...tornPaper, ...patch, ...(markCustom && patch.presetId === undefined ? { presetId: "custom" } : {}) }, activeLayer.effects.paperFrame, activeLayer.effects.innerShadow) } });
  }
  function resetTornPaper() {
    const type: PaperFrameType = "torn";
    const defaults = createDefaultTornPaperEffect({ ...createDefaultPaperFrame(), type, borderWidth: 0, innerPadding: 0 });
    onPatch({ effects: { ...activeLayer.effects, paperFrame: { ...activeLayer.effects.paperFrame, type }, tornPaper: { ...defaults, enabled: true, imageInset: 0, customPresets: tornPaper.customPresets } } });
  }

  const frameTextureType: "none" | "paper" | "crumpled-paper" = layer.effects.paper.enabled === false || layer.effects.paper.type === "none" ? "none" : layer.effects.paper.type === "crumpled-paper" ? "crumpled-paper" : "paper";
  function patchLayerPaper(patch: Partial<PaperTextureEffect>) {
    onPatch({ effects: { ...activeLayer.effects, paper: { ...activeLayer.effects.paper, ...patch } } });
  }
  function patchFrameTexture(type: "none" | "paper" | "crumpled-paper") {
    if (type === "none") {
      const nextPaperFrame = { ...activeLayer.effects.paperFrame, textureIntensity: 0 };
      onPatch({
        effects: {
          ...activeLayer.effects,
          paper: {
            ...activeLayer.effects.paper,
            enabled: false,
            type: "none",
            customTextureId: undefined,
            intensity: 0,
            opacity: 0
          },
          paperFrame: nextPaperFrame,
          polaroid: normalizePolaroidEffect({ ...polaroid, grain: 0, warmth: 0 }, nextPaperFrame, activeLayer.effects.innerShadow),
          tornPaper: normalizeTornPaperEffect({ ...tornPaper, grain: 0, wrinkles: 0, fibers: 0 }, nextPaperFrame, activeLayer.effects.innerShadow)
        }
      });
      return;
    }
    const textureAmount = type === "crumpled-paper" ? 92 : 78;
    const surfaceDefaults = surfaceDefaultsForType(type) ?? {};
    const nextPaperFrame = { ...activeLayer.effects.paperFrame, textureIntensity: textureAmount };
    onPatch({
      effects: {
        ...activeLayer.effects,
        paper: {
          ...activeLayer.effects.paper,
          ...surfaceDefaults,
          enabled: true,
          type,
          customTextureId: undefined,
          seed: activeLayer.effects.paper.seed || 1
        },
        paperFrame: nextPaperFrame,
        polaroid: normalizePolaroidEffect({ ...polaroid, grain: textureAmount, warmth: Math.round(textureAmount * .12) }, nextPaperFrame, activeLayer.effects.innerShadow),
        tornPaper: normalizeTornPaperEffect({ ...tornPaper, grain: textureAmount, wrinkles: textureAmount, fibers: Math.round(textureAmount * .45) }, nextPaperFrame, activeLayer.effects.innerShadow)
      }
    });
  }

  function patchFrameMode(frameMode: PlaceholderLayer["frameMode"]) {
    onPatch(frameMode === "adaptive"
      ? { frameMode, cropMode: "contain", alignment: "center", crop: { offsetX: 0, offsetY: 0, zoom: 1 } }
      : { frameMode: "fixed", cropMode: "cover", alignment: "center", crop: { offsetX: 0, offsetY: 0, zoom: 1 } });
  }

  function patchSimpleDropShadow(value: number) {
    const strength = Math.max(0, Math.min(100, value));
    const shadow: ShadowEffect = {
      enabled: strength > 0,
      x: 0,
      y: Math.round(4 + strength * 0.18),
      blur: Math.round(12 + strength * 0.48),
      spread: 0,
      opacity: Math.min(0.42, strength / 190),
      color: "#0f172a"
    };
    onPatch({
      shadow: strength > 0,
      effects: {
        ...activeLayer.effects,
        innerShadow: false,
        glow: false,
        paperFrame: { ...activeLayer.effects.paperFrame, shadowStrength: strength },
        polaroid: normalizePolaroidEffect({ ...polaroid, dropShadow: shadow, innerShadow: { ...polaroid.innerShadow, enabled: false } }, activeLayer.effects.paperFrame, false),
        tornPaper: normalizeTornPaperEffect({ ...tornPaper, outerShadow: shadow, innerShadow: { ...tornPaper.innerShadow, enabled: false } }, activeLayer.effects.paperFrame, false)
      }
    });
  }

  return (
    <section className="panel properties">
      {activeTab === "image" && <>
        <details open>
          <summary>Frame Position <ChevronDown size={15} /></summary>
          <div className="frame-mode-choice-grid" role="group" aria-label="Frame Mode">
            <button type="button" className={(layer.frameMode ?? "fixed") === "fixed" ? "active" : ""} onClick={() => patchFrameMode("fixed")}>Fixed Shape</button>
            <button type="button" className={layer.frameMode === "adaptive" ? "active" : ""} onClick={() => patchFrameMode("adaptive")}>Adaptive Aspect</button>
          </div>
          <div className="two-col"><label>X<input type="number" value={Math.round(layer.x)} onChange={numeric("x")} /></label><label>Y<input type="number" value={Math.round(layer.y)} onChange={numeric("y")} /></label><label>{layer.frameMode === "adaptive" ? "Target W" : "Width"}<SoftNumberInput value={Math.round(layer.width)} min={16} onCommit={(value) => onPatch({ width: Math.round(value) })} /></label><label>{layer.frameMode === "adaptive" ? "Target H" : "Height"}<SoftNumberInput value={Math.round(layer.height)} min={16} onCommit={(value) => onPatch({ height: Math.round(value) })} /></label></div>
          <FilterSlider label="Rotation" value={layer.rotation} min={-180} max={180} onChange={(value) => onPatch({ rotation: value })} />
          <div className="compact-action-row image-step-row"><button className="button secondary" disabled={imageChoiceCount < 2} onClick={() => onStepImage(layer, "previous")}>Previous Image</button><button className="button secondary" disabled={imageChoiceCount < 2} onClick={() => onStepImage(layer, "next")}>Next Image</button></div>
          <div className="compact-action-row"><button className="button secondary" onClick={() => onMatchAspect(layer)}>Match Image</button><button className="button ghost" onClick={() => onResetFrame(layer)}>Reset Frame</button><button className="button ghost" disabled={!source} onClick={() => onRegenerate(layer)}><Shuffle size={15} /> Shuffle</button></div>
        </details>

        <details open className={shapeControlsDisabled ? "shape-controls-disabled" : undefined}>
          <summary>Border and Shape <ChevronDown size={15} /></summary>
          {shapeControlsDisabled && <p className="control-note">Border and shape are handled by the active paper style. Set Paper to None to edit them.</p>}
          <label>Shape<select value={layer.maskShape} disabled={shapeControlsDisabled} onChange={(event) => onPatch({ maskShape: event.target.value as MaskShape })}><option value="rectangle">Rectangle</option><option value="rounded">Rounded</option><option value="circle">Circle</option></select></label>
          <div className="two-col"><label>Border Thickness<SoftNumberInput value={layer.borderWidth} min={0} disabled={shapeControlsDisabled} onCommit={(value) => onPatch({ borderWidth: Math.round(value) })} /></label><label>Radius<SoftNumberInput value={layer.borderRadius} min={0} disabled={shapeControlsDisabled || layer.maskShape !== "rounded"} onCommit={(value) => onPatch({ borderRadius: Math.round(value) })} /></label><label className="rounded-color-label">Border Color<input type="color" value={layer.borderColor} disabled={shapeControlsDisabled} onChange={(event) => onPatch({ borderColor: event.target.value })} /></label><label>Opacity<SoftNumberInput value={layer.borderOpacity} min={0} max={1} step={0.05} disabled={shapeControlsDisabled} onCommit={(value) => onPatch({ borderOpacity: value })} /></label></div>
          <FilterSlider label="Image opacity" value={layer.opacity} min={0} max={1} step={.05} onChange={(value) => onPatch({ opacity: value })} />
        </details>

        <details>
          <summary>Filters <ChevronDown size={15} /></summary>
          <PresetButtons currentId={layer.effects.filters.presetId ?? "none"} onPick={patchFilters} />
          <FilterSlider label="Brightness" value={layer.effects.filters.brightness} min={0} max={200} onChange={(value) => patchFilters({ brightness: value, presetId: "custom" })} />
          <FilterSlider label="Contrast" value={layer.effects.filters.contrast} min={0} max={200} onChange={(value) => patchFilters({ contrast: value, presetId: "custom" })} />
          <FilterSlider label="Saturation" value={layer.effects.filters.saturation} min={0} max={200} onChange={(value) => patchFilters({ saturation: value, presetId: "custom" })} />
          <FilterSlider label="Temperature" value={layer.effects.filters.temperature} min={-100} max={100} onChange={(value) => patchFilters({ temperature: value, presetId: "custom" })} />
          <FilterSlider label="Fade" value={layer.effects.filters.fade} min={0} max={80} onChange={(value) => patchFilters({ fade: value, presetId: "custom" })} />
        </details>

      </>}

      {activeTab === "effects" && <>
        <details open>
          <summary>Paper <ChevronDown size={15} /></summary>
          <label>Style<select value={frameType === "deckle" ? "torn" : frameType === "newsprint" || frameType === "clean" ? "polaroid" : frameType} onChange={(event) => patchPaperFrame({ type: event.target.value as PaperFrameType })}><option value="none">None</option><option value="polaroid">Polaroid</option><option value="torn">Torn Paper</option></select></label>
          {frameType !== "none" && (
            <div className="simple-effect-stack">
              <label>Paper color<input type="color" value={frameType === "polaroid" || frameType === "clean" ? polaroid.frameColor : frameType === "torn" ? tornPaper.paperColor : layer.effects.paperFrame.paperColor} onChange={(event) => frameType === "polaroid" || frameType === "clean" ? patchPolaroid({ frameColor: event.target.value }) : frameType === "torn" ? patchTornPaper({ paperColor: event.target.value }) : patchPaperFrame({ paperColor: event.target.value })} /></label>
              <label>Texture<select value={frameTextureType} onChange={(event) => patchFrameTexture(event.target.value as "none" | "paper" | "crumpled-paper")}><option value="none">None</option><option value="paper">Paper</option><option value="crumpled-paper">Crumpled Paper</option></select></label>
              {(frameType === "polaroid" || frameType === "clean") && (
                <PolaroidInspector
                  effect={polaroid}
                  onPatch={patchPolaroid}
                  onPatchLayer={onPatch}
                  onReset={resetPolaroid}
                />
              )}
              {frameType === "torn" && (
                <TornPaperInspector
                  layer={layer}
                  effect={tornPaper}
                  onPatch={patchTornPaper}
                  onPatchLayer={onPatch}
                  onReset={resetTornPaper}
                />
              )}
            </div>
          )}
        </details>

        <details open>
          <summary>Shadow and Blend <ChevronDown size={15} /></summary>
          <FilterSlider label="Drop Shadow" value={layer.effects.paperFrame.shadowStrength} min={0} max={100} onChange={patchSimpleDropShadow} />
          <label>Blend<select value={layer.effects.blendMode} onChange={(event) => onPatch({ effects: { ...layer.effects, blendMode: event.target.value as PlaceholderLayer["effects"]["blendMode"] } })}><option value="normal">No blend</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft Light</option></select></label>
        </details>
      </>}
    </section>
  );
}

function PolaroidInspector({
  effect,
  onPatch,
  onPatchLayer,
  onReset
}: {
  effect: PolaroidEffect;
  onPatch: (patch: Partial<PolaroidEffect>) => void;
  onPatchLayer: (patch: Partial<PlaceholderLayer>) => void;
  onReset: () => void;
}) {
  function patchBorder(patch: Partial<Pick<PolaroidEffect, "borderTop" | "borderRight" | "borderBottom" | "borderLeft">>) {
    const nextTop = patch.borderTop ?? effect.borderTop;
    const nextBottom = patch.borderBottom ?? effect.borderBottom;
    onPatch({
      ...patch,
      captionHeight: Math.max(0, nextBottom - nextTop)
    });
  }

  return (
    <div className="expanded-effect-editor polaroid-editor simple-effect-editor">
      <div className="effect-editor-heading">
        <div><strong>Polaroid</strong></div>
        <button className="button ghost compact" onClick={onReset}>Reset</button>
      </div>
      <div className="polaroid-border-grid">
        <label>Top<SoftNumberInput value={Math.round(effect.borderTop)} min={0} max={600} onCommit={(value) => patchBorder({ borderTop: Math.round(value) })} /></label>
        <label>Right<SoftNumberInput value={Math.round(effect.borderRight)} min={0} max={600} onCommit={(value) => patchBorder({ borderRight: Math.round(value) })} /></label>
        <label>Bottom<SoftNumberInput value={Math.round(effect.borderBottom)} min={0} max={900} onCommit={(value) => patchBorder({ borderBottom: Math.round(value) })} /></label>
        <label>Left<SoftNumberInput value={Math.round(effect.borderLeft)} min={0} max={600} onCommit={(value) => patchBorder({ borderLeft: Math.round(value) })} /></label>
      </div>
      <FilterSlider label="Corner Radius" value={effect.cornerRadius} min={0} max={160} step={1} onChange={(value) => onPatch({ cornerRadius: value })} />
      <div className="polaroid-placement-row"><button className="button ghost polaroid-reset-placement-button" onClick={() => {
        onPatch({ imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, imageRotation: 0 });
        onPatchLayer({ crop: { offsetX: 0, offsetY: 0, zoom: 1 }, alignment: "center" });
      }}>Reset Photo Placement</button></div>
    </div>
  );
}


function TornPaperInspector({
  effect,
  onPatch,
  onReset
}: {
  layer: PlaceholderLayer;
  effect: TornPaperEffect;
  onPatch: (patch: Partial<TornPaperEffect>, markCustom?: boolean) => void;
  onPatchLayer: (patch: Partial<PlaceholderLayer>) => void;
  onReset: () => void;
}) {
  const tearDepth = Math.round((effect.edges.top.depth + effect.edges.right.depth + effect.edges.bottom.depth + effect.edges.left.depth) / 4);
  const ridgeCount = Math.round((effect.edges.top.frequency + effect.edges.right.frequency + effect.edges.bottom.frequency + effect.edges.left.frequency) / 4);

  function patchEdges(patch: Partial<TearEdgeEffect>) {
    const next = { enabled: true, scale: 1, ...patch };
    onPatch({
      edges: {
        top: { ...effect.edges.top, ...next },
        right: { ...effect.edges.right, ...next },
        bottom: { ...effect.edges.bottom, ...next },
        left: { ...effect.edges.left, ...next }
      }
    });
  }

  function patchDepth(value: number) {
    const depth = Math.max(0, Math.min(100, Math.round(value)));
    patchEdges({
      depth,
      roughness: Math.max(0, Math.min(100, Math.round(depth * 0.92))),
      waviness: Math.max(0, Math.min(100, Math.round(24 + depth * 0.55)))
    });
  }

  function patchRidgeCount(value: number) {
    const frequency = Math.max(4, Math.min(80, Math.round(value)));
    patchEdges({ frequency });
  }

  return (
    <div className="expanded-effect-editor torn-paper-editor simple-effect-editor">
      <div className="effect-editor-heading">
        <div><strong>Torn Paper</strong></div>
        <button className="button ghost compact" onClick={onReset}>Reset</button>
      </div>
      <FilterSlider label="Tear Depth" value={tearDepth} min={0} max={100} onChange={patchDepth} />
      <FilterSlider label="Ridge Count" value={ridgeCount} min={4} max={80} onChange={patchRidgeCount} />
      <FilterSlider label="Paper Border" value={effect.imageInset} min={0} max={300} onChange={(value) => onPatch({ imageInset: Math.round(value) })} />
      <div className="torn-paper-action-row"><button className="button secondary torn-paper-regenerate-button" onClick={() => onPatch({ seed: nextStableSeed(effect.seed) })}><RefreshCcw size={15} /> Regenerate Tear</button></div>
    </div>
  );
}



function formatSoftNumber(value: number, step?: number | string) {
  if (!Number.isFinite(value)) return "";
  const precision = typeof step === "number" && step > 0 && !Number.isInteger(step)
    ? Math.min(4, String(step).split(".")[1]?.length ?? 0)
    : 0;
  return precision > 0 ? value.toFixed(precision).replace(/0+$/, "").replace(/\.$/, "") : String(Math.round(value));
}

function SoftNumberInput({
  value,
  min,
  max,
  step,
  disabled,
  onCommit
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number | string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatSoftNumber(value, step));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatSoftNumber(value, step));
  }, [value, step, focused]);

  function commit(raw = text) {
    const trimmed = raw.trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed)) {
      setText(formatSoftNumber(value, step));
      return;
    }
    let next = parsed;
    if (min !== undefined && next < min) {
      next = min;
      notifySoftNumberConstraint(`At least ${formatSoftNumber(min, step)}.`);
    }
    if (max !== undefined && next > max) {
      next = max;
      notifySoftNumberConstraint(`At most ${formatSoftNumber(max, step)}.`);
    }
    onCommit(next);
    setText(formatSoftNumber(next, step));
  }

  function handleChange(raw: string) {
    setText(raw);
    const parsed = Number(raw);
    if (raw.trim() && Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max)) {
      onCommit(parsed);
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onChange={(event) => handleChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setText(formatSoftNumber(value, step));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function FilterSlider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const display = Number.isInteger(value) ? String(value) : value.toFixed(value < 1 ? 2 : 1).replace(/\.0$/, "");
  return (
    <label className="filter-slider">
      <span className="filter-slider-label">{label}</span>
      <div className="filter-slider-control">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <b>{display}</b>
      </div>
    </label>
  );
}

function PresetButtons({ currentId, onPick }: { currentId: string; onPick: (filters: Partial<ImageFilters>) => void }) {
  const presetsMap: Array<[string, Partial<ImageFilters>]> = [
    ["None", {}],
    ["Warm", { brightness: 106, contrast: 96, saturation: 112, temperature: 32, sepia: 8 }],
    ["Cool", { brightness: 96, contrast: 112, saturation: 82, temperature: -28, fade: 8 }],
    ["Fade", { brightness: 112, contrast: 82, saturation: 86, fade: 18 }],
    ["Vintage", { brightness: 104, contrast: 92, saturation: 74, sepia: 34, grain: 16 }],
    ["Muted", { brightness: 98, contrast: 108, saturation: 68 }],
    ["Contrast", { brightness: 102, contrast: 148, saturation: 104 }],
    ["Mono", { grayscale: 100, contrast: 112 }]
  ];
  return <div className="preset-grid">{presetsMap.map(([name, filters]) => {
    const id = name.toLowerCase();
    return <button className={currentId === id ? "active" : ""} key={name} onClick={() => onPick({ ...createDefaultEffects().filters, ...filters, presetId: id })}>{name}</button>;
  })}</div>;
}

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);

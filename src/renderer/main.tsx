import React, { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  BringToFront,
  ChevronDown,
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
  Unlock,
  Upload,
  Wallpaper
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
  createDefaultPaperFrame,
  createPlaceholder,
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
import { layerSelectionRange, layersIntersectingRect, moveLayerBlockToTarget, reorderLayerBlock, type LayerOrderAction } from "../shared/layers";
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
import { applyGeneratedWallpaperFile, generateWallpaperFile, withWallpaperTimeout } from "../shared/wallpaper-pipeline";
import { SingleFlightWallpaperOperation } from "../shared/scheduler";
import { selectImagesForGeneration } from "../shared/source-selection";
import { placementForCanvasDrop, type CanvasDropPoint } from "../shared/drop-placement";
import { resizeRectAroundCenter, type ResizeHandle } from "../shared/resize-geometry";
import { bundledSurfaceChoices, bundledSurfaceUrl } from "./surface-textures";
import { surfaceDefaultsForType } from "../shared/surfaces";
import { clearSurfaceTextureCaches, drawSurfacePreview } from "./surface-renderer";
import { nextSurfaceSeed, normalizeSurfaceEffect, surfaceEffectIsVisible } from "../shared/surface-rendering";
import { applyTornPaperPreset, bundledTornPaperPresets, createCustomTornPaperPreset, createDefaultPolaroidEffect, createDefaultTornPaperEffect, nextStableSeed, normalizePolaroidEffect, normalizeTornPaperEffect, paperWarmthOverlay, shadowToCss, tornPaperTextureDataUrl } from "../shared/frame-effects";
import { clampPolaroidRotation, distanceBetween, pointerAngleDegrees, polaroidScaleFromPointerDistance, rotatePoint, screenDeltaToFrameDelta, shortestAngleDelta } from "../shared/polaroid-interaction";
import "./styles.css";

const autosaveKey = "pwc.autosave.v2";
const filePathKey = "pwc.filePath.v1";
const historyLimit = 80;
const snapDistance = 8;
const isMacOS = /Macintosh|MacIntel|MacPPC|Mac68K/i.test(navigator.userAgent) || /Mac/i.test(navigator.platform);

function cssImageUrl(src?: string) {
  if (!src) return undefined;
  return `url("${renderableLocalFileUrl(src).replace(/"/g, "\\\"")}")`;
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
  historyProject: WallpaperProject;
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
  error?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function sourceKindLabel(source: ImageSource) {
  if (source.type === "pinterest-board") return "Pinterest board";
  if (source.type === "local-file") return "Local images";
  return "Local folder";
}

function sourceLocationLabel(source: ImageSource) {
  return source.path ?? source.url ?? source.cachePath ?? "Stored in project";
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
      ? { label: "Assign source to this placeholder", valid: true, placementCount: 1 }
      : target === "canvas"
        ? { label: "Release to place source here", valid: true, placementCount: 1 }
        : { label: "Source already belongs to the library", valid: false };
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
  if (!valid && types.includes("text/uri-list") && target === "sources") return { label: "Add linked source", valid: true };
  if (!valid) return { label: unsupported > 0 ? "Unsupported files cannot be imported" : "Drop image files or folders", valid: false };

  // Finder groups all loose images into one reusable source. Each folder is
  // its own source, so mixed and multi-folder drops can place several frames.
  const placementCount = folders + (supportedImages > 0 ? 1 : 0);
  if (target === "placeholder") {
    if (folders > 0 && supportedImages > 0) return { label: "Assign folders and images to this placeholder", valid: true, placementCount };
    if (folders > 1) return { label: `Assign ${folders} folders to this placeholder`, valid: true, placementCount };
    if (folders === 1) return { label: "Assign folder to this placeholder", valid: true, placementCount: 1 };
    if (supportedImages === 1) return { label: "Assign image to this placeholder", valid: true, placementCount: 1 };
    return { label: `Assign ${supportedImages} images to this placeholder`, valid: true, placementCount: 1 };
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

function getDroppedPinterestUrl(event: React.DragEvent) {
  const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
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
};

type AddSourceMenuPosition = {
  left: number;
  top: number;
  ready: boolean;
};

function AddSourceControl({ onAddFolder, onAddImages, onAddPinterest }: AddSourceControlProps) {
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
      label: "Local Folder",
      description: "Use images from a folder",
      icon: <FolderOpen size={18} />,
      action: onAddFolder
    },
    {
      id: "images",
      label: "Local Images",
      description: "Select one or more image files",
      icon: <ImagePlus size={18} />,
      action: onAddImages
    },
    {
      id: "pinterest",
      label: "Pinterest Board",
      description: "Import images from a board",
      icon: <Sparkles size={18} />,
      action: onAddPinterest
    }
  ], [onAddFolder, onAddImages, onAddPinterest]);

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
      onPointerEnter={scheduleOpen}
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
            <button className="button secondary" onClick={() => { localStorage.removeItem(autosaveKey); window.location.reload(); }}>Reset Autosave and Reload</button>
          </div>
          <small>Reset Autosave removes only crash-recovery state, not explicitly saved project files.</small>
        </section>
      </main>
    );
  }
}

function App() {
  const [project, setProject] = useState<WallpaperProject>(() => {
    const autosaved = localStorage.getItem(autosaveKey);
    if (!autosaved) return createProject();
    try {
      return compactProjectForAutosave(normalizeProject(JSON.parse(autosaved) as WallpaperProject));
    } catch {
      return createProject();
    }
  });
  const [view, setView] = useState<AppView>("home");
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("all");
  const [selectedLayerId, setSelectedLayerId] = useState<string | undefined>(project.layers[0]?.id);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>(project.layers[0]?.id ? [project.layers[0].id] : []);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | undefined>(project.layers[0]?.id);
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(project.sources[0]?.id);
  const [projectPath, setProjectPath] = useState<string | undefined>(() => localStorage.getItem(filePathKey) ?? undefined);
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
  const [sourceMenu, setSourceMenu] = useState<SourceMenuState | undefined>();
  const [layerMenu, setLayerMenu] = useState<LayerMenuState | undefined>();
  const [sourceLibraryView, setSourceLibraryView] = useState<SourceLibraryView>("linked");
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>("sources");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("settings");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [renameState, setRenameState] = useState<RenameState | undefined>();
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
    failed: 0
  });
  const dragRef = useRef<DragState | undefined>(undefined);
  const polaroidImageDragRef = useRef<PolaroidImageDragState | undefined>(undefined);
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
    return window.wallpaperApi.onTrayCommand((command) => {
      if (command === "generate-apply") void previewOnCurrentDesktop();
      if (command === "previous") void applyPreviousWallpaper();
    });
  }, []);

  useEffect(() => {
    void window.wallpaperApi.applyStartupBehavior(projectRef.current.wallpaper.startMinimized);
  }, []);

  useEffect(() => {
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
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
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
    if (selectedLayer) patchLayer(selectedLayer.id, patch, historyEnabled);
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
      return { ...current, ...resized };
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
    commitProject((current) => {
      const layer = createPlaceholder(current.canvas, current.layers.length + 1);
      selectOnlyLayer(layer.id);
      return { ...current, layers: [...current.layers, layer] };
    });
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
    const copies = project.layers
      .filter((layer) => idSet.has(layer.id) && !layer.locked)
      .map((layer) => ({
        ...structuredClone(layer),
        id: uid("placeholder"),
        name: `${layer.name} Copy`,
        x: layer.x + 32,
        y: layer.y + 32
      }));
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
      patchLayer(layer.id, {
        width: Math.round(Math.max(40, Math.min(project.canvas.width, width))),
        height: Math.round(Math.max(40, Math.min(project.canvas.height, height))),
        x: Math.round(clamp(centerX - width / 2, 0, Math.max(0, project.canvas.width - width))),
        y: Math.round(clamp(centerY - height / 2, 0, Math.max(0, project.canvas.height - height))),
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
    patchLayer(layer.id, {
      width: defaults.width,
      height: defaults.height,
      x: Math.round(clamp(centerX - defaults.width / 2, 0, Math.max(0, project.canvas.width - defaults.width))),
      y: Math.round(clamp(centerY - defaults.height / 2, 0, Math.max(0, project.canvas.height - defaults.height)))
    });
  }

  async function addFolderSource() {
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
      mediaPolicy: "images-only",
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
    const result = await window.wallpaperApi.importPaths(paths);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    const merged = addSourcesToProjectDetailed(result.sources, true, false);
    setMessage(importResultMessage(result.summary, merged, result.warnings));
  }

  async function assignDroppedPathsToLayer(paths: string[], layer: PlaceholderLayer) {
    if (paths.length === 0) {
      setMessage("No Finder file paths were available for this drop.");
      return;
    }
    const result = await window.wallpaperApi.importPaths(paths);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    const merged = addSourcesToProjectDetailed(result.sources, true, false);
    if (merged.resolved.length === 0) return;
    assignSourcesToLayer(merged.resolved, layer, importResultMessage(result.summary, merged, result.warnings, layer));
  }

  function placeSourcesAtCanvasPoint(
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
      if (sourceImagesForPolicy(source).length === 0) continue;
      const placement = placementForCanvasDrop(next.canvas, point, createdLayerIds.length);
      const layer = createPlaceholder(next.canvas, next.layers.length + 1);
      Object.assign(layer, placement, { name: source.name });
      next = { ...next, layers: [...next.layers, layer] };
      const assigned = projectWithSourcesAssignment(next, [source], layer.id);
      if (!assigned) {
        next = { ...next, layers: next.layers.filter((item) => item.id !== layer.id) };
        continue;
      }
      next = assigned;
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
    placeSourcesAtCanvasPoint(result.sources, point, result.summary, result.warnings);
  }

  async function addLocalImagesSource() {
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
  }

  async function runPinterestImport(mode: "import" | "update") {
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
      const result =
        mode === "import"
          ? await window.wallpaperApi.importPinterestBoard(request)
          : await window.wallpaperApi.updatePinterestBoard(request);

      setPinterestDialog((current) => ({
        ...current,
        busy: false,
        stage: result.canceled ? "canceled" : result.partial ? "partial" : result.ok ? "complete" : "error",
        progress: result.progress,
        imagesFound: result.imagesFound,
        imagesCached: result.imagesCached,
        log: result.log,
        error: result.error
      }));

      if (result.source && result.source.images.length > 0) {
        const [resolved] = addSourcesToProject([result.source], [], true);
        setSelectedSourceId(resolved?.id ?? result.source.id);
      }
      setMessage(result.error ?? `Pinterest board ready with ${result.imagesCached} cached pins.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pinterest import failed.";
      setPinterestDialog((current) => ({ ...current, busy: false, stage: "error", error: message, log: [...current.log, message] }));
      setMessage(message);
    }
  }

  async function cancelPinterestImport() {
    const jobId = pinterestDialog.jobId;
    if (!jobId) return;
    await window.wallpaperApi.cancelPinterestImport(jobId);
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
          templateName: `${item.templateName} · ${item.target.label}`,
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
    const current = normalizeProject(projectRef.current);
    let base = normalizeProject(updateActiveTemplateSnapshot(current));
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

    if (isMacOS && wallpaperTargetModeNeedsInactiveSpaces(base.wallpaper.targetMode)) {
      if (options.automatic) {
        recordWallpaperFailure("Automatic all-desktop application is replaced by macOS folder shuffle. Create a wallpaper set and let macOS rotate it across Spaces.", true);
        return;
      }
      openExportSet(targetTemplateId);
      setMessage("Choose how many wallpaper variations to create, then select the exported folder in macOS Wallpaper Settings.");
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
    // Preview is still a generation action: resolve every assigned source pool
    // before rendering, then constrain only the native apply target. The
    // previous Phase 15.1.14 implementation rendered the unprepared editor
    // state, which could leave shuffle placeholders unchanged or empty.
    const prepared = prepareGeneratedProject(previewBase, previewBase.templates.activeTemplateId);
    await applyCandidate(normalizeProject(prepared.project), prepared.combination, {
      label: "Previewed on current desktop"
    });
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
      const result = await window.wallpaperApi.exportImage({
        dataUrl,
        format,
        suggestedName: `${project.name}.${format === "png" ? "png" : "jpg"}`
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
      error: undefined
    }));
    if (!exportSet.destinationPath) {
      void window.wallpaperApi.getDefaultExportSetFolder().then((result) => {
        if (!result.canceled && result.filePath) {
          setExportSet((current) => current.open && !current.destinationPath ? { ...current, destinationPath: result.filePath } : current);
        }
      });
    }
  }

  async function chooseExportSetFolder() {
    const result = await window.wallpaperApi.chooseExportSetFolder();
    if (!result.canceled && result.filePath) setExportSet((current) => ({ ...current, destinationPath: result.filePath }));
  }

  function cancelExportSet() {
    exportCancelRef.current = true;
    setExportSet((current) => ({ ...current, cancelRequested: true }));
  }

  async function cleanupWallpaperSets() {
    setToolbarMenuOpen(false);
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
    const result = await window.wallpaperApi.revealExportSet(target);
    if (!result.ok) setMessage(result.error ?? "Unable to open the wallpaper set folder.");
  }

  async function openMacOSWallpaperSettings() {
    const result = await window.wallpaperApi.openWallpaperSettings();
    if (!result.ok) setMessage(result.error ?? "Unable to open macOS Wallpaper Settings.");
  }

  async function runExportSet() {
    const options = exportSet;
    const count = clamp(Math.round(options.count), 1, 500);
    let rootPath = options.destinationPath;
    if (!rootPath) {
      const result = await window.wallpaperApi.getDefaultExportSetFolder();
      if (result.canceled || !result.filePath) return;
      rootPath = result.filePath;
      setExportSet((current) => ({ ...current, destinationPath: rootPath }));
    }
    const template = projectRef.current.templates.templates.find((item) => item.id === options.templateId)
      ?? projectRef.current.templates.templates.find((item) => item.id === projectRef.current.templates.activeTemplateId);
    if (!template) {
      setExportSet((current) => ({ ...current, error: "Choose a template before creating a wallpaper set." }));
      return;
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
      error: undefined
    }));

    const begin = await window.wallpaperApi.beginExportSet({
      rootPath,
      setName: options.setName || template.name,
      projectName: projectRef.current.name,
      templateName: template.name,
      format: options.format,
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
      const fileName = `wallpaper-${String(index).padStart(3, "0")}.${options.format === "png" ? "png" : "jpg"}`;
      try {
        const dataUrl = await renderProjectToDataUrl(exportProject, options.format, options.quality);
        const result = await window.wallpaperApi.writeExportSetFile({ sessionId, dataUrl, fileName });
        if (!result.ok) throw new Error(result.error ?? `Could not write ${fileName}.`);
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

    setMessage(`Created macOS wallpaper set with ${completed} variation${completed === 1 ? "" : "s"}: ${finalized.finalPath}`);
    setExportSet((current) => ({
      ...current,
      busy: false,
      cancelRequested: false,
      completed,
      failed: 0,
      finalPath: finalized.finalPath,
      error: undefined
    }));
  }

  async function saveProject() {
    const result = await window.wallpaperApi.saveProject(project, projectPath);
    if (result.canceled) return;
    setProjectPath(result.filePath);
    setMessage(`Saved ${result.filePath}`);
  }

  async function saveProjectAs() {
    const result = await window.wallpaperApi.saveProject(project);
    if (result.canceled) return;
    setProjectPath(result.filePath);
    setMessage(`Saved ${result.filePath}`);
  }

  async function openProject() {
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

    const movableIds = mode === "move" ? nextSelection : [layer.id];
    const groupLayers = project.layers.filter((item) => movableIds.includes(item.id) && !item.locked);
    dragRef.current = {
      id: layer.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      layer,
      groupLayers,
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

  function snapLayer(layer: PlaceholderLayer, x: number, y: number) {
    const centerX = x + layer.width / 2;
    const centerY = y + layer.height / 2;
    const targetsX = [0, project.canvas.width / 2, project.canvas.width];
    const targetsY = [0, project.canvas.height / 2, project.canvas.height];
    for (const other of project.layers) {
      if (other.id === layer.id) continue;
      targetsX.push(other.x, other.x + other.width / 2, other.x + other.width);
      targetsY.push(other.y, other.y + other.height / 2, other.y + other.height);
    }

    let nextX = x;
    let nextY = y;
    let guideX: number | undefined;
    let guideY: number | undefined;
    for (const target of targetsX) {
      const points = [x, centerX, x + layer.width];
      const hit = points.find((point) => Math.abs(point - target) <= snapDistance);
      if (hit !== undefined) {
        nextX += target - hit;
        guideX = target;
        break;
      }
    }
    for (const target of targetsY) {
      const points = [y, centerY, y + layer.height];
      const hit = points.find((point) => Math.abs(point - target) <= snapDistance);
      if (hit !== undefined) {
        nextY += target - hit;
        guideY = target;
        break;
      }
    }
    setGuides({ x: guideX, y: guideY });
    return { x: nextX, y: nextY };
  }

  function onCanvasPointerMove(event: PointerEvent) {
    const marquee = marqueeRef.current;
    if (marquee) {
      const canvas = event.currentTarget as HTMLElement;
      const rect = canvas.getBoundingClientRect();
      const currentX = clamp((event.clientX - rect.left) / zoomRef.current, 0, project.canvas.width);
      const currentY = clamp((event.clientY - rect.top) / zoomRef.current, 0, project.canvas.height);
      const next: SelectionMarquee = {
        ...marquee,
        x: Math.min(marquee.startX, currentX),
        y: Math.min(marquee.startY, currentY),
        width: Math.abs(currentX - marquee.startX),
        height: Math.abs(currentY - marquee.startY)
      };
      marqueeRef.current = next;
      setSelectionMarquee(next);
      const hits = layersIntersectingRect(project.layers, next);
      const ids = [...new Set([...next.baseIds, ...hits])];
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

    if (drag.mode === "move") {
      const snapped = snapLayer(drag.layer, drag.layer.x + dx, drag.layer.y + dy);
      const primaryX = Math.round(clamp(snapped.x, 0, project.canvas.width - drag.layer.width));
      const primaryY = Math.round(clamp(snapped.y, 0, project.canvas.height - drag.layer.height));
      const appliedDx = primaryX - drag.layer.x;
      const appliedDy = primaryY - drag.layer.y;
      const originals = new Map(drag.groupLayers.map((layer) => [layer.id, layer]));
      commitProject(
        (current) => ({
          ...current,
          layers: current.layers.map((layer) => {
            const original = originals.get(layer.id);
            if (!original) return layer;
            return {
              ...layer,
              x: Math.round(clamp(original.x + appliedDx, 0, project.canvas.width - original.width)),
              y: Math.round(clamp(original.y + appliedDy, 0, project.canvas.height - original.height))
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
    const next = resizeRectAroundCenter(
      drag.layer,
      drag.mode as ResizeHandle,
      dx,
      dy,
      preserveAspect,
      { width: project.canvas.width, height: project.canvas.height, minSize: 40 }
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
    setDropFeedback(undefined);
    if (getDroppedSourceId(event)) {
      setMessage("This source is already in the library.");
      return;
    }
    const pinterestUrl = getDroppedPinterestUrl(event);
    if (pinterestUrl) {
      setPinterestDialog((current) => ({ ...current, open: true, url: pinterestUrl }));
      return;
    }
    await importDroppedPaths(getDroppedPaths(event));
  }

  async function handleCanvasDrop(event: React.DragEvent) {
    event.preventDefault();
    const point = canvasPointFromClient(event.clientX, event.clientY);
    setDropFeedback(undefined);
    if (!point) {
      setMessage("Drop the source directly on the canvas to position it.");
      return;
    }

    const existingSourceId = getDroppedSourceId(event);
    if (existingSourceId) {
      const source = projectRef.current.sources.find((item) => item.id === existingSourceId);
      if (source) placeSourcesAtCanvasPoint([source], point);
      return;
    }

    const pinterestUrl = getDroppedPinterestUrl(event);
    if (pinterestUrl) {
      setPinterestDialog((current) => ({ ...current, open: true, url: pinterestUrl }));
      setMessage("Import the Pinterest board, then drag its source onto the canvas to position it.");
      return;
    }

    await importDroppedPathsAtCanvasPoint(getDroppedPaths(event), point);
  }

  async function handlePlaceholderDrop(event: React.DragEvent, layer: PlaceholderLayer) {
    event.preventDefault();
    event.stopPropagation();
    setDropFeedback(undefined);
    const existingSourceId = getDroppedSourceId(event);
    if (existingSourceId) {
      const source = projectRef.current.sources.find((item) => item.id === existingSourceId);
      if (source) assignSourceToLayer(source, layer);
      return;
    }
    await assignDroppedPathsToLayer(getDroppedPaths(event), layer);
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
    setMessage(`Opened template "${template.name}".`);
  }

  function createBlankTemplate() {
    const blank = createProject();
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
    await previewOnCurrentDesktop();
  }

  function sourceAssignmentCount(sourceId: string) {
    return project.layers.filter((layer) => layer.sourceId === sourceId || layer.sourceState.sourceIds.includes(sourceId)).length;
  }

  function sourceTemplateUsageCount(sourceId: string) {
    return project.templates.templates.filter(
      (template) =>
        template.project.sourceIds.includes(sourceId) ||
        template.project.layers.some((layer) => layer.sourceId === sourceId || layer.sourceState.sourceIds.includes(sourceId))
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
    if (assigned > 0 && !window.confirm(`Unlink ${source.name} from this template? It is assigned to ${assigned} placeholder${assigned === 1 ? "" : "s"}, which will be cleared.`)) return;
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
      const result = await window.wallpaperApi.updatePinterestBoard({
        url: sourceUrl,
        mode: "update",
        jobId,
        existingSource: source,
        resumeBookmark: source.importCursor
      });
      setPinterestDialog((current) => ({
        ...current,
        busy: false,
        stage: result.canceled ? "canceled" : result.partial ? "partial" : result.ok ? "complete" : "error",
        progress: result.progress,
        imagesFound: result.imagesFound,
        imagesCached: result.imagesCached,
        log: result.log,
        error: result.error
      }));
      if (result.source && result.source.images.length > 0) {
        commitProject((current) => ({
          ...current,
          sources: current.sources.map((item) => (item.id === source.id ? { ...result.source!, id: source.id, name: source.name } : item))
        }));
        setMessage(result.error ?? `Refreshed ${result.source.images.length} Pinterest pins.`);
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
      ? `Delete ${source.name} from the global source library? It is linked to ${templateUsage} template${templateUsage === 1 ? "" : "s"}. Those links and placeholder assignments will be cleared. Original local files will not be deleted.`
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
      if (!event.metaKey && !event.ctrlKey) return;
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
      if (isTypingTarget(event.target) && !(command && event.key.toLowerCase() === "s")) return;
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
      } else if (command && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      } else if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (command && event.key.toLowerCase() === "c" && selectedLayers.length) {
        event.preventDefault();
        setClipboardLayers(structuredClone(selectedLayers));
      } else if (command && event.key.toLowerCase() === "v" && clipboardLayers.length) {
        event.preventDefault();
        const pasted = clipboardLayers.map((layer) => ({
          ...structuredClone(layer),
          id: uid("placeholder"),
          x: layer.x + 28,
          y: layer.y + 28
        }));
        commitProject((current) => ({ ...current, layers: [...current.layers, ...pasted] }));
        setSelectedLayerIds(pasted.map((layer) => layer.id));
        setSelectedLayerId(pasted.at(-1)?.id);
        setSelectionAnchorId(pasted.at(-1)?.id);
      } else if (command && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedLayer();
      } else if (command && event.key.toLowerCase() === "s") {
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
            x: clamp(layer.x + dx, 0, current.canvas.width - layer.width),
            y: clamp(layer.y + dy, 0, current.canvas.height - layer.height)
          } : layer)
        }));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedLayer, selectedLayers, clipboardLayers, cropModeLayerId, project, projectPath, selectedLayerIds, view]);

  if (view === "home") {
    return (
      <>
        <TemplateHome
          project={project}
          templates={visibleTemplates}
          filter={templateFilter}
          message={message}
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
        <RenameDialog state={renameState} onChange={setRenameState} onFinish={finishRename} />
        <ExportSetDialog
          state={exportSet}
          onChange={setExportSet}
          onChooseFolder={() => void chooseExportSetFolder()}
          onRun={() => void runExportSet()}
          onCancel={cancelExportSet}
          onCleanup={() => void cleanupWallpaperSets()}
          onReveal={(folderPath) => void revealWallpaperSet(folderPath)}
          onOpenSettings={() => void openMacOSWallpaperSettings()}
          onClose={() => setExportSet((current) => ({ ...current, open: false }))}
        />
        <GlobalTooltip />
      </>
    );
  }

  return (
    <main className={`app-shell ${leftPanelOpen ? "" : "left-collapsed"} ${rightPanelOpen ? "" : "right-collapsed"}`}>
      <aside className={`sidebar left ${leftPanelOpen ? "" : "collapsed"}`}>
        <div className="brand compact-brand">
          <div className="brand-mark">P</div>
          <div className="brand-copy">
            <input className="project-name" value={project.name} onChange={(event) => commitProject((current) => ({ ...current, name: event.target.value }))} />
            <p>{project.sources.length} pools · {project.templates.templates.length} templates</p>
          </div>
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
          {dropFeedback?.target === "sources" && (
            <div className={`drop-feedback-overlay ${dropFeedback.valid ? "valid" : "invalid"}`}>
              <Upload size={22} />
              <strong>{dropFeedback.label}</strong>
              <span>Folders become reusable pools. Multiple images become one source.</span>
            </div>
          )}
          <div className="library-heading">
            <div>
              <span className="eyebrow">COLLECTIONS</span>
              <h2>Sources</h2>
            </div>
            <AddSourceControl
              onAddFolder={() => void addFolderSource()}
              onAddImages={() => void addLocalImagesSource()}
              onAddPinterest={() => setPinterestDialog((current) => ({ ...current, open: true }))}
            />
          </div>

          <div className="source-tabs" role="tablist" aria-label="Source library">
            <button className={sourceLibraryView === "linked" ? "active" : ""} onClick={() => setSourceLibraryView("linked")}>Linked <span>{linkedSources.length}</span></button>
            <button className={sourceLibraryView === "global" ? "active" : ""} onClick={() => setSourceLibraryView("global")}>Library <span>{project.sources.length}</span></button>
          </div>

          <p className="source-help">
            {selectedLayer
              ? selectedLayer.locked
                ? "Unlock the selected frame to change its source."
                : "Choose a source to assign its whole pool to this frame."
              : selectedSource
                ? "Source details"
                : sourceLibraryView === "linked"
                  ? "Select a source to view its details."
                  : "Reusable folders, boards, and image collections shared across templates."}
          </p>

          {sourceLibraryView === "linked" && linkedSources.length === 0 && (
            <button className="assign-source-button" onClick={() => setSourceLibraryView("global")}>
              <Plus size={16} /> Add from global sources
            </button>
          )}

          {selectedSource && !selectedLayer && (
            <div className="source-detail-card">
              <div className="source-detail-heading">
                <span className="source-icon">{selectedSource.type === "local-folder" ? <FolderOpen size={17} /> : selectedSource.type === "pinterest-board" ? <Sparkles size={17} /> : <Images size={17} />}</span>
                <div>
                  <strong>{selectedSource.name}</strong>
                  <span>{sourceKindLabel(selectedSource)}</span>
                </div>
              </div>
              <div className="source-summary-line">
                <span>{sourceImagesForPolicy(selectedSource).length} available</span>
                <span className={`status-dot ${selectedSource.importStatus ?? (selectedSource.missing ? "missing" : "ready")}`} />
              </div>
              <label className="source-media-policy">Media<select value={selectedSource.mediaPolicy} onChange={(event) => {
                const mediaPolicy = event.target.value as SourceMediaPolicy;
                commitProject((current) => ({ ...current, sources: current.sources.map((source) => source.id === selectedSource.id ? { ...source, mediaPolicy } : source) }));
                setMessage(`Updated ${selectedSource.name}: ${mediaPolicy.replace(/-/g, " ")}.`);
              }}><option value="images-only">Images only</option><option value="images-and-video-thumbnails">Images + video thumbnails</option></select></label>
              <details className="source-technical-details">
                <summary>Details <ChevronDown size={14} /></summary>
                <dl>
                  <div><dt>Total</dt><dd>{selectedSource.mediaCounts?.total ?? selectedSource.images.length}{selectedSource.expectedItemCount ? ` / ${selectedSource.expectedItemCount}` : ""}</dd></div>
                  <div><dt>Images</dt><dd>{selectedSource.mediaCounts?.images ?? selectedSource.images.filter((image) => image.mediaType !== "video").length}</dd></div>
                  <div><dt>Videos</dt><dd>{selectedSource.mediaCounts?.videos ?? selectedSource.images.filter((image) => image.mediaType === "video").length}</dd></div>
                  <div><dt>Available</dt><dd>{sourceImagesForPolicy(selectedSource).length}</dd></div>
                  <div><dt>Location</dt><dd title={sourceLocationLabel(selectedSource)}>{sourceLocationLabel(selectedSource)}</dd></div>
                  <div><dt>Status</dt><dd>{selectedSource.importStatus ?? (selectedSource.missing ? "missing" : "ready")}</dd></div>
                  <div><dt>Updated</dt><dd>{selectedSource.lastImportCompletedAt ? new Date(selectedSource.lastImportCompletedAt).toLocaleString() : selectedSource.lastScannedAt ? new Date(selectedSource.lastScannedAt).toLocaleString() : "Not scanned"}</dd></div>
                </dl>
              </details>
              {(selectedSource.mediaCounts?.videos ?? 0) > 0 && selectedSource.mediaPolicy === "images-only" && <p className="source-exclusion-note">{selectedSource.mediaCounts?.videos} video thumbnail{selectedSource.mediaCounts?.videos === 1 ? "" : "s"} excluded</p>}
              <div className="source-detail-actions">
                <button className="pill-button" onClick={() => void rescanSource(selectedSource)}>Refresh</button>
                <button className="pill-button" onClick={() => void showSourceInFolder(selectedSource)}>Show</button>
              </div>
            </div>
          )}


          <div className="source-list collection-list">
            {visibleSources.length === 0 ? (
              <button className="empty-source-card" onClick={sourceLibraryView === "linked" ? () => setSourceLibraryView("global") : addFolderSource}>
                <FolderOpen size={20} />
                <strong>{sourceLibraryView === "linked" ? "No sources linked" : "Add a source collection"}</strong>
                <span>{sourceLibraryView === "linked" ? "Choose one from the global library" : "Drop a folder here or import a Pinterest board"}</span>
              </button>
            ) : visibleSources.map((source) => {
              const linked = linkedSourceIds.includes(source.id);
              const assigned = Boolean(selectedLayer && (selectedLayer.sourceId === source.id || selectedLayer.sourceState.sourceIds.includes(source.id)));
              const eligibleCount = sourceImagesForPolicy(source).length;
              const countLabel = source.expectedItemCount && source.expectedItemCount > source.images.length
                ? `${eligibleCount} usable · ${source.images.length} cached / ${source.expectedItemCount}`
                : `${eligibleCount} usable`;
              return (
                <div
                  className={`${!selectedLayer && selectedSourceId === source.id ? "source-row active" : "source-row"} ${selectedLayer && assigned ? "assigned" : ""}`}
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
                      <span>{sourceKindLabel(source)} · {countLabel} items{source.importStatus === "partial" ? " · partial" : ""}</span>
                    </span>
                    {selectedLayer && assigned && <span className="assigned-dot" title="Assigned to selected frame" />}
                  </button>
                  <div className="source-row-actions">
                    {sourceLibraryView === "linked" ? (
                      <button className="source-mini-action" title="Unlink from this template" onClick={() => unlinkSourceFromTemplate(source)}>Unlink</button>
                    ) : linked ? (
                      <span className="source-linked-badge">Linked</span>
                    ) : (
                      <button className="source-mini-action" title="Link to this template" onClick={() => linkSourceToTemplate(source)}>Link</button>
                    )}
                    {sourceLibraryView === "global" && (
                      <button className="icon-button source-delete" title="Delete global source" onClick={() => removeSource(source)}><Trash2 size={14} /></button>
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
            />
          )}
        </section>

        <section className={`panel layers-panel ${leftPanelTab === "layers" ? "" : "hidden-panel"}`}>
          <div className="panel-title-row">
            <h2><Layers size={17} /> Layers</h2>
            <button className="icon-button tooltip-anchor" data-tooltip="Add placeholder" aria-label="Add placeholder" onClick={addPlaceholder}><Plus size={16} /></button>
          </div>
          {project.layers.some((layer) => layer.hidden) && (
            <details className="hidden-layers-menu">
              <summary><EyeOff size={14} /> Hidden Layers <span>{project.layers.filter((layer) => layer.hidden).length}</span></summary>
              <div>
                {project.layers.filter((layer) => layer.hidden).map((layer) => (
                  <button key={layer.id} onClick={() => toggleLayerVisibility(layer.id)}><Eye size={14} /> Restore {layer.name}</button>
                ))}
              </div>
            </details>
          )}
          <div className="layers-list" aria-label="Layers from front to back">
            {[...project.layers].filter((layer) => !layer.hidden).reverse().map((layer) => {
              const selected = selectedLayerIds.includes(layer.id);
              return (
                <div
                  className={`layer-row ${selected ? "active" : ""}`}
                  key={layer.id}
                  draggable={!layer.locked}
                  onDragStart={(event) => {
                    const ids = (selected ? selectedLayerIds : [layer.id]).filter((id) => !project.layers.find((item) => item.id === id)?.locked);
                    if (!selected) selectOnlyLayer(layer.id);
                    event.dataTransfer.setData("application/x-pwc-layer-ids", JSON.stringify(ids));
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const raw = event.dataTransfer.getData("application/x-pwc-layer-ids");
                    let ids: string[] = [];
                    try { ids = JSON.parse(raw) as string[]; } catch { ids = []; }
                    if (!ids.length || ids.includes(layer.id)) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const beforeInPanel = event.clientY < rect.top + rect.height / 2;
                    commitProject((current) => ({ ...current, layers: moveLayerBlockToTarget(current.layers, ids, layer.id, beforeInPanel) }));
                    setSelectedLayerIds(ids);
                    setSelectedLayerId(ids.at(-1));
                  }}
                >
                  <span className="layer-drag-handle tooltip-anchor" data-tooltip="Drag to reorder"><GripVertical size={15} /></span>
                  <button className="layer-main" onClick={(event) => selectLayerFromPanel(layer.id, event)}>
                    <span className="layer-type-icon"><ImagePlus size={14} /></span>
                    <span className="layer-name">{layer.name}</span>
                    {layer.locked && <Lock size={12} className="layer-lock-indicator" />}
                  </button>
                  <button
                    className="layer-icon-button tooltip-anchor"
                    data-tooltip="Layer actions"
                    aria-label="Layer actions"
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
          <button onClick={saveAsTemplate}><LayoutTemplate size={16} /> Save template</button>
          <button onClick={() => setRightPanelOpen(true)}><SlidersHorizontal size={16} /> Edit details</button>
        </section>
      </aside>

      <section className="workspace">
        <header className="toolbar minimal-toolbar">
          <div className="toolbar-cluster">
            <button className="icon-button tooltip-anchor" data-tooltip="Back to templates" aria-label="Back to templates" onClick={() => void goHome()}><Home size={17} /></button>
            <button className="icon-button tooltip-anchor" data-tooltip="Undo" aria-label="Undo" onClick={undo} disabled={history.past.length === 0}>↶</button>
            <button className="icon-button tooltip-anchor" data-tooltip="Redo" aria-label="Redo" onClick={redo} disabled={history.future.length === 0}>↷</button>
          </div>
          <div className="toolbar-title">
            <strong>{project.name}</strong>
            <span>{project.canvas.width} x {project.canvas.height}</span>
          </div>
          <div className="toolbar-cluster">
            <button className="secondary-action" disabled={wallpaperBusy} onClick={() => void previewOnCurrentDesktop()}>
              <Wallpaper size={17} />
              {wallpaperBusy ? "Working…" : "Preview on Current Desktop"}
            </button>
            {isMacOS && (
              <button className="primary-action" disabled={wallpaperBusy} onClick={() => openExportSet()}>
                <Images size={17} /> Create Wallpaper Set
              </button>
            )}
            <div className="overflow-wrap">
              <button className="icon-button tooltip-anchor" data-tooltip="More actions" aria-label="More actions" onClick={() => setToolbarMenuOpen((value) => !value)}><MoreHorizontal size={18} /></button>
              {toolbarMenuOpen && (
                <div className="popover-menu toolbar-overflow">
                  <button onClick={openProject}><FolderOpen size={16} /> Open</button>
                  <button onClick={saveProject}><Save size={16} /> Save</button>
                  <button onClick={saveProjectAs}>Save as</button>
                  <button onClick={addPlaceholder}><Plus size={16} /> Add Placeholder</button>
                  <button onClick={() => exportWallpaper("png")}><Download size={16} /> Export PNG</button>
                  <button onClick={() => exportWallpaper("jpeg")}><Download size={16} /> Export JPEG</button>
                  <button onClick={() => openExportSet()}><Images size={16} /> Create macOS Wallpaper Set</button>
                  <button onClick={() => void cleanupWallpaperSets()}><Trash2 size={16} /> Delete All Wallpaper Sets…</button>
                  <button onClick={() => setLeftPanelOpen((value) => !value)}><PanelLeft size={16} /> Toggle Left Panel</button>
                  <button onClick={() => setRightPanelOpen((value) => !value)}><SlidersHorizontal size={16} /> Toggle Inspector</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div
          ref={stageRef}
          className="canvas-stage"
        >
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
          ) : selectedLayer && !selectedLayer.locked ? (
            <ContextToolbar
              layer={selectedLayer}
              onPatch={(patch) => patchSelectedLayer(patch)}
              onCrop={() => setCropModeLayerId(selectedLayer.id)}
              onDuplicate={duplicateSelectedLayer}
              onDelete={deleteSelectedLayer}
              onOrder={reorderSelectedLayer}
            />
          ) : null}
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
              if (event.target !== event.currentTarget) return;
              if (event.shiftKey) {
                const rect = event.currentTarget.getBoundingClientRect();
                const startX = clamp((event.clientX - rect.left) / zoomRef.current, 0, project.canvas.width);
                const startY = clamp((event.clientY - rect.top) / zoomRef.current, 0, project.canvas.height);
                const marquee: SelectionMarquee = { startX, startY, x: startX, y: startY, width: 0, height: 0, baseIds: selectedLayerIds };
                marqueeRef.current = marquee;
                setSelectionMarquee(marquee);
                event.currentTarget.setPointerCapture(event.pointerId);
              } else {
                clearLayerSelection();
              }
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
                return (
                  <div
                    className="canvas-drop-placement-preview"
                    key={`drop-preview-${index}`}
                    style={{
                      left: placement.x,
                      top: placement.y,
                      width: placement.width,
                      height: placement.height,
                      zIndex: 50 + index
                    }}
                  >
                    {index === 0 && (
                      <div className="canvas-drop-placement-copy">
                        <Upload size={18} />
                        <strong>{dropFeedback.label}</strong>
                        <span>Release to create and select the placeholder here.</span>
                        {(dropFeedback.placementCount ?? 1) > 1 && <b>{dropFeedback.placementCount} placeholders</b>}
                      </div>
                    )}
                  </div>
                );
              })}
            {guides.x !== undefined && <div className="guide vertical" style={{ left: guides.x }} />}
            {guides.y !== undefined && <div className="guide horizontal" style={{ top: guides.y }} />}
            {selectionMarquee && <div className="selection-marquee" style={{ left: selectionMarquee.x, top: selectionMarquee.y, width: selectionMarquee.width, height: selectionMarquee.height }} />}
            {project.layers.map((layer) => {
              const image = getImageForLayer(project, layer);
              if (layer.hidden) return null;
              const selected = selectedLayerIds.includes(layer.id);
              const cropping = cropModeLayerId === layer.id;
              const paperFrame = layer.effects.paperFrame ?? createDefaultPaperFrame();
              const polaroid = normalizePolaroidEffect(layer.effects.polaroid, paperFrame, layer.effects.innerShadow);
              const tornPaper = normalizeTornPaperEffect(layer.effects.tornPaper, paperFrame, layer.effects.innerShadow);
              const insets = paperFrameInsets(paperFrame, layer.width, layer.height, polaroid, tornPaper);
              const innerWidth = Math.max(1, layer.width - insets.left - insets.right);
              const innerHeight = Math.max(1, layer.height - insets.top - insets.bottom);
              const paperActive = paperFrame.type !== "none";
              const rough = paperFrameIsRough(paperFrame);
              const polaroidActive = paperFrame.type === "polaroid";
              const tornActive = paperFrame.type === "torn" || paperFrame.type === "deckle";
              const expandedFrameRotation = paperFrameRotation(paperFrame, polaroid);
              const expandedFrameColor = polaroidActive ? polaroid.frameColor : tornActive ? tornPaper.paperColor : paperFrame.paperColor;
              const expandedFrameOpacity = polaroidActive ? polaroid.frameOpacity : tornActive ? tornPaper.paperOpacity : 1;
              const expandedFrameRadius = polaroidActive ? polaroid.cornerRadius : Math.min(18, paperFrame.borderWidth * 0.4);
              const expandedFrameTexture = polaroidActive ? polaroid.grain : tornActive ? tornPaper.grain : paperFrame.textureIntensity;
              const expandedOuterShadow = polaroidActive ? shadowToCss(polaroid.dropShadow) : tornActive ? shadowToCss(tornPaper.outerShadow) : "";
              const expandedInnerShadow = polaroidActive ? shadowToCss(polaroid.innerShadow) : tornActive ? shadowToCss(tornPaper.innerShadow) : "";
              const polaroidWarmth = polaroidActive ? paperWarmthOverlay(polaroid.warmth) : undefined;
              const tornPaperTexture = tornActive ? tornPaperTextureDataUrl(tornPaper, layer.width, layer.height) : undefined;
              const imageTransform = polaroidActive
                ? { scale: polaroid.imageScale, x: polaroid.imageOffsetX, y: polaroid.imageOffsetY, rotation: polaroid.imageRotation }
                : tornActive
                  ? { scale: tornPaper.imageScale, x: tornPaper.imageOffsetX, y: tornPaper.imageOffsetY, rotation: 0 }
                  : undefined;
              return (
                <React.Fragment key={layer.id}>
                <div
                  className={`placeholder ${selected ? "selected" : ""} ${layer.locked ? "locked" : ""} ${cropping ? "cropping" : ""} ${paperActive ? `paper-frame ${paperFrame.type}` : ""} ${rough ? "rough-paper" : ""} ${dropFeedback?.target === "placeholder" && dropFeedback.layerId === layer.id ? `drop-target ${dropFeedback.valid ? "drop-valid" : "drop-invalid"}` : ""}`}
                  style={{
                    left: layer.x,
                    top: layer.y,
                    width: layer.width,
                    height: layer.height,
                    transform: `rotate(${layer.rotation + expandedFrameRotation}deg)`,
                    borderWidth: layer.borderWidth,
                    borderColor: hexWithOpacity(layer.borderColor, layer.borderOpacity),
                    borderRadius: paperActive ? expandedFrameRadius : layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? 0 : layer.borderRadius,
                    overflow: rough ? "visible" : "hidden",
                    clipPath: rough ? paperFrameClipPath(paperFrame, tornPaper, layer.width, layer.height) : undefined,
                    opacity: layer.opacity,
                    backgroundColor: paperActive ? hexWithOpacity(expandedFrameColor, expandedFrameOpacity) : layer.effects.backgroundColor,
                    mixBlendMode: layer.effects.blendMode,
                    boxShadow: [
                      layer.effects.glow ? "0 0 0 2px rgba(255,255,255,.8), 0 0 32px rgba(207,42,69,.38)" : "",
                      expandedOuterShadow,
                      !expandedOuterShadow && Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) > 0 ? `0 ${Math.max(4, paperFrame.shadowStrength * 0.18)}px ${Math.max(12, paperFrame.shadowStrength * 0.75)}px rgba(15,23,42,${Math.min(0.42, Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) / 180)})` : ""
                    ].filter(Boolean).join(", ") || "none"
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!layer.locked) setCropModeLayerId(layer.id);
                  }}
                  onDragEnter={(event) => updateDropFeedback(event, "placeholder", layer.id)}
                  onDragOver={(event) => updateDropFeedback(event, "placeholder", layer.id)}
                  onDragLeave={(event) => leaveDropTarget(event, "placeholder", layer.id)}
                  onDrop={(event) => void handlePlaceholderDrop(event, layer)}
                  onPointerDown={(event) => beginDrag(event, layer, cropping ? "crop" : "move")}
                >
                  {dropFeedback?.target === "placeholder" && dropFeedback.layerId === layer.id && (
                    <div className={`placeholder-drop-label ${dropFeedback.valid ? "valid" : "invalid"}`}>
                      <Upload size={16} />
                      <span>{dropFeedback.label}</span>
                    </div>
                  )}
                  {!cropping && (
                    <div className={`on-canvas-layer-controls ${selected ? "visible" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
                      <button
                        className="tooltip-anchor"
                        data-tooltip={layer.locked ? "Unlock layer" : "Lock layer"}
                        aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
                        onClick={(event) => { event.stopPropagation(); toggleLayerLock(layer.id); }}
                      >{layer.locked ? <Unlock size={14} /> : <Lock size={14} />}</button>
                      <button
                        className="tooltip-anchor"
                        data-tooltip="Hide layer"
                        aria-label="Hide layer"
                        onClick={(event) => { event.stopPropagation(); toggleLayerVisibility(layer.id); }}
                      ><EyeOff size={14} /></button>
                    </div>
                  )}
                  {paperActive && <span className="paper-frame-texture" style={{ opacity: expandedFrameTexture / 100, backgroundImage: paperTextureBackground({ ...layer.effects.paper, type: layer.effects.paper.type === "none" ? "paper" : layer.effects.paper.type }, project.customTextures) }} />}
                  {polaroidWarmth && <span className="polaroid-warmth-overlay" style={{ backgroundColor: polaroidWarmth.color, opacity: polaroidWarmth.opacity }} />}
                  {tornPaperTexture && <span className="torn-paper-detail-overlay" style={{ backgroundImage: cssImageUrl(tornPaperTexture) }} />}
                  <div
                    className="placeholder-image-area"
                    style={{
                      left: insets.left,
                      top: insets.top,
                      width: innerWidth,
                      height: innerHeight,
                      borderRadius: layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? 0 : Math.max(0, layer.borderRadius - Math.max(insets.left, insets.top)),
                      backgroundColor: layer.effects.backgroundColor,
                      boxShadow: expandedInnerShadow ? `inset ${expandedInnerShadow}` : layer.effects.innerShadow ? "inset 0 0 22px rgba(15,23,42,.32)" : "none"
                    }}
                  >
                    {image ? (
                      <FramedImage
                        src={renderableLocalFileUrl(image.url)}
                        frameWidth={innerWidth}
                        frameHeight={innerHeight}
                        mode={layer.cropMode}
                        alignment={layer.alignment}
                        crop={layer.crop}
                        filter={cssFilter(layer.effects.filters)}
                        imageTransform={imageTransform}
                        onNatural={(natural) => { imageNaturalRef.current[layer.id] = natural; }}
                      />
                    ) : (
                      <span><ImagePlus size={22} /> Assign source</span>
                    )}
                    <span className="texture-overlay" style={textureStyle(layer, project.customTextures)} />
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
                {selectedLayerId === layer.id && !layer.locked && !cropping && (
                  <div
                    className="selection-handles-overlay"
                    style={{
                      left: layer.x,
                      top: layer.y,
                      width: layer.width,
                      height: layer.height,
                      transform: `rotate(${layer.rotation + expandedFrameRotation}deg)`
                    }}
                  >
                    <SelectionHandles layer={layer} onBeginDrag={beginDrag} />
                  </div>
                )}
                </React.Fragment>
              );
            })}
          </div>
          </div>
        </div>
        <footer className="status">{message}</footer>
      </section>

      <aside className={`sidebar right ${rightPanelOpen ? "" : "collapsed"}`}>
        <div className="panel-tabs inspector-tabs" role="tablist" aria-label="Inspector">
          {(selectedLayer
            ? ([ ["image", "Image"], ["effects", "Effects"] ] as Array<[InspectorTab, string]>)
            : ([ ["settings", "Settings"] ] as Array<[InspectorTab, string]>))
            .map(([id, label]) => (
              <button key={id} className={inspectorTab === id ? "active" : ""} onClick={() => setInspectorTab(id)}>{label}</button>
            ))}
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
            <WallpaperPanel
              project={project}
              onPatch={patchWallpaper}
              onPrevious={() => void applyPreviousWallpaper()}
              onNext={() => void applyNextWallpaper()}
              busy={wallpaperBusy}
              runtimeStatus={wallpaperStatus}
            />
          </>
        )}
        <Properties
          layer={selectedLayer}
          activeTab={inspectorTab}
          sources={project.sources}
          cropMode={cropModeLayerId === selectedLayer?.id}
          onPatch={(patch) => patchSelectedLayer(patch)}
          onDelete={deleteSelectedLayer}
          onCrop={() => selectedLayer && setCropModeLayerId(cropModeLayerId === selectedLayer.id ? undefined : selectedLayer.id)}
          onResetFrame={resetFrame}
          onMatchAspect={(layer) => void matchFrameToImage(layer)}
          onRegenerate={(layer) => {
            const selection = selectImageForLayer(project, layer, new Set<string>());
            if (!selection.imageId) return;
            patchLayer(layer.id, selection.layer);
          }}
        />
        </div>
      </aside>

      {pinterestDialog.open && (
        <PinterestDialog
          state={pinterestDialog}
          onChange={setPinterestDialog}
          onImport={() => void runPinterestImport("import")}
          onUpdate={() => void runPinterestImport("update")}
          onCancel={() => void cancelPinterestImport()}
          onClose={() => setPinterestDialog((current) => ({ ...current, open: false }))}
        />
      )}
      <RenameDialog state={renameState} onChange={setRenameState} onFinish={finishRename} />
      <ExportSetDialog
        state={exportSet}
        onChange={setExportSet}
        onChooseFolder={() => void chooseExportSetFolder()}
        onRun={() => void runExportSet()}
        onCancel={cancelExportSet}
        onCleanup={() => void cleanupWallpaperSets()}
        onReveal={(folderPath) => void revealWallpaperSet(folderPath)}
        onOpenSettings={() => void openMacOSWallpaperSettings()}
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
  message,
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
  message: string;
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
    { id: "favorites", label: "Favorites" },
    { id: "recent", label: "Recently Used" },
    { id: "rotation", label: "Active Rotation" }
  ];

  return (
    <main className="template-home">
      <header className="home-header">
        <div className="home-brand">
          <div className="home-brand-mark">P</div>
          <div>
            <span className="home-kicker">WALLPAPER STUDIO</span>
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
          <p className="home-eyebrow">A quiet space for changing walls</p>
          <h2>Wallpaper, made personal.<br /><span>Turn the images you love into an evolving visual space.</span></h2>
        </div>
        <div className="home-summary">
          <strong>{project.templates.templates.length}</strong>
          <span>saved templates</span>
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
              <TemplatePreview template={template} sources={project.sources} />
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
              {template.enabledForRotation && <span className="rotation-badge">Rotation</span>}
            </div>
            <div className="home-template-copy">
              <div>
                <h3>{template.name}</h3>
                <p>{template.project.canvas.width} × {template.project.canvas.height} · {template.project.layers.length} layers</p>
              </div>
              <time>{new Date(template.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
            </div>
            <div className="home-template-actions" onClick={(event) => event.stopPropagation()}>
              <button className="template-apply" onClick={() => onApply(template)}><Wallpaper size={15} /> Preview</button>
              <button onClick={() => onOpen(template)}>Edit</button>
              <button onClick={() => onDuplicate(template)}>Duplicate</button>
              <button onClick={() => onRename(template)}>Rename</button>
              <button onClick={() => onExportSet(template)}>Export Set</button>
              <button onClick={() => onToggleRotation(template)}>{template.enabledForRotation ? "Disable Rotation" : "Add to Rotation"}</button>
              <button className="danger" onClick={() => onDelete(template.id)}>Delete</button>
            </div>
          </article>
        ))}
      </section>

      <footer className="home-status">{message}</footer>
    </main>
  );
}

function TemplatePreview({ template, sources }: { template: WallpaperTemplate; sources: ImageSource[] }) {
  if (template.thumbnailDataUrl) {
    return <img className="home-template-image" src={template.thumbnailDataUrl} alt="" />;
  }
  const canvas = template.project.canvas;
  return (
    <div
      className="generated-template-preview"
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        backgroundColor: canvas.backgroundColor,
        backgroundImage: cssImageUrl(canvas.backgroundImage?.url)
      }}
    >
      {template.project.layers.filter((layer) => !layer.hidden).map((layer) => {
        const sourceIds = layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
        const previewSource = sourceIds
          .map((sourceId) => sources.find((source) => source.id === sourceId))
          .find((source) => source && sourceImagesForPolicy(source).length);
        const image = previewSource ? sourceImagesForPolicy(previewSource)[0] : undefined;
        return (
          <span
            key={layer.id}
            className="generated-template-layer"
            style={{
              left: `${(layer.x / canvas.width) * 100}%`,
              top: `${(layer.y / canvas.height) * 100}%`,
              width: `${(layer.width / canvas.width) * 100}%`,
              height: `${(layer.height / canvas.height) * 100}%`,
              transform: `rotate(${layer.rotation}deg)`,
              borderRadius: `${Math.min(18, layer.borderRadius / 2)}px`,
              backgroundImage: cssImageUrl(image?.url),
              backgroundColor: image ? undefined : "rgba(255,255,255,.6)"
            }}
          />
        );
      })}
    </div>
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
    customTexture?.url
  ]);

  if (!surfaceEffectIsVisible(paper)) return null;
  return (
    <canvas
      ref={canvasRef}
      className="canvas-surface-overlay"
      aria-hidden="true"
      style={{ width: canvas.width, height: canvas.height, mixBlendMode: paper.blendMode }}
    />
  );
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

function SelectionHandles({ layer, onBeginDrag }: { layer: PlaceholderLayer; onBeginDrag: (event: PointerEvent, layer: PlaceholderLayer, mode: DragMode) => void }) {
  const handles: DragMode[] = ["resize-nw", "resize-n", "resize-ne", "resize-e", "resize-se", "resize-s", "resize-sw", "resize-w"];
  function startControlDrag(event: PointerEvent, mode: DragMode) {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    onBeginDrag(event, layer, mode);
  }
  return (
    <>
      <button className="rotate-handle" onPointerDown={(event) => startControlDrag(event, "rotate")} aria-label="Rotate"><RotateCw size={13} /></button>
      {handles.map((handle) => (
        <button key={handle} className={`resize-handle ${handle}`} onPointerDown={(event) => startControlDrag(event, handle)} aria-label={handle} />
      ))}
    </>
  );
}

function ContextToolbar({
  layer,
  onPatch,
  onCrop,
  onDuplicate,
  onDelete,
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
    <div className="context-toolbar">
      <button disabled={layer.locked} onClick={() => onPatch({ cropMode: "cover" })}>Fill</button>
      <button disabled={layer.locked} onClick={() => onPatch({ cropMode: "contain" })}>Fit</button>
      <button disabled={layer.locked} onClick={() => onPatch({ crop: { offsetX: 0, offsetY: 0, zoom: 1 }, cropMode: "original", alignment: "center" })}>Original</button>
      <button disabled={layer.locked} onClick={onCrop}>Crop</button>
      <label className="mini-slider">Zoom<input disabled={layer.locked} type="range" min="0.5" max="3" step="0.05" value={layer.crop.zoom} onChange={(event) => onPatch({ crop: { ...layer.crop, zoom: Number(event.target.value) } })} /></label>
      <button onClick={() => onPatch({ locked: !layer.locked })}>{layer.locked ? <Lock size={16} /> : <Unlock size={16} />}</button>
      <button onClick={() => onPatch({ hidden: !layer.hidden })}>{layer.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      <button onClick={onDuplicate}><Copy size={16} /></button>
      <button disabled={layer.locked} onClick={() => onOrder("front")}><BringToFront size={16} /></button>
      <button disabled={layer.locked} onClick={() => onOrder("back")}><SendToBack size={16} /></button>
      <button disabled={layer.locked} className="danger" onClick={onDelete}><Trash2 size={16} /></button>
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
        <button onClick={() => onOrder("forward")}><ChevronUp size={15} /> Bring Forward</button>
        <button onClick={() => onOrder("backward")}><ChevronDown size={15} /> Send Backward</button>
        <button onClick={() => onOrder("back")}><SendToBack size={15} /> Send to Back</button>
        <button onClick={onDuplicate}><Copy size={15} /> Duplicate</button>
        <button className="danger" onClick={onDelete} disabled={layer.locked && selectionCount === 1}><Trash2 size={15} /> Delete</button>
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
  onDeleteCache
}: {
  state: SourceMenuState;
  source?: ImageSource;
  onClose: () => void;
  onRename: (source: ImageSource) => void;
  onRescan: (source: ImageSource) => void;
  onShow: (source: ImageSource) => void;
  onRemove: (source: ImageSource) => void;
  onDeleteCache: (source: ImageSource) => void;
}) {
  if (!source) return null;
  return (
    <>
      <button className="context-scrim" aria-label="Close source menu" onClick={onClose} />
      <div className="source-context-menu popover-menu" style={{ left: state.x, top: state.y }}>
        <button onClick={() => { onRename(source); onClose(); }}>Rename</button>
        <button onClick={() => { onRescan(source); onClose(); }}>{source.type === "pinterest-board" ? "Refresh" : "Rescan"}</button>
        <button onClick={() => { onShow(source); onClose(); }}>Show in Folder</button>
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
  const label = state.kind === "template" ? "Rename template" : state.kind === "source" ? "Rename source" : "Rename layer";
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
  onClose: () => void;
}) {
  if (!state.open) return null;
  const totalFinished = state.completed + state.failed;
  const progress = Math.min(100, (totalFinished / Math.max(1, state.count)) * 100);
  const ready = Boolean(state.finalPath);
  return (
    <div className="modal-backdrop" onMouseDown={() => !state.busy && onClose()}>
      <section className={`modal export-set-modal ${ready ? "setup-mode" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title-row">
          <div>
            <h2>{ready ? "Set Up Your macOS Wallpaper Rotation" : "Create macOS Wallpaper Set"}</h2>
            <p>{ready
              ? "Read these steps first. Wallpaper Settings opens only when you click the button below."
              : "Generate a new immutable folder of variations, then let macOS shuffle it across every desktop Space."}</p>
          </div>
          <button className="button ghost" disabled={state.busy} onClick={onClose}>Close</button>
        </div>

        {ready && state.finalPath ? (
          <div className="wallpaper-setup-guide">
            <div className="wallpaper-setup-banner">
              <strong>Your wallpaper set is ready.</strong>
              <span>Keep this instruction window open while completing the setup in System Settings.</span>
            </div>

            <div className="wallpaper-set-path-card">
              <span>Folder to select</span>
              <code>{state.finalPath}</code>
              <button className="button ghost" onClick={() => void navigator.clipboard.writeText(state.finalPath ?? "")}>Copy Folder Path</button>
            </div>

            <div className="wallpaper-setup-steps" aria-label="Wallpaper setup instructions">
              <div className="wallpaper-setup-step">
                <span className="setup-step-number">1</span>
                <div><strong>Locate the exported folder</strong><p>Click Show Set in Finder below. Leave that Finder window open so the correct folder is easy to identify.</p></div>
              </div>
              <div className="wallpaper-setup-step">
                <span className="setup-step-number">2</span>
                <div><strong>Open Wallpaper Settings</strong><p>Click Open Wallpaper Settings only after you have read these instructions.</p></div>
              </div>
              <div className="wallpaper-setup-step">
                <span className="setup-step-number">3</span>
                <div><strong>Add the folder</strong><p>Scroll to Your Photos, choose Add Photo, choose Choose Folder, then select the exact folder shown above.</p></div>
              </div>
              <div className="wallpaper-setup-step">
                <span className="setup-step-number">4</span>
                <div><strong>Enable the rotation</strong><p>Select Shuffle, choose the interval you want, and turn on Show on all Spaces.</p></div>
              </div>
            </div>

            <div className="wallpaper-setup-actions">
              <button className="button secondary" onClick={() => onReveal(state.finalPath)}>Show Set in Finder</button>
              <button className="button primary" onClick={onOpenSettings}>Open Wallpaper Settings</button>
            </div>

            <p className="settings-warning wallpaper-set-retention-warning">
              Keep this folder in place while macOS is using it. Before deleting an old set, select a different wallpaper folder in System Settings.
            </p>

            <div className="dialog-actions">
              <button className="button secondary" onClick={() => onChange((current) => ({
                ...current,
                finalPath: undefined,
                completed: 0,
                failed: 0,
                error: undefined
              }))}>Back to Set Options</button>
              <button className="button ghost" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="wallpaper-set-note">
              Each run creates a new versioned folder. Existing sets are never overwritten, preventing stale macOS folder caches.
            </div>

            <div className="export-set-grid">
              <label>Set name<input value={state.setName} maxLength={100} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, setName: event.target.value }))} placeholder="My Wallpaper Rotation" /></label>
              <label>Variations<input type="number" min="1" max="500" value={state.count} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, count: clamp(Number(event.target.value), 1, 500) }))} /><span className="field-note">1–500 wallpapers</span></label>
              <label>Format<select value={state.format} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, format: event.target.value as "png" | "jpeg" }))}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
              {state.format === "jpeg" && <label>JPEG quality<input type="range" min="0.4" max="1" step="0.02" value={state.quality} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, quality: Number(event.target.value) }))} /><span>{Math.round(state.quality * 100)}%</span></label>}
            </div>

            <div className="destination-row wallpaper-set-destination">
              <div>
                <strong>Wallpaper Sets parent folder</strong>
                <span title={state.destinationPath}>{state.destinationPath ?? "Loading default Pictures folder…"}</span>
              </div>
              <div className="destination-actions">
                <button className="button secondary" disabled={state.busy} onClick={onChooseFolder}>Choose</button>
                <button className="button ghost" disabled={!state.destinationPath || state.busy} onClick={() => onReveal(state.destinationPath)}>Open</button>
                <button className="button destructive" disabled={state.busy || state.cleanupBusy} onClick={onCleanup}>{state.cleanupBusy ? "Inspecting…" : "Delete All Sets…"}</button>
              </div>
            </div>

            <div className="export-options">
              <label><input type="checkbox" checked={state.avoidRepeats} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, avoidRepeats: event.target.checked }))} /> Avoid repeated combinations when possible</label>
              <label><input type="checkbox" checked={state.advanceLiveState} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, advanceLiveState: event.target.checked }))} /> Continue the source shuffle state after export</label>
            </div>

            {(state.busy || totalFinished > 0) && <>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
              <div className="export-summary"><span>{state.completed} of {state.count} generated</span><span>{state.failed} failed</span></div>
            </>}
            {state.error && <p className="dialog-error">{state.error}</p>}

            <div className="dialog-actions">
              {state.busy
                ? <button className="button destructive" onClick={onCancel}>Cancel and Remove Temporary Files</button>
                : <button className="button primary" onClick={onRun}>{`Generate ${Math.max(1, Math.round(state.count))} Wallpapers`}</button>}
              {!state.busy && <button className="button ghost" onClick={onClose}>Cancel</button>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PinterestDialog({
  state,
  onChange,
  onImport,
  onUpdate,
  onCancel,
  onClose
}: {
  state: PinterestDialogState;
  onChange: React.Dispatch<React.SetStateAction<PinterestDialogState>>;
  onImport: () => void;
  onUpdate: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <div className="modal-title-row">
          <div>
            <h2>Import Pinterest Board</h2>
            <p>Paste a public board URL. The app will cache imported images locally for offline wallpaper rotation.</p>
          </div>
          <button onClick={state.busy ? onCancel : onClose}>{state.busy ? "Stop Import" : "Close"}</button>
        </div>
        <label>Pinterest board URL<input value={state.url} onChange={(event) => onChange((current) => ({ ...current, url: event.target.value }))} placeholder="https://www.pinterest.com/user/board-name/" /></label>
        <div className="dialog-actions">
          <button className="pill-button primary" disabled={state.busy} onClick={onImport}>Import Board</button>
          <button className="pill-button" disabled={state.busy} onClick={onUpdate}>Update from Web</button>
        </div>
        <div className="progress-track"><span style={{ width: `${state.progress}%` }} /></div>
        <div className="import-stats">
          <span>{state.current ?? state.imagesFound}{state.total ? ` / ${state.total}` : ""} pins discovered</span>
          <span>{state.imagesCached} cached</span>
          {state.stage && <span className={`import-stage ${state.stage}`}>{state.stage}</span>}
        </div>
        {state.error && (
          <div className={`pinterest-error ${state.stage === "partial" ? "partial" : ""}`}>
            <strong>{state.stage === "partial" ? "Pinterest import incomplete" : state.stage === "canceled" ? "Pinterest import stopped" : "Pinterest import unavailable"}</strong>
            <p>{state.error}</p>
            <div className="dialog-actions">
              <button className="pill-button primary" disabled={state.busy} onClick={onUpdate}>{state.stage === "partial" || state.stage === "canceled" ? "Resume Update" : "Retry"}</button>
              <button className="pill-button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function WallpaperPanel({
  project,
  onPatch,
  onPrevious,
  onNext,
  busy,
  runtimeStatus
}: {
  project: WallpaperProject;
  onPatch: (patch: Partial<WallpaperProject["wallpaper"]>) => void;
  onPrevious: () => void;
  onNext: () => void;
  busy: boolean;
  runtimeStatus: WallpaperRuntimeStatus;
}) {
  return (
    <section className="panel wallpaper-panel settings-section">
      <details open>
        <summary>Wallpaper Assignment <ChevronDown size={15} /></summary>
        <label>
          Wallpaper assignment
          <select value={project.wallpaper.targetTemplateMode === "single-template" ? "single-template" : "different-template"} onChange={(event) => {
            const targetTemplateMode = event.target.value as "single-template" | "different-template";
            onPatch({
              targetTemplateMode,
              targetMode: "all-visible-monitors",
              scope: "same-all-desktops",
              monitorMode: "all",
              monitorId: undefined,
              targetTemplateIds: {},
              targetPlaylistIds: {}
            });
          }}>
            <option value="single-template">Same generated wallpaper on every display</option>
            <option value="different-template">Different generated variation on each display</option>
          </select>
        </label>
        <p className="settings-hint">Preview on Current Desktop affects only the active desktop. Create Wallpaper Set is the supported workflow for all Mission Control Spaces.</p>
      </details>

      <div className="wallpaper-set-note">
        Wallpaper rotation is managed by macOS after you select an exported set. This app no longer runs a background wallpaper schedule.
      </div>

      <div className="compact-action-row">
        <button className="button ghost" disabled={busy} onClick={onPrevious}>Previous</button>
        <button className="button ghost" disabled={busy} onClick={onNext}>Next</button>
      </div>

      <div className="wallpaper-status-card">
        <div><span>Status</span><strong>{runtimeStatus}</strong></div>
        {project.wallpaper.lastUpdatedAt && <div><span>Last applied</span><strong>{new Date(project.wallpaper.lastUpdatedAt).toLocaleTimeString()}</strong></div>}
        {project.wallpaper.lastError && <p className="status-error">{project.wallpaper.lastError}</p>}
      </div>
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
  const [resizeMode, setResizeMode] = useState<CanvasResizeMode>("keep");
  const [lockAspect, setLockAspect] = useState(true);
  const aspect = canvas.width / Math.max(1, canvas.height);

  useEffect(() => { setDraftWidth(canvas.width); setDraftHeight(canvas.height); }, [canvas.width, canvas.height]);
  function changeWidth(value: number) { const width = Math.max(64, value); setDraftWidth(width); if (lockAspect) setDraftHeight(Math.max(64, Math.round(width / aspect))); }
  function changeHeight(value: number) { const height = Math.max(64, value); setDraftHeight(height); if (lockAspect) setDraftWidth(Math.max(64, Math.round(height * aspect))); }
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

  return (
    <section className="panel canvas-design-panel settings-section">
      <details>
        <summary>Canvas <ChevronDown size={15} /></summary>
        <label>Preset<select value={canvas.presetId} onChange={(event) => onPreset(event.target.value, resizeMode)}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <div className="two-col"><label>Width<input type="number" min="64" value={draftWidth} onChange={(event) => changeWidth(Number(event.target.value))} /></label><label>Height<input type="number" min="64" value={draftHeight} onChange={(event) => changeHeight(Number(event.target.value))} /></label></div>
        <label>Resize content<select value={resizeMode} onChange={(event) => setResizeMode(event.target.value as CanvasResizeMode)}><option value="keep">Keep positions</option><option value="scale">Scale proportionally</option><option value="center">Center content</option></select></label>
        <div className="compact-action-row three-up">
          <button className={lockAspect ? "button selected" : "button secondary"} onClick={() => setLockAspect((value) => !value)}>Lock Ratio</button>
          <button className="button secondary" onClick={() => { setDraftWidth(canvas.height); setDraftHeight(canvas.width); }}>Swap</button>
          <button className="button secondary" onClick={() => { const ratio = window.devicePixelRatio || 1; setDraftWidth(Math.round(window.screen.width * ratio)); setDraftHeight(Math.round(window.screen.height * ratio)); }}>Use Current</button>
        </div>
        <button className="button primary full-width" onClick={() => onResize(draftWidth, draftHeight, resizeMode)}>Apply Size</button>
      </details>

      <details open>
        <summary>Background <ChevronDown size={15} /></summary>
        <div className="segmented-control two-options" role="group" aria-label="Background base">
          <button className={canvas.backgroundBaseMode === "color" ? "active" : ""} onClick={() => onPatch({ backgroundBaseMode: "color", backgroundTransparent: false })}>Color</button>
          <button className={canvas.backgroundBaseMode === "image" ? "active" : ""} onClick={() => canvas.backgroundImage ? onPatch({ backgroundBaseMode: "image", backgroundTransparent: false }) : onChooseBackground()}>Image</button>
        </div>
        {canvas.backgroundBaseMode === "color" && <label>Color<input type="color" value={canvas.backgroundColor} onChange={(event) => onPatch({ backgroundColor: event.target.value, backgroundTransparent: false })} /></label>}
        {canvas.backgroundBaseMode === "image" && <>
          <div className="compact-action-row"><button className="button secondary" onClick={onChooseBackground}><ImagePlus size={15} /> {canvas.backgroundImage ? "Replace" : "Choose"}</button><button className="button ghost" disabled={!canvas.backgroundImage} onClick={onClearBackground}>Remove</button></div>
          <label>Fit<select value={canvas.backgroundMode} onChange={(event) => onPatch({ backgroundMode: event.target.value as CanvasSettings["backgroundMode"] })}><option value="cover">Fill</option><option value="contain">Fit</option><option value="stretch">Stretch</option><option value="original">Original</option><option value="center">Center</option><option value="tile">Tile</option></select></label>
          <label>Alignment<select value={canvas.backgroundAlignment} onChange={(event) => onPatch({ backgroundAlignment: event.target.value as ImageAlignment })}>{alignmentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <FilterSlider label="Opacity" value={canvas.backgroundOpacity} min={0} max={1} step={0.05} onChange={(value) => onPatch({ backgroundOpacity: value })} />
        </>}
      </details>

      <details open>
        <summary>Surface <ChevronDown size={15} /></summary>
        <label className="surface-enable-row">
          <input
            type="checkbox"
            role="switch"
            checked={surface.enabled && surface.type !== "none"}
            onChange={(event) => setSurfaceEnabled(event.target.checked)}
          />
          <span><strong>Enable surface texture</strong><small>Applies across the complete wallpaper.</small></span>
        </label>
        <div className="texture-picker-grid compact-texture-grid">
          {surfaces.map((choice) => (
            <button
              key={choice.type}
              className={(choice.type === "none" ? !surface.enabled || surface.type === "none" : surface.enabled && surface.type === choice.type) ? "texture-choice active" : "texture-choice"}
              onClick={() => selectSurface(choice.type)}
            >
              <span className="texture-swatch" style={{ backgroundImage: cssImageUrl(choice.thumbnailUrl) }} />
              <span>{choice.label}</span>
            </button>
          ))}
          {customTextures.map((texture) => (
            <div className={surface.enabled && surface.type === "custom" && surface.customTextureId === texture.id ? "texture-choice custom active" : "texture-choice custom"} key={texture.id}>
              <button onClick={() => selectSurface("custom", texture.id)}>
                <span className="texture-swatch" style={{ backgroundImage: cssImageUrl(texture.url) }} />
                <span>{texture.name}</span>
              </button>
              <div className="texture-actions"><button onClick={() => onRevealTexture(texture.id)}>Show</button><button onClick={() => onRemoveTexture(texture.id)}>Remove</button></div>
            </div>
          ))}
        </div>
        <button className="button ghost compact" onClick={onImportTexture}>Import Custom Surface</button>
        {surface.enabled && surface.type !== "none" && (
          <div className="surface-controls">
            <FilterSlider label="Intensity" value={surface.intensity} min={0} max={100} onChange={(value) => patchPaper({ intensity: value })} />
            <FilterSlider label="Opacity" value={surface.opacity} min={0} max={1} step={.02} onChange={(value) => patchPaper({ opacity: value })} />
            <FilterSlider label="Scale" value={surface.scale} min={.2} max={5} step={.05} onChange={(value) => patchPaper({ scale: value })} />
            <FilterSlider label="Noise / grain" value={surface.noise} min={0} max={100} onChange={(value) => patchPaper({ noise: value })} />
            <FilterSlider label="Roughness" value={surface.roughness} min={0} max={100} onChange={(value) => patchPaper({ roughness: value })} />
            <FilterSlider label="Light / dark" value={surface.tone} min={-100} max={100} onChange={(value) => patchPaper({ tone: value })} />
            <FilterSlider label="Rotation" value={surface.rotation} min={-180} max={180} step={1} onChange={(value) => patchPaper({ rotation: value })} />
            <label>Blend mode<select value={surface.blendMode} onChange={(event) => patchPaper({ blendMode: event.target.value as PaperTextureEffect["blendMode"] })}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft Light</option></select></label>
            <div className="surface-seed-row">
              <label>Texture seed<input type="number" min="1" value={surface.seed} onChange={(event) => patchPaper({ seed: Math.max(1, Number(event.target.value) || 1) })} /></label>
              <button className="button secondary" onClick={() => patchPaper({ seed: nextSurfaceSeed(surface.seed) })}><RefreshCcw size={14} /> Regenerate Texture</button>
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
  activeTab,
  sources,
  cropMode,
  onPatch,
  onDelete,
  onRegenerate,
  onCrop,
  onResetFrame,
  onMatchAspect
}: {
  layer?: PlaceholderLayer;
  activeTab: InspectorTab;
  sources: ImageSource[];
  cropMode: boolean;
  onPatch: (patch: Partial<PlaceholderLayer>) => void;
  onDelete: () => void;
  onRegenerate: (layer: PlaceholderLayer) => void;
  onCrop: () => void;
  onResetFrame: (layer: PlaceholderLayer) => void;
  onMatchAspect: (layer: PlaceholderLayer) => void;
}) {
  if (!layer) return null;
  const activeLayer = layer;
  const sourceId = layer.sourceState.sourceIds[0] ?? layer.sourceId;
  const source = sources.find((item) => item.id === sourceId);

  if (layer.locked) {
    return <section className="panel muted-panel"><h2>{layer.name}</h2><p>This layer is locked. Use the lock control on the canvas to edit it.</p></section>;
  }

  function numeric<K extends keyof PlaceholderLayer>(key: K) {
    return (event: React.ChangeEvent<HTMLInputElement>) => onPatch({ [key]: Number(event.target.value) } as Partial<PlaceholderLayer>);
  }
  function patchFilters(patch: Partial<ImageFilters>) { onPatch({ effects: { ...activeLayer.effects, filters: { ...activeLayer.effects.filters, ...patch } } }); }
  function patchPaperFrame(patch: Partial<PlaceholderLayer["effects"]["paperFrame"]>) {
    const paperFrame = { ...activeLayer.effects.paperFrame, ...patch };
    const polaroid = normalizePolaroidEffect(activeLayer.effects.polaroid, paperFrame, activeLayer.effects.innerShadow);
    const tornPaper = normalizeTornPaperEffect(activeLayer.effects.tornPaper, paperFrame, activeLayer.effects.innerShadow);
    const base = Math.max(0, paperFrame.borderWidth + paperFrame.innerPadding);
    if (patch.type !== undefined) {
      polaroid.enabled = patch.type === "polaroid";
      tornPaper.enabled = patch.type === "torn" || patch.type === "deckle";
    }
    if (patch.borderWidth !== undefined || patch.innerPadding !== undefined) {
      polaroid.borderTop = base;
      polaroid.borderRight = base;
      polaroid.borderLeft = base;
      polaroid.borderBottom = base * 2.2;
      polaroid.captionHeight = Math.max(0, polaroid.borderBottom - base);
      tornPaper.imageInset = base;
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
      tornPaper.fibers = paperFrame.type === "deckle" ? patch.edgeRoughness : Math.round(patch.edgeRoughness * .45);
    }
    if (patch.seed !== undefined) tornPaper.seed = Math.max(1, Math.floor(patch.seed));
    onPatch({ effects: { ...activeLayer.effects, paperFrame, polaroid, tornPaper } });
  }
  function resetCrop() { onPatch({ crop: { offsetX: 0, offsetY: 0, zoom: 1 }, alignment: "center" }); }
  const frameType = layer.effects.paperFrame.type;
  const polaroid = normalizePolaroidEffect(layer.effects.polaroid, layer.effects.paperFrame, layer.effects.innerShadow);
  function patchPolaroid(patch: Partial<PolaroidEffect>) {
    onPatch({ effects: { ...activeLayer.effects, polaroid: normalizePolaroidEffect({ ...polaroid, ...patch }, activeLayer.effects.paperFrame, activeLayer.effects.innerShadow) } });
  }
  function patchPolaroidShadow(kind: "dropShadow" | "innerShadow", patch: Partial<ShadowEffect>) {
    patchPolaroid({ [kind]: { ...polaroid[kind], ...patch } } as Partial<PolaroidEffect>);
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
  function patchTornPaperShadow(kind: "outerShadow" | "innerShadow", patch: Partial<ShadowEffect>) {
    patchTornPaper({ [kind]: { ...tornPaper[kind], ...patch } } as Partial<TornPaperEffect>);
  }
  function patchTornPaperEdges(edges: TornPaperEffect["edges"]) {
    patchTornPaper({ edges });
  }
  function resetTornPaper() {
    const type = frameType === "deckle" ? "deckle" : "torn";
    const defaults = createDefaultTornPaperEffect({ ...createDefaultPaperFrame(), type });
    onPatch({ effects: { ...activeLayer.effects, paperFrame: { ...activeLayer.effects.paperFrame, type }, tornPaper: { ...defaults, enabled: true, customPresets: tornPaper.customPresets } } });
  }

  return (
    <section className="panel properties">
      <div className="panel-title-row"><h2>{layer.name}</h2><button className="icon-button danger tooltip-anchor" data-tooltip="Delete layer" aria-label="Delete layer" onClick={onDelete}><Trash2 size={16} /></button></div>

      {activeTab === "image" && <>
        <details open>
          <summary>Source <ChevronDown size={15} /></summary>
          <div className="assigned-source-card"><span>{source ? sourceKindLabel(source) : "No source"}</span><strong>{source?.name ?? "Choose a source from the left panel"}</strong></div>
          <button className="button secondary full-width" disabled={!source} onClick={() => onRegenerate(layer)}><Shuffle size={15} /> Next Image</button>
        </details>

        <details open>
          <summary>Fit and Crop <ChevronDown size={15} /></summary>
          <label>Fit<select value={layer.cropMode} onChange={(event) => onPatch({ cropMode: event.target.value as CropMode })}><option value="cover">Fill</option><option value="contain">Fit</option><option value="stretch">Stretch</option><option value="original">Original</option><option value="tile">Tile</option></select></label>
          <label>Alignment<select value={layer.alignment} onChange={(event) => onPatch({ alignment: event.target.value as ImageAlignment })}>{alignmentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="compact-action-row"><button className={cropMode ? "button selected" : "button secondary"} onClick={onCrop}>{cropMode ? "Done Cropping" : "Crop"}</button><button className="button ghost" onClick={resetCrop}>Reset</button></div>
          <FilterSlider label="Zoom" value={layer.crop.zoom} min={.1} max={6} step={.05} onChange={(value) => onPatch({ crop: { ...layer.crop, zoom: value } })} />
          <div className="two-col"><label>Offset X<input type="number" value={layer.crop.offsetX} onChange={(event) => onPatch({ crop: { ...layer.crop, offsetX: Number(event.target.value) } })} /></label><label>Offset Y<input type="number" value={layer.crop.offsetY} onChange={(event) => onPatch({ crop: { ...layer.crop, offsetY: Number(event.target.value) } })} /></label></div>
        </details>

        <details>
          <summary>Adjustments <ChevronDown size={15} /></summary>
          <PresetButtons currentId={layer.effects.filters.presetId ?? "none"} onPick={patchFilters} />
          <FilterSlider label="Brightness" value={layer.effects.filters.brightness} min={0} max={200} onChange={(value) => patchFilters({ brightness: value, presetId: "custom" })} />
          <FilterSlider label="Contrast" value={layer.effects.filters.contrast} min={0} max={200} onChange={(value) => patchFilters({ contrast: value, presetId: "custom" })} />
          <FilterSlider label="Saturation" value={layer.effects.filters.saturation} min={0} max={200} onChange={(value) => patchFilters({ saturation: value, presetId: "custom" })} />
          <FilterSlider label="Temperature" value={layer.effects.filters.temperature} min={-100} max={100} onChange={(value) => patchFilters({ temperature: value, presetId: "custom" })} />
          <FilterSlider label="Fade" value={layer.effects.filters.fade} min={0} max={80} onChange={(value) => patchFilters({ fade: value, presetId: "custom" })} />
        </details>

        <details>
          <summary>Frame Position and Size <ChevronDown size={15} /></summary>
          <div className="two-col"><label>X<input type="number" value={Math.round(layer.x)} onChange={numeric("x")} /></label><label>Y<input type="number" value={Math.round(layer.y)} onChange={numeric("y")} /></label><label>Width<input type="number" min="16" value={Math.round(layer.width)} onChange={numeric("width")} /></label><label>Height<input type="number" min="16" value={Math.round(layer.height)} onChange={numeric("height")} /></label></div>
          <FilterSlider label="Rotation" value={layer.rotation} min={-180} max={180} onChange={(value) => onPatch({ rotation: value })} />
          <label className="toggle-setting"><input type="checkbox" checked={layer.keepAspectRatio} onChange={(event) => onPatch({ keepAspectRatio: event.target.checked })} /> Lock frame ratio</label>
          <div className="compact-action-row"><button className="button secondary" onClick={() => onMatchAspect(layer)}>Match Image</button><button className="button ghost" onClick={() => onResetFrame(layer)}>Reset Frame</button></div>
        </details>

        <details>
          <summary>Border and Shape <ChevronDown size={15} /></summary>
          <label>Shape<select value={layer.maskShape} onChange={(event) => onPatch({ maskShape: event.target.value as MaskShape })}><option value="rectangle">Rectangle</option><option value="rounded">Rounded</option><option value="circle">Circle</option></select></label>
          <div className="two-col"><label>Border<input type="number" min="0" value={layer.borderWidth} onChange={numeric("borderWidth")} /></label><label>Radius<input type="number" min="0" disabled={layer.maskShape !== "rounded"} value={layer.borderRadius} onChange={numeric("borderRadius")} /></label><label>Color<input type="color" value={layer.borderColor} onChange={(event) => onPatch({ borderColor: event.target.value })} /></label><label>Opacity<input type="number" min="0" max="1" step=".05" value={layer.borderOpacity} onChange={numeric("borderOpacity")} /></label></div>
          <FilterSlider label="Image opacity" value={layer.opacity} min={0} max={1} step={.05} onChange={(value) => onPatch({ opacity: value })} />
        </details>
      </>}

      {activeTab === "effects" && <>
        <details open>
          <summary>Paper Frame <ChevronDown size={15} /></summary>
          <label>Style<select value={frameType} onChange={(event) => patchPaperFrame({ type: event.target.value as PaperFrameType })}><option value="none">None</option><option value="clean">Clean</option><option value="polaroid">Polaroid</option><option value="torn">Torn</option><option value="deckle">Deckle</option><option value="newsprint">Newsprint</option></select></label>
          {frameType === "polaroid" ? (
            <PolaroidInspector
              layer={layer}
              effect={polaroid}
              onPatch={patchPolaroid}
              onPatchShadow={patchPolaroidShadow}
              onPatchCaption={patchPolaroidCaption}
              onPatchLayer={onPatch}
              onReset={resetPolaroid}
            />
          ) : frameType === "torn" || frameType === "deckle" ? (
            <TornPaperInspector
              layer={layer}
              effect={tornPaper}
              frameType={frameType}
              onPatch={patchTornPaper}
              onPatchEdges={patchTornPaperEdges}
              onPatchShadow={patchTornPaperShadow}
              onPatchLayer={onPatch}
              onReset={resetTornPaper}
            />
          ) : frameType !== "none" && <>
            <div className="two-col"><label>Paper<input type="color" value={layer.effects.paperFrame.paperColor} onChange={(event) => patchPaperFrame({ paperColor: event.target.value })} /></label><label>Border<input type="number" min="0" max="240" value={layer.effects.paperFrame.borderWidth} onChange={(event) => patchPaperFrame({ borderWidth: Number(event.target.value) })} /></label></div>
            {frameType === "clean" && <FilterSlider label="Padding" value={layer.effects.paperFrame.innerPadding} min={0} max={120} onChange={(value) => patchPaperFrame({ innerPadding: value })} />}
            <FilterSlider label="Shadow" value={layer.effects.paperFrame.shadowStrength} min={0} max={100} onChange={(value) => patchPaperFrame({ shadowStrength: value })} />
            <FilterSlider label="Texture" value={layer.effects.paperFrame.textureIntensity} min={0} max={100} onChange={(value) => patchPaperFrame({ textureIntensity: value })} />
          </>}
        </details>

        <details>
          <summary>Shadow and Blend <ChevronDown size={15} /></summary>
          <div className="toggle-row"><button className={layer.shadow ? "toggle active" : "toggle"} onClick={() => onPatch({ shadow: !layer.shadow })}>Outer Shadow</button><button className={layer.effects.innerShadow ? "toggle active" : "toggle"} onClick={() => onPatch({ effects: { ...layer.effects, innerShadow: !layer.effects.innerShadow } })}>Inner Shadow</button><button className={layer.effects.glow ? "toggle active" : "toggle"} onClick={() => onPatch({ effects: { ...layer.effects, glow: !layer.effects.glow } })}>Glow</button></div>
          <label>Blend<select value={layer.effects.blendMode} onChange={(event) => onPatch({ effects: { ...layer.effects, blendMode: event.target.value as PlaceholderLayer["effects"]["blendMode"] } })}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft Light</option></select></label>
        </details>

        <details>
          <summary>Advanced Adjustments <ChevronDown size={15} /></summary>
          <FilterSlider label="Exposure" value={layer.effects.filters.exposure} min={-20} max={20} onChange={(value) => patchFilters({ exposure: value, presetId: "custom" })} />
          <FilterSlider label="Blur" value={layer.effects.filters.blur} min={0} max={16} onChange={(value) => patchFilters({ blur: value, presetId: "custom" })} />
          <FilterSlider label="Sepia" value={layer.effects.filters.sepia} min={0} max={100} onChange={(value) => patchFilters({ sepia: value, presetId: "custom" })} />
          <FilterSlider label="Mono" value={layer.effects.filters.grayscale} min={0} max={100} onChange={(value) => patchFilters({ grayscale: value, presetId: "custom" })} />
          <FilterSlider label="Grain" value={layer.effects.filters.grain} min={0} max={100} onChange={(value) => patchFilters({ grain: value, presetId: "custom" })} />
        </details>
      </>}
    </section>
  );
}

function PolaroidInspector({
  layer,
  effect,
  onPatch,
  onPatchShadow,
  onPatchCaption,
  onPatchLayer,
  onReset
}: {
  layer: PlaceholderLayer;
  effect: PolaroidEffect;
  onPatch: (patch: Partial<PolaroidEffect>) => void;
  onPatchShadow: (kind: "dropShadow" | "innerShadow", patch: Partial<ShadowEffect>) => void;
  onPatchCaption: (patch: Partial<PolaroidEffect["caption"]>) => void;
  onPatchLayer: (patch: Partial<PlaceholderLayer>) => void;
  onReset: () => void;
}) {
  const number = (key: keyof Pick<PolaroidEffect, "borderTop" | "borderRight" | "borderBottom" | "borderLeft" | "captionHeight" | "imageInset">) =>
    (event: React.ChangeEvent<HTMLInputElement>) => onPatch({ [key]: Number(event.target.value) } as Partial<PolaroidEffect>);

  return (
    <div className="expanded-effect-editor polaroid-editor">
      <div className="effect-editor-heading">
        <div><strong>Polaroid Customization</strong><small>Frame and image settings are saved with this layer.</small></div>
        <button className="button ghost compact" onClick={onReset}>Reset Polaroid</button>
      </div>

      <details className="effect-subsection" open>
        <summary>Layout <ChevronDown size={14} /></summary>
        <div className="two-col">
          <label>Top border<input type="number" min="0" max="1000" value={effect.borderTop} onChange={number("borderTop")} /></label>
          <label>Right border<input type="number" min="0" max="1000" value={effect.borderRight} onChange={number("borderRight")} /></label>
          <label>Bottom border<input type="number" min="0" max="1000" value={effect.borderBottom} onChange={number("borderBottom")} /></label>
          <label>Left border<input type="number" min="0" max="1000" value={effect.borderLeft} onChange={number("borderLeft")} /></label>
        </div>
        <div className="two-col">
          <label>Caption area<input type="number" min="0" max="1000" value={effect.captionHeight} onChange={number("captionHeight")} /></label>
          <label>Image inset<input type="number" min="0" max="1000" value={effect.imageInset} onChange={number("imageInset")} /></label>
        </div>
      </details>

      <details className="effect-subsection" open>
        <summary>Photo Placement <ChevronDown size={14} /></summary>
        <div className="polaroid-direct-edit-note">
          <strong>Edit the photo directly on the canvas</strong>
          <span>Drag inside the photo to move it. Drag any corner dot to resize it. Use the round top handle to rotate it. Drag the white frame area to move the complete Polaroid.</span>
        </div>
        <label>Crop mode<select value={layer.cropMode} onChange={(event) => onPatchLayer({ cropMode: event.target.value as CropMode })}><option value="cover">Fill</option><option value="contain">Fit</option><option value="stretch">Stretch</option><option value="original">Original</option><option value="tile">Tile</option></select></label>
        <button className="button ghost full-width" onClick={() => {
          onPatch({ imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, imageRotation: 0 });
          onPatchLayer({ crop: { offsetX: 0, offsetY: 0, zoom: 1 }, alignment: "center" });
        }}>Reset Photo Placement</button>
      </details>

      <details className="effect-subsection">
        <summary>Frame <ChevronDown size={14} /></summary>
        <FilterSlider label="Frame rotation" value={effect.frameRotation} min={-180} max={180} step={1} onChange={(value) => onPatch({ frameRotation: value })} />
        <div className="two-col">
          <label>Frame color<input type="color" value={effect.frameColor} onChange={(event) => onPatch({ frameColor: event.target.value })} /></label>
          <label>Frame opacity<input type="number" min="0" max="1" step=".05" value={effect.frameOpacity} onChange={(event) => onPatch({ frameOpacity: Number(event.target.value) })} /></label>
        </div>
        <FilterSlider label="Corner radius" value={effect.cornerRadius} min={0} max={160} step={1} onChange={(value) => onPatch({ cornerRadius: value })} />
      </details>

      <details className="effect-subsection">
        <summary>Paper Surface <ChevronDown size={14} /></summary>
        <FilterSlider label="Paper grain" value={effect.grain} min={0} max={100} onChange={(value) => onPatch({ grain: value })} />
        <FilterSlider label="Paper warmth" value={effect.warmth} min={-100} max={100} onChange={(value) => onPatch({ warmth: value })} />
      </details>

      <details className="effect-subsection">
        <summary>Shadows <ChevronDown size={14} /></summary>
        <ShadowInspector label="Drop shadow" effect={effect.dropShadow} onPatch={(patch) => onPatchShadow("dropShadow", patch)} />
        <ShadowInspector label="Inner shadow" effect={effect.innerShadow} onPatch={(patch) => onPatchShadow("innerShadow", patch)} />
      </details>

      <details className="effect-subsection">
        <summary>Caption <ChevronDown size={14} /></summary>
        <label className="toggle-setting"><input type="checkbox" checked={effect.caption.enabled} onChange={(event) => onPatchCaption({ enabled: event.target.checked })} /> Show caption</label>
        <label>Caption text<textarea value={effect.caption.text} onChange={(event) => onPatchCaption({ text: event.target.value })} placeholder="Add a caption…" /></label>
        <label>Font<select value={effect.caption.fontFamily} onChange={(event) => onPatchCaption({ fontFamily: event.target.value })}><option value="Avenir Next">Avenir Next</option><option value="Helvetica Neue">Helvetica Neue</option><option value="Georgia">Georgia</option><option value="Courier New">Courier New</option><option value="system-ui">System</option></select></label>
        <div className="two-col">
          <label>Size<input type="number" min="6" max="240" value={effect.caption.fontSize} onChange={(event) => onPatchCaption({ fontSize: Number(event.target.value) })} /></label>
          <label>Weight<select value={effect.caption.fontWeight} onChange={(event) => onPatchCaption({ fontWeight: Number(event.target.value) })}><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label>
          <label>Color<input type="color" value={effect.caption.color} onChange={(event) => onPatchCaption({ color: event.target.value })} /></label>
          <label>Alignment<select value={effect.caption.alignment} onChange={(event) => onPatchCaption({ alignment: event.target.value as PolaroidEffect["caption"]["alignment"] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          <label>Position X<input type="number" value={effect.caption.x} onChange={(event) => onPatchCaption({ x: Number(event.target.value) })} /></label>
          <label>Position Y<input type="number" value={effect.caption.y} onChange={(event) => onPatchCaption({ y: Number(event.target.value) })} /></label>
        </div>
        <button className="button ghost full-width" onClick={() => onPatchCaption({ enabled: false, text: "", fontFamily: "Avenir Next", fontSize: 28, fontWeight: 600, color: "#2f3033", alignment: "center", x: 0, y: 0 })}>Reset Caption</button>
      </details>
    </div>
  );
}


function TornPaperInspector({
  layer,
  effect,
  frameType,
  onPatch,
  onPatchEdges,
  onPatchShadow,
  onPatchLayer,
  onReset
}: {
  layer: PlaceholderLayer;
  effect: TornPaperEffect;
  frameType: "torn" | "deckle";
  onPatch: (patch: Partial<TornPaperEffect>, markCustom?: boolean) => void;
  onPatchEdges: (edges: TornPaperEffect["edges"]) => void;
  onPatchShadow: (kind: "outerShadow" | "innerShadow", patch: Partial<ShadowEffect>) => void;
  onPatchLayer: (patch: Partial<PlaceholderLayer>) => void;
  onReset: () => void;
}) {
  const [linkEdges, setLinkEdges] = useState(false);
  const presets = [...bundledTornPaperPresets, ...(effect.customPresets ?? [])];
  const selectedPreset = presets.find((preset) => preset.id === effect.presetId);
  const selectedCustomPreset = selectedPreset && !selectedPreset.bundled ? selectedPreset : undefined;

  function applyPresetById(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (preset) onPatch(applyTornPaperPreset(effect, preset), false);
  }

  function savePreset() {
    const name = window.prompt("Name this torn-paper preset", "Custom Torn Paper");
    if (!name?.trim()) return;
    const preset = createCustomTornPaperPreset(effect, name);
    onPatch({ customPresets: [...(effect.customPresets ?? []), preset], presetId: preset.id }, false);
  }

  function duplicatePreset() {
    const source = selectedPreset ? applyTornPaperPreset(effect, selectedPreset) : effect;
    const preset = createCustomTornPaperPreset(source, `${selectedPreset?.name ?? "Torn Paper"} Copy`);
    onPatch({ customPresets: [...(effect.customPresets ?? []), preset], presetId: preset.id }, false);
  }

  function renamePreset() {
    if (!selectedCustomPreset) return;
    const name = window.prompt("Rename torn-paper preset", selectedCustomPreset.name);
    if (!name?.trim()) return;
    onPatch({
      customPresets: (effect.customPresets ?? []).map((preset) => preset.id === selectedCustomPreset.id ? { ...preset, name: name.trim() } : preset)
    }, false);
  }

  function deletePreset() {
    if (!selectedCustomPreset) return;
    const remaining = (effect.customPresets ?? []).filter((preset) => preset.id !== selectedCustomPreset.id);
    const fallback = bundledTornPaperPresets[0];
    onPatch({ ...applyTornPaperPreset(effect, fallback), customPresets: remaining, presetId: fallback.id }, false);
  }

  function restoreBundledPreset() {
    const fallback = bundledTornPaperPresets.find((preset) => preset.id === effect.presetId) ?? bundledTornPaperPresets[0];
    onPatch(applyTornPaperPreset(effect, fallback), false);
  }

  function patchEdge(edgeName: keyof TornPaperEffect["edges"], patch: Partial<TearEdgeEffect>) {
    if (linkEdges) {
      onPatchEdges({
        top: { ...effect.edges.top, ...patch },
        right: { ...effect.edges.right, ...patch },
        bottom: { ...effect.edges.bottom, ...patch },
        left: { ...effect.edges.left, ...patch }
      });
      return;
    }
    onPatchEdges({ ...effect.edges, [edgeName]: { ...effect.edges[edgeName], ...patch } });
  }

  function copyEdgeToAll(edgeName: keyof TornPaperEffect["edges"]) {
    const source = effect.edges[edgeName];
    onPatchEdges({ top: { ...source }, right: { ...source }, bottom: { ...source }, left: { ...source } });
  }

  return (
    <div className="expanded-effect-editor torn-paper-editor">
      <div className="effect-editor-heading">
        <div><strong>{frameType === "deckle" ? "Deckle Paper Customization" : "Torn Paper Customization"}</strong><small>Tear geometry stays fixed until its seed or geometry changes.</small></div>
        <button className="button ghost compact" onClick={onReset}>Reset Torn Paper</button>
      </div>

      <details className="effect-subsection" open>
        <summary>Presets <ChevronDown size={14} /></summary>
        <label>Texture preset<select value={effect.presetId ?? "custom"} onChange={(event) => applyPresetById(event.target.value)}>
          {bundledTornPaperPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          {(effect.customPresets ?? []).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          {effect.presetId === "custom" && <option value="custom">Custom</option>}
        </select></label>
        <div className="compact-action-row torn-preset-actions">
          <button className="button secondary" onClick={savePreset}>Save Current</button>
          <button className="button secondary" onClick={duplicatePreset}>Duplicate</button>
          <button className="button ghost" disabled={!selectedCustomPreset} onClick={renamePreset}>Rename</button>
          <button className="button ghost" disabled={!selectedCustomPreset} onClick={deletePreset}>Delete</button>
        </div>
        <button className="button ghost full-width" onClick={restoreBundledPreset}>Restore Bundled Preset</button>
      </details>

      <details className="effect-subsection" open>
        <summary>Tear Edges <ChevronDown size={14} /></summary>
        <label className="toggle-setting"><input type="checkbox" checked={linkEdges} onChange={(event) => setLinkEdges(event.target.checked)} /> Link all edges</label>
        <button className="button secondary full-width" onClick={() => onPatch({ seed: nextStableSeed(effect.seed) })}><RefreshCcw size={14} /> Regenerate Tear</button>
        <div className="tear-edge-list">
          {(["top", "right", "bottom", "left"] as const).map((edgeName) => (
            <TearEdgeInspector key={edgeName} name={edgeName} edge={effect.edges[edgeName]} onPatch={(patch) => patchEdge(edgeName, patch)} onCopy={() => copyEdgeToAll(edgeName)} />
          ))}
        </div>
      </details>

      <details className="effect-subsection" open>
        <summary>Paper Appearance <ChevronDown size={14} /></summary>
        <div className="two-col">
          <label>Paper color<input type="color" value={effect.paperColor} onChange={(event) => onPatch({ paperColor: event.target.value })} /></label>
          <label>Paper opacity<input type="number" min="0" max="1" step=".05" value={effect.paperOpacity} onChange={(event) => onPatch({ paperOpacity: Number(event.target.value) })} /></label>
        </div>
        <FilterSlider label="Grain" value={effect.grain} min={0} max={100} onChange={(value) => onPatch({ grain: value })} />
        <FilterSlider label="Fibers" value={effect.fibers} min={0} max={100} onChange={(value) => onPatch({ fibers: value })} />
        <FilterSlider label="Wrinkles" value={effect.wrinkles} min={0} max={100} onChange={(value) => onPatch({ wrinkles: value })} />
        <FilterSlider label="Stains" value={effect.stains} min={0} max={100} onChange={(value) => onPatch({ stains: value })} />
        <FilterSlider label="Speckles" value={effect.speckles} min={0} max={100} onChange={(value) => onPatch({ speckles: value })} />
        <FilterSlider label="Edge darkening" value={effect.edgeDarkening} min={0} max={100} onChange={(value) => onPatch({ edgeDarkening: value })} />
      </details>

      <details className="effect-subsection" open>
        <summary>Image <ChevronDown size={14} /></summary>
        <label>Crop mode<select value={layer.cropMode} onChange={(event) => onPatchLayer({ cropMode: event.target.value as CropMode })}><option value="cover">Fill</option><option value="contain">Fit</option><option value="stretch">Stretch</option><option value="original">Original</option><option value="tile">Tile</option></select></label>
        <FilterSlider label="Image inset" value={effect.imageInset} min={0} max={300} onChange={(value) => onPatch({ imageInset: value })} />
        <FilterSlider label="Image scale" value={effect.imageScale} min={.1} max={6} step={.05} onChange={(value) => onPatch({ imageScale: value })} />
        <div className="two-col">
          <label>Image X<input type="number" value={effect.imageOffsetX} onChange={(event) => onPatch({ imageOffsetX: Number(event.target.value) })} /></label>
          <label>Image Y<input type="number" value={effect.imageOffsetY} onChange={(event) => onPatch({ imageOffsetY: Number(event.target.value) })} /></label>
        </div>
        <button className="button ghost full-width" onClick={() => onPatch({ imageInset: 20, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 })}>Reset Image Placement</button>
      </details>

      <details className="effect-subsection">
        <summary>Shadows <ChevronDown size={14} /></summary>
        <ShadowInspector label="Outer shadow" effect={effect.outerShadow} onPatch={(patch) => onPatchShadow("outerShadow", patch)} />
        <ShadowInspector label="Inner shadow" effect={effect.innerShadow} onPatch={(patch) => onPatchShadow("innerShadow", patch)} />
      </details>
    </div>
  );
}

function TearEdgeInspector({ name, edge, onPatch, onCopy }: { name: keyof TornPaperEffect["edges"]; edge: TearEdgeEffect; onPatch: (patch: Partial<TearEdgeEffect>) => void; onCopy: () => void }) {
  return (
    <details className="tear-edge-editor">
      <summary><span>{name[0].toUpperCase() + name.slice(1)} edge</span><ChevronDown size={13} /></summary>
      <label className="toggle-setting"><input type="checkbox" checked={edge.enabled} onChange={(event) => onPatch({ enabled: event.target.checked })} /> Enable tearing</label>
      <FilterSlider label="Tear depth" value={edge.depth} min={0} max={100} onChange={(value) => onPatch({ depth: value })} />
      <FilterSlider label="Frequency" value={edge.frequency} min={2} max={128} onChange={(value) => onPatch({ frequency: value })} />
      <FilterSlider label="Scale" value={edge.scale} min={.1} max={8} step={.05} onChange={(value) => onPatch({ scale: value })} />
      <FilterSlider label="Waviness" value={edge.waviness} min={0} max={100} onChange={(value) => onPatch({ waviness: value })} />
      <FilterSlider label="Roughness" value={edge.roughness} min={0} max={100} onChange={(value) => onPatch({ roughness: value })} />
      <button className="button ghost full-width" onClick={onCopy}>Copy to All Edges</button>
    </details>
  );
}

function ShadowInspector({ label, effect, onPatch }: { label: string; effect: ShadowEffect; onPatch: (patch: Partial<ShadowEffect>) => void }) {
  return (
    <div className="shadow-inspector">
      <label className="toggle-setting"><input type="checkbox" checked={effect.enabled} onChange={(event) => onPatch({ enabled: event.target.checked })} /> {label}</label>
      {effect.enabled && <>
        <div className="two-col">
          <label>X<input type="number" value={effect.x} onChange={(event) => onPatch({ x: Number(event.target.value) })} /></label>
          <label>Y<input type="number" value={effect.y} onChange={(event) => onPatch({ y: Number(event.target.value) })} /></label>
          <label>Blur<input type="number" min="0" max="300" value={effect.blur} onChange={(event) => onPatch({ blur: Number(event.target.value) })} /></label>
          <label>Spread<input type="number" min="-100" max="200" value={effect.spread} onChange={(event) => onPatch({ spread: Number(event.target.value) })} /></label>
          <label>Opacity<input type="number" min="0" max="1" step=".05" value={effect.opacity} onChange={(event) => onPatch({ opacity: Number(event.target.value) })} /></label>
          <label>Color<input type="color" value={effect.color} onChange={(event) => onPatch({ color: event.target.value })} /></label>
        </div>
      </>}
    </div>
  );
}

function FilterSlider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="filter-slider"><span>{label}<b>{value}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
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

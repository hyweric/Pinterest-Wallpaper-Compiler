import React, { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  Link2,
  Lock,
  MoreHorizontal,
  PanelLeft,
  Pause,
  PencilLine,
  Play,
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
  MaskShape,
  PaperTextureEffect,
  PinterestImportProgress,
  PlaceholderLayer,
  WallpaperTemplate,
  WallpaperProject
} from "../shared/types";
import {
  activeTemplateSourceIds,
  createCombination,
  createDefaultEffects,
  createPlaceholder,
  createProject,
  createWallpaperTemplate,
  getImageForLayer,
  linkSourceToActiveTemplate,
  normalizeProject,
  presets,
  selectImageForLayer,
  touchProject,
  uid,
  unlinkSourceFromActiveTemplate,
  updateActiveTemplateSnapshot,
  workspaceFromTemplate
} from "./project";
import { layerSelectionRange, moveLayerBlockToTarget, reorderLayerBlock, type LayerOrderAction } from "../shared/layers";
import { computeImagePlacement, removeBackgroundImage, resizeCanvasAndLayers } from "../shared/geometry";
import {
  appendAppliedHistory,
  generationStateAfterApplication,
  nextHistoryIndex,
  nextScheduledAt,
  planTemplateRotation,
  previousHistoryIndex,
  wallpaperIntervalToMs
} from "../shared/wallpaper";
import { renderProjectToDataUrl } from "./exporter";
import "./styles.css";

const autosaveKey = "pwc.autosave.v2";
const filePathKey = "pwc.filePath.v1";
const historyLimit = 80;
const snapDistance = 8;

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


function getDroppedPaths(event: React.DragEvent) {
  const filePaths = Array.from(event.dataTransfer.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((filePath): filePath is string => Boolean(filePath));
  const textPath = event.dataTransfer.getData("text/plain");
  if (filePaths.length === 0 && textPath.startsWith("/")) return [textPath];
  return filePaths;
}

function getDroppedPinterestUrl(event: React.DragEvent) {
  const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
  return text.includes("pinterest.") || text.includes("pin.it") ? text.trim() : undefined;
}

function getDroppedSourceId(event: React.DragEvent) {
  return event.dataTransfer.getData("application/x-pwc-source-id") || undefined;
}

function sourceIdentity(source: ImageSource) {
  if (source.type === "local-folder" && source.path) return `folder:${source.path}`;
  if (source.type === "pinterest-board" && source.url) return `pinterest:${source.url.replace(/\/$/, "").toLowerCase()}`;
  if (source.type === "local-file") {
    return `files:${source.images.map((image) => image.path).sort().join("|")}`;
  }
  return `${source.type}:${source.id}`;
}

function mergeReusableSources(existing: ImageSource[], incoming: ImageSource[]) {
  const sources = [...existing];
  const resolved: ImageSource[] = [];
  for (const candidate of incoming) {
    const key = sourceIdentity(candidate);
    const index = sources.findIndex((source) => sourceIdentity(source) === key);
    if (index >= 0) {
      const current = sources[index];
      const updated = { ...current, ...candidate, id: current.id, name: current.name };
      sources[index] = updated;
      resolved.push(updated);
    } else {
      sources.push(candidate);
      resolved.push(candidate);
    }
  }
  return { sources, resolved };
}

function prepareGeneratedProject(current: WallpaperProject, templateId = current.templates.activeTemplateId) {
  const used = new Set<string>();
  const assignments: Record<string, string> = {};
  const layers = current.layers.map((layer) => {
    if (layer.hidden) return layer;
    const selection = selectImageForLayer(current, layer, used);
    if (selection.imageId) assignments[layer.id] = selection.imageId;
    return selection.layer;
  });
  const combination = createCombination(assignments, templateId);
  return {
    project: { ...current, layers },
    combination
  };
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

function App() {
  const [project, setProject] = useState<WallpaperProject>(() => {
    const autosaved = localStorage.getItem(autosaveKey);
    if (!autosaved) return createProject();
    try {
      return normalizeProject(JSON.parse(autosaved) as WallpaperProject);
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
  const [dragActive, setDragActive] = useState(false);
  const [wallpaperHistoryIndex, setWallpaperHistoryIndex] = useState(0);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [sourceMenu, setSourceMenu] = useState<SourceMenuState | undefined>();
  const [layerMenu, setLayerMenu] = useState<LayerMenuState | undefined>();
  const [sourceLibraryView, setSourceLibraryView] = useState<SourceLibraryView>("linked");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
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
  const dragRef = useRef<DragState | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef(project);
  const applyInFlightRef = useRef(false);
  const loginRotationTriggeredRef = useRef(false);
  const selectedLayers = project.layers.filter((layer) => selectedLayerIds.includes(layer.id));
  const selectedLayer = project.layers.find((layer) => layer.id === selectedLayerId) ?? selectedLayers.at(-1);
  const linkedSourceIds = activeTemplateSourceIds(project);
  const linkedSources = project.sources.filter((source) => linkedSourceIds.includes(source.id));
  const visibleSources = sourceLibraryView === "linked" ? linkedSources : project.sources;
  const selectedSource = project.sources.find((source) => source.id === selectedSourceId) ?? linkedSources[0] ?? project.sources[0];
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
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    void window.wallpaperApi.setTrayState({ enabled: project.wallpaper.enabled, paused: project.wallpaper.paused });
  }, [project.wallpaper.enabled, project.wallpaper.paused]);

  useEffect(() => {
    return window.wallpaperApi.onTrayCommand((command) => {
      if (command === "generate-apply") void generateAndApply({ rotateTemplate: true });
      if (command === "previous") void applyPreviousWallpaper();
      if (command === "pause") patchWallpaper({ paused: true });
      if (command === "resume") patchWallpaper({ paused: false });
    });
  }, []);

  useEffect(() => {
    void window.wallpaperApi.applyStartupBehavior(projectRef.current.wallpaper.startMinimized);
  }, []);

  useEffect(() => {
    if (loginRotationTriggeredRef.current) return;
    if (!project.wallpaper.enabled || project.wallpaper.paused || project.wallpaper.interval !== "login") return;
    loginRotationTriggeredRef.current = true;
    void generateAndApply({ rotateTemplate: true, automatic: true });
  }, [project.wallpaper.enabled, project.wallpaper.paused, project.wallpaper.interval]);

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
    localStorage.setItem(autosaveKey, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    if (projectPath) localStorage.setItem(filePathKey, projectPath);
    else localStorage.removeItem(filePathKey);
  }, [projectPath]);

  const scaled = useMemo(
    () => ({ width: project.canvas.width * zoom, height: project.canvas.height * zoom }),
    [project.canvas.width, project.canvas.height, zoom]
  );

  useEffect(() => {
    const ms = wallpaperIntervalToMs(project.wallpaper.interval, project.wallpaper.customIntervalMinutes);
    if (!project.wallpaper.enabled || project.wallpaper.paused || !ms) {
      setProject((current) => current.wallpaper.nextScheduledAt
        ? { ...current, wallpaper: { ...current.wallpaper, nextScheduledAt: undefined } }
        : current);
      return;
    }
    setProject((current) => ({
      ...current,
      wallpaper: {
        ...current.wallpaper,
        nextScheduledAt: nextScheduledAt(current.wallpaper.interval, current.wallpaper.customIntervalMinutes)
      }
    }));
    const timer = window.setInterval(() => {
      void generateAndApply({ rotateTemplate: true, automatic: true });
    }, ms);
    return () => window.clearInterval(timer);
  }, [project.wallpaper.enabled, project.wallpaper.paused, project.wallpaper.interval, project.wallpaper.customIntervalMinutes]);

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
        layers: current.layers.map((layer) => (selected.has(layer.id) ? { ...layer, ...patch } : layer))
      }),
      historyEnabled
    );
  }

  function patchLayer(id: string, patch: Partial<PlaceholderLayer>, historyEnabled = true) {
    commitProject(
      (current) => ({
        ...current,
        layers: current.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer))
      }),
      historyEnabled
    );
  }

  function patchSelectedLayer(patch: Partial<PlaceholderLayer>, historyEnabled = true) {
    if (selectedLayer) patchLayer(selectedLayer.id, patch, historyEnabled);
  }

  function patchWallpaper(patch: Partial<WallpaperProject["wallpaper"]>) {
    commitProject((current) => ({ ...current, wallpaper: { ...current.wallpaper, ...patch } }));
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
      .filter((layer) => idSet.has(layer.id))
      .map((layer) => ({
        ...structuredClone(layer),
        id: uid("placeholder"),
        name: `${layer.name} Copy`,
        x: layer.x + 32,
        y: layer.y + 32
      }));
    if (copies.length === 0) return;
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
    const name = window.prompt("Layer name", layer.name)?.trim();
    if (!name || name === layer.name) return;
    patchLayer(layerId, { name });
    setLayerMenu(undefined);
  }

  function toggleLayerVisibility(layerId: string) {
    const layer = project.layers.find((item) => item.id === layerId);
    if (layer) patchLayer(layerId, { hidden: !layer.hidden });
  }

  function toggleLayerLock(layerId: string) {
    const layer = project.layers.find((item) => item.id === layerId);
    if (layer) patchLayer(layerId, { locked: !layer.locked });
  }

  async function chooseBackground() {
    const result = await window.wallpaperApi.chooseImageFile();
    if (result.canceled || !result.image) return;
    commitProject((current) => ({
      ...current,
      canvas: {
        ...current.canvas,
        backgroundImage: result.image,
        backgroundTransparent: false,
        backgroundOffsetX: 0,
        backgroundOffsetY: 0,
        backgroundScale: 1
      }
    }));
  }

  function clearBackgroundImage() {
    commitProject((current) => ({ ...current, canvas: removeBackgroundImage(current.canvas) }));
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
    if (result.error || !result.path || !result.images) {
      setMessage(result.error ?? "Unable to add folder.");
      return;
    }
    const source: ImageSource = {
      id: uid("source"),
      providerId: "local-folder",
      type: "local-folder",
      name: result.name ?? "Local folder",
      path: result.path,
      images: result.images,
      importStatus: "ready",
      importLog: [`Imported ${result.images.length} local images from ${result.path}.`],
      updatedAt: new Date().toISOString()
    };
    const [resolved] = addSourcesToProject([source]);
    if (resolved) {
      setSelectedSourceId(resolved.id);
      setMessage(`${resolved.id === source.id ? "Added" : "Updated"} ${resolved.images.length} images from ${resolved.name}`);
    }
  }

  function addSourcesToProject(sources: ImageSource[], images: LocalImageRef[] = [], linkToTemplate = true) {
    if (sources.length === 0 && images.length === 0) return [];
    const imageSource: ImageSource | undefined =
      images.length > 0
        ? {
            id: uid("source"),
            providerId: "local-file",
            type: "local-file",
            name: images.length === 1 ? images[0].name : `${images.length} local images`,
            images,
            importStatus: "ready",
            importLog: [`Imported ${images.length} local image files as one collection.`],
            updatedAt: new Date().toISOString()
          }
        : undefined;
    const nextSources = [...sources, ...(imageSource ? [imageSource] : [])];
    const merged = mergeReusableSources(project.sources, nextSources);
    commitProject((current) => {
      const resolved = mergeReusableSources(current.sources, nextSources);
      let next = { ...current, sources: resolved.sources };
      if (linkToTemplate) {
        for (const source of resolved.resolved) next = linkSourceToActiveTemplate(next, source.id);
      }
      return next;
    });
    setSelectedSourceId(merged.resolved[0]?.id);
    if (linkToTemplate) setSourceLibraryView("linked");
    setMessage(`${merged.resolved.length} reusable source${merged.resolved.length === 1 ? "" : "s"} ready${linkToTemplate ? " and linked to this template" : ""}.`);
    return merged.resolved;
  }

  function assignSourceToLayer(source: ImageSource, layer: PlaceholderLayer) {
    const singleImage = source.images.length === 1;
    patchLayer(layer.id, {
      sourceId: source.id,
      selectedImageId: singleImage ? source.images[0]?.id : undefined,
      generatedImageId: undefined,
      sourceState: {
        ...layer.sourceState,
        sourceIds: [source.id],
        mode: singleImage ? "fixed" : "shuffle",
        currentIndex: 0,
        shuffleQueue: [],
        usedImageIds: [],
        preventDuplicates: source.images.length > 1
      }
    });
    setSelectedSourceId(source.id);
    setMessage(`Assigned ${source.name} to ${layer.name}.`);
  }

  async function importDroppedPaths(paths: string[]) {
    if (paths.length === 0) return;
    const result = await window.wallpaperApi.importPaths(paths);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    addSourcesToProject(result.sources, result.images);
  }

  async function assignDroppedPathsToLayer(paths: string[], layer: PlaceholderLayer) {
    const result = await window.wallpaperApi.importPaths(paths);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    const addedSources = addSourcesToProject(result.sources, result.images);
    const source = addedSources[0];
    if (!source) return;
    assignSourceToLayer(source, layer);
  }

  async function addLocalImagesSource() {
    const result = await window.wallpaperApi.chooseImageFiles();
    if (result.canceled) return;
    const images = result.images ?? (result.image ? [result.image] : []);
    if (result.error || images.length === 0) {
      setMessage(result.error ?? "No images selected.");
      return;
    }
    const source: ImageSource = {
      id: uid("source"),
      providerId: "local-file",
      type: "local-file",
      name: images.length === 1 ? images[0].name : `${images.length} local images`,
      images,
      importStatus: "ready",
      importLog: [`Imported ${images.length} individual local images.`],
      updatedAt: new Date().toISOString()
    };
    const [resolved] = addSourcesToProject([source]);
    if (resolved) {
      setSelectedSourceId(resolved.id);
      setMessage(`${resolved.id === source.id ? "Added" : "Reused"} ${resolved.name}`);
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

  function generate() {
    const current = projectRef.current;
    const prepared = prepareGeneratedProject(current);
    const next = touchProject(updateActiveTemplateSnapshot(normalizeProject(prepared.project)));
    projectRef.current = next;
    setProject(next);
    setWallpaperHistoryIndex(0);
    setMessage("Generated a new wallpaper preview");
  }

  function recordWallpaperFailure(error: string, automatic: boolean) {
    const failures = (projectRef.current.wallpaper.consecutiveFailures ?? 0) + 1;
    setProject((current) => {
      const next = {
        ...current,
        wallpaper: {
          ...current.wallpaper,
          lastError: error,
          consecutiveFailures: failures,
          paused: automatic && failures >= 3 ? true : current.wallpaper.paused,
          nextScheduledAt: automatic && failures >= 3
            ? undefined
            : nextScheduledAt(current.wallpaper.interval, current.wallpaper.customIntervalMinutes)
        }
      };
      projectRef.current = next;
      return next;
    });
    setMessage(automatic && failures >= 3 ? `${error} Rotation paused after repeated failures.` : error);
  }

  async function applyCandidate(
    candidate: WallpaperProject,
    combination: GeneratedCombination,
    options: { automatic?: boolean; label?: string } = {}
  ) {
    if (applyInFlightRef.current) {
      setMessage("A wallpaper is already being applied.");
      return false;
    }
    applyInFlightRef.current = true;
    setWallpaperBusy(true);
    try {
      const dataUrl = await renderProjectToDataUrl(candidate, "png");
      const result = await window.wallpaperApi.applyWallpaper({
        dataUrl,
        suggestedName: `${candidate.name.replace(/[^\w.-]+/g, "-")}-${Date.now()}.png`,
        monitorMode: candidate.wallpaper.monitorMode,
        displayMode: candidate.wallpaper.displayMode
      });
      if (!result.ok || !result.filePath) {
        recordWallpaperFailure(result.error ?? "The operating system did not apply the wallpaper.", Boolean(options.automatic));
        return false;
      }

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
      const committedCandidate = generationStateAfterApplication(projectRef.current, candidate, true);
      const finalProject = touchProject(updateActiveTemplateSnapshot({
        ...committedCandidate,
        wallpaper: {
          ...candidate.wallpaper,
          lastUpdatedAt: appliedAt,
          lastAppliedFilePath: result.filePath,
          lastAppliedTemplateId: templateId,
          lastError: undefined,
          consecutiveFailures: 0,
          nextScheduledAt: candidate.wallpaper.enabled && !candidate.wallpaper.paused
            ? nextScheduledAt(candidate.wallpaper.interval, candidate.wallpaper.customIntervalMinutes, new Date(appliedAt))
            : undefined
        },
        recentCombinations: appendAppliedHistory(candidate.recentCombinations, historyEntry)
      }));
      projectRef.current = finalProject;
      setProject(finalProject);
      setWallpaperHistoryIndex(0);
      setMessage(`${options.label ?? "Wallpaper applied"}: ${result.filePath}`);
      return true;
    } catch (error) {
      recordWallpaperFailure(error instanceof Error ? error.message : "Unable to render and apply wallpaper.", Boolean(options.automatic));
      return false;
    } finally {
      applyInFlightRef.current = false;
      setWallpaperBusy(false);
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

    const prepared = prepareGeneratedProject(base, targetTemplateId);
    await applyCandidate(normalizeProject(prepared.project), prepared.combination, {
      automatic: options.automatic,
      label: options.automatic ? "Wallpaper rotated" : target ? `Applied “${target.name}”` : "Wallpaper applied"
    });
  }

  async function applyCurrentDesignAsWallpaper() {
    const current = normalizeProject(projectRef.current);
    const assignments = Object.fromEntries(
      current.layers
        .map((layer) => [layer.id, layer.generatedImageId ?? layer.selectedImageId] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
    const combination = createCombination(assignments, current.templates.activeTemplateId);
    await applyCandidate(current, combination, { label: "Current preview applied" });
  }

  async function applyHistoryAt(index: number) {
    const current = projectRef.current;
    const entry = current.recentCombinations[index];
    if (!entry?.filePath) {
      setMessage("That wallpaper file is no longer available in history.");
      return;
    }
    setWallpaperBusy(true);
    try {
      const result = await window.wallpaperApi.applyWallpaperFile({
        filePath: entry.filePath,
        monitorMode: current.wallpaper.monitorMode,
        displayMode: current.wallpaper.displayMode
      });
      if (!result.ok) {
        recordWallpaperFailure(result.error ?? "Unable to apply wallpaper history item.", false);
        return;
      }
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
      setMessage(`Applied history: ${entry.templateName ?? entry.name}`);
    } catch (error) {
      recordWallpaperFailure(error instanceof Error ? error.message : "Unable to apply wallpaper history item.", false);
    } finally {
      setWallpaperBusy(false);
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

    const additive = event.metaKey || event.ctrlKey;
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
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;

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
      patchLayer(
        drag.id,
        { crop: { ...drag.layer.crop, offsetX: drag.layer.crop.offsetX + dx, offsetY: drag.layer.crop.offsetY + dy } },
        false
      );
      return;
    }

    if (drag.mode === "rotate") {
      const cx = (drag.layer.x + drag.layer.width / 2) * zoom;
      const cy = (drag.layer.y + drag.layer.height / 2) * zoom;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const angle = Math.atan2(event.clientY - rect.top - cy, event.clientX - rect.left - cx) * (180 / Math.PI) + 90;
      patchLayer(drag.id, { rotation: Math.round(angle) }, false);
      return;
    }

    resizeLayer(drag, dx, dy, event.shiftKey || drag.layer.keepAspectRatio, event.altKey);
  }

  function resizeLayer(drag: DragState, dx: number, dy: number, preserveAspect: boolean, fromCenter: boolean) {
    const layer = drag.layer;
    let { x, y, width, height } = layer;
    if (drag.mode.includes("e")) width += dx;
    if (drag.mode.includes("s")) height += dy;
    if (drag.mode.includes("w")) {
      x += dx;
      width -= dx;
    }
    if (drag.mode.includes("n")) {
      y += dy;
      height -= dy;
    }
    if (fromCenter) {
      x -= dx / 2;
      y -= dy / 2;
      width += Math.abs(dx);
      height += Math.abs(dy);
    }
    if (preserveAspect) {
      const aspect = layer.width / layer.height;
      if (Math.abs(dx) > Math.abs(dy)) height = width / aspect;
      else width = height * aspect;
    }
    patchLayer(
      drag.id,
      {
        x: Math.round(clamp(x, 0, project.canvas.width - 40)),
        y: Math.round(clamp(y, 0, project.canvas.height - 40)),
        width: Math.round(clamp(width, 40, project.canvas.width)),
        height: Math.round(clamp(height, 40, project.canvas.height))
      },
      false
    );
  }

  function endDrag() {
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

  function fitCanvas() {
    setZoom(0.36);
  }

  function zoomAtPoint(nextZoom: number, clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) {
      setZoom(nextZoom);
      return;
    }
    const rect = stage.getBoundingClientRect();
    const contentX = stage.scrollLeft + clientX - rect.left;
    const contentY = stage.scrollTop + clientY - rect.top;
    const ratio = nextZoom / zoom;
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      stage.scrollLeft = contentX * ratio - (clientX - rect.left);
      stage.scrollTop = contentY * ratio - (clientY - rect.top);
    });
  }

  function onCanvasWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    zoomAtPoint(clamp(zoom + direction * 0.06, 0.12, 1.6), event.clientX, event.clientY);
  }

  async function handleSourceDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragActive(false);
    const pinterestUrl = getDroppedPinterestUrl(event);
    if (pinterestUrl) {
      setPinterestDialog((current) => ({ ...current, open: true, url: pinterestUrl }));
      return;
    }
    await importDroppedPaths(getDroppedPaths(event));
  }

  async function handleCanvasDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragActive(false);
    const existingSourceId = getDroppedSourceId(event);
    if (existingSourceId) {
      const source = project.sources.find((item) => item.id === existingSourceId);
      if (!source) return;
      commitProject((current) => {
        const layer = createPlaceholder(current.canvas, current.layers.length + 1);
        layer.name = source.name;
        layer.sourceId = source.id;
        layer.selectedImageId = source.images.length === 1 ? source.images[0]?.id : undefined;
        layer.generatedImageId = undefined;
        layer.sourceState = {
          ...layer.sourceState,
          sourceIds: [source.id],
          mode: source.images.length === 1 ? "fixed" : "shuffle",
          preventDuplicates: source.images.length > 1
        };
        selectOnlyLayer(layer.id);
        return { ...current, layers: [...current.layers, layer] };
      });
      return;
    }
    const paths = getDroppedPaths(event);
    if (paths.length === 0) return;
    const result = await window.wallpaperApi.importPaths(paths);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    const addedSources = addSourcesToProject(result.sources, result.images);
    const source = addedSources[0];
    if (!source) return;
    commitProject((current) => {
      const layer = createPlaceholder(current.canvas, current.layers.length + 1);
      layer.name = source.name;
      layer.sourceId = source.id;
      layer.selectedImageId = source.images.length === 1 ? source.images[0]?.id : undefined;
      layer.generatedImageId = undefined;
      layer.sourceState = {
        ...layer.sourceState,
        sourceIds: [source.id],
        mode: source.images.length === 1 ? "fixed" : "shuffle",
        preventDuplicates: source.images.length > 1
      };
      selectOnlyLayer(layer.id);
      return { ...current, layers: [...current.layers, layer] };
    });
  }

  async function handlePlaceholderDrop(event: React.DragEvent, layer: PlaceholderLayer) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const existingSourceId = getDroppedSourceId(event);
    if (existingSourceId) {
      const source = project.sources.find((item) => item.id === existingSourceId);
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
    const name = window.prompt("Rename template", template.name)?.trim();
    if (!name) return;
    patchTemplate(template.id, { name });
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
    await generateAndApply({ templateId: template.id });
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
    const name = window.prompt("Rename source", source.name);
    if (!name?.trim()) return;
    commitProject((current) => ({
      ...current,
      sources: current.sources.map((item) => (item.id === source.id ? { ...item, name: name.trim(), updatedAt: new Date().toISOString() } : item))
    }));
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
    const refreshed = await window.wallpaperApi.rescanFolder(source.path);
    commitProject((current) => ({
      ...current,
      sources: current.sources.map((item) => (item.id === source.id ? { ...refreshed, id: source.id, name: source.name } : item))
    }));
    setMessage(`Rescanned ${refreshed.images.length} images.`);
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
    let lastGestureScale = 1;
    function onGestureStart(event: Event) {
      event.preventDefault();
      lastGestureScale = 1;
    }
    function onGestureChange(event: Event) {
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      event.preventDefault();
      const scale = gesture.scale ?? 1;
      const delta = scale - lastGestureScale;
      lastGestureScale = scale;
      zoomAtPoint(
        clamp(zoom + delta * 0.25, 0.12, 1.6),
        gesture.clientX ?? window.innerWidth / 2,
        gesture.clientY ?? window.innerHeight / 2
      );
    }
    function onKeyDown(event: KeyboardEvent) {
      const command = event.metaKey || event.ctrlKey;
      if (isTypingTarget(event.target) && !(command && event.key.toLowerCase() === "s")) return;
      if (command && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        zoomAtPoint(clamp(zoom + 0.08, 0.12, 1.6), window.innerWidth / 2, window.innerHeight / 2);
      } else if (command && event.key === "-") {
        event.preventDefault();
        zoomAtPoint(clamp(zoom - 0.08, 0.12, 1.6), window.innerWidth / 2, window.innerHeight / 2);
      } else if (command && event.key === "0") {
        event.preventDefault();
        fitCanvas();
      } else if (command && event.key === "1") {
        event.preventDefault();
        setZoom(1);
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
    window.addEventListener("gesturestart", onGestureStart);
    window.addEventListener("gesturechange", onGestureChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("gesturestart", onGestureStart);
      window.removeEventListener("gesturechange", onGestureChange);
    };
  }, [selectedLayer, selectedLayers, clipboardLayers, cropModeLayerId, project, projectPath, selectedLayerIds]);

  if (view === "home") {
    return (
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
        onOpenProject={() => void openProject()}
        onSaveProject={() => void saveProject()}
      />
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

        <section
          className={`source-library drop-zone ${dragActive ? "drag-active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => void handleSourceDrop(event)}
        >
          <div className="library-heading">
            <div>
              <span className="eyebrow">IMAGE POOLS</span>
              <h2>{sourceLibraryView === "linked" ? "Template Sources" : "Global Sources"}</h2>
            </div>
            <div className="compact-actions">
              <button className="icon-button" title="Add folder pool" onClick={addFolderSource}><FolderOpen size={17} /></button>
              <button className="icon-button" title="Add Pinterest board" onClick={() => setPinterestDialog((current) => ({ ...current, open: true }))}><Sparkles size={17} /></button>
              <button className="icon-button" title="Add local image collection" onClick={addLocalImagesSource}><ImagePlus size={17} /></button>
            </div>
          </div>

          <div className="source-tabs" role="tablist" aria-label="Source library">
            <button className={sourceLibraryView === "linked" ? "active" : ""} onClick={() => setSourceLibraryView("linked")}>This Template <span>{linkedSources.length}</span></button>
            <button className={sourceLibraryView === "global" ? "active" : ""} onClick={() => setSourceLibraryView("global")}>Global <span>{project.sources.length}</span></button>
          </div>

          <p className="source-help">
            {sourceLibraryView === "linked"
              ? "Only collections linked to this template appear here. Assign a whole pool to a placeholder; images cycle automatically."
              : "Reusable folders, boards, and image collections shared across every template. Individual images are never listed here."}
          </p>

          {sourceLibraryView === "linked" && linkedSources.length === 0 && (
            <button className="assign-source-button" onClick={() => setSourceLibraryView("global")}>
              <Plus size={16} /> Add from global sources
            </button>
          )}

          {selectedLayer && selectedSource && linkedSourceIds.includes(selectedSource.id) && (
            <button className="assign-source-button" onClick={() => assignSourceToLayer(selectedSource, selectedLayer)}>
              <Link2 size={16} /> Assign {selectedSource.name} to {selectedLayer.name}
            </button>
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
              const countLabel = source.expectedItemCount && source.expectedItemCount > source.images.length
                ? `${source.images.length} / ${source.expectedItemCount}`
                : `${source.images.length}`;
              return (
                <div
                  className={`${selectedSourceId === source.id ? "source-row active" : "source-row"} ${assigned ? "assigned" : ""}`}
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
                    onClick={() => setSelectedSourceId(source.id)}
                    onDoubleClick={() => linked && selectedLayer && assignSourceToLayer(source, selectedLayer)}
                  >
                    <span className="source-icon">{source.type === "local-folder" ? <FolderOpen size={17} /> : source.type === "pinterest-board" ? <Sparkles size={17} /> : <Images size={17} />}</span>
                    <span className="source-copy">
                      <strong>{source.name}</strong>
                      <span>{sourceKindLabel(source)} · {countLabel} items{source.importStatus === "partial" ? " · partial" : ""}</span>
                    </span>
                    {assigned && <span className="assigned-dot" title="Assigned to selected placeholder" />}
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

          <div className="source-footer">
            <span>{sourceLibraryView === "linked" ? "Double-click to assign the entire pool" : "Link collections to the active template"}</span>
            <span>{sourceLibraryView === "linked" ? "Unlink keeps the global source" : "Delete warns about template usage"}</span>
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

        <section className="sidebar-bottom-actions">
          <button onClick={saveAsTemplate}><LayoutTemplate size={16} /> Save template</button>
          <button onClick={() => setRightPanelOpen(true)}><SlidersHorizontal size={16} /> Edit details</button>
        </section>
      </aside>

      <section className="workspace">
        <header className="toolbar minimal-toolbar">
          <div className="toolbar-cluster">
            <button className="icon-button" title="Back to templates" onClick={() => void goHome()}><Home size={17} /></button>
            <button className="icon-button" title="Toggle sources panel" onClick={() => setLeftPanelOpen((value) => !value)}><PanelLeft size={17} /></button>
            <button className="icon-button" title="Open" onClick={openProject}><FolderOpen size={17} /></button>
            <button className="icon-button" title="Save" onClick={saveProject}><Save size={17} /></button>
            <button className="icon-button" title="Undo" onClick={undo} disabled={history.past.length === 0}>↶</button>
            <button className="icon-button" title="Redo" onClick={redo} disabled={history.future.length === 0}>↷</button>
          </div>
          <div className="toolbar-title">
            <strong>{project.name}</strong>
            <span>{project.canvas.width} x {project.canvas.height}</span>
          </div>
          <div className="toolbar-cluster">
            <button className="icon-button" title="Toggle layers panel" onClick={() => setRightPanelOpen((value) => !value)}><Layers size={17} /></button>
            <button onClick={addPlaceholder}><Plus size={17} /> Placeholder</button>
            <button className="primary-action" onClick={() => void generateAndApply()}><Wallpaper size={17} /> Apply</button>
            <div className="overflow-wrap">
              <button className="icon-button" title="More actions" onClick={() => setToolbarMenuOpen((value) => !value)}><MoreHorizontal size={18} /></button>
              {toolbarMenuOpen && (
                <div className="popover-menu toolbar-overflow">
                  <button onClick={saveProjectAs}>Save as</button>
                  <button onClick={generate}><RefreshCcw size={16} /> Generate Preview</button>
                  <button onClick={() => void applyCurrentDesignAsWallpaper()}><Wallpaper size={16} /> Set Current</button>
                  <button onClick={refreshPreview}><Eye size={16} /> Preview</button>
                  <button onClick={() => exportWallpaper("png")}><Download size={16} /> Export PNG</button>
                  <button onClick={() => exportWallpaper("jpeg")}><Download size={16} /> Export JPEG</button>
                </div>
              )}
            </div>
            <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
          </div>
        </header>

        <div
          ref={stageRef}
          className={`canvas-stage ${dragActive ? "drag-active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => void handleCanvasDrop(event)}
          onWheel={onCanvasWheel}
        >
          {selectedLayer && (
            <ContextToolbar
              layer={selectedLayer}
              cropMode={cropModeLayerId === selectedLayer.id}
              onPatch={(patch) => patchSelectedLayer(patch)}
              onCrop={() => setCropModeLayerId(cropModeLayerId === selectedLayer.id ? undefined : selectedLayer.id)}
              onDuplicate={duplicateSelectedLayer}
              onDelete={deleteSelectedLayer}
              onOrder={reorderSelectedLayer}
            />
          )}
          <div
            className="canvas"
            style={{
              width: scaled.width,
              height: scaled.height,
              backgroundColor: project.canvas.backgroundTransparent ? "transparent" : project.canvas.backgroundColor,
              backgroundImage: project.canvas.backgroundTransparent
                ? "linear-gradient(45deg, #f1f1ef 25%, transparent 25%), linear-gradient(-45deg, #f1f1ef 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f1ef 75%), linear-gradient(-45deg, transparent 75%, #f1f1ef 75%)"
                : undefined,
              backgroundSize: project.canvas.backgroundTransparent ? `${16 * zoom}px ${16 * zoom}px` : undefined,
              backgroundPosition: project.canvas.backgroundTransparent ? `0 0, 0 ${8 * zoom}px, ${8 * zoom}px ${-8 * zoom}px, ${-8 * zoom}px 0px` : undefined
            }}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) clearLayerSelection();
            }}
          >
            <BackgroundImageView canvas={project.canvas} zoom={zoom} />
            {guides.x !== undefined && <div className="guide vertical" style={{ left: guides.x * zoom }} />}
            {guides.y !== undefined && <div className="guide horizontal" style={{ top: guides.y * zoom }} />}
            {project.layers.map((layer) => {
              const image = getImageForLayer(project, layer);
              if (layer.hidden) return null;
              const selected = selectedLayerIds.includes(layer.id);
              const cropping = cropModeLayerId === layer.id;
              return (
                <div
                  className={`placeholder ${selected ? "selected" : ""} ${layer.locked ? "locked" : ""} ${cropping ? "cropping" : ""} ${layer.effects.polaroidFrame ? "polaroid" : ""} ${layer.effects.tapeDecoration ? "taped" : ""}`}
                  key={layer.id}
                  style={{
                    left: layer.x * zoom,
                    top: layer.y * zoom,
                    width: layer.width * zoom,
                    height: layer.height * zoom,
                    transform: `rotate(${layer.rotation}deg)`,
                    borderWidth: layer.borderWidth * zoom,
                    borderColor: hexWithOpacity(layer.borderColor, layer.borderOpacity),
                    borderRadius: layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? 0 : layer.borderRadius * zoom,
                    overflow: "hidden",
                    opacity: layer.opacity,
                    backgroundColor: layer.effects.backgroundColor,
                    mixBlendMode: layer.effects.blendMode,
                    boxShadow: [
                      layer.effects.glow ? "0 0 0 2px rgba(255,255,255,.8), 0 0 32px rgba(207,42,69,.38)" : "",
                      layer.shadow ? "0 16px 34px rgba(15, 23, 42, 0.25)" : "",
                      layer.effects.innerShadow ? "inset 0 0 22px rgba(15,23,42,.32)" : ""
                    ].filter(Boolean).join(", ") || "none"
                  }}
	                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!layer.locked) setCropModeLayerId(layer.id);
	                  }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void handlePlaceholderDrop(event, layer)}
	                  onPointerDown={(event) => beginDrag(event, layer, cropping ? "crop" : "move")}
	                >
                  {image ? (
                    <FramedImage
                      src={image.url}
                      frameWidth={layer.width}
                      frameHeight={layer.height}
                      mode={layer.cropMode}
                      alignment={layer.alignment}
                      crop={layer.crop}
                      zoom={zoom}
                      filter={cssFilter(layer.effects.filters)}
                    />
                  ) : (
                    <span><ImagePlus size={22} /> Assign source</span>
                  )}
                  <span className="texture-overlay" style={textureStyle(layer)} />
                  {selectedLayerId === layer.id && !layer.locked && <SelectionHandles layer={layer} onBeginDrag={beginDrag} />}
                </div>
              );
            })}
          </div>
        </div>
        <footer className="status">{message}</footer>
      </section>

      <aside className={`sidebar right ${rightPanelOpen ? "" : "collapsed"}`}>
        <section className="panel">
          <h2><Layers size={17} /> Layers</h2>
          <div className="layers-list" aria-label="Layers from front to back">
            {[...project.layers].reverse().map((layer) => {
              const selected = selectedLayerIds.includes(layer.id);
              return (
                <div
                  className={`layer-row ${selected ? "active" : ""} ${layer.hidden ? "hidden" : ""}`}
                  key={layer.id}
                  draggable={!layer.locked}
                  onDragStart={(event) => {
                    const ids = (selected ? selectedLayerIds : [layer.id]).filter((id) => !project.layers.find((item) => item.id === id)?.locked);
                    if (!selected) selectOnlyLayer(layer.id);
                    event.dataTransfer.setData("application/x-pwc-layer-ids", JSON.stringify(ids));
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const raw = event.dataTransfer.getData("application/x-pwc-layer-ids");
                    let ids: string[] = [];
                    try { ids = JSON.parse(raw) as string[]; } catch { ids = []; }
                    if (!ids.length || ids.includes(layer.id)) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const beforeInPanel = event.clientY < rect.top + rect.height / 2;
                    commitProject((current) => ({
                      ...current,
                      layers: moveLayerBlockToTarget(current.layers, ids, layer.id, beforeInPanel)
                    }));
                    setSelectedLayerIds(ids);
                    setSelectedLayerId(ids.at(-1));
                  }}
                >
                  <span className="layer-drag-handle" title="Drag to reorder"><GripVertical size={15} /></span>
                  <button className="layer-main" onClick={(event) => selectLayerFromPanel(layer.id, event)}>
                    <span className="layer-type-icon"><ImagePlus size={14} /></span>
                    <span className="layer-name">{layer.name}</span>
                  </button>
                  <button className="layer-icon-button" title={layer.hidden ? "Show layer" : "Hide layer"} onClick={() => toggleLayerVisibility(layer.id)}>
                    {layer.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button className="layer-icon-button" title={layer.locked ? "Unlock layer" : "Lock layer"} onClick={() => toggleLayerLock(layer.id)}>
                    {layer.locked ? <Lock size={15} /> : <Unlock size={15} />}
                  </button>
                  <button
                    className="layer-icon-button"
                    title="Layer actions"
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
        </section>
        <CanvasDesignPanel
          canvas={project.canvas}
          onPatch={patchCanvas}
          onChooseBackground={() => void chooseBackground()}
          onClearBackground={clearBackgroundImage}
          onResize={resizeCanvas}
          onPreset={setPreset}
        />
        <WallpaperPanel
          project={project}
          onPatch={patchWallpaper}
          onGenerateApply={() => void generateAndApply()}
          onApplyCurrent={() => void applyCurrentDesignAsWallpaper()}
          onPrevious={() => void applyPreviousWallpaper()}
          onNext={() => void applyNextWallpaper()}
          onGenerate={() => generate()}
          busy={wallpaperBusy}
        />
        <Properties
          layer={selectedLayer}
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
        <section className="panel preview-panel">
          <h2>Preview</h2>
          {previewUrl ? <img src={previewUrl} /> : <div className="empty-preview">No preview rendered</div>}
        </section>
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
          <h2>Choose a composition.<br />Let the images evolve.</h2>
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
              <button className="template-apply" onClick={() => onApply(template)}><Wallpaper size={15} /> Apply</button>
              <button onClick={() => onOpen(template)}>Edit</button>
              <button onClick={() => onDuplicate(template)}>Duplicate</button>
              <button onClick={() => onRename(template)}>Rename</button>
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
        backgroundImage: canvas.backgroundImage ? `url(${canvas.backgroundImage.url})` : undefined
      }}
    >
      {template.project.layers.filter((layer) => !layer.hidden).map((layer) => {
        const sourceIds = layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
        const image = sourceIds
          .map((sourceId) => sources.find((source) => source.id === sourceId))
          .find((source) => source?.images.length)?.images[0];
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
              backgroundImage: image ? `url(${image.url})` : undefined,
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
  zoom,
  filter
}: {
  src: string;
  frameWidth: number;
  frameHeight: number;
  mode: CropMode;
  alignment: ImageAlignment;
  crop: PlaceholderLayer["crop"];
  zoom: number;
  filter?: string;
}) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const placement = natural.width
    ? computeImagePlacement(natural.width, natural.height, frameWidth, frameHeight, mode, alignment, crop)
    : undefined;

  if (placement?.tile) {
    return (
      <div
        className="framed-image tiled-image"
        style={{
          backgroundImage: `url(${src})`,
          backgroundRepeat: "repeat",
          backgroundSize: `${placement.width * zoom}px ${placement.height * zoom}px`,
          backgroundPosition: `${placement.x * zoom}px ${placement.y * zoom}px`,
          filter
        }}
      >
        <img className="image-dimension-probe" src={src} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      </div>
    );
  }

  return (
    <img
      src={src}
      className="framed-image"
      onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      style={placement ? {
        left: placement.x * zoom,
        top: placement.y * zoom,
        width: placement.width * zoom,
        height: placement.height * zoom,
        filter
      } : { opacity: 0 }}
    />
  );
}

function BackgroundImageView({ canvas, zoom }: { canvas: CanvasSettings; zoom: number }) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  if (!canvas.backgroundImage) {
    return <span className="canvas-background-texture" style={backgroundTextureStyle(canvas)} />;
  }
  const placement = natural.width
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
  const filter = `brightness(${canvas.backgroundBrightness}%) blur(${canvas.backgroundBlur * zoom}px)`;
  return (
    <>
      {placement?.tile ? (
        <div
          className="canvas-background-image tiled-image"
          style={{
            backgroundImage: `url(${canvas.backgroundImage.url})`,
            backgroundRepeat: "repeat",
            backgroundSize: `${placement.width * zoom}px ${placement.height * zoom}px`,
            backgroundPosition: `${placement.x * zoom}px ${placement.y * zoom}px`,
            filter,
            opacity: canvas.backgroundOpacity
          }}
        >
          <img className="image-dimension-probe" src={canvas.backgroundImage.url} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        </div>
      ) : (
        <img
          className="canvas-background-image"
          src={canvas.backgroundImage.url}
          onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          style={placement ? {
            left: placement.x * zoom,
            top: placement.y * zoom,
            width: placement.width * zoom,
            height: placement.height * zoom,
            filter,
            opacity: canvas.backgroundOpacity
          } : { opacity: 0 }}
        />
      )}
      <span className="canvas-background-texture" style={backgroundTextureStyle(canvas)} />
    </>
  );
}

function backgroundTextureStyle(canvas: CanvasSettings): React.CSSProperties {
  const paper = canvas.backgroundPaper;
  return {
    opacity: Math.max(paper.opacity, paper.intensity / 100),
    mixBlendMode: paper.blendMode,
    backgroundSize: `${28 / Math.max(0.4, paper.scale)}px ${28 / Math.max(0.4, paper.scale)}px`,
    transform: `rotate(${paper.rotation}deg)`
  };
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

function textureStyle(layer: PlaceholderLayer): React.CSSProperties {
  const paper = layer.effects.paper;
  return {
    opacity: Math.max(paper.opacity, layer.effects.filters.grain / 100),
    mixBlendMode: paper.blendMode,
    backgroundSize: `${28 / Math.max(0.4, paper.scale)}px ${28 / Math.max(0.4, paper.scale)}px`,
    transform: `rotate(${paper.rotation}deg)`
  };
}

function SelectionHandles({ layer, onBeginDrag }: { layer: PlaceholderLayer; onBeginDrag: (event: PointerEvent, layer: PlaceholderLayer, mode: DragMode) => void }) {
  const handles: DragMode[] = ["resize-nw", "resize-n", "resize-ne", "resize-e", "resize-se", "resize-s", "resize-sw", "resize-w"];
  return (
    <>
      <button className="rotate-handle" onPointerDown={(event) => onBeginDrag(event, layer, "rotate")} aria-label="Rotate"><RotateCw size={13} /></button>
      {handles.map((handle) => (
        <button key={handle} className={`resize-handle ${handle}`} onPointerDown={(event) => onBeginDrag(event, layer, handle)} aria-label={handle} />
      ))}
    </>
  );
}

function ContextToolbar({
  layer,
  cropMode,
  onPatch,
  onCrop,
  onDuplicate,
  onDelete,
  onOrder
}: {
  layer: PlaceholderLayer;
  cropMode: boolean;
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
      <button disabled={layer.locked} className={cropMode ? "active" : ""} onClick={onCrop}>Crop</button>
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
        <details className="diagnostics">
          <summary>View Diagnostics <ChevronDown size={15} /></summary>
          <div className="import-log">
            {state.log.length === 0 ? <p>No import activity yet.</p> : state.log.map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)}
          </div>
        </details>
      </section>
    </div>
  );
}

function WallpaperPanel({
  project,
  onPatch,
  onGenerateApply,
  onApplyCurrent,
  onPrevious,
  onNext,
  onGenerate,
  busy
}: {
  project: WallpaperProject;
  onPatch: (patch: Partial<WallpaperProject["wallpaper"]>) => void;
  onGenerateApply: () => void;
  onApplyCurrent: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onGenerate: () => void;
  busy: boolean;
}) {
  async function setLaunchAtLogin(enabled: boolean) {
    await window.wallpaperApi.setLaunchAtLogin(enabled);
    onPatch({ launchAtLogin: enabled });
  }

  const currentTemplate = project.templates.templates.find((template) => template.id === project.templates.activeTemplateId);

  return (
    <section className="panel wallpaper-panel">
      <h2><Wallpaper size={17} /> Wallpaper</h2>
      <div className="toggle-row">
        <button className={project.wallpaper.enabled ? "toggle active" : "toggle"} onClick={() => onPatch({ enabled: !project.wallpaper.enabled })}>
          {project.wallpaper.enabled ? <Repeat size={16} /> : <Play size={16} />} Rotation
        </button>
        <button className={project.wallpaper.paused ? "toggle active" : "toggle"} disabled={!project.wallpaper.enabled} onClick={() => onPatch({ paused: !project.wallpaper.paused })}>
          {project.wallpaper.paused ? <Play size={16} /> : <Pause size={16} />} {project.wallpaper.paused ? "Resume" : "Pause"}
        </button>
      </div>
      <button className="pill-button primary" disabled={busy} onClick={onGenerateApply}><Wallpaper size={17} /> {busy ? "Applying…" : "Generate and Apply"}</button>
      <button className="pill-button" disabled={busy} onClick={onApplyCurrent}>Apply Current Preview</button>
      <button className="pill-button" disabled={busy} onClick={onGenerate}><Shuffle size={16} /> Generate New Combination</button>
      <div className="toggle-row">
        <button className="toggle" disabled={busy} onClick={onPrevious}>Previous Wallpaper</button>
        <button className="toggle" disabled={busy} onClick={onNext}>Next Wallpaper</button>
      </div>
      <label>
        Update interval
        <select value={project.wallpaper.interval} onChange={(event) => onPatch({ interval: event.target.value as WallpaperProject["wallpaper"]["interval"] })}>
          <option value="manual">Manual only</option>
          <option value="1m">Every 1 minute</option>
          <option value="5m">Every 5 minutes</option>
          <option value="15m">Every 15 minutes</option>
          <option value="30m">Every 30 minutes</option>
          <option value="hourly">Hourly</option>
          <option value="few-hours">Every few hours</option>
          <option value="daily">Daily</option>
          <option value="login">At login</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {project.wallpaper.interval === "custom" && (
        <label>Custom minutes<input type="number" min="1" value={project.wallpaper.customIntervalMinutes} onChange={(event) => onPatch({ customIntervalMinutes: Number(event.target.value) })} /></label>
      )}
      <div className="toggle-row">
        <button className={project.wallpaper.launchAtLogin ? "toggle active" : "toggle"} onClick={() => void setLaunchAtLogin(!project.wallpaper.launchAtLogin)}>Launch at Login</button>
        <button className={project.wallpaper.startMinimized ? "toggle active" : "toggle"} onClick={() => onPatch({ startMinimized: !project.wallpaper.startMinimized })}>Start Minimized</button>
      </div>
      <label>
        Monitor mode
        <select value={project.wallpaper.monitorMode} onChange={(event) => onPatch({ monitorMode: event.target.value as WallpaperProject["wallpaper"]["monitorMode"] })}>
          <option value="all">All monitors</option>
          <option value="primary">Primary monitor</option>
          <option value="span">Span across monitors</option>
        </select>
      </label>
      <label>
        Desktop fit
        <select value={project.wallpaper.displayMode} onChange={(event) => onPatch({ displayMode: event.target.value as WallpaperProject["wallpaper"]["displayMode"] })}>
          <option value="fill">Fill</option>
          <option value="fit">Fit</option>
          <option value="stretch">Stretch</option>
          <option value="tile">Tile</option>
          <option value="center">Center</option>
          <option value="span">Span</option>
        </select>
      </label>
      <div className="wallpaper-status">
        <span>Template: {currentTemplate?.name ?? project.name}</span>
        <span>Status: {!project.wallpaper.enabled ? "Manual" : project.wallpaper.paused ? "Paused" : "Active"}</span>
        <span>Last applied: {project.wallpaper.lastUpdatedAt ? new Date(project.wallpaper.lastUpdatedAt).toLocaleString() : "Never"}</span>
        <span>Next update: {project.wallpaper.nextScheduledAt ? new Date(project.wallpaper.nextScheduledAt).toLocaleString() : "Not scheduled"}</span>
        {project.wallpaper.lastError && (
          <details>
            <summary>Last error</summary>
            <p>{project.wallpaper.lastError}</p>
          </details>
        )}
      </div>
    </section>
  );
}

function CanvasDesignPanel({
  canvas,
  onPatch,
  onChooseBackground,
  onClearBackground,
  onResize,
  onPreset
}: {
  canvas: CanvasSettings;
  onPatch: (patch: Partial<CanvasSettings>) => void;
  onChooseBackground: () => void;
  onClearBackground: () => void;
  onResize: (width: number, height: number, mode: CanvasResizeMode) => void;
  onPreset: (id: string, mode: CanvasResizeMode) => void;
}) {
  const [draftWidth, setDraftWidth] = useState(canvas.width);
  const [draftHeight, setDraftHeight] = useState(canvas.height);
  const [resizeMode, setResizeMode] = useState<CanvasResizeMode>("keep");
  const [lockAspect, setLockAspect] = useState(true);
  const aspect = canvas.width / Math.max(1, canvas.height);

  useEffect(() => {
    setDraftWidth(canvas.width);
    setDraftHeight(canvas.height);
  }, [canvas.width, canvas.height]);

  function changeWidth(value: number) {
    const width = Math.max(64, value);
    setDraftWidth(width);
    if (lockAspect) setDraftHeight(Math.max(64, Math.round(width / aspect)));
  }

  function changeHeight(value: number) {
    const height = Math.max(64, value);
    setDraftHeight(height);
    if (lockAspect) setDraftWidth(Math.max(64, Math.round(height * aspect)));
  }

  function patchPaper(patch: Partial<PaperTextureEffect>) {
    onPatch({ backgroundPaper: { ...canvas.backgroundPaper, ...patch } });
  }

  return (
    <section className="panel canvas-design-panel">
      <h2>Canvas + Background</h2>
      <details open>
        <summary>Canvas Dimensions <ChevronDown size={15} /></summary>
        <label>Preset<select value={canvas.presetId} onChange={(event) => onPreset(event.target.value, resizeMode)}>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <div className="two-col">
          <label>Width<input type="number" min="64" value={draftWidth} onChange={(event) => changeWidth(Number(event.target.value))} /></label>
          <label>Height<input type="number" min="64" value={draftHeight} onChange={(event) => changeHeight(Number(event.target.value))} /></label>
        </div>
        <label>Resize content<select value={resizeMode} onChange={(event) => setResizeMode(event.target.value as CanvasResizeMode)}><option value="keep">Keep positions</option><option value="scale">Scale proportionally</option><option value="center">Center content</option></select></label>
        <div className="compact-action-row">
          <button className={lockAspect ? "toggle active" : "toggle"} onClick={() => setLockAspect((value) => !value)}>Lock ratio</button>
          <button className="toggle" onClick={() => { setDraftWidth(canvas.height); setDraftHeight(canvas.width); }}>Swap</button>
          <button className="toggle" onClick={() => {
            const ratio = window.devicePixelRatio || 1;
            setDraftWidth(Math.round(window.screen.width * ratio));
            setDraftHeight(Math.round(window.screen.height * ratio));
          }}>Current monitor</button>
        </div>
        <button className="pill-button primary" onClick={() => onResize(draftWidth, draftHeight, resizeMode)}>Apply dimensions</button>
      </details>

      <details open>
        <summary>Background <ChevronDown size={15} /></summary>
        <div className="two-col">
          <label>Color<input type="color" value={canvas.backgroundColor} onChange={(event) => onPatch({ backgroundColor: event.target.value, backgroundTransparent: false })} /></label>
          <label>Mode<select value={canvas.backgroundMode} onChange={(event) => onPatch({ backgroundMode: event.target.value as CanvasSettings["backgroundMode"] })}><option value="cover">Fill</option><option value="contain">Fit</option><option value="stretch">Stretch</option><option value="original">Original size</option><option value="center">Center</option><option value="tile">Tile</option></select></label>
        </div>
        <div className="compact-action-row">
          <button className="pill-button" onClick={onChooseBackground}><ImagePlus size={15} /> Choose image</button>
          <button className="pill-button" disabled={!canvas.backgroundImage} onClick={onClearBackground}>Reset to color</button>
          <button className={canvas.backgroundTransparent ? "toggle active" : "toggle"} onClick={() => onPatch({ backgroundTransparent: !canvas.backgroundTransparent })}>Transparent</button>
        </div>
        <label>Alignment<select value={canvas.backgroundAlignment} onChange={(event) => onPatch({ backgroundAlignment: event.target.value as ImageAlignment })}>{alignmentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="two-col">
          <label>Offset X<input type="number" value={canvas.backgroundOffsetX} onChange={(event) => onPatch({ backgroundOffsetX: Number(event.target.value) })} /></label>
          <label>Offset Y<input type="number" value={canvas.backgroundOffsetY} onChange={(event) => onPatch({ backgroundOffsetY: Number(event.target.value) })} /></label>
        </div>
        <FilterSlider label="Scale" value={canvas.backgroundScale} min={0.1} max={4} step={0.05} onChange={(value) => onPatch({ backgroundScale: value })} />
        <FilterSlider label="Opacity" value={canvas.backgroundOpacity} min={0} max={1} step={0.05} onChange={(value) => onPatch({ backgroundOpacity: value })} />
        <FilterSlider label="Brightness" value={canvas.backgroundBrightness} min={0} max={200} onChange={(value) => onPatch({ backgroundBrightness: value })} />
        <FilterSlider label="Blur" value={canvas.backgroundBlur} min={0} max={30} step={0.5} onChange={(value) => onPatch({ backgroundBlur: value })} />
      </details>

      <details>
        <summary>Background Paper <ChevronDown size={15} /></summary>
        <label>Texture<select value={canvas.backgroundPaper.type} onChange={(event) => patchPaper({ type: event.target.value as PaperTextureEffect["type"] })}><option value="none">None</option><option value="fine-grain">Fine paper grain</option><option value="recycled">Recycled paper</option><option value="matte-photo">Matte photo</option><option value="canvas">Canvas</option><option value="newspaper">Newspaper</option><option value="fold-marks">Fold marks</option><option value="dust-scratches">Dust and scratches</option><option value="halftone">Halftone</option></select></label>
        <FilterSlider label="Intensity" value={canvas.backgroundPaper.intensity} min={0} max={100} onChange={(value) => patchPaper({ intensity: value })} />
        <FilterSlider label="Opacity" value={canvas.backgroundPaper.opacity} min={0} max={1} step={0.05} onChange={(value) => patchPaper({ opacity: value })} />
        <FilterSlider label="Scale" value={canvas.backgroundPaper.scale} min={0.4} max={3} step={0.1} onChange={(value) => patchPaper({ scale: value })} />
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
  sources: ImageSource[];
  cropMode: boolean;
  onPatch: (patch: Partial<PlaceholderLayer>) => void;
  onDelete: () => void;
  onRegenerate: (layer: PlaceholderLayer) => void;
  onCrop: () => void;
  onResetFrame: (layer: PlaceholderLayer) => void;
  onMatchAspect: (layer: PlaceholderLayer) => void;
}) {
  const sourceId = layer?.sourceState.sourceIds[0] ?? layer?.sourceId;
  const source = sources.find((item) => item.id === sourceId);
  if (!layer) {
    return <section className="panel muted-panel"><h2>Layer Properties</h2><p>Select an image frame to edit its frame, fit, crop, border, and effects.</p></section>;
  }
  const activeLayer = layer;

  function numeric<K extends keyof PlaceholderLayer>(key: K) {
    return (event: React.ChangeEvent<HTMLInputElement>) => onPatch({ [key]: Number(event.target.value) } as Partial<PlaceholderLayer>);
  }
  function patchFilters(patch: Partial<ImageFilters>) {
    onPatch({ effects: { ...activeLayer.effects, filters: { ...activeLayer.effects.filters, ...patch } } });
  }
  function patchPaper(patch: Partial<PaperTextureEffect>) {
    onPatch({ effects: { ...activeLayer.effects, paper: { ...activeLayer.effects.paper, ...patch } } });
  }
  function resetCrop() {
    onPatch({ crop: { offsetX: 0, offsetY: 0, zoom: 1 }, alignment: "center" });
  }

  return (
    <section className="panel properties">
      <div className="panel-title-row">
        <h2>Layer Properties</h2>
        <button className="icon-button danger" onClick={onDelete} title="Delete layer"><Trash2 size={17} /></button>
      </div>

      <details open>
        <summary>Position + Frame <ChevronDown size={15} /></summary>
        <label>Name<input value={layer.name} onChange={(event) => onPatch({ name: event.target.value })} /></label>
        <div className="two-col">
          <label>X<input type="number" value={layer.x} onChange={numeric("x")} /></label>
          <label>Y<input type="number" value={layer.y} onChange={numeric("y")} /></label>
          <label>Width<input type="number" min="40" value={layer.width} onChange={numeric("width")} /></label>
          <label>Height<input type="number" min="40" value={layer.height} onChange={numeric("height")} /></label>
        </div>
        <FilterSlider label="Rotation" value={layer.rotation} min={-180} max={180} onChange={(value) => onPatch({ rotation: value })} />
        <div className="compact-action-row">
          <button className={layer.keepAspectRatio ? "toggle active" : "toggle"} onClick={() => onPatch({ keepAspectRatio: !layer.keepAspectRatio })}>Lock frame ratio</button>
          <button className="toggle" onClick={() => onMatchAspect(layer)}>Match image ratio</button>
          <button className="toggle" onClick={() => onResetFrame(layer)}>Reset frame</button>
        </div>
      </details>

      <details open>
        <summary>Image Fit + Crop <ChevronDown size={15} /></summary>
        <div className="pool-card">
          <div className="pool-card-heading"><span>Assigned pool</span><strong>{source?.name ?? "None"}</strong></div>
          <select value={sourceId ?? ""} onChange={(event) => {
            const nextSourceId = event.target.value || undefined;
            const assignedSource = sources.find((sourceItem) => sourceItem.id === nextSourceId);
            onPatch({
              sourceId: nextSourceId,
              selectedImageId: undefined,
              generatedImageId: undefined,
              sourceState: {
                ...layer.sourceState,
                sourceIds: nextSourceId ? [nextSourceId] : [],
                mode: nextSourceId ? "shuffle" : layer.sourceState.mode,
                currentIndex: 0,
                shuffleQueue: [],
                usedImageIds: [],
                preventDuplicates: Boolean(assignedSource && assignedSource.images.length > 1)
              }
            });
          }}><option value="">No pool assigned</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {source && <span className="pool-summary">{source.images.length} images cycle from this collection</span>}
        </div>
        <label>Image fit<select value={layer.cropMode} onChange={(event) => onPatch({ cropMode: event.target.value as CropMode })}><option value="cover">Fill frame</option><option value="contain">Fit whole image</option><option value="stretch">Stretch to frame</option><option value="original">Original size</option><option value="tile">Tile</option></select></label>
        <label>Alignment<select value={layer.alignment} onChange={(event) => onPatch({ alignment: event.target.value as ImageAlignment })}>{alignmentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="two-col">
          <label>Offset X<input type="number" value={layer.crop.offsetX} onChange={(event) => onPatch({ crop: { ...layer.crop, offsetX: Number(event.target.value) } })} /></label>
          <label>Offset Y<input type="number" value={layer.crop.offsetY} onChange={(event) => onPatch({ crop: { ...layer.crop, offsetY: Number(event.target.value) } })} /></label>
        </div>
        <FilterSlider label="Image zoom" value={layer.crop.zoom} min={0.1} max={5} step={0.05} onChange={(value) => onPatch({ crop: { ...layer.crop, zoom: value } })} />
        <div className="compact-action-row">
          <button className={cropMode ? "toggle active" : "toggle"} onClick={onCrop}>{cropMode ? "Exit crop" : "Crop on canvas"}</button>
          <button className="toggle" onClick={resetCrop}>Reset crop</button>
          <button className="toggle" disabled={!source} onClick={() => onRegenerate(layer)}>Next image</button>
        </div>
      </details>

      <details>
        <summary>Border + Shape <ChevronDown size={15} /></summary>
        <label>Mask<select value={layer.maskShape} onChange={(event) => onPatch({ maskShape: event.target.value as MaskShape })}><option value="rectangle">Rectangle</option><option value="rounded">Rounded</option><option value="circle">Circle / ellipse</option></select></label>
        <div className="two-col">
          <label>Border width<input type="number" min="0" value={layer.borderWidth} onChange={numeric("borderWidth")} /></label>
          <label>Corner radius<input type="number" min="0" disabled={layer.maskShape !== "rounded"} value={layer.borderRadius} onChange={numeric("borderRadius")} /></label>
          <label>Border color<input type="color" value={layer.borderColor} onChange={(event) => onPatch({ borderColor: event.target.value })} /></label>
          <label>Border opacity<input type="number" min="0" max="1" step="0.05" value={layer.borderOpacity} onChange={numeric("borderOpacity")} /></label>
        </div>
        <FilterSlider label="Image opacity" value={layer.opacity} min={0} max={1} step={0.05} onChange={(value) => onPatch({ opacity: value })} />
        <label>Blend mode<select value={layer.effects.blendMode} onChange={(event) => onPatch({ effects: { ...layer.effects, blendMode: event.target.value as PlaceholderLayer["effects"]["blendMode"] } })}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft light</option></select></label>
      </details>

      <details>
        <summary>Shadow <ChevronDown size={15} /></summary>
        <div className="toggle-row">
          <button className={layer.shadow ? "toggle active" : "toggle"} onClick={() => onPatch({ shadow: !layer.shadow })}>Outer shadow</button>
          <button className={layer.effects.innerShadow ? "toggle active" : "toggle"} onClick={() => onPatch({ effects: { ...layer.effects, innerShadow: !layer.effects.innerShadow } })}>Inner shadow</button>
          <button className={layer.effects.glow ? "toggle active" : "toggle"} onClick={() => onPatch({ effects: { ...layer.effects, glow: !layer.effects.glow } })}>Glow</button>
        </div>
      </details>

      <details>
        <summary>Image Adjustments <ChevronDown size={15} /></summary>
        <PresetButtons onPick={(filters) => patchFilters(filters)} />
        <FilterSlider label="Brightness" value={layer.effects.filters.brightness} min={0} max={200} onChange={(value) => patchFilters({ brightness: value })} />
        <FilterSlider label="Contrast" value={layer.effects.filters.contrast} min={0} max={200} onChange={(value) => patchFilters({ contrast: value })} />
        <FilterSlider label="Saturation" value={layer.effects.filters.saturation} min={0} max={200} onChange={(value) => patchFilters({ saturation: value })} />
        <FilterSlider label="Exposure" value={layer.effects.filters.exposure} min={-20} max={20} onChange={(value) => patchFilters({ exposure: value })} />
        <FilterSlider label="Temperature" value={layer.effects.filters.temperature} min={-100} max={100} onChange={(value) => patchFilters({ temperature: value })} />
        <FilterSlider label="Blur" value={layer.effects.filters.blur} min={0} max={16} onChange={(value) => patchFilters({ blur: value })} />
        <FilterSlider label="Sepia" value={layer.effects.filters.sepia} min={0} max={100} onChange={(value) => patchFilters({ sepia: value })} />
        <FilterSlider label="Grayscale" value={layer.effects.filters.grayscale} min={0} max={100} onChange={(value) => patchFilters({ grayscale: value })} />
        <FilterSlider label="Fade" value={layer.effects.filters.fade} min={0} max={80} onChange={(value) => patchFilters({ fade: value })} />
        <FilterSlider label="Vignette" value={layer.effects.filters.vignette} min={0} max={100} onChange={(value) => patchFilters({ vignette: value })} />
      </details>

      <details>
        <summary>Paper + Texture <ChevronDown size={15} /></summary>
        <label>Texture<select value={layer.effects.paper.type} onChange={(event) => patchPaper({ type: event.target.value as PaperTextureEffect["type"] })}><option value="none">None</option><option value="fine-grain">Fine paper grain</option><option value="recycled">Recycled paper</option><option value="matte-photo">Matte photo</option><option value="canvas">Canvas texture</option><option value="newspaper">Newspaper print</option><option value="fold-marks">Fold marks</option><option value="dust-scratches">Dust and scratches</option><option value="halftone">Halftone</option></select></label>
        <FilterSlider label="Grain" value={layer.effects.filters.grain} min={0} max={100} onChange={(value) => patchFilters({ grain: value })} />
        <FilterSlider label="Texture intensity" value={layer.effects.paper.intensity} min={0} max={100} onChange={(value) => patchPaper({ intensity: value })} />
        <FilterSlider label="Texture opacity" value={layer.effects.paper.opacity} min={0} max={1} step={0.05} onChange={(value) => patchPaper({ opacity: value })} />
        <FilterSlider label="Texture scale" value={layer.effects.paper.scale} min={0.4} max={3} step={0.1} onChange={(value) => patchPaper({ scale: value })} />
      </details>

      <div className="toggle-row">
        <button className={layer.locked ? "toggle active" : "toggle"} onClick={() => onPatch({ locked: !layer.locked })}>{layer.locked ? <Lock size={16} /> : <Unlock size={16} />} Lock</button>
        <button className={layer.hidden ? "toggle active" : "toggle"} onClick={() => onPatch({ hidden: !layer.hidden })}>{layer.hidden ? <EyeOff size={16} /> : <Eye size={16} />} Hide</button>
      </div>
    </section>
  );
}

function FilterSlider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="filter-slider"><span>{label}<b>{value}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function PresetButtons({ onPick }: { onPick: (filters: Partial<ImageFilters>) => void }) {
  const presetsMap: Array<[string, Partial<ImageFilters>]> = [
    ["Warm Print", { brightness: 106, contrast: 96, saturation: 112, temperature: 32, sepia: 8 }],
    ["Cool Film", { brightness: 96, contrast: 112, saturation: 82, temperature: -28, fade: 8 }],
    ["Soft Fade", { brightness: 112, contrast: 82, saturation: 86, fade: 18 }],
    ["Vintage Paper", { brightness: 104, contrast: 92, saturation: 74, sepia: 34, grain: 16 }],
    ["Muted Editorial", { brightness: 98, contrast: 108, saturation: 68 }],
    ["High Contrast", { brightness: 102, contrast: 148, saturation: 104 }],
    ["Black and White", { grayscale: 100, contrast: 112 }],
    ["Washed Daylight", { brightness: 118, contrast: 88, saturation: 92, fade: 10 }]
  ];
  return <div className="preset-grid">{presetsMap.map(([name, filters]) => <button key={name} onClick={() => onPick({ ...createDefaultEffects().filters, ...filters, presetId: name })}>{name}</button>)}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);

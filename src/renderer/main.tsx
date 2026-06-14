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
  PaperFrameType,
  SourceMediaPolicy,
  MaskShape,
  PaperTextureEffect,
  PinterestImportProgress,
  PlaceholderLayer,
  WallpaperApplyResult,
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
import { clampCropTransform, computeImagePlacement, removeBackgroundImage, resizeCanvasAndLayers } from "../shared/geometry";
import { paperFrameClipPath, paperFrameInsets, paperFrameIsRough, paperFrameRotation } from "../shared/paper";
import { projectAfterExportSet } from "../shared/export-set";
import {
  appendAppliedHistory,
  formatWallpaperCountdown,
  generationStateAfterApplication,
  nextHistoryIndex,
  nextScheduledAt,
  planTemplateRotation,
  previousHistoryIndex,
  wallpaperIntervalToMs
} from "../shared/wallpaper";
import { renderProjectToArrayBuffer, renderProjectToDataUrl } from "./exporter";
import { applyGeneratedWallpaperFile, generateWallpaperFile, withWallpaperTimeout } from "../shared/wallpaper-pipeline";
import { SingleRunScheduler } from "../shared/scheduler";
import { selectImagesForGeneration } from "../shared/source-selection";
import { bundledSurfaceChoices, bundledSurfaceUrl } from "./surface-textures";
import "./styles.css";

const autosaveKey = "pwc.autosave.v2";
const filePathKey = "pwc.filePath.v1";
const backgroundAdvancedKey = "pwc.backgroundAdvanced.v1";
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
  count: number;
  format: "png" | "jpeg";
  quality: number;
  destinationPath?: string;
  includeTemplateName: boolean;
  includeTimestamp: boolean;
  avoidRepeats: boolean;
  advanceLiveState: boolean;
  overwrite: boolean;
  busy: boolean;
  cancelRequested: boolean;
  completed: number;
  skipped: number;
  failed: number;
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
  const [dragActive, setDragActive] = useState(false);
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
  const [lastWallpaperDiagnostics, setLastWallpaperDiagnostics] = useState<WallpaperApplyResult["diagnostics"]>();
  const [wallpaperStatus, setWallpaperStatus] = useState<WallpaperRuntimeStatus>("idle");
  const [wallpaperTargets, setWallpaperTargets] = useState<WallpaperTarget[]>([]);
  const [backgroundAdvancedOpen, setBackgroundAdvancedOpen] = useState(() => localStorage.getItem(backgroundAdvancedKey) === "true");
  const [nowTick, setNowTick] = useState(Date.now());
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
    count: 10,
    format: "png",
    quality: 0.92,
    includeTemplateName: true,
    includeTimestamp: false,
    avoidRepeats: true,
    advanceLiveState: false,
    overwrite: false,
    busy: false,
    cancelRequested: false,
    completed: 0,
    skipped: 0,
    failed: 0
  });
  const dragRef = useRef<DragState | undefined>(undefined);
  const marqueeRef = useRef<SelectionMarquee | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageNaturalRef = useRef<Record<string, { width: number; height: number }>>({});
  const projectRef = useRef(project);
  const applyInFlightRef = useRef(false);
  const loginRotationTriggeredRef = useRef(false);
  const exportCancelRef = useRef(false);
  const sourceApplyTimerRef = useRef<number | undefined>(undefined);
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const sourceApplyVersionRef = useRef(0);
  const wallpaperSchedulerRef = useRef<SingleRunScheduler | undefined>(undefined);
  if (!wallpaperSchedulerRef.current) {
    wallpaperSchedulerRef.current = new SingleRunScheduler(
      (callback, delayMs) => window.setTimeout(callback, delayMs),
      (timer) => window.clearTimeout(timer as number),
      () => Date.now()
    );
  }
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

  function wallpaperMs(wallpaper = project.wallpaper) {
    return wallpaperIntervalToMs(
      wallpaper.interval,
      wallpaper.customIntervalMinutes,
      wallpaper.customIntervalValue,
      wallpaper.customIntervalUnit
    );
  }

  function scheduleFor(wallpaper = project.wallpaper, from = new Date()) {
    return nextScheduledAt(
      wallpaper.interval,
      wallpaper.customIntervalMinutes,
      from,
      wallpaper.customIntervalValue,
      wallpaper.customIntervalUnit
    );
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
    wallpaperSchedulerRef.current?.cancel();
  }, []);

  useEffect(() => {
    void window.wallpaperApi.setTrayState({
      enabled: project.wallpaper.enabled,
      paused: project.wallpaper.paused,
      interval: project.wallpaper.interval,
      customIntervalMinutes: project.wallpaper.customIntervalMinutes,
      customIntervalValue: project.wallpaper.customIntervalValue,
      customIntervalUnit: project.wallpaper.customIntervalUnit,
      nextScheduledAt: project.wallpaper.nextScheduledAt,
      status: wallpaperStatus,
      lastError: project.wallpaper.lastError
    });
  }, [
    project.wallpaper.enabled,
    project.wallpaper.paused,
    project.wallpaper.interval,
    project.wallpaper.customIntervalMinutes,
    project.wallpaper.customIntervalValue,
    project.wallpaper.customIntervalUnit,
    project.wallpaper.nextScheduledAt,
    project.wallpaper.lastError,
    wallpaperStatus
  ]);

  useEffect(() => {
    window.wallpaperApi.getWallpaperTargets()
      .then(setWallpaperTargets)
      .catch(() => setWallpaperTargets([]));
  }, []);

  useEffect(() => {
    localStorage.setItem(backgroundAdvancedKey, String(backgroundAdvancedOpen));
  }, [backgroundAdvancedOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  const scaled = useMemo(
    () => ({ width: project.canvas.width * zoom, height: project.canvas.height * zoom }),
    [project.canvas.width, project.canvas.height, zoom]
  );

  useEffect(() => {
    const scheduler = wallpaperSchedulerRef.current!;
    const ms = wallpaperMs(project.wallpaper);
    if (!project.wallpaper.enabled || project.wallpaper.paused || !ms) {
      scheduler.cancel();
      setWallpaperStatus(project.wallpaper.paused ? "paused" : "idle");
      setProject((current) => current.wallpaper.nextScheduledAt
        ? { ...current, wallpaper: { ...current.wallpaper, nextScheduledAt: undefined } }
        : current);
      return;
    }

    const parsedCurrent = project.wallpaper.nextScheduledAt
      ? Date.parse(project.wallpaper.nextScheduledAt)
      : Number.NaN;
    const scheduled = Number.isFinite(parsedCurrent)
      ? project.wallpaper.nextScheduledAt
      : scheduleFor(project.wallpaper);

    if (scheduled && scheduled !== project.wallpaper.nextScheduledAt) {
      setProject((current) => ({
        ...current,
        wallpaper: { ...current.wallpaper, nextScheduledAt: scheduled }
      }));
      return;
    }
    if (!scheduled) return;

    setWallpaperStatus((current) => applyInFlightRef.current ? current : "scheduled");
    scheduler.schedule(Date.parse(scheduled), async () => {
      const latest = projectRef.current;
      const latestMs = wallpaperMs(latest.wallpaper);
      if (!latest.wallpaper.enabled || latest.wallpaper.paused || !latestMs) return;
      if (applyInFlightRef.current) {
        const retryAt = new Date(Date.now() + 1_000).toISOString();
        setProject((current) => {
          const next = { ...current, wallpaper: { ...current.wallpaper, nextScheduledAt: retryAt } };
          projectRef.current = next;
          return next;
        });
        return;
      }
      await generateAndApply({ rotateTemplate: true, automatic: true });
    });

    return () => scheduler.cancel();
  }, [
    project.wallpaper.enabled,
    project.wallpaper.paused,
    project.wallpaper.interval,
    project.wallpaper.customIntervalMinutes,
    project.wallpaper.customIntervalValue,
    project.wallpaper.customIntervalUnit,
    project.wallpaper.nextScheduledAt
  ]);

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
    commitProject((current) => {
      const wallpaper = { ...current.wallpaper, ...patch };
      const scheduleChanged =
        "enabled" in patch ||
        "paused" in patch ||
        "interval" in patch ||
        "customIntervalMinutes" in patch ||
        "customIntervalValue" in patch ||
        "customIntervalUnit" in patch;
      return {
        ...current,
        wallpaper: {
          ...wallpaper,
          nextScheduledAt: scheduleChanged && wallpaper.enabled && !wallpaper.paused
            ? scheduleFor(wallpaper)
            : scheduleChanged
              ? undefined
              : wallpaper.nextScheduledAt
        }
      };
    });
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
    if (result.canceled || !result.image) return;
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
        backgroundPaper: { ...current.canvas.backgroundPaper, type: "custom", customTextureId: result.texture!.id, intensity: Math.max(35, current.canvas.backgroundPaper.intensity), opacity: Math.max(0.35, current.canvas.backgroundPaper.opacity) }
      }
    }));
    setMessage(`Imported texture ${result.texture.name}.`);
  }

  async function removeCustomTextureAsset(textureId: string) {
    const texture = projectRef.current.customTextures.find((item) => item.id === textureId);
    if (!texture) return;
    await window.wallpaperApi.removeCustomTexture(texture.path);
    commitProject((current) => ({
      ...current,
      customTextures: current.customTextures.filter((item) => item.id !== textureId),
      canvas: current.canvas.backgroundPaper.customTextureId === textureId
        ? { ...current.canvas, backgroundPaper: { ...current.canvas.backgroundPaper, type: "none", customTextureId: undefined, intensity: 0, opacity: 0 } }
        : current.canvas,
      layers: current.layers.map((layer) => layer.effects.paper.customTextureId === textureId
        ? { ...layer, effects: { ...layer.effects, paper: { ...layer.effects.paper, type: "none", customTextureId: undefined, intensity: 0, opacity: 0 } } }
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
      mediaPolicy: "images-only",
      mediaCounts: { total: result.images.length, images: result.images.filter((image) => image.mediaType !== "video").length, videos: result.images.filter((image) => image.mediaType === "video").length },
      importLog: [`Imported ${result.images.length} local items from ${result.path}.`],
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
            mediaPolicy: "images-only",
            mediaCounts: { total: images.length, images: images.filter((image) => image.mediaType !== "video").length, videos: images.filter((image) => image.mediaType === "video").length },
            importLog: [`Imported ${images.length} local files as one collection.`],
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

  function projectWithSourceAssignment(base: WallpaperProject, source: ImageSource, layerId: string) {
    const layer = base.layers.find((item) => item.id === layerId);
    if (!layer || layer.locked) return undefined;
    const eligibleImages = sourceImagesForPolicy(source);
    if (eligibleImages.length === 0) return undefined;
    const singleImage = eligibleImages.length === 1;
    let next = linkedSourceIds.includes(source.id) ? base : linkSourceToActiveTemplate(base, source.id);
    next = {
      ...next,
      layers: next.layers.map((item) => item.id === layerId ? {
        ...item,
        sourceId: source.id,
        selectedImageId: singleImage ? eligibleImages[0]?.id : undefined,
        generatedImageId: undefined,
        sourceState: {
          ...item.sourceState,
          sourceIds: [source.id],
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

  function assignSourceToLayer(source: ImageSource, layer: PlaceholderLayer) {
    if (layer.locked) {
      setMessage("Unlock the layer before changing its source.");
      return;
    }
    const next = projectWithSourceAssignment(projectRef.current, source, layer.id);
    if (!next) {
      setMessage(`${source.name} has no items allowed by its media filter.`);
      return;
    }
    setHistory((stack) => ({ past: [...stack.past, cloneProject(projectRef.current)].slice(-historyLimit), future: [] }));
    projectRef.current = next;
    setProject(next);
    setSelectedSourceId(source.id);
    setMessage(`Assigned ${source.name} to ${layer.name}.`);
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
      mediaPolicy: "images-only",
      mediaCounts: { total: images.length, images: images.filter((image) => image.mediaType !== "video").length, videos: images.filter((image) => image.mediaType === "video").length },
      importLog: [`Imported ${images.length} individual local files.`],
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

  function recordWallpaperFailure(error: string, automatic: boolean) {
    const failures = (projectRef.current.wallpaper.consecutiveFailures ?? 0) + 1;
    setWallpaperStatus(automatic && failures >= 3 ? "paused" : "failed");
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
            : scheduleFor(current.wallpaper)
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
      setMessage("A wallpaper operation is already running.");
      return false;
    }
    applyInFlightRef.current = true;
    setWallpaperBusy(true);
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
          transitionEnabled: candidate.wallpaper.transitionEnabled,
          transitionDurationMs: candidate.wallpaper.transitionDurationMs
        }),
        onStatus: setWallpaperStatus
      });
      setLastWallpaperDiagnostics(result.diagnostics);

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
          nextScheduledAt: generatedProject.wallpaper.enabled && !generatedProject.wallpaper.paused
            ? scheduleFor(generatedProject.wallpaper, new Date(appliedAt))
            : undefined
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
      applyInFlightRef.current = false;
      setWallpaperBusy(false);
    }
  }

  function targetTemplateFor(base: WallpaperProject, target: WallpaperTarget, index: number) {
    const enabled = base.templates.templates.filter((template) => template.enabledForRotation);
    if (base.wallpaper.targetTemplateMode === "different-template") {
      const templateId = base.wallpaper.targetTemplateIds[target.id];
      return base.templates.templates.find((template) => template.id === templateId)
        ?? enabled[index % Math.max(1, enabled.length)]
        ?? base.templates.templates[index % base.templates.templates.length];
    }
    if (base.wallpaper.targetTemplateMode === "playlist") {
      const ids = base.wallpaper.targetPlaylistIds[target.id]?.length
        ? base.wallpaper.targetPlaylistIds[target.id]
        : base.templates.rotationTemplateIds;
      const templateId = ids[index % Math.max(1, ids.length)];
      return base.templates.templates.find((template) => template.id === templateId) ?? enabled[index % Math.max(1, enabled.length)];
    }
    const templateId = base.wallpaper.targetTemplateIds.all ?? base.templates.activeTemplateId;
    return base.templates.templates.find((template) => template.id === templateId);
  }

  async function applyDifferentWallpapers(base: WallpaperProject, options: { automatic?: boolean; label?: string } = {}) {
    if (applyInFlightRef.current) {
      setMessage("A wallpaper is already being applied.");
      return false;
    }
    applyInFlightRef.current = true;
    setWallpaperBusy(true);
    setWallpaperStatus("generating");
    try {
      const targets = wallpaperTargets.length ? wallpaperTargets : await window.wallpaperApi.getWallpaperTargets();
      setWallpaperTargets(targets);
      const supportedTargets = targets.filter((target) => target.reliable);
      const applyTargets = supportedTargets.length ? supportedTargets : targets.slice(0, 1);
      if (applyTargets.length === 0) {
        recordWallpaperFailure("No wallpaper desktop targets are available.", Boolean(options.automatic));
        return false;
      }

      let working = normalizeProject(base);
      const used = new Set<string>();
      const rendered: Array<{ target: WallpaperTarget; combination: GeneratedCombination; imageData: ArrayBuffer; templateName: string }> = [];
      for (const [index, target] of applyTargets.entries()) {
        const template = targetTemplateFor(working, target, index);
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
      const result = await withWallpaperTimeout(window.wallpaperApi.applyWallpaperTargets({
        scope: "different-per-desktop",
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
      }), 60_000, "Applying desktop wallpapers timed out.");
      setWallpaperStatus("verifying");
      setLastWallpaperDiagnostics(result.diagnostics);
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
          nextScheduledAt: working.wallpaper.enabled && !working.wallpaper.paused
            ? scheduleFor(working.wallpaper, new Date(appliedAt))
            : undefined
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

    if (base.wallpaper.scope === "different-per-desktop" && !options.templateId) {
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
    if (applyInFlightRef.current) {
      setMessage("A wallpaper operation is already running.");
      return;
    }
    applyInFlightRef.current = true;
    setWallpaperBusy(true);
    try {
      const result = await applyGeneratedWallpaperFile({
        filePath: entry.filePath,
        apply: (filePath) => window.wallpaperApi.applyWallpaperFile({
          filePath,
          monitorMode: current.wallpaper.monitorMode,
          displayMode: current.wallpaper.displayMode,
          scope: current.wallpaper.scope,
          transitionEnabled: current.wallpaper.transitionEnabled,
          transitionDurationMs: current.wallpaper.transitionDurationMs
        }),
        onStatus: setWallpaperStatus
      });
      setLastWallpaperDiagnostics(result.diagnostics);
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
      setMessage(`Applied history: ${entry.templateName ?? entry.name}`);
    } catch (error) {
      recordWallpaperFailure(error instanceof Error ? error.message : "Unable to apply wallpaper history item.", false);
    } finally {
      applyInFlightRef.current = false;
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

  function openExportSet(templateId = project.templates.activeTemplateId) {
    exportCancelRef.current = false;
    setExportSet((current) => ({
      ...current,
      open: true,
      templateId,
      busy: false,
      cancelRequested: false,
      completed: 0,
      skipped: 0,
      failed: 0,
      error: undefined
    }));
  }

  async function chooseExportSetFolder() {
    const result = await window.wallpaperApi.chooseExportSetFolder();
    if (!result.canceled && result.filePath) setExportSet((current) => ({ ...current, destinationPath: result.filePath }));
  }

  function cancelExportSet() {
    exportCancelRef.current = true;
    setExportSet((current) => ({ ...current, cancelRequested: true }));
  }

  async function runExportSet() {
    const options = exportSet;
    const count = clamp(Math.round(options.count), 1, 500);
    let destinationPath = options.destinationPath;
    if (!destinationPath) {
      const result = await window.wallpaperApi.chooseExportSetFolder();
      if (result.canceled || !result.filePath) return;
      destinationPath = result.filePath;
      setExportSet((current) => ({ ...current, destinationPath }));
    }
    const template = projectRef.current.templates.templates.find((item) => item.id === options.templateId)
      ?? projectRef.current.templates.templates.find((item) => item.id === projectRef.current.templates.activeTemplateId);
    if (!template) {
      setExportSet((current) => ({ ...current, error: "Choose a template before exporting." }));
      return;
    }

    exportCancelRef.current = false;
    setExportSet((current) => ({ ...current, busy: true, cancelRequested: false, completed: 0, skipped: 0, failed: 0, error: undefined }));
    let exportProject = workspaceFromTemplate(cloneProject(projectRef.current), template);
    const used = new Set<string>();
    const signatures = new Set<string>();
    let completed = 0;
    let skipped = 0;
    let failed = 0;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = (options.includeTemplateName ? template.name : "Wallpaper")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "Wallpaper";

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
      try {
        const dataUrl = await renderProjectToDataUrl(exportProject, options.format, options.quality);
        const suffix = `${String(index).padStart(3, "0")}${options.includeTimestamp ? `-${stamp}` : ""}`;
        const fileName = `${baseName}-${suffix}.${options.format === "png" ? "png" : "jpg"}`;
        const result = await window.wallpaperApi.writeExportSetFile({
          destinationPath,
          dataUrl,
          fileName,
          overwrite: options.overwrite
        });
        if (result.ok) completed += 1;
        else if (result.skipped) skipped += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      setExportSet((current) => ({ ...current, completed, skipped, failed }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    if (options.advanceLiveState && !exportCancelRef.current) {
      const normalized = touchProject(updateActiveTemplateSnapshot(normalizeProject(exportProject)));
      const nextProject = projectAfterExportSet(projectRef.current, normalized, true);
      projectRef.current = nextProject;
      setProject(nextProject);
    }
    const summary = exportCancelRef.current
      ? `Export stopped: ${completed} exported, ${skipped} skipped, ${failed} failed.`
      : `Export complete: ${completed} exported, ${skipped} skipped, ${failed} failed.`;
    setMessage(summary);
    setExportSet((current) => ({ ...current, busy: false, cancelRequested: exportCancelRef.current, completed, skipped, failed, error: failed ? `${failed} variation${failed === 1 ? "" : "s"} failed.` : undefined }));
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
      const currentX = clamp((event.clientX - rect.left) / zoom, 0, project.canvas.width);
      const currentY = clamp((event.clientY - rect.top) / zoom, 0, project.canvas.height);
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
          className={`source-library drop-zone ${leftPanelTab === "sources" ? "" : "hidden-panel"} ${dragActive ? "drag-active" : ""}`}
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
              <span className="eyebrow">COLLECTIONS</span>
              <h2>Sources</h2>
            </div>
            <div className="compact-actions">
              <button className="icon-button tooltip-anchor" data-tooltip="Add folder pool" aria-label="Add folder pool" onClick={addFolderSource}><FolderOpen size={17} /></button>
              <button className="icon-button tooltip-anchor" data-tooltip="Add Pinterest board" aria-label="Add Pinterest board" onClick={() => setPinterestDialog((current) => ({ ...current, open: true }))}><Sparkles size={17} /></button>
              <button className="icon-button tooltip-anchor" data-tooltip="Add local image collection" aria-label="Add local image collection" onClick={addLocalImagesSource}><ImagePlus size={17} /></button>
            </div>
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
            <button className="primary-action" disabled={wallpaperBusy} onClick={() => void generateAndApply()}><Wallpaper size={17} /> {wallpaperBusy ? "Working…" : "Generate and Apply"}</button>
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
                  <button onClick={() => openExportSet()}><Images size={16} /> Export Set</button>
                  <button onClick={() => setLeftPanelOpen((value) => !value)}><PanelLeft size={16} /> Toggle Left Panel</button>
                  <button onClick={() => setRightPanelOpen((value) => !value)}><SlidersHorizontal size={16} /> Toggle Inspector</button>
                </div>
              )}
            </div>
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
          <div className={`floating-canvas-status ${cropModeLayerId ? "cropping" : ""}`}>
            <span>{Math.round(zoom * 100)}%</span>
            {cropModeLayerId && <button onClick={() => setCropModeLayerId(undefined)}>Done cropping</button>}
          </div>
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
            className={`canvas ${cropModeLayerId ? "crop-active" : ""}`}
            style={{
              width: scaled.width,
              height: scaled.height,
              backgroundColor: project.canvas.backgroundBaseMode === "transparent" ? "transparent" : project.canvas.backgroundColor,
              backgroundImage: project.canvas.backgroundBaseMode === "transparent"
                ? "linear-gradient(45deg, #f1f1ef 25%, transparent 25%), linear-gradient(-45deg, #f1f1ef 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f1ef 75%), linear-gradient(-45deg, transparent 75%, #f1f1ef 75%)"
                : undefined,
              backgroundSize: project.canvas.backgroundBaseMode === "transparent" ? `${16 * zoom}px ${16 * zoom}px` : undefined,
              backgroundPosition: project.canvas.backgroundBaseMode === "transparent" ? `0 0, 0 ${8 * zoom}px, ${8 * zoom}px ${-8 * zoom}px, ${-8 * zoom}px 0px` : undefined
            }}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.shiftKey) {
                const rect = event.currentTarget.getBoundingClientRect();
                const startX = clamp((event.clientX - rect.left) / zoom, 0, project.canvas.width);
                const startY = clamp((event.clientY - rect.top) / zoom, 0, project.canvas.height);
                const marquee: SelectionMarquee = { startX, startY, x: startX, y: startY, width: 0, height: 0, baseIds: selectedLayerIds };
                marqueeRef.current = marquee;
                setSelectionMarquee(marquee);
                event.currentTarget.setPointerCapture(event.pointerId);
              } else {
                clearLayerSelection();
              }
            }}
          >
            <BackgroundImageView canvas={project.canvas} customTextures={project.customTextures} zoom={zoom} />
            {guides.x !== undefined && <div className="guide vertical" style={{ left: guides.x * zoom }} />}
            {guides.y !== undefined && <div className="guide horizontal" style={{ top: guides.y * zoom }} />}
            {selectionMarquee && <div className="selection-marquee" style={{ left: selectionMarquee.x * zoom, top: selectionMarquee.y * zoom, width: selectionMarquee.width * zoom, height: selectionMarquee.height * zoom }} />}
            {project.layers.map((layer) => {
              const image = getImageForLayer(project, layer);
              if (layer.hidden) return null;
              const selected = selectedLayerIds.includes(layer.id);
              const cropping = cropModeLayerId === layer.id;
              const paperFrame = layer.effects.paperFrame ?? createDefaultPaperFrame();
              const insets = paperFrameInsets(paperFrame, layer.width, layer.height);
              const innerWidth = Math.max(1, layer.width - insets.left - insets.right);
              const innerHeight = Math.max(1, layer.height - insets.top - insets.bottom);
              const paperActive = paperFrame.type !== "none";
              const rough = paperFrameIsRough(paperFrame);
              return (
                <div
                  className={`placeholder ${selected ? "selected" : ""} ${layer.locked ? "locked" : ""} ${cropping ? "cropping" : ""} ${paperActive ? `paper-frame ${paperFrame.type}` : ""} ${rough ? "rough-paper" : ""}`}
                  key={layer.id}
                  style={{
                    left: layer.x * zoom,
                    top: layer.y * zoom,
                    width: layer.width * zoom,
                    height: layer.height * zoom,
                    transform: `rotate(${layer.rotation + paperFrameRotation(paperFrame)}deg)`,
                    borderWidth: layer.borderWidth * zoom,
                    borderColor: hexWithOpacity(layer.borderColor, layer.borderOpacity),
                    borderRadius: paperActive ? Math.min(18, paperFrame.borderWidth * 0.4) * zoom : layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? 0 : layer.borderRadius * zoom,
                    overflow: rough ? "visible" : "hidden",
                    clipPath: rough ? paperFrameClipPath(paperFrame) : undefined,
                    opacity: layer.opacity,
                    backgroundColor: paperActive ? paperFrame.paperColor : layer.effects.backgroundColor,
                    mixBlendMode: layer.effects.blendMode,
                    boxShadow: [
                      layer.effects.glow ? "0 0 0 2px rgba(255,255,255,.8), 0 0 32px rgba(207,42,69,.38)" : "",
                      Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) > 0 ? `0 ${Math.max(4, paperFrame.shadowStrength * 0.18)}px ${Math.max(12, paperFrame.shadowStrength * 0.75)}px rgba(15,23,42,${Math.min(0.42, Math.max(layer.shadow ? 35 : 0, paperFrame.shadowStrength) / 180)})` : ""
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
                  {paperActive && <span className="paper-frame-texture" style={{ opacity: paperFrame.textureIntensity / 100, backgroundImage: paperTextureBackground({ ...layer.effects.paper, type: layer.effects.paper.type === "none" ? "fine-grain" : layer.effects.paper.type }, project.customTextures) }} />}
                  <div
                    className="placeholder-image-area"
                    style={{
                      left: insets.left * zoom,
                      top: insets.top * zoom,
                      width: innerWidth * zoom,
                      height: innerHeight * zoom,
                      borderRadius: layer.maskShape === "circle" ? "50%" : layer.maskShape === "rectangle" ? 0 : Math.max(0, layer.borderRadius - Math.max(insets.left, insets.top)) * zoom,
                      backgroundColor: layer.effects.backgroundColor,
                      boxShadow: layer.effects.innerShadow ? "inset 0 0 22px rgba(15,23,42,.32)" : "none"
                    }}
                  >
                    {image ? (
                      <FramedImage
                        src={image.url}
                        frameWidth={innerWidth}
                        frameHeight={innerHeight}
                        mode={layer.cropMode}
                        alignment={layer.alignment}
                        crop={layer.crop}
                        zoom={zoom}
                        filter={cssFilter(layer.effects.filters)}
                        onNatural={(natural) => { imageNaturalRef.current[layer.id] = natural; }}
                      />
                    ) : (
                      <span><ImagePlus size={22} /> Assign source</span>
                    )}
                    <span className="texture-overlay" style={textureStyle(layer, project.customTextures)} />
                  </div>
                  {cropping && <span className="crop-mode-badge">CROP MODE</span>}
                  {selectedLayerId === layer.id && !layer.locked && !cropping && <SelectionHandles layer={layer} onBeginDrag={beginDrag} />}
                </div>
              );
            })}
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
              advancedOpen={backgroundAdvancedOpen}
              onAdvancedOpenChange={setBackgroundAdvancedOpen}
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
              diagnostics={lastWallpaperDiagnostics}
              targets={wallpaperTargets}
              templates={project.templates.templates}
              runtimeStatus={wallpaperStatus}
              countdownLabel={formatWallpaperCountdown(project.wallpaper.nextScheduledAt, nowTick)}
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
              <button className="template-apply" onClick={() => onApply(template)}><Wallpaper size={15} /> Apply</button>
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
        backgroundImage: canvas.backgroundImage ? `url(${canvas.backgroundImage.url})` : undefined
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
  filter,
  onNatural
}: {
  src: string;
  frameWidth: number;
  frameHeight: number;
  mode: CropMode;
  alignment: ImageAlignment;
  crop: PlaceholderLayer["crop"];
  zoom: number;
  filter?: string;
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
          backgroundImage: `url(${src})`,
          backgroundRepeat: "repeat",
          backgroundSize: `${placement.width * zoom}px ${placement.height * zoom}px`,
          backgroundPosition: `${placement.x * zoom}px ${placement.y * zoom}px`,
          filter
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
        left: placement.x * zoom,
        top: placement.y * zoom,
        width: placement.width * zoom,
        height: placement.height * zoom,
        filter
      } : { opacity: 0 }}
    />
  );
}

function BackgroundImageView({ canvas, customTextures, zoom }: { canvas: CanvasSettings; customTextures: WallpaperProject["customTextures"]; zoom: number }) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const showImage = canvas.backgroundBaseMode === "image" && Boolean(canvas.backgroundImage);
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
  const filter = `brightness(${canvas.backgroundBrightness}%) contrast(${canvas.backgroundContrast}%) blur(${canvas.backgroundBlur * zoom}px)`;
  return (
    <>
      {showImage && canvas.backgroundImage && (placement?.tile ? (
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
      ))}
      {canvas.backgroundTemperature !== 0 && <span className="canvas-background-temperature" style={{ backgroundColor: canvas.backgroundTemperature > 0 ? "#ff9b55" : "#5e8dff", opacity: Math.min(0.35, Math.abs(canvas.backgroundTemperature) / 280), mixBlendMode: "soft-light" }} />}
      <span className="canvas-background-texture" style={backgroundTextureStyle(canvas, customTextures)} />
    </>
  );
}

function backgroundTextureStyle(canvas: CanvasSettings, customTextures: WallpaperProject["customTextures"]): React.CSSProperties {
  const paper = canvas.backgroundPaper;
  return {
    opacity: Math.max(paper.opacity, paper.intensity / 100) * 0.55,
    mixBlendMode: paper.blendMode,
    backgroundImage: paperTextureBackground(paper, customTextures),
    backgroundSize: paper.type === "custom" ? `${Math.max(48, 220 * paper.scale)}px auto` : `${Math.max(96, 320 * paper.scale)}px ${Math.max(96, 320 * paper.scale)}px`,
    transform: `rotate(${paper.rotation}deg) scale(1.05)`
  };
}

function paperTextureBackground(paper: PaperTextureEffect, customTextures: WallpaperProject["customTextures"] = []) {
  if (paper.type === "none") return undefined;
  if (paper.type === "custom") {
    const texture = customTextures.find((item) => item.id === paper.customTextureId);
    return texture ? `url(${texture.url})` : undefined;
  }
  const bundled = bundledSurfaceUrl(paper.type);
  if (bundled) return `url(${bundled})`;
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
  onClose
}: {
  state: ExportSetState;
  onChange: React.Dispatch<React.SetStateAction<ExportSetState>>;
  onChooseFolder: () => void;
  onRun: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  if (!state.open) return null;
  const totalFinished = state.completed + state.skipped + state.failed;
  const progress = Math.min(100, (totalFinished / Math.max(1, state.count)) * 100);
  return (
    <div className="modal-backdrop" onMouseDown={() => !state.busy && onClose()}>
      <section className="modal export-set-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title-row">
          <div><h2>Export Set</h2><p>Create distinct wallpaper variations without changing the active desktop or live source state.</p></div>
          <button className="button ghost" disabled={state.busy} onClick={onClose}>Close</button>
        </div>
        <div className="export-set-grid">
          <label>Variations<input type="number" min="1" max="500" value={state.count} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, count: clamp(Number(event.target.value), 1, 500) }))} /></label>
          <label>Format<select value={state.format} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, format: event.target.value as "png" | "jpeg" }))}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
          {state.format === "jpeg" && <label>JPEG quality<input type="range" min="0.4" max="1" step="0.02" value={state.quality} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, quality: Number(event.target.value) }))} /><span>{Math.round(state.quality * 100)}%</span></label>}
        </div>
        <div className="destination-row"><span title={state.destinationPath}>{state.destinationPath ?? "Choose a destination folder"}</span><button className="button secondary" disabled={state.busy} onClick={onChooseFolder}>Choose Folder</button></div>
        <div className="export-options">
          <label><input type="checkbox" checked={state.includeTemplateName} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, includeTemplateName: event.target.checked }))} /> Include template name</label>
          <label><input type="checkbox" checked={state.includeTimestamp} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, includeTimestamp: event.target.checked }))} /> Include timestamp</label>
          <label><input type="checkbox" checked={state.avoidRepeats} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, avoidRepeats: event.target.checked }))} /> Avoid repeated combinations</label>
          <label><input type="checkbox" checked={state.advanceLiveState} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, advanceLiveState: event.target.checked }))} /> Advance live source state</label>
          <label><input type="checkbox" checked={state.overwrite} disabled={state.busy} onChange={(event) => onChange((current) => ({ ...current, overwrite: event.target.checked }))} /> Replace existing files</label>
        </div>
        {(state.busy || totalFinished > 0) && <>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="export-summary"><span>{state.completed} exported</span><span>{state.skipped} skipped</span><span>{state.failed} failed</span></div>
        </>}
        {state.error && <p className="dialog-error">{state.error}</p>}
        <div className="dialog-actions">
          {state.busy ? <button className="button destructive" onClick={onCancel}>Cancel</button> : <button className="button primary" onClick={onRun}>Export Variations</button>}
          {!state.busy && <button className="button ghost" onClick={onClose}>Done</button>}
        </div>
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
  onPrevious,
  onNext,
  busy,
  diagnostics,
  targets,
  templates,
  runtimeStatus,
  countdownLabel
}: {
  project: WallpaperProject;
  onPatch: (patch: Partial<WallpaperProject["wallpaper"]>) => void;
  onPrevious: () => void;
  onNext: () => void;
  busy: boolean;
  diagnostics?: WallpaperApplyResult["diagnostics"];
  targets: WallpaperTarget[];
  templates: WallpaperTemplate[];
  runtimeStatus: WallpaperRuntimeStatus;
  countdownLabel: string;
}) {
  const rotationActive = project.wallpaper.enabled && !project.wallpaper.paused && project.wallpaper.interval !== "manual";
  const currentTemplate = project.templates.templates.find((template) => template.id === project.templates.activeTemplateId);

  function toggleRotation() {
    if (rotationActive) {
      onPatch({ paused: true });
      return;
    }
    onPatch({
      enabled: true,
      paused: false,
      interval: project.wallpaper.interval === "manual" ? "15m" : project.wallpaper.interval
    });
  }

  return (
    <section className="panel wallpaper-panel settings-section">
      <details>
        <summary>Wallpaper Targets <ChevronDown size={15} /></summary>
        <label>
          Apply to
          <select value={project.wallpaper.scope} onChange={(event) => onPatch({ scope: event.target.value as WallpaperProject["wallpaper"]["scope"] })}>
            <option value="same-all-desktops">All monitors and desktops</option>
            <option value="different-per-desktop">Different on each target</option>
            <option value="current-desktop">Current monitor only</option>
          </select>
        </label>
        {project.wallpaper.scope === "different-per-desktop" && (
          <details className="target-config">
            <summary>Target templates <ChevronDown size={14} /></summary>
            <label>
              Assignment
              <select value={project.wallpaper.targetTemplateMode} onChange={(event) => onPatch({ targetTemplateMode: event.target.value as WallpaperProject["wallpaper"]["targetTemplateMode"] })}>
                <option value="single-template">Same template</option>
                <option value="different-template">Different template</option>
                <option value="playlist">Playlist per target</option>
              </select>
            </label>
            {project.wallpaper.targetTemplateMode === "single-template" && (
              <label>Template<select value={project.wallpaper.targetTemplateIds.all ?? ""} onChange={(event) => onPatch({ targetTemplateIds: { ...project.wallpaper.targetTemplateIds, all: event.target.value || undefined } })}>
                <option value="">Active template</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select></label>
            )}
            <div className="target-list">
              {targets.map((target) => (
                <div className="target-row" key={target.id}>
                  <span><strong>{target.label}</strong><small>{target.reliable ? "Detected" : target.limitation ?? "Best effort"}</small></span>
                  {project.wallpaper.targetTemplateMode === "different-template" && (
                    <select value={project.wallpaper.targetTemplateIds[target.id] ?? ""} onChange={(event) => onPatch({ targetTemplateIds: { ...project.wallpaper.targetTemplateIds, [target.id]: event.target.value || undefined } })}>
                      <option value="">Automatic</option>
                      {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </details>

      <details open>
        <summary>Schedule <ChevronDown size={15} /></summary>
        <div className="rotation-control-row">
          <button className={`button ${rotationActive ? "secondary" : "primary"}`} onClick={toggleRotation}>
            {rotationActive ? <Pause size={15} /> : <Play size={15} />} {rotationActive ? "Pause" : "Resume"}
          </button>
          <span className={`runtime-chip ${runtimeStatus}`}>{runtimeStatus}</span>
        </div>
        <label>Interval<select value={project.wallpaper.interval} onChange={(event) => {
          const interval = event.target.value as WallpaperProject["wallpaper"]["interval"];
          onPatch(interval === "manual" ? { interval, enabled: false, paused: false } : { interval, enabled: true, paused: false });
        }}>
          <option value="manual">Manual</option><option value="5s">5 seconds</option><option value="10s">10 seconds</option><option value="30s">30 seconds</option><option value="1m">1 minute</option><option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="30m">30 minutes</option><option value="hourly">Hourly</option><option value="few-hours">Every few hours</option><option value="daily">Daily</option><option value="login">At login</option><option value="custom">Custom</option>
        </select></label>
        {project.wallpaper.interval === "custom" && (
          <div className="custom-interval-row">
            <label>Every<input type="number" min="1" value={project.wallpaper.customIntervalValue} onChange={(event) => onPatch({ customIntervalValue: Number(event.target.value) })} /></label>
            <label>Unit<select value={project.wallpaper.customIntervalUnit} onChange={(event) => onPatch({ customIntervalUnit: event.target.value as WallpaperProject["wallpaper"]["customIntervalUnit"] })}><option value="seconds">Seconds</option><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label>
          </div>
        )}
        {rotationActive && <p className="settings-hint">Next update {countdownLabel}</p>}
      </details>

      <div className="compact-action-row">
        <button className="button ghost" disabled={busy} onClick={onPrevious}>Previous</button>
        <button className="button ghost" disabled={busy} onClick={onNext}>Next</button>
      </div>

      <details>
        <summary>Advanced <ChevronDown size={15} /></summary>
        <label className="toggle-setting"><input type="checkbox" checked={project.wallpaper.transitionEnabled} onChange={(event) => onPatch({ transitionEnabled: event.target.checked })} /> Fade transition</label>
        {project.wallpaper.transitionEnabled && <FilterSlider label="Fade duration" value={project.wallpaper.transitionDurationMs} min={200} max={1600} step={50} onChange={(value) => onPatch({ transitionDurationMs: value })} />}
        <p className="settings-hint">Active monitors fade smoothly. Inactive Mission Control Spaces update without animation.</p>
      </details>

      <div className="wallpaper-status-card">
        <div><span>Template</span><strong>{currentTemplate?.name ?? project.name}</strong></div>
        <div><span>Status</span><strong>{runtimeStatus}</strong></div>
        {project.wallpaper.lastUpdatedAt && <div><span>Last applied</span><strong>{new Date(project.wallpaper.lastUpdatedAt).toLocaleTimeString()}</strong></div>}
        {project.wallpaper.lastError && <p className="status-error">{project.wallpaper.lastError}</p>}
      </div>
      {diagnostics && <details className="diagnostics"><summary>Diagnostics <ChevronDown size={14} /></summary><pre>{JSON.stringify(diagnostics, null, 2)}</pre></details>}
    </section>
  );
}

function CanvasDesignPanel({
  canvas,
  customTextures,
  advancedOpen,
  onAdvancedOpenChange,
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
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
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

  return (
    <section className="panel canvas-design-panel settings-section">
      <h2>Settings</h2>
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
        <div className="segmented-control three-options" role="group" aria-label="Background base">
          <button className={canvas.backgroundBaseMode === "color" ? "active" : ""} onClick={() => onPatch({ backgroundBaseMode: "color", backgroundTransparent: false })}>Color</button>
          <button className={canvas.backgroundBaseMode === "transparent" ? "active" : ""} onClick={() => onPatch({ backgroundBaseMode: "transparent", backgroundTransparent: true })}>Clear</button>
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

      <details>
        <summary>Surface <ChevronDown size={15} /></summary>
        <div className="texture-picker-grid compact-texture-grid">
          {surfaces.map((surface) => <button key={surface.type} className={canvas.backgroundPaper.type === surface.type ? "texture-choice active" : "texture-choice"} onClick={() => patchPaper({ type: surface.type, customTextureId: undefined, intensity: surface.type === "none" ? 0 : Math.max(24, canvas.backgroundPaper.intensity), opacity: surface.type === "none" ? 0 : Math.max(.22, canvas.backgroundPaper.opacity) })}><span className="texture-swatch" style={{ backgroundImage: surface.thumbnailUrl ? `url(${surface.thumbnailUrl})` : undefined }} /><span>{surface.label}</span></button>)}
          {customTextures.map((texture) => <div className={canvas.backgroundPaper.type === "custom" && canvas.backgroundPaper.customTextureId === texture.id ? "texture-choice custom active" : "texture-choice custom"} key={texture.id}><button onClick={() => patchPaper({ type: "custom", customTextureId: texture.id, intensity: Math.max(30, canvas.backgroundPaper.intensity), opacity: Math.max(.3, canvas.backgroundPaper.opacity) })}><span className="texture-swatch" style={{ backgroundImage: `url(${texture.url})` }} /><span>{texture.name}</span></button><div className="texture-actions"><button onClick={() => onRevealTexture(texture.id)}>Show</button><button onClick={() => onRemoveTexture(texture.id)}>Remove</button></div></div>)}
        </div>
        <button className="button ghost compact" onClick={onImportTexture}>Import Custom Surface</button>
        {canvas.backgroundPaper.type !== "none" && <><FilterSlider label="Intensity" value={canvas.backgroundPaper.intensity} min={0} max={100} onChange={(value) => patchPaper({ intensity: value, opacity: Math.max(.05, value / 100) })} /><FilterSlider label="Scale" value={canvas.backgroundPaper.scale} min={.4} max={3} step={.1} onChange={(value) => patchPaper({ scale: value })} /></>}
      </details>

      <details open={advancedOpen} onToggle={(event) => onAdvancedOpenChange(event.currentTarget.open)}>
        <summary>Advanced <ChevronDown size={15} /></summary>
        <FilterSlider label="Blur" value={canvas.backgroundBlur} min={0} max={30} step={.5} onChange={(value) => onPatch({ backgroundBlur: value })} />
        <FilterSlider label="Brightness" value={canvas.backgroundBrightness} min={0} max={200} onChange={(value) => onPatch({ backgroundBrightness: value })} />
        <FilterSlider label="Contrast" value={canvas.backgroundContrast} min={0} max={200} onChange={(value) => onPatch({ backgroundContrast: value })} />
        <FilterSlider label="Temperature" value={canvas.backgroundTemperature} min={-100} max={100} onChange={(value) => onPatch({ backgroundTemperature: value })} />
        <div className="two-col"><label>Offset X<input type="number" value={canvas.backgroundOffsetX} onChange={(event) => onPatch({ backgroundOffsetX: Number(event.target.value) })} /></label><label>Offset Y<input type="number" value={canvas.backgroundOffsetY} onChange={(event) => onPatch({ backgroundOffsetY: Number(event.target.value) })} /></label></div>
        <FilterSlider label="Image scale" value={canvas.backgroundScale} min={.1} max={4} step={.05} onChange={(value) => onPatch({ backgroundScale: value })} />
        <FilterSlider label="Surface opacity" value={canvas.backgroundPaper.opacity} min={0} max={1} step={.05} onChange={(value) => patchPaper({ opacity: value })} />
        <label>Surface blend<select value={canvas.backgroundPaper.blendMode} onChange={(event) => patchPaper({ blendMode: event.target.value as PaperTextureEffect["blendMode"] })}><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft Light</option></select></label>
        <label>Seed<input type="number" value={canvas.backgroundPaper.seed} onChange={(event) => patchPaper({ seed: Number(event.target.value) })} /></label>
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
  function patchPaperFrame(patch: Partial<PlaceholderLayer["effects"]["paperFrame"]>) { onPatch({ effects: { ...activeLayer.effects, paperFrame: { ...activeLayer.effects.paperFrame, ...patch } } }); }
  function resetCrop() { onPatch({ crop: { offsetX: 0, offsetY: 0, zoom: 1 }, alignment: "center" }); }
  const frameType = layer.effects.paperFrame.type;

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
          {frameType !== "none" && <>
            <div className="two-col"><label>Paper<input type="color" value={layer.effects.paperFrame.paperColor} onChange={(event) => patchPaperFrame({ paperColor: event.target.value })} /></label><label>Border<input type="number" min="0" max="240" value={layer.effects.paperFrame.borderWidth} onChange={(event) => patchPaperFrame({ borderWidth: Number(event.target.value) })} /></label></div>
            {(frameType === "polaroid" || frameType === "clean") && <FilterSlider label="Padding" value={layer.effects.paperFrame.innerPadding} min={0} max={120} onChange={(value) => patchPaperFrame({ innerPadding: value })} />}
            {(frameType === "torn" || frameType === "deckle") && <FilterSlider label={frameType === "torn" ? "Tear size" : "Fiber roughness"} value={layer.effects.paperFrame.edgeRoughness} min={0} max={100} onChange={(value) => patchPaperFrame({ edgeRoughness: value })} />}
            <FilterSlider label="Shadow" value={layer.effects.paperFrame.shadowStrength} min={0} max={100} onChange={(value) => patchPaperFrame({ shadowStrength: value })} />
            <FilterSlider label="Texture" value={layer.effects.paperFrame.textureIntensity} min={0} max={100} onChange={(value) => patchPaperFrame({ textureIntensity: value })} />
            {(frameType === "torn" || frameType === "deckle") && <button className="button ghost full-width" onClick={() => patchPaperFrame({ seed: Math.floor(Math.random() * 1_000_000) + 1 })}>Randomize Edge</button>}
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

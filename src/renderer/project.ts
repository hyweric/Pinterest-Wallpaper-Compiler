import type {
  CanvasSettings,
  GeneratedCombination,
  ImageFilters,
  ImageSource,
  PaperFrameEffect,
  PaperTextureEffect,
  PlaceholderEffects,
  PlaceholderLayer,
  PlaceholderSourceState,
  TemplateLibrary,
  WallpaperProject,
  WallpaperProjectSnapshot,
  WallpaperSettings,
  WallpaperTemplate
} from "../shared/types";

export const presets = [
  { id: "1920x1080", label: "Desktop HD", width: 1920, height: 1080 },
  { id: "2560x1440", label: "Desktop QHD", width: 2560, height: 1440 },
  { id: "3840x2160", label: "Desktop 4K", width: 3840, height: 2160 },
  { id: "1920x1200", label: "MacBook 16:10", width: 1920, height: 1200 },
  { id: "custom", label: "Custom", width: 1920, height: 1080 }
];

export function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createDefaultWallpaperSettings(): WallpaperSettings {
  return {
    enabled: false,
    paused: false,
    interval: "15m",
    customIntervalMinutes: 20,
    customIntervalValue: 20,
    customIntervalUnit: "minutes",
    launchAtLogin: false,
    startMinimized: false,
    transitionEnabled: true,
    transitionDurationMs: 650,
    monitorMode: "all",
    scope: "same-all-desktops",
    targetTemplateMode: "single-template",
    targetTemplateIds: {},
    targetPlaylistIds: {},
    displayMode: "fill",
    consecutiveFailures: 0
  };
}

export function createDefaultTemplateLibrary(): TemplateLibrary {
  return {
    templates: [],
    collections: [
      { id: "collection-minimal", name: "Minimal" },
      { id: "collection-study", name: "Study" },
      { id: "collection-moodboards", name: "Moodboards" },
      { id: "collection-seasonal", name: "Seasonal" }
    ],
    rotationMode: "shuffle",
    rotationTemplateIds: [],
    shuffleQueue: [],
    currentIndex: 0,
    activeTemplateId: undefined
  };
}

export function createProject(): WallpaperProject {
  const now = new Date().toISOString();
  const project: WallpaperProject = {
    schemaVersion: 2,
    id: uid("project"),
    name: "My First Template",
    canvas: {
      width: 1920,
      height: 1080,
      presetId: "1920x1080",
      orientation: "landscape",
      backgroundColor: "#f1eee8",
      backgroundBaseMode: "color",
      backgroundTransparent: false,
      backgroundMode: "cover",
      backgroundAlignment: "center",
      backgroundOffsetX: 0,
      backgroundOffsetY: 0,
      backgroundScale: 1,
      backgroundBlur: 0,
      backgroundBrightness: 100,
      backgroundContrast: 100,
      backgroundTemperature: 0,
      backgroundVignette: 0,
      backgroundOpacity: 1,
      backgroundPaper: createDefaultPaper()
    },
    layers: [],
    sources: [],
    customTextures: [],
    wallpaper: createDefaultWallpaperSettings(),
    templates: createDefaultTemplateLibrary(),
    savedCombinations: [],
    recentCombinations: [],
    createdAt: now,
    updatedAt: now
  };
  const template = createWallpaperTemplate(project, { name: project.name });
  project.templates = {
    ...project.templates,
    templates: [template],
    rotationTemplateIds: [template.id],
    activeTemplateId: template.id
  };
  return project;
}

export function createDefaultSourceState(sourceId?: string): PlaceholderSourceState {
  return {
    sourceIds: sourceId ? [sourceId] : [],
    mode: "shuffle",
    currentIndex: 0,
    shuffleQueue: [],
    usedImageIds: [],
    preventDuplicates: true,
    includeSubfolders: false
  };
}

export function createPlaceholder(canvas: CanvasSettings, index: number): PlaceholderLayer {
  const width = Math.round(canvas.width * 0.28);
  const height = Math.round(canvas.height * 0.42);
  return {
    id: uid("placeholder"),
    type: "placeholder",
    name: `Image ${index}`,
    x: Math.round(canvas.width * 0.12 + index * 28),
    y: Math.round(canvas.height * 0.16 + index * 28),
    width,
    height,
    rotation: 0,
    cropMode: "cover",
    alignment: "center",
    borderWidth: 0,
    borderColor: "#ffffff",
    borderOpacity: 1,
    borderRadius: 24,
    maskShape: "rounded",
    shadow: true,
    opacity: 1,
    locked: false,
    hidden: false,
    keepAspectRatio: false,
    crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    effects: createDefaultEffects(),
    sourceState: createDefaultSourceState()
  };
}

export function createDefaultFilters(): ImageFilters {
  return {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    exposure: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    blur: 0,
    sharpen: 0,
    sepia: 0,
    grayscale: 0,
    fade: 0,
    vignette: 0,
    grain: 0,
    presetId: "none"
  };
}

export function createDefaultPaper(): PaperTextureEffect {
  return {
    type: "none",
    intensity: 0,
    scale: 1,
    rotation: 0,
    opacity: 0,
    blendMode: "multiply",
    seed: 1
  };
}

export function createDefaultPaperFrame(): PaperFrameEffect {
  return {
    type: "none",
    borderWidth: 20,
    paperColor: "#fffdf8",
    edgeRoughness: 35,
    shadowStrength: 35,
    innerPadding: 0,
    rotationVariation: 0,
    textureIntensity: 20,
    seed: 1
  };
}

export function createDefaultEffects(): PlaceholderEffects {
  return {
    filters: createDefaultFilters(),
    paper: createDefaultPaper(),
    innerShadow: false,
    glow: false,
    backgroundColor: "#ffffff",
    blendMode: "normal",
    polaroidFrame: false,
    tapeDecoration: false,
    tornEdgeMask: false,
    paperFrame: createDefaultPaperFrame()
  };
}

function mediaCounts(images: ImageSource["images"]) {
  const videos = images.filter((image) => image.mediaType === "video").length;
  return { total: images.length, images: images.length - videos, videos };
}

export function sourceImagesForPolicy(source: ImageSource) {
  const policy = source.mediaPolicy ?? "images-only";
  if (policy === "images-and-video-thumbnails") return source.images.filter((image) => image.mediaType !== "video" || image.videoThumbnail !== false);
  return source.images.filter((image) => image.mediaType !== "video");
}

function normalizeSource(source: ImageSource): ImageSource {
  const images = (source.images ?? []).map((image) => ({ ...image, mediaType: image.mediaType ?? "image" as const }));
  return {
    ...source,
    images,
    mediaPolicy: source.mediaPolicy === "images-and-video-thumbnails" ? "images-and-video-thumbnails" : "images-only",
    mediaCounts: mediaCounts(images),
    providerId: source.providerId ?? (source.type === "mock-web" ? undefined : source.type),
    importStatus: source.importStatus ?? "ready",
    includeSubfolders: source.includeSubfolders ?? false,
    lastScannedAt: source.lastScannedAt ?? source.updatedAt,
    importLog: source.importLog ?? []
  };
}

function normalizeCanvas(canvas: CanvasSettings): CanvasSettings {
  return {
    ...canvas,
    backgroundBaseMode: canvas.backgroundBaseMode ?? (canvas.backgroundTransparent ? "transparent" : canvas.backgroundImage ? "image" : "color"),
    backgroundTransparent: canvas.backgroundTransparent ?? false,
    backgroundMode: canvas.backgroundMode ?? "cover",
    backgroundAlignment: canvas.backgroundAlignment ?? "center",
    backgroundOffsetX: canvas.backgroundOffsetX ?? 0,
    backgroundOffsetY: canvas.backgroundOffsetY ?? 0,
    backgroundScale: canvas.backgroundScale ?? 1,
    backgroundBlur: canvas.backgroundBlur ?? 0,
    backgroundBrightness: canvas.backgroundBrightness ?? 100,
    backgroundContrast: canvas.backgroundContrast ?? 100,
    backgroundTemperature: canvas.backgroundTemperature ?? 0,
    backgroundVignette: canvas.backgroundVignette ?? 0,
    backgroundOpacity: canvas.backgroundOpacity ?? 1,
    backgroundPaper: { ...createDefaultPaper(), ...(canvas.backgroundPaper ?? {}) }
  };
}

function normalizeLayer(layer: PlaceholderLayer): PlaceholderLayer {
  const legacyPaperType = layer.effects?.paperFrame?.type as string | undefined;
  const paperType = legacyPaperType === "clean-paper" || legacyPaperType === "photo-print" ? "clean"
    : legacyPaperType === "torn-paper" ? "torn"
      : legacyPaperType === "deckle-edge" ? "deckle"
        : legacyPaperType === "newspaper-cutout" ? "newsprint"
          : legacyPaperType === "polaroid" ? "polaroid"
            : "none";
  return {
    ...layer,
    borderOpacity: layer.borderOpacity ?? 1,
    maskShape: layer.maskShape ?? (layer.borderRadius >= Math.min(layer.width, layer.height) / 2 ? "circle" : layer.borderRadius > 0 ? "rounded" : "rectangle"),
    crop: layer.crop ?? { offsetX: 0, offsetY: 0, zoom: 1 },
    sourceState: {
      ...createDefaultSourceState(layer.sourceId),
      ...(layer.sourceState ?? {}),
      sourceIds: layer.sourceState?.sourceIds?.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : []
    },
    effects: {
      ...createDefaultEffects(),
      ...(layer.effects ?? {}),
      filters: { ...createDefaultFilters(), ...(layer.effects?.filters ?? {}) },
      paper: { ...createDefaultPaper(), ...(layer.effects?.paper ?? {}) },
      paperFrame: { ...createDefaultPaperFrame(), ...(layer.effects?.paperFrame ?? {}), type: paperType }
    }
  };
}

function imageSourceIdentity(source: ImageSource) {
  if (source.type === "local-folder" && source.path) return `folder:${source.path}`;
  if (source.type === "pinterest-board" && source.url) return `pinterest:${source.url.replace(/\/$/, "").toLowerCase()}`;
  if (source.type === "local-file") return `files:${source.images.map((image) => image.path).sort().join("|")}`;
  return `${source.type}:${source.id}`;
}

function mergeSources(existing: ImageSource[], incoming: ImageSource[]) {
  const merged = [...existing];
  for (const source of incoming) {
    const index = merged.findIndex((item) => imageSourceIdentity(item) === imageSourceIdentity(source) || item.id === source.id);
    if (index >= 0) merged[index] = { ...merged[index], ...source, id: merged[index].id };
    else merged.push(source);
  }
  return merged;
}

function sourceIdsFromLayers(layers: PlaceholderLayer[]) {
  return [...new Set(layers.flatMap((layer) => layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : []))];
}

export function createTemplateSnapshot(project: WallpaperProject): WallpaperProjectSnapshot {
  const activeTemplate = project.templates.templates.find((template) => template.id === project.templates.activeTemplateId);
  const linkedSourceIds = activeTemplate?.project.sourceIds ?? [];
  return {
    canvas: structuredClone(project.canvas),
    layers: structuredClone(project.layers),
    sourceIds: [...new Set([...linkedSourceIds, ...sourceIdsFromLayers(project.layers)])],
    wallpaper: structuredClone(project.wallpaper)
  };
}

export function activeTemplateSourceIds(project: WallpaperProject) {
  return project.templates.templates.find((template) => template.id === project.templates.activeTemplateId)?.project.sourceIds ?? [];
}

export function linkSourceToActiveTemplate(project: WallpaperProject, sourceId: string): WallpaperProject {
  const activeId = project.templates.activeTemplateId;
  if (!activeId) return project;
  return {
    ...project,
    templates: {
      ...project.templates,
      templates: project.templates.templates.map((template) =>
        template.id === activeId
          ? {
              ...template,
              project: {
                ...template.project,
                sourceIds: [...new Set([...template.project.sourceIds, sourceId])]
              },
              updatedAt: new Date().toISOString()
            }
          : template
      )
    }
  };
}

export function unlinkSourceFromActiveTemplate(project: WallpaperProject, sourceId: string): WallpaperProject {
  const activeId = project.templates.activeTemplateId;
  if (!activeId) return project;
  return {
    ...project,
    layers: project.layers.map((layer) => {
      const sourceIds = layer.sourceState.sourceIds.filter((id) => id !== sourceId);
      const wasPrimary = layer.sourceId === sourceId;
      return {
        ...layer,
        sourceId: wasPrimary ? sourceIds[0] : layer.sourceId,
        selectedImageId: wasPrimary ? undefined : layer.selectedImageId,
        generatedImageId: wasPrimary ? undefined : layer.generatedImageId,
        sourceState: { ...layer.sourceState, sourceIds }
      };
    }),
    templates: {
      ...project.templates,
      templates: project.templates.templates.map((template) =>
        template.id === activeId
          ? {
              ...template,
              project: {
                ...template.project,
                sourceIds: template.project.sourceIds.filter((id) => id !== sourceId),
                layers: template.project.layers.map((layer) => {
                  const sourceIds = layer.sourceState.sourceIds.filter((id) => id !== sourceId);
                  const wasPrimary = layer.sourceId === sourceId;
                  return {
                    ...layer,
                    sourceId: wasPrimary ? sourceIds[0] : layer.sourceId,
                    selectedImageId: wasPrimary ? undefined : layer.selectedImageId,
                    generatedImageId: wasPrimary ? undefined : layer.generatedImageId,
                    sourceState: { ...layer.sourceState, sourceIds }
                  };
                })
              },
              updatedAt: new Date().toISOString()
            }
          : template
      )
    }
  };
}

export function createWallpaperTemplate(
  project: WallpaperProject,
  options: { name?: string; thumbnailDataUrl?: string; collectionIds?: string[] } = {}
): WallpaperTemplate {
  const now = new Date().toISOString();
  return {
    id: uid("template"),
    name: options.name?.trim() || project.name || "Untitled Template",
    project: createTemplateSnapshot(project),
    thumbnailDataUrl: options.thumbnailDataUrl,
    collectionIds: options.collectionIds ?? [],
    favorite: false,
    enabledForRotation: true,
    weight: 1,
    createdAt: now,
    updatedAt: now
  };
}

export function workspaceFromTemplate(project: WallpaperProject, template: WallpaperTemplate): WallpaperProject {
  return {
    ...project,
    name: template.name,
    canvas: structuredClone(template.project.canvas),
    layers: structuredClone(template.project.layers),
    wallpaper: { ...createDefaultWallpaperSettings(), ...structuredClone(template.project.wallpaper) },
    templates: {
      ...project.templates,
      activeTemplateId: template.id,
      templates: project.templates.templates.map((item) =>
        item.id === template.id ? { ...item, lastUsedAt: new Date().toISOString() } : item
      )
    }
  };
}

export function updateActiveTemplateSnapshot(project: WallpaperProject, thumbnailDataUrl?: string): WallpaperProject {
  const activeId = project.templates.activeTemplateId;
  if (!activeId) return project;
  const now = new Date().toISOString();
  return {
    ...project,
    templates: {
      ...project.templates,
      templates: project.templates.templates.map((template) =>
        template.id === activeId
          ? {
              ...template,
              name: project.name,
              project: createTemplateSnapshot(project),
              thumbnailDataUrl: thumbnailDataUrl ?? template.thumbnailDataUrl,
              updatedAt: now
            }
          : template
      )
    }
  };
}

function stripCombinationPreview(combination: GeneratedCombination): GeneratedCombination {
  const { previewDataUrl: _previewDataUrl, ...rest } = combination;
  return rest;
}

/**
 * Crash recovery should store project structure, not multi-megabyte rendered
 * previews. Explicit project saves still keep the full project data.
 */
export function compactProjectForAutosave(project: WallpaperProject): WallpaperProject {
  return {
    ...project,
    savedCombinations: project.savedCombinations.map(stripCombinationPreview),
    recentCombinations: project.recentCombinations.map(stripCombinationPreview),
    templates: {
      ...project.templates,
      templates: project.templates.templates.map(({ thumbnailDataUrl: _thumbnailDataUrl, ...template }) => template)
    }
  };
}

export function normalizeProject(input: WallpaperProject): WallpaperProject {
  const raw = input as WallpaperProject & { schemaVersion?: number };
  type LegacyTemplate = Omit<WallpaperTemplate, "project"> & {
    project?: Partial<WallpaperProjectSnapshot> & { sources?: ImageSource[] };
  };
  const wallpaper = { ...createDefaultWallpaperSettings(), ...(raw.wallpaper ?? {}) };
  wallpaper.scope = wallpaper.scope ?? "same-all-desktops";
  wallpaper.targetTemplateMode = wallpaper.targetTemplateMode ?? "single-template";
  wallpaper.targetTemplateIds = wallpaper.targetTemplateIds ?? {};
  wallpaper.targetPlaylistIds = wallpaper.targetPlaylistIds ?? {};
  wallpaper.transitionEnabled = wallpaper.transitionEnabled ?? true;
  wallpaper.transitionDurationMs = Math.max(200, Math.min(1600, wallpaper.transitionDurationMs ?? 650));
  const layers = (raw.layers ?? []).map(normalizeLayer);
  let sources = (raw.sources ?? []).map(normalizeSource);
  const defaultLibrary = createDefaultTemplateLibrary();
  const rawTemplates = ((raw.templates as TemplateLibrary | undefined)?.templates ?? []) as unknown as LegacyTemplate[];

  const templates = rawTemplates.map((template) => {
    const legacyProject = template.project ?? {};
    const legacySources = Array.isArray(legacyProject.sources) ? legacyProject.sources.map(normalizeSource) : [];
    sources = mergeSources(sources, legacySources);
    const templateLayers = (legacyProject.layers ?? []).map(normalizeLayer);
    const linkedIds: string[] = Array.isArray(legacyProject.sourceIds)
      ? legacyProject.sourceIds.filter((id): id is string => typeof id === "string")
      : legacySources.length
        ? legacySources.map((source) => source.id)
        : sourceIdsFromLayers(templateLayers);
    return {
      ...template,
      project: {
        canvas: normalizeCanvas(structuredClone(legacyProject.canvas ?? raw.canvas)),
        layers: structuredClone(templateLayers),
        sourceIds: [...new Set(linkedIds)],
        wallpaper: { ...wallpaper, ...(legacyProject.wallpaper ?? {}) }
      },
      collectionIds: template.collectionIds ?? [],
      favorite: template.favorite ?? false,
      enabledForRotation: template.enabledForRotation ?? true,
      weight: template.weight ?? 1,
      createdAt: template.createdAt ?? raw.createdAt ?? new Date().toISOString(),
      updatedAt: template.updatedAt ?? raw.updatedAt ?? new Date().toISOString()
    } satisfies WallpaperTemplate;
  });

  const base: WallpaperProject = {
    ...raw,
    schemaVersion: 2,
    name: raw.name || "Untitled Template",
    canvas: normalizeCanvas(raw.canvas),
    layers,
    sources,
    customTextures: raw.customTextures ?? [],
    wallpaper,
    templates: {
      ...defaultLibrary,
      ...(raw.templates ?? {}),
      collections: raw.templates?.collections ?? defaultLibrary.collections,
      templates,
      rotationTemplateIds: raw.templates?.rotationTemplateIds ?? [],
      shuffleQueue: raw.templates?.shuffleQueue ?? [],
      currentIndex: raw.templates?.currentIndex ?? 0,
      activeTemplateId: raw.templates?.activeTemplateId
    },
    savedCombinations: raw.savedCombinations ?? [],
    recentCombinations: raw.recentCombinations ?? [],
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString()
  };

  const sourceNameById = new Map(base.sources.map((source) => [source.id, source.name]));
  let genericIndex = 1;
  const migrateLayerName = (layer: PlaceholderLayer) => {
    const sourceId = layer.sourceState.sourceIds[0] ?? layer.sourceId;
    const sourceName = sourceId ? sourceNameById.get(sourceId) : undefined;
    if (sourceName && layer.name.trim() === sourceName.trim()) return { ...layer, name: `Image ${genericIndex++}` };
    if (/^placeholder(?:\s+\d+)?$/i.test(layer.name.trim())) return { ...layer, name: `Image ${genericIndex++}` };
    genericIndex += 1;
    return layer;
  };
  base.layers = base.layers.map(migrateLayerName);
  base.templates.templates = base.templates.templates.map((template) => ({
    ...template,
    project: { ...template.project, layers: template.project.layers.map(migrateLayerName) }
  }));

  if (base.templates.templates.length === 0) {
    const migrated = createWallpaperTemplate(base, { name: base.name });
    base.templates = {
      ...base.templates,
      templates: [migrated],
      rotationTemplateIds: [migrated.id],
      activeTemplateId: migrated.id
    };
  } else if (!base.templates.activeTemplateId || !base.templates.templates.some((template) => template.id === base.templates.activeTemplateId)) {
    base.templates.activeTemplateId = base.templates.templates[0].id;
  }

  return base;
}

export function collectLayerImages(project: WallpaperProject, layer: PlaceholderLayer): LocalPoolImage[] {
  const sourceIds = layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
  return sourceIds.flatMap((sourceId) => {
    const source = project.sources.find((item) => item.id === sourceId);
    if (!source) return [];
    return sourceImagesForPolicy(source).map((image) => ({ image, source }));
  });
}

interface LocalPoolImage {
  image: ImageSource["images"][number];
  source: ImageSource;
}

export function selectImageForLayer(
  project: WallpaperProject,
  layer: PlaceholderLayer,
  usedImageIds = new Set<string>()
): { layer: PlaceholderLayer; imageId?: string } {
  const pool = collectLayerImages(project, layer);
  if (pool.length === 0) return { layer };

  const available = layer.sourceState.preventDuplicates ? pool.filter((item) => !usedImageIds.has(item.image.id)) : pool;
  const candidates = available.length > 0 ? available : pool;
  const mode = layer.sourceState.mode;
  let image = candidates[0]?.image;
  let nextState = { ...layer.sourceState };

  if (mode === "fixed") {
    image = pool.find((item) => item.image.id === layer.selectedImageId)?.image ?? candidates[0].image;
  } else if (mode === "sequential") {
    const index = nextState.currentIndex % pool.length;
    image = pool[index].image;
    nextState.currentIndex = (index + 1) % pool.length;
  } else if (mode === "newest" || mode === "oldest") {
    const sorted = [...candidates].sort((a, b) => {
      const aTime = Date.parse(a.image.modifiedAt ?? "1970-01-01");
      const bTime = Date.parse(b.image.modifiedAt ?? "1970-01-01");
      return mode === "newest" ? bTime - aTime : aTime - bTime;
    });
    image = sorted[0].image;
  } else if (mode === "shuffle") {
    let queue = nextState.shuffleQueue.filter((imageId) => pool.some((item) => item.image.id === imageId));
    if (queue.length === 0) {
      queue = shuffle(pool.map((item) => item.image.id));
      nextState.usedImageIds = [];
    }
    const nextId = queue.find((imageId) => !usedImageIds.has(imageId)) ?? queue[0];
    image = pool.find((item) => item.image.id === nextId)?.image ?? candidates[0].image;
    nextState.shuffleQueue = queue.filter((imageId) => imageId !== image?.id);
    nextState.usedImageIds = [...new Set([...nextState.usedImageIds, image.id])];
  } else {
    image = candidates[Math.floor(Math.random() * candidates.length)].image;
  }

  usedImageIds.add(image.id);
  return {
    imageId: image.id,
    layer: {
      ...layer,
      sourceId: pool.find((item) => item.image.id === image.id)?.source.id ?? layer.sourceId,
      generatedImageId: image.id,
      sourceState: nextState
    }
  };
}

export function createCombination(assignments: Record<string, string>, templateId?: string): GeneratedCombination {
  return {
    id: uid("combo"),
    name: `Generated ${new Date().toLocaleTimeString()}`,
    createdAt: new Date().toISOString(),
    assignments,
    templateId
  };
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function touchProject(project: WallpaperProject): WallpaperProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

export function getImageForLayer(project: WallpaperProject, layer: PlaceholderLayer) {
  const sourceIds = layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
  const imageId = layer.generatedImageId || layer.selectedImageId;
  for (const sourceId of sourceIds) {
    const source = project.sources.find((item) => item.id === sourceId);
    const image = source?.images.find((item) => item.id === imageId);
    if (image) return image;
  }
  return undefined;
}

export function assignmentForLayer(project: WallpaperProject, layer: PlaceholderLayer) {
  const sourceIds = layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
  for (const sourceId of sourceIds) {
    const source = project.sources.find((item) => item.id === sourceId);
    if (!source) continue;
    const images = sourceImagesForPolicy(source);
    if (images.length === 0) continue;
    return images.find((image) => image.id === layer.selectedImageId) ?? images[0];
  }
  return undefined;
}

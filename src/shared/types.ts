export type ExportFormat = "png" | "jpeg";

export type CropMode = "cover" | "contain" | "stretch" | "original" | "tile";

export type BackgroundFitMode = "cover" | "contain" | "stretch" | "original" | "tile" | "center";
export type MaskShape = "rectangle" | "rounded" | "circle";
export type CanvasResizeMode = "keep" | "scale" | "center";

export type ImageSelectionMode = "fixed" | "sequential" | "random" | "shuffle" | "newest" | "oldest";

export type WallpaperInterval =
  | "manual"
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "hourly"
  | "few-hours"
  | "daily"
  | "login"
  | "custom";

export type TemplateRotationMode = "sequential" | "random" | "shuffle";

export type WallpaperDisplayMode = "fill" | "fit" | "stretch" | "tile" | "center" | "span";

export type ImageAlignment =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "soft-light";

export interface ImageFilters {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  blur: number;
  sharpen: number;
  sepia: number;
  grayscale: number;
  fade: number;
  vignette: number;
  grain: number;
  presetId?: string;
}

export interface PaperTextureEffect {
  type:
    | "none"
    | "fine-grain"
    | "recycled"
    | "matte-photo"
    | "canvas"
    | "newspaper"
    | "fold-marks"
    | "dust-scratches"
    | "halftone";
  intensity: number;
  scale: number;
  rotation: number;
  opacity: number;
  blendMode: BlendMode;
  seed: number;
}

export interface PlaceholderEffects {
  filters: ImageFilters;
  paper: PaperTextureEffect;
  innerShadow: boolean;
  glow: boolean;
  backgroundColor: string;
  blendMode: BlendMode;
  polaroidFrame: boolean;
  tapeDecoration: boolean;
  tornEdgeMask: boolean;
}

export interface CropTransform {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface CanvasSettings {
  width: number;
  height: number;
  presetId: string;
  orientation: "landscape" | "portrait" | "square" | "custom";
  backgroundColor: string;
  backgroundTransparent: boolean;
  backgroundImage?: LocalImageRef;
  backgroundMode: BackgroundFitMode;
  backgroundAlignment: ImageAlignment;
  backgroundOffsetX: number;
  backgroundOffsetY: number;
  backgroundScale: number;
  backgroundBlur: number;
  backgroundBrightness: number;
  backgroundOpacity: number;
  backgroundPaper: PaperTextureEffect;
}

export interface LocalImageRef {
  id: string;
  name: string;
  path: string;
  url: string;
  modifiedAt?: string;
  size?: number;
  externalId?: string;
  sourceUrl?: string;
}

export interface ImageSource {
  id: string;
  name: string;
  type: "local-folder" | "local-file" | "pinterest-board" | "mock-web";
  path?: string;
  url?: string;
  images: LocalImageRef[];
  providerId?: "local-folder" | "local-file" | "pinterest-board";
  cachePath?: string;
  importStatus?: "idle" | "ready" | "partial" | "canceled" | "unsupported" | "error";
  importLog?: string[];
  expectedItemCount?: number;
  importedItemCount?: number;
  importCursor?: string;
  lastImportCompletedAt?: string;
  includeSubfolders?: boolean;
  lastScannedAt?: string;
  missing?: boolean;
  updatedAt: string;
}

export interface PlaceholderSourceState {
  sourceIds: string[];
  mode: ImageSelectionMode;
  currentIndex: number;
  shuffleQueue: string[];
  usedImageIds: string[];
  preventDuplicates: boolean;
  includeSubfolders: boolean;
}

export interface PlaceholderLayer {
  id: string;
  type: "placeholder";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  cropMode: CropMode;
  alignment: ImageAlignment;
  borderWidth: number;
  borderColor: string;
  borderOpacity: number;
  borderRadius: number;
  maskShape: MaskShape;
  shadow: boolean;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  keepAspectRatio: boolean;
  crop: CropTransform;
  effects: PlaceholderEffects;
  sourceState: PlaceholderSourceState;
  sourceId?: string;
  selectedImageId?: string;
  generatedImageId?: string;
}

export type ProjectLayer = PlaceholderLayer;

export interface GeneratedCombination {
  id: string;
  name: string;
  createdAt: string;
  assignments: Record<string, string>;
  previewDataUrl?: string;
  filePath?: string;
  templateId?: string;
  templateName?: string;
  appliedAt?: string;
  monitorMode?: WallpaperSettings["monitorMode"];
}

export interface WallpaperSettings {
  enabled: boolean;
  paused: boolean;
  interval: WallpaperInterval;
  customIntervalMinutes: number;
  launchAtLogin: boolean;
  startMinimized: boolean;
  monitorMode: "primary" | "all" | "span";
  displayMode: WallpaperDisplayMode;
  monitorId?: string;
  lastUpdatedAt?: string;
  nextScheduledAt?: string;
  lastAppliedFilePath?: string;
  lastAppliedTemplateId?: string;
  lastError?: string;
  consecutiveFailures: number;
}

export interface TemplateCollection {
  id: string;
  name: string;
}

export interface WallpaperTemplate {
  id: string;
  name: string;
  project: WallpaperProjectSnapshot;
  thumbnailDataUrl?: string;
  collectionIds: string[];
  favorite: boolean;
  enabledForRotation: boolean;
  weight: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface WallpaperProjectSnapshot {
  canvas: CanvasSettings;
  layers: ProjectLayer[];
  sourceIds: string[];
  wallpaper: WallpaperSettings;
}

export interface TemplateLibrary {
  templates: WallpaperTemplate[];
  collections: TemplateCollection[];
  rotationMode: TemplateRotationMode;
  rotationTemplateIds: string[];
  shuffleQueue: string[];
  currentIndex: number;
  activeTemplateId?: string;
}

export interface WallpaperProject {
  schemaVersion: 2;
  id: string;
  name: string;
  canvas: CanvasSettings;
  layers: ProjectLayer[];
  sources: ImageSource[];
  wallpaper: WallpaperSettings;
  templates: TemplateLibrary;
  savedCombinations: GeneratedCombination[];
  recentCombinations: GeneratedCombination[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export interface OpenProjectResult {
  canceled: boolean;
  filePath?: string;
  project?: WallpaperProject;
  error?: string;
}

export interface FolderResult {
  canceled: boolean;
  path?: string;
  name?: string;
  images?: LocalImageRef[];
  error?: string;
}

export interface PathImportResult {
  canceled?: boolean;
  sources: ImageSource[];
  images: LocalImageRef[];
  error?: string;
}

export interface ImageFileResult {
  canceled: boolean;
  image?: LocalImageRef;
  images?: LocalImageRef[];
  error?: string;
}

export interface ExportPayload {
  dataUrl: string;
  format: ExportFormat;
  suggestedName: string;
}

export interface WallpaperApplyPayload {
  dataUrl: string;
  suggestedName: string;
  monitorMode?: WallpaperSettings["monitorMode"];
  displayMode?: WallpaperDisplayMode;
}

export interface WallpaperApplyFilePayload {
  filePath: string;
  monitorMode?: WallpaperSettings["monitorMode"];
  displayMode?: WallpaperDisplayMode;
}

export interface WallpaperApplyResult {
  ok: boolean;
  filePath?: string;
  appliedAt?: string;
  fileSize?: number;
  platform?: "darwin" | "win32" | "linux" | string;
  error?: string;
}

export interface TrayRuntimeState {
  enabled: boolean;
  paused: boolean;
}

export interface PinterestImportRequest {
  url: string;
  mode: "import" | "update";
  jobId?: string;
  existingSource?: ImageSource;
  accessToken?: string;
  boardId?: string;
  resumeBookmark?: string;
}

export type PinterestImportStage =
  | "validating"
  | "discovering"
  | "paginating"
  | "downloading"
  | "complete"
  | "partial"
  | "canceled"
  | "error";

export interface PinterestImportProgress {
  jobId: string;
  stage: PinterestImportStage;
  current: number;
  total?: number;
  progress: number;
  message: string;
  page?: number;
  bookmark?: string;
}

export interface PinterestImportResult {
  canceled?: boolean;
  partial?: boolean;
  ok: boolean;
  source?: ImageSource;
  imagesFound: number;
  imagesCached: number;
  progress: number;
  log: string[];
  error?: string;
  page?: number;
  bookmark?: string;
}

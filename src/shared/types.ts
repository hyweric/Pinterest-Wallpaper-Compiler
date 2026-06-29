export type ExportFormat = "png" | "jpeg"; // JPEG remains readable for old files; the UI now exports PNG only.

export type CropMode = "cover" | "contain" | "stretch" | "original" | "tile";
export type PlaceholderFrameMode = "fixed" | "adaptive";

export type BackgroundFitMode = "cover" | "contain" | "stretch" | "original" | "tile" | "center";
export type MaskShape = "rectangle" | "rounded" | "circle";
export type CanvasResizeMode = "keep" | "scale" | "center";

export type ImageSelectionMode = "fixed" | "sequential" | "random" | "shuffle" | "newest" | "oldest";

export type WallpaperInterval =
  | "manual"
  | "5s"
  | "10s"
  | "30s"
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
export type WallpaperScope = "same-all-desktops" | "different-per-desktop" | "current-desktop";
export type WallpaperTargetMode =
  | "current-desktop"
  | "current-monitor"
  | "all-visible-monitors"
  | "all-desktops-current-monitor"
  | "all-desktops-all-monitors";
export type WallpaperTargetTemplateMode = "single-template" | "different-template" | "playlist";
export type WallpaperAllSpacesRefreshMode =
  | "native-global-setting"
  | "stable-asset-slots"
  | "system-events"
  | "silent-observer"
  | "force-wallpaperagent-restart"
  | "immediate-restart";

export type MacOSWallpaperStrategy =
  | "modern-store"
  | "legacy-dock"
  | "modern-store+legacy-dock"
  | "observer-only"
  | "unsupported";

export interface MacOSWallpaperDisplayDiagnostic {
  displayId: string;
  displayUUID?: string;
  name: string;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  currentPath?: string;
  currentSpaceUUID?: string;
  spaceUUIDs: string[];
}

export interface MacOSWallpaperFileReferenceDiagnostic {
  source: string;
  path: string;
  exists: boolean;
  readable: boolean;
}

export interface MacOSWallpaperStoreDiagnostic {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  schema: "modern-index-v1" | "unknown" | "missing" | "corrupt";
  compatible: boolean;
  topLevelKeys: string[];
  displayRecordCount: number;
  spaceRecordCount: number;
  desktopRecordCount: number;
  displayKeys: string[];
  spaceDisplayUUIDs: Record<string, string[]>;
  displayPaths?: Record<string, string>;
  spaceDisplayPaths?: Record<string, Record<string, string>>;
  references: MacOSWallpaperFileReferenceDiagnostic[];
  error?: string;
}

export interface MacOSLegacyWallpaperDatabaseDiagnostic {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  compatible: boolean;
  tables: string[];
  pictureRecordCount: number;
  targetRecordCount: number;
  references: MacOSWallpaperFileReferenceDiagnostic[];
  error?: string;
}

export interface MacOSWallpaperDiagnosticReport {
  ok: boolean;
  generatedAt: string;
  platform: string;
  macOSVersion?: string;
  macOSBuild?: string;
  displaysHaveSeparateSpaces?: boolean;
  activeDisplayId?: string;
  activeSpaceUUIDs: string[];
  displays: MacOSWallpaperDisplayDiagnostic[];
  totalSpaceCount: number;
  sharedSpaceCount: number;
  sharedSpaceUUIDs: string[];
  wallpaperAgentRunning: boolean;
  dockRunning: boolean;
  store: MacOSWallpaperStoreDiagnostic;
  legacyDatabase: MacOSLegacyWallpaperDatabaseDiagnostic;
  recommendedStrategy: MacOSWallpaperStrategy;
  warnings: string[];
  errors: string[];
}

export interface MacOSAllSpacesApplyAttempt {
  id: "native-global-all-spaces" | "stable-asset-slots" | "active-record-clone" | "path-only-store" | "global-all-spaces" | "system-events-desktop-api" | "legacy-current-row-bridge";
  label: string;
  ok: boolean;
  targetSpaceCount?: number;
  verifiedSpaceCount?: number;
  targetDisplayCount?: number;
  verifiedDisplayCount?: number;
  error?: string;
}

export interface MacOSAllSpacesApplyStatus {
  attempted: boolean;
  strategy: MacOSWallpaperStrategy;
  attempts: MacOSAllSpacesApplyAttempt[];
  targetDisplayCount: number;
  updatedDisplayCount: number;
  verifiedDisplayCount: number;
  targetSpaceCount: number;
  updatedSpaceCount: number;
  verifiedSpaceCount: number;
  updatedSharedSpaceCount: number;
  verifiedSharedSpaceCount: number;
  modernStoreWritten: boolean;
  modernStoreVerified: boolean;
  legacyDatabaseWritten: boolean;
  legacyDatabaseVerified: boolean;
  wallpaperAgentReloaded: boolean;
  dockReloaded: boolean;
  reloadMethod: "none" | "native-global-setting" | "stable-asset-slots" | "native-wallpaper-agent-xpc" | "system-events-desktop-api" | "wallpaperagent-restart" | "visible-monitors-fallback" | "observer-fallback";
  visibleApplyPassCount: number;
  observerSuppressedDuringTransaction: boolean;
  operationDurationMs: number;
  missionControlTransitionDetected?: boolean;
  directBridgeAttempted?: boolean;
  directBridgeAvailable?: boolean;
  directBridgePostedSignals?: string[];
  directBridgeFrameworks?: string[];
  directBridgeMechanism?: string;
  directBridgeRequestAccepted?: boolean;
  directBridgeXPCServices?: string[];
  directBridgeSelectors?: string[];
  systemEventsAttempted?: boolean;
  systemEventsAccepted?: boolean;
  nativeGlobalSettingAttempted?: boolean;
  nativeGlobalSettingEnabled?: boolean;
  nativeGlobalSettingRearmed?: boolean;
  nativeGlobalSettingOpenedUI?: boolean;
  nativeGlobalSettingPermissionDenied?: boolean;
  nativeGlobalSettingControlLabel?: string;
  stableStoreVerificationPassed?: boolean;
  stableAssetSlotsAttempted?: boolean;
  stableAssetSlotsVerified?: boolean;
  stableAssetSlotCount?: number;
  stableAssetSlotPaths?: string[];
  fallbackToVisibleMonitors?: boolean;
  observerStarted: boolean;
  observerFallback: boolean;
  rollbackPerformed: boolean;
  backupPaths: string[];
  warning?: string;
  error?: string;
}
export type WallpaperRuntimeStatus =
  | "idle"
  | "scheduled"
  | "generating"
  | "rendering"
  | "saving"
  | "generated"
  | "applying"
  | "verifying"
  | "applied"
  | "paused"
  | "failed";
export type WallpaperTargetType = "physical-display" | "active-space" | "inactive-space";

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
export type MediaType = "image" | "video";
export type SourceMediaPolicy = "images-only" | "images-and-video-thumbnails";
export type BackgroundBaseMode = "color" | "transparent" | "image";
export type PaperFrameType = "none" | "clean" | "polaroid" | "torn" | "deckle" | "newsprint"; // deckle/newsprint are legacy aliases normalized into torn/clean.

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


export interface ShadowEffect {
  enabled: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  opacity: number;
  color: string;
}

export interface PolaroidCaptionEffect {
  enabled: boolean;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  alignment: "left" | "center" | "right";
  x: number;
  y: number;
}

export interface PolaroidEffect {
  schemaVersion: number;
  enabled: boolean;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;
  captionHeight: number;
  imageInset: number;
  imageScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  imageRotation: number;
  frameRotation: number;
  frameColor: string;
  frameOpacity: number;
  grain: number;
  warmth: number;
  cornerRadius: number;
  dropShadow: ShadowEffect;
  innerShadow: ShadowEffect;
  caption: PolaroidCaptionEffect;
}

export interface TearEdgeEffect {
  enabled: boolean;
  depth: number;
  frequency: number;
  scale: number;
  waviness: number;
  roughness: number;
}


export interface TornPaperPresetSettings {
  edges: {
    top: TearEdgeEffect;
    right: TearEdgeEffect;
    bottom: TearEdgeEffect;
    left: TearEdgeEffect;
  };
  paperColor: string;
  paperOpacity: number;
  grain: number;
  fibers: number;
  wrinkles: number;
  stains: number;
  speckles: number;
  edgeDarkening: number;
  imageInset: number;
  imageScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  innerShadow: ShadowEffect;
  outerShadow: ShadowEffect;
}

export interface TornPaperPreset {
  id: string;
  name: string;
  bundled: boolean;
  settings: TornPaperPresetSettings;
}

export interface TornPaperEffect {
  schemaVersion: number;
  enabled: boolean;
  seed: number;
  edges: {
    top: TearEdgeEffect;
    right: TearEdgeEffect;
    bottom: TearEdgeEffect;
    left: TearEdgeEffect;
  };
  paperColor: string;
  paperOpacity: number;
  grain: number;
  fibers: number;
  wrinkles: number;
  stains: number;
  speckles: number;
  edgeDarkening: number;
  imageInset: number;
  imageScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  innerShadow: ShadowEffect;
  outerShadow: ShadowEffect;
  presetId?: string;
  customPresets?: TornPaperPreset[];
}

export interface PaperTextureEffect {
  enabled?: boolean;
  type:
    | "none"
    | "paper"
    | "crumpled-paper"
    | "grid-paper"
    | "dotted-paper"
    | "fine-grain"
    | "recycled"
    | "matte-photo"
    | "canvas"
    | "handmade"
    | "newspaper"
    | "fold-marks"
    | "dust-scratches"
    | "halftone"
    | "custom";
  intensity: number;
  scale: number;
  rotation: number;
  opacity: number;
  blendMode: BlendMode;
  seed: number;
  noise?: number;
  roughness?: number;
  tone?: number;
  tintColor?: string;
  tintStrength?: number;
  customTextureId?: string;
}

export interface PaperFrameEffect {
  type: PaperFrameType;
  borderWidth: number;
  paperColor: string;
  edgeRoughness: number;
  shadowStrength: number;
  innerPadding: number;
  rotationVariation: number;
  textureIntensity: number;
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
  paperFrame: PaperFrameEffect;
  polaroid?: PolaroidEffect;
  tornPaper?: TornPaperEffect;
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
  backgroundBaseMode: BackgroundBaseMode;
  backgroundTransparent: boolean;
  backgroundImage?: LocalImageRef;
  backgroundMode: BackgroundFitMode;
  backgroundAlignment: ImageAlignment;
  backgroundOffsetX: number;
  backgroundOffsetY: number;
  backgroundScale: number;
  backgroundBlur: number;
  backgroundBrightness: number;
  backgroundContrast: number;
  backgroundTemperature: number;
  backgroundVignette: number;
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
  width?: number;
  height?: number;
  externalId?: string;
  sourceUrl?: string;
  mediaType?: MediaType;
  videoThumbnail?: boolean;
}

export interface SourceShuffleState {
  shuffleQueue: string[];
  cycle: number;
  lastImageByLayer: Record<string, string>;
}

export interface ImageSource {
  id: string;
  identityKey?: string;
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
  mediaPolicy: SourceMediaPolicy;
  mediaCounts?: { total: number; images: number; videos: number };
  updatedAt: string;
  selectionState?: SourceShuffleState;
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
  objectKind?: "frame" | "text";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  frameMode?: PlaceholderFrameMode;
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
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
  textAlign?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
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
  customIntervalValue: number;
  customIntervalUnit: "seconds" | "minutes" | "hours";
  launchAtLogin: boolean;
  startMinimized: boolean;
  monitorMode: "primary" | "all" | "span";
  scope: WallpaperScope;
  targetMode: WallpaperTargetMode;
  allSpacesRefreshMode?: WallpaperAllSpacesRefreshMode;
  targetTemplateMode: WallpaperTargetTemplateMode;
  targetTemplateIds: Record<string, string | undefined>;
  targetPlaylistIds: Record<string, string[]>;
  displayMode: WallpaperDisplayMode;
  monitorId?: string;
  lastUpdatedAt?: string;
  lastGeneratedAt?: string;
  lastGeneratedFilePath?: string;
  nextScheduledAt?: string;
  lastAppliedFilePath?: string;
  lastAppliedTemplateId?: string;
  lastError?: string;
  transitionEnabled: boolean;
  transitionDurationMs: number;
  consecutiveFailures: number;
}

export interface CustomTextureAsset {
  id: string;
  name: string;
  path: string;
  url: string;
  createdAt: string;
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
  customTextures: CustomTextureAsset[];
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

export interface LocalImportSummary {
  requestedPathCount: number;
  importedFolderCount: number;
  importedLooseImageCount: number;
  discoveredImageCount: number;
  skippedUnsupportedCount: number;
  skippedUnreadableCount: number;
  skippedMissingCount: number;
  duplicatePathCount: number;
  emptyFolders: string[];
}

export interface FolderResult {
  canceled: boolean;
  path?: string;
  name?: string;
  images?: LocalImageRef[];
  source?: ImageSource;
  summary?: LocalImportSummary;
  warnings?: string[];
  error?: string;
}

export interface PathImportResult {
  canceled?: boolean;
  sources: ImageSource[];
  images: LocalImageRef[];
  summary?: LocalImportSummary;
  warnings?: string[];
  error?: string;
}

export interface ImageFileResult {
  canceled: boolean;
  image?: LocalImageRef;
  images?: LocalImageRef[];
  source?: ImageSource;
  summary?: LocalImportSummary;
  warnings?: string[];
  error?: string;
}

export interface ExportPayload {
  dataUrl: string;
  format: ExportFormat;
  suggestedName: string;
}

export interface WallpaperSetBeginPayload {
  rootPath?: string;
  setName: string;
  projectName: string;
  templateName: string;
  format: ExportFormat;
  variationCount: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface WallpaperSetBeginResult {
  ok: boolean;
  sessionId?: string;
  rootPath?: string;
  stagingPath?: string;
  finalPath?: string;
  folderName?: string;
  error?: string;
}

export interface ExportSetFilePayload {
  sessionId: string;
  dataUrl: string;
  fileName: string;
}

export interface ExportSetFileResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}

export interface WallpaperSetFinalizePayload {
  sessionId: string;
}

export interface WallpaperSetFinalizeResult {
  ok: boolean;
  finalPath?: string;
  manifestPath?: string;
  fileCount?: number;
  firstFilePath?: string;
  error?: string;
}

export interface WallpaperSetCleanupResult {
  ok: boolean;
  canceled?: boolean;
  rootPath?: string;
  deletedEntryCount?: number;
  deletedDirectoryCount?: number;
  deletedFileCount?: number;
  freedBytes?: number;
  error?: string;
}

export interface CustomTextureResult {
  canceled: boolean;
  texture?: CustomTextureAsset;
  error?: string;
}

export interface WallpaperGeneratePayload {
  imageData: ArrayBuffer;
  suggestedName: string;
  mimeType?: "image/png" | "image/jpeg";
}

export interface WallpaperGenerateResult {
  ok: boolean;
  filePath?: string;
  fileSize?: number;
  generatedAt?: string;
  error?: string;
}

export interface WallpaperApplyPayload extends WallpaperGeneratePayload {
  monitorMode?: WallpaperSettings["monitorMode"];
  transitionEnabled?: boolean;
  transitionDurationMs?: number;
  displayMode?: WallpaperDisplayMode;
  scope?: WallpaperScope;
  targetMode?: WallpaperTargetMode;
  allSpacesRefreshMode?: WallpaperAllSpacesRefreshMode;
  monitorId?: string;
  targetId?: string;
}

export interface WallpaperApplyFilePayload {
  filePath: string;
  monitorMode?: WallpaperSettings["monitorMode"];
  displayMode?: WallpaperDisplayMode;
  scope?: WallpaperScope;
  targetMode?: WallpaperTargetMode;
  allSpacesRefreshMode?: WallpaperAllSpacesRefreshMode;
  monitorId?: string;
  targetId?: string;
  transitionEnabled?: boolean;
  transitionDurationMs?: number;
}

export interface WallpaperTargetApplyItem {
  targetId: string;
  targetLabel: string;
  displayId?: string;
  current?: boolean;
  imageData: ArrayBuffer;
  suggestedName: string;
  mimeType?: "image/png" | "image/jpeg";
}

export interface WallpaperApplyTargetsPayload {
  items: WallpaperTargetApplyItem[];
  displayMode?: WallpaperDisplayMode;
  transitionEnabled?: boolean;
  transitionDurationMs?: number;
  scope?: WallpaperScope;
  targetMode?: WallpaperTargetMode;
  allSpacesRefreshMode?: WallpaperAllSpacesRefreshMode;
  monitorId?: string;
}

export interface NativeCommandResult {
  method: string;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode?: number;
  signal?: string;
  timedOut: boolean;
  error?: string;
}

export interface WallpaperTarget {
  id: string;
  label: string;
  index: number;
  displayId?: string;
  displayName?: string;
  spaceId?: string;
  current: boolean;
  targetType?: WallpaperTargetType;
  visible?: boolean;
  reliable: boolean;
  limitation?: string;
  currentPath?: string;
  primary?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface WallpaperTransitionDiagnostic {
  targetType?: "physical-display";
  displayId: string;
  oldImagePath?: string;
  newImagePath: string;
  overlayCreated: boolean;
  oldImageDecoded: boolean;
  newImageDecoded: boolean;
  animationStarted: boolean;
  animationCompleted: boolean;
  animationFrames?: number;
  startedAt?: string;
  completedAt?: string;
  removedAt?: string;
  durationMs: number;
  actualDurationMs?: number;
  removedAfterVerification: boolean;
  error?: string;
}

export interface WallpaperTargetResult {
  targetId: string;
  targetLabel: string;
  filePath?: string;
  fileSize?: number;
  diagnostics: WallpaperApplyDiagnostics;
  ok: boolean;
  error?: string;
}

export interface WallpaperApplyDiagnostics {
  renderedPath?: string;
  fileSize?: number;
  validImage?: boolean;
  permissionStatus?: "not-checked" | "verified" | "automation-timeout" | "automation-denied" | "verification-failed";
  nativeResults: NativeCommandResult[];
  verifiedPaths: string[];
  verificationMethod?: string;
  changed: boolean;
  lastError?: string;
  targetId?: string;
  targetLabel?: string;
  targetIndex?: number;
  displayId?: string;
  displayName?: string;
  spaceId?: string;
  requestedPath?: string;
  reportedPath?: string;
  verificationResult?: "matched" | "mismatched" | "unavailable";
  targetType?: WallpaperTargetType;
  visible?: boolean;
  transitionDiagnostics?: WallpaperTransitionDiagnostic[];
  targetResults?: WallpaperTargetResult[];
  targetMode?: WallpaperTargetMode;
  limitation?: string;
  partial?: boolean;
  requestedTargetCount?: number;
  appliedTargetCount?: number;
  macOSAllSpaces?: MacOSAllSpacesApplyStatus;
}

export interface WallpaperApplyResult {
  ok: boolean;
  filePath?: string;
  appliedAt?: string;
  fileSize?: number;
  platform?: "darwin" | "win32" | "linux" | string;
  error?: string;
  diagnostics?: WallpaperApplyDiagnostics;
  targets?: WallpaperTargetResult[];
}

export interface TrayRuntimeState {
  enabled: boolean;
  paused: boolean;
  interval?: WallpaperInterval;
  customIntervalMinutes?: number;
  customIntervalValue?: number;
  customIntervalUnit?: "seconds" | "minutes" | "hours";
  nextScheduledAt?: string;
  status?: WallpaperRuntimeStatus;
  lastError?: string;
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

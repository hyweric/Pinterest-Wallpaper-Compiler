import { clipboard, contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  CustomTextureResult,
  ExportPayload,
  ExportSetFilePayload,
  ExportSetFileResult,
  WallpaperSetBeginPayload,
  WallpaperSetBeginResult,
  WallpaperSetCleanupResult,
  WallpaperSetFinalizePayload,
  WallpaperSetFinalizeResult,
  FolderResult,
  ImageFileResult,
  OpenProjectResult,
  PathImportResult,
  PinterestImportProgress,
  SourceImportProgress,
  PinterestImportRequest,
  PinterestImportResult,
  SaveDialogResult,
  WallpaperApplyFilePayload,
  WallpaperSetApplyPayload,
  WallpaperApplyPayload,
  WallpaperApplyTargetsPayload,
  WallpaperApplyResult,
  WallpaperGeneratePayload,
  WallpaperGenerateResult,
  MacOSWallpaperDiagnosticReport,
  WallpaperTarget,
  WallpaperProject,
  TrayRuntimeState
} from "../shared/types.js";

let lastNativeDropPaths: { paths: string[]; updatedAt: number } = { paths: [], updatedAt: 0 };

function nativePathForFile(file: File | null | undefined): string {
  if (!file) return "";
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return "";
  }
}

function nativePathsFromTransfer(dataTransfer: DataTransfer | null | undefined): string[] {
  if (!dataTransfer) return [];
  const paths: string[] = [];
  for (const file of Array.from(dataTransfer.files ?? [])) {
    const filePath = nativePathForFile(file);
    if (filePath) paths.push(filePath);
  }
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const filePath = nativePathForFile(item.getAsFile());
    if (filePath) paths.push(filePath);
  }
  return [...new Set(paths)];
}

function rememberNativeDropPaths(event: DragEvent) {
  const paths = nativePathsFromTransfer(event.dataTransfer);
  if (paths.length > 0) lastNativeDropPaths = { paths, updatedAt: Date.now() };
}

if (typeof window !== "undefined") {
  window.addEventListener("dragenter", rememberNativeDropPaths, true);
  window.addEventListener("dragover", rememberNativeDropPaths, true);
  window.addEventListener("drop", rememberNativeDropPaths, true);
}

const recentNativeDropPaths = () => {
  if (Date.now() - lastNativeDropPaths.updatedAt > 5_000) return [];
  return [...lastNativeDropPaths.paths];
};

const api = {
  chooseFolder: (): Promise<FolderResult> => ipcRenderer.invoke("dialog:choose-folder"),
  chooseImageFile: (): Promise<ImageFileResult> => ipcRenderer.invoke("dialog:choose-image-file"),
  chooseImageFiles: (): Promise<ImageFileResult> => ipcRenderer.invoke("dialog:choose-image-files"),
  getPathForFile: (file: File): string => nativePathForFile(file),
  getLastDroppedFilePaths: (): string[] => recentNativeDropPaths(),
  clearLastDroppedFilePaths: (): void => { lastNativeDropPaths = { paths: [], updatedAt: 0 }; },
  importPaths: (paths: string[]): Promise<PathImportResult> => ipcRenderer.invoke("source:import-paths", paths),
  importWebImage: (payload: { url?: string; dataUrl?: string; name?: string; mimeType?: string }): Promise<ImageFileResult> => ipcRenderer.invoke("source:import-web-image", payload),
  rescanFolder: (path: string) => ipcRenderer.invoke("source:rescan-folder", path),
  showInFolder: (path: string): Promise<boolean> => ipcRenderer.invoke("source:show-in-folder", path),
  copyText: (value: string): boolean => {
    clipboard.writeText(value);
    return clipboard.readText() === value;
  },
  deleteCache: (path: string): Promise<boolean> => ipcRenderer.invoke("source:delete-cache", path),
  importPinterestBoard: (request: PinterestImportRequest): Promise<PinterestImportResult> =>
    ipcRenderer.invoke("provider:pinterest-import", request),
  updatePinterestBoard: (request: PinterestImportRequest): Promise<PinterestImportResult> =>
    ipcRenderer.invoke("provider:pinterest-update", request),
  cancelPinterestImport: (jobId: string): Promise<boolean> => ipcRenderer.invoke("provider:pinterest-cancel", jobId),
  onPinterestProgress: (callback: (progress: PinterestImportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: PinterestImportProgress) => callback(progress);
    ipcRenderer.on("provider:pinterest-progress", listener);
    return () => {
      ipcRenderer.removeListener("provider:pinterest-progress", listener);
    };
  },
  onSourceImportProgress: (callback: (progress: SourceImportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SourceImportProgress) => callback(progress);
    ipcRenderer.on("source:import-progress", listener);
    return () => {
      ipcRenderer.removeListener("source:import-progress", listener);
    };
  },
  saveProject: (project: WallpaperProject, filePath?: string): Promise<SaveDialogResult> =>
    ipcRenderer.invoke("project:save", project, filePath),
  openProject: (): Promise<OpenProjectResult> => ipcRenderer.invoke("project:open"),
  exportImage: (payload: ExportPayload): Promise<SaveDialogResult> =>
    ipcRenderer.invoke("image:export", payload),
  getDefaultExportSetFolder: (): Promise<SaveDialogResult> => ipcRenderer.invoke("export-set:default-folder"),
  chooseExportSetFolder: (): Promise<SaveDialogResult> => ipcRenderer.invoke("export-set:choose-folder"),
  beginExportSet: (payload: WallpaperSetBeginPayload): Promise<WallpaperSetBeginResult> => ipcRenderer.invoke("export-set:begin", payload),
  writeExportSetFile: (payload: ExportSetFilePayload): Promise<ExportSetFileResult> => ipcRenderer.invoke("export-set:write-file", payload),
  finalizeExportSet: (payload: WallpaperSetFinalizePayload): Promise<WallpaperSetFinalizeResult> => ipcRenderer.invoke("export-set:finalize", payload),
  abortExportSet: (sessionId: string): Promise<boolean> => ipcRenderer.invoke("export-set:abort", sessionId),
  revealExportSet: (folderPath: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("export-set:reveal", folderPath),
  openWallpaperSettings: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("export-set:open-wallpaper-settings"),
  cleanupExportSets: (rootPath?: string): Promise<WallpaperSetCleanupResult> => ipcRenderer.invoke("export-set:cleanup", rootPath),
  importCustomTexture: (): Promise<CustomTextureResult> => ipcRenderer.invoke("texture:import"),
  importOverlayImage: (): Promise<ImageFileResult> => ipcRenderer.invoke("overlay:import"),
  removeCustomTexture: (path: string): Promise<boolean> => ipcRenderer.invoke("texture:remove", path),
  revealCustomTexture: (path: string): Promise<boolean> => ipcRenderer.invoke("texture:reveal", path),
  generateWallpaper: (payload: WallpaperGeneratePayload): Promise<WallpaperGenerateResult> =>
    ipcRenderer.invoke("wallpaper:generate", payload),
  applyWallpaper: (payload: WallpaperApplyPayload): Promise<WallpaperApplyResult> =>
    ipcRenderer.invoke("wallpaper:apply", payload),
  applyWallpaperFile: (payload: WallpaperApplyFilePayload): Promise<WallpaperApplyResult> =>
    ipcRenderer.invoke("wallpaper:apply-file", payload),
  applyWallpaperSet: (payload: WallpaperSetApplyPayload): Promise<WallpaperApplyResult> =>
    ipcRenderer.invoke("wallpaper:apply-set", payload),
  getWallpaperTargets: (): Promise<WallpaperTarget[]> => ipcRenderer.invoke("wallpaper:targets"),
  getMacOSWallpaperDiagnostic: (): Promise<MacOSWallpaperDiagnosticReport> => ipcRenderer.invoke("wallpaper:macos-diagnostic"),
  applyWallpaperTargets: (payload: WallpaperApplyTargetsPayload): Promise<WallpaperApplyResult> =>
    ipcRenderer.invoke("wallpaper:apply-targets", payload),
  setTrayState: (state: TrayRuntimeState): Promise<TrayRuntimeState> => ipcRenderer.invoke("tray:set-state", state),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke("app:set-login-item", enabled),
  applyStartupBehavior: (startMinimized: boolean) => ipcRenderer.invoke("app:apply-startup-behavior", startMinimized),
  onTrayCommand: (callback: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on("tray:command", listener);
    return () => {
      ipcRenderer.removeListener("tray:command", listener);
    };
  }
};

contextBridge.exposeInMainWorld("wallpaperApi", api);

export type WallpaperApi = typeof api;

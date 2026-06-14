import { contextBridge, ipcRenderer } from "electron";
import type {
  ExportPayload,
  FolderResult,
  ImageFileResult,
  OpenProjectResult,
  PathImportResult,
  PinterestImportProgress,
  PinterestImportRequest,
  PinterestImportResult,
  SaveDialogResult,
  WallpaperApplyFilePayload,
  WallpaperApplyPayload,
  WallpaperApplyResult,
  WallpaperProject,
  TrayRuntimeState
} from "../shared/types.js";

const api = {
  chooseFolder: (): Promise<FolderResult> => ipcRenderer.invoke("dialog:choose-folder"),
  chooseImageFile: (): Promise<ImageFileResult> => ipcRenderer.invoke("dialog:choose-image-file"),
  chooseImageFiles: (): Promise<ImageFileResult> => ipcRenderer.invoke("dialog:choose-image-files"),
  importPaths: (paths: string[]): Promise<PathImportResult> => ipcRenderer.invoke("source:import-paths", paths),
  rescanFolder: (path: string) => ipcRenderer.invoke("source:rescan-folder", path),
  showInFolder: (path: string): Promise<boolean> => ipcRenderer.invoke("source:show-in-folder", path),
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
  saveProject: (project: WallpaperProject, filePath?: string): Promise<SaveDialogResult> =>
    ipcRenderer.invoke("project:save", project, filePath),
  openProject: (): Promise<OpenProjectResult> => ipcRenderer.invoke("project:open"),
  exportImage: (payload: ExportPayload): Promise<SaveDialogResult> =>
    ipcRenderer.invoke("image:export", payload),
  applyWallpaper: (payload: WallpaperApplyPayload): Promise<WallpaperApplyResult> =>
    ipcRenderer.invoke("wallpaper:apply", payload),
  applyWallpaperFile: (payload: WallpaperApplyFilePayload): Promise<WallpaperApplyResult> =>
    ipcRenderer.invoke("wallpaper:apply-file", payload),
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

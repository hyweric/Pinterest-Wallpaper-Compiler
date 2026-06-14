import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ExportPayload,
  ImageSource,
  LocalImageRef,
  WallpaperApplyDiagnostics,
  PathImportResult,
  PinterestImportProgress,
  PinterestImportRequest,
  WallpaperApplyFilePayload,
  WallpaperApplyPayload,
  WallpaperApplyTargetsPayload,
  WallpaperProject,
  WallpaperTargetResult,
  TrayRuntimeState
} from "../shared/types.js";
import { PinterestBoardProvider, type PublicPinterestBoardResult } from "./providers.js";
import { createWallpaperController } from "./wallpaper.js";
import { cleanupGeneratedWallpapers, safeWallpaperFileName, validateWallpaperFile } from "./wallpaper-files.js";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);

const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let trayRuntimeState: TrayRuntimeState = { enabled: false, paused: false };
const pinterestJobs = new Map<string, AbortController>();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f5f5f2",
    title: "Pinterest Wallpaper Compiler",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (isDev) {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

function updateTrayMenu() {
  if (!tray) return;
  const pauseLabel = trayRuntimeState.paused ? "Resume Rotation" : "Pause Rotation";
  const intervalLabel = trayRuntimeState.interval === "custom"
    ? `Every ${trayRuntimeState.customIntervalMinutes ?? 1} min`
    : trayRuntimeState.interval ?? "manual";
  const nextLabel = trayRuntimeState.nextScheduledAt ? new Date(trayRuntimeState.nextScheduledAt).toLocaleString() : "Not scheduled";
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Editor", click: showWindow },
      { label: "Generate Now", click: () => mainWindow?.webContents.send("tray:command", "generate-apply") },
      { label: "Previous Wallpaper", click: () => mainWindow?.webContents.send("tray:command", "previous") },
      {
        label: pauseLabel,
        enabled: trayRuntimeState.enabled,
        click: () => mainWindow?.webContents.send("tray:command", trayRuntimeState.paused ? "resume" : "pause")
      },
      { type: "separator" },
      { label: `Current interval: ${intervalLabel}`, enabled: false },
      { label: `Next update: ${nextLabel}`, enabled: false },
      { label: `Status: ${trayRuntimeState.status ?? "idle"}`, enabled: false },
      ...(trayRuntimeState.lastError ? [{ label: `Last error: ${trayRuntimeState.lastError}`, enabled: false } as const] : []),
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromNamedImage("NSImageNameColorPanel", [-1, 0, 1]);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Pinterest Wallpaper Compiler");
  tray.on("click", showWindow);
  updateTrayMenu();
}

async function loadPublicPinterestBoard(
  boardUrl: string,
  options: {
    signal?: AbortSignal;
    expectedTotal?: number;
    onProgress?: (current: number, total?: number, message?: string) => void;
  }
): Promise<PublicPinterestBoardResult> {
  const scraper = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  scraper.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const closeScraper = () => {
    if (!scraper.isDestroyed()) scraper.destroy();
  };

  try {
    if (options.signal?.aborted) throw new DOMException("Pinterest import canceled.", "AbortError");
    await scraper.loadURL(boardUrl, { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36" });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    let stableRounds = 0;
    let previousCount = 0;
    let latest: { pins: Array<{ id: string; imageUrl: string }>; atBottom: boolean; bodyText: string } = {
      pins: [],
      atBottom: false,
      bodyText: ""
    };

    for (let iteration = 0; iteration < 500; iteration += 1) {
      if (options.signal?.aborted) throw new DOMException("Pinterest import canceled.", "AbortError");
      const scanResult = await scraper.webContents.executeJavaScript(String.raw`(() => {
        try {
          const root = window;
          root.__pwcPins = root.__pwcPins && typeof root.__pwcPins === "object" ? root.__pwcPins : {};
          const chooseSrc = (img) => {
            const entries = String(img.getAttribute("srcset") || "").split(",").map((item) => {
              const parts = item.trim().split(/\s+/);
              return { url: parts[0], width: Number((parts[1] || "").replace(/[^0-9.]/g, "")) || 0 };
            }).filter((item) => item.url);
            entries.sort((a, b) => b.width - a.width);
            return entries[0]?.url || img.currentSrc || img.src || img.getAttribute("data-src") || "";
          };
          for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
            const match = String(anchor.getAttribute("href") || "").match(/\/pin\/(\d+)/);
            if (!match) continue;
            const img = anchor.querySelector("img");
            if (!img) continue;
            const imageUrl = chooseSrc(img);
            if (!/^https?:/i.test(imageUrl)) continue;
            root.__pwcPins[match[1]] = { id: match[1], imageUrl };
          }
          const scrollRoot = document.scrollingElement || document.documentElement;
          const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 800);
          const atBottom = scrollRoot.scrollTop + viewportHeight >= scrollRoot.scrollHeight - 160;
          window.scrollBy(0, Math.max(850, viewportHeight * 0.85));
          return {
            ok: true,
            pins: Object.values(root.__pwcPins),
            atBottom,
            bodyText: document.body?.innerText?.slice(0, 6000) || "",
            pageUrl: location.href
          };
        } catch (error) {
          return {
            ok: false,
            pins: [],
            atBottom: false,
            bodyText: "",
            pageUrl: location.href,
            error: error instanceof Error ? error.stack || error.message : String(error)
          };
        }
      })()`, true) as {
        ok: boolean;
        pins: Array<{ id: string; imageUrl: string }>;
        atBottom: boolean;
        bodyText: string;
        pageUrl?: string;
        error?: string;
      };
      if (!scanResult.ok) {
        throw new Error(`Pinterest board page scan failed${scanResult.pageUrl ? ` at ${scanResult.pageUrl}` : ""}: ${scanResult.error ?? "unknown page error"}`);
      }
      latest = scanResult;

      const count = latest.pins.length;
      stableRounds = count === previousCount ? stableRounds + 1 : 0;
      previousCount = count;
      options.onProgress?.(count, options.expectedTotal, `Discovered ${count}${options.expectedTotal ? ` / ${options.expectedTotal}` : ""} public pins...`);

      if (options.expectedTotal && count >= options.expectedTotal) break;
      if (latest.atBottom && stableRounds >= 10) break;
      if (stableRounds >= 18) break;
      await new Promise((resolve) => setTimeout(resolve, 550));
    }

    const blocked = /log in|sign up|access denied|something went wrong/i.test(latest.bodyText) && latest.pins.length === 0;
    if (blocked) throw new Error("Pinterest did not expose the public board feed in the embedded browser.");
    const pins = options.expectedTotal ? latest.pins.slice(0, options.expectedTotal) : latest.pins;
    return {
      pins,
      total: options.expectedTotal,
      log: [`Full-board browser loader discovered ${pins.length} unique pin cards.`]
    };
  } finally {
    closeScraper();
  }
}

function pinterestProvider() {
  return new PinterestBoardProvider(path.join(app.getPath("userData"), "Image Cache", "Pinterest"), loadPublicPinterestBoard);
}

async function readImagesFromFolder(folderPath: string, includeSubfolders = false): Promise<LocalImageRef[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const images: LocalImageRef[] = [];

  for (const entry of entries) {
    const filePath = path.join(folderPath, entry.name);
    if (entry.isDirectory() && includeSubfolders) {
      images.push(...(await readImagesFromFolder(filePath, includeSubfolders)));
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!imageExtensions.has(extension)) continue;
    const fileStat = await stat(filePath);
    images.push({
      id: `${filePath}:${entry.name}`,
      name: entry.name,
      path: filePath,
      url: pathToFileURL(filePath).toString(),
      modifiedAt: fileStat.mtime.toISOString(),
      size: fileStat.size
    });
  }

  return images.sort((a, b) => a.name.localeCompare(b.name));
}

async function sourceFromFolder(folderPath: string): Promise<ImageSource> {
  const images = await readImagesFromFolder(folderPath);
  return {
    id: `source-${crypto.randomUUID()}`,
    providerId: "local-folder",
    type: "local-folder",
    name: path.basename(folderPath),
    path: folderPath,
    images,
    importStatus: "ready",
    importLog: [`Scanned ${images.length} supported images.`],
    lastScannedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function imageFromFilePath(filePath: string): Promise<LocalImageRef> {
  const fileStat = await stat(filePath);
  return {
    id: `${filePath}:${path.basename(filePath)}`,
    name: path.basename(filePath),
    path: filePath,
    url: pathToFileURL(filePath).toString(),
    modifiedAt: fileStat.mtime.toISOString(),
    size: fileStat.size
  };
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid image data.");
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

async function validateRenderedWallpaperImage(filePath: string) {
  const file = await validateWallpaperFile(filePath);
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error("Rendered wallpaper file is not a valid readable image.");
  return file;
}

function diagnosticsFromError(error: unknown): WallpaperApplyDiagnostics | undefined {
  return error && typeof error === "object" && "diagnostics" in error
    ? error.diagnostics as WallpaperApplyDiagnostics
    : undefined;
}

async function writeRenderedWallpaper(dataUrl: string, suggestedName: string) {
  const cacheDir = path.join(app.getPath("userData"), "Generated Wallpapers");
  await mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, safeWallpaperFileName(suggestedName));
  await writeFile(filePath, dataUrlToBuffer(dataUrl));
  const file = await validateRenderedWallpaperImage(filePath);
  return { cacheDir, filePath, file };
}

ipcMain.handle("dialog:choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Choose Image Folder"
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const folderPath = result.filePaths[0];
  try {
    const folderStat = await stat(folderPath);
    if (!folderStat.isDirectory()) {
      return { canceled: false, error: "Selected path is not a folder." };
    }
    const images = await readImagesFromFolder(folderPath);
    return {
      canceled: false,
      path: folderPath,
      name: path.basename(folderPath),
      images
    };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? error.message : "Unable to read folder." };
  }
});

ipcMain.handle("dialog:choose-image-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Choose Image",
    filters: [{ name: "Images", extensions: [...imageExtensions].map((ext) => ext.slice(1)) }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const filePath = result.filePaths[0];
  return {
    canceled: false,
    image: await imageFromFilePath(filePath)
  };
});

ipcMain.handle("dialog:choose-image-files", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: "Choose Images",
    filters: [{ name: "Images", extensions: [...imageExtensions].map((ext) => ext.slice(1)) }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const images = await Promise.all(result.filePaths.map((filePath) => imageFromFilePath(filePath)));

  return { canceled: false, images };
});

ipcMain.handle("source:import-paths", async (_event, paths: string[]): Promise<PathImportResult> => {
  const sources: ImageSource[] = [];
  const images: LocalImageRef[] = [];

  for (const itemPath of paths) {
    try {
      const itemStat = await stat(itemPath);
      if (itemStat.isDirectory()) {
        sources.push(await sourceFromFolder(itemPath));
      } else if (itemStat.isFile() && imageExtensions.has(path.extname(itemPath).toLowerCase())) {
        images.push(await imageFromFilePath(itemPath));
      }
    } catch {
      // Ignore individual missing paths; the caller shows a summary.
    }
  }

  if (sources.length === 0 && images.length === 0) {
    return { sources: [], images: [], error: "No supported image files or folders were found in the drop." };
  }

  return { sources, images };
});

ipcMain.handle("source:rescan-folder", async (_event, folderPath: string) => {
  return sourceFromFolder(folderPath);
});

ipcMain.handle("source:show-in-folder", (_event, itemPath: string) => {
  shell.showItemInFolder(itemPath);
  return true;
});

ipcMain.handle("source:delete-cache", async (_event, cachePath: string) => {
  await rm(cachePath, { recursive: true, force: true });
  return true;
});

async function runPinterestJob(
  event: Electron.IpcMainInvokeEvent,
  request: PinterestImportRequest,
  mode: "import" | "update"
) {
  const jobId = request.jobId ?? `pinterest-${crypto.randomUUID()}`;
  const controller = new AbortController();
  pinterestJobs.get(jobId)?.abort();
  pinterestJobs.set(jobId, controller);
  const sendProgress = (progress: PinterestImportProgress) => {
    if (!event.sender.isDestroyed()) event.sender.send("provider:pinterest-progress", progress);
  };
  try {
    const provider = pinterestProvider();
    const normalizedRequest = { ...request, jobId, mode };
    return mode === "import"
      ? await provider.import(normalizedRequest, sendProgress, controller.signal)
      : await provider.update(normalizedRequest, sendProgress, controller.signal);
  } finally {
    if (pinterestJobs.get(jobId) === controller) pinterestJobs.delete(jobId);
  }
}

ipcMain.handle("provider:pinterest-import", async (event, request: PinterestImportRequest) => {
  return runPinterestJob(event, request, "import");
});

ipcMain.handle("provider:pinterest-update", async (event, request: PinterestImportRequest) => {
  return runPinterestJob(event, request, "update");
});

ipcMain.handle("provider:pinterest-cancel", (_event, jobId: string) => {
  const job = pinterestJobs.get(jobId);
  job?.abort();
  return Boolean(job);
});

ipcMain.handle("project:save", async (_event, project: WallpaperProject, filePath?: string) => {
  let targetPath = filePath;
  if (!targetPath) {
    const result = await dialog.showSaveDialog({
      title: "Save Wallpaper Project",
      defaultPath: `${project.name || "Wallpaper Project"}.pwc.json`,
      filters: [{ name: "Wallpaper Compiler Project", extensions: ["pwc.json", "json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    targetPath = result.filePath;
  }

  await writeFile(targetPath, JSON.stringify(project, null, 2), "utf8");
  return { canceled: false, filePath: targetPath };
});

ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Open Wallpaper Project",
    filters: [{ name: "Wallpaper Compiler Project", extensions: ["pwc.json", "json"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  try {
    const filePath = result.filePaths[0];
    const project = JSON.parse(await readFile(filePath, "utf8")) as WallpaperProject;
    return { canceled: false, filePath, project };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? error.message : "Unable to open project." };
  }
});

ipcMain.handle("image:export", async (_event, payload: ExportPayload) => {
  const result = await dialog.showSaveDialog({
    title: "Export Wallpaper",
    defaultPath: payload.suggestedName,
    filters: [
      {
        name: payload.format === "png" ? "PNG Image" : "JPEG Image",
        extensions: [payload.format === "png" ? "png" : "jpg"]
      }
    ]
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  await writeFile(result.filePath, dataUrlToBuffer(payload.dataUrl));
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("wallpaper:apply", async (_event, payload: WallpaperApplyPayload) => {
  try {
    const { cacheDir, filePath, file: generatedFile } = await writeRenderedWallpaper(payload.dataUrl, payload.suggestedName);
    const diagnostics = await createWallpaperController().setWallpaper(filePath, {
      monitorMode: payload.monitorMode,
      displayMode: payload.displayMode,
      scope: payload.scope,
      targetId: payload.targetId
    });
    diagnostics.renderedPath = filePath;
    diagnostics.fileSize = generatedFile.size;
    diagnostics.validImage = true;
    if (!diagnostics.changed) {
      throw Object.assign(new Error(diagnostics.lastError ?? "macOS did not confirm the desktop wallpaper changed."), { diagnostics });
    }
    await cleanupGeneratedWallpapers(cacheDir, 40);
    return {
      ok: true,
      filePath,
      fileSize: generatedFile.size,
      appliedAt: new Date().toISOString(),
      platform: process.platform,
      diagnostics
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to set wallpaper.",
      platform: process.platform,
      diagnostics: diagnosticsFromError(error)
    };
  }
});

ipcMain.handle("wallpaper:targets", async () => {
  const controller = createWallpaperController();
  if (!controller.getTargets) {
    return [{
      id: "desktop-1",
      label: process.platform === "win32" ? "Primary desktop" : "Desktop 1",
      index: 1,
      current: true,
      reliable: false,
      limitation: "This platform does not expose individual desktop targets."
    }];
  }
  return controller.getTargets();
});

ipcMain.handle("wallpaper:apply-targets", async (_event, payload: WallpaperApplyTargetsPayload) => {
  const cacheDir = path.join(app.getPath("userData"), "Generated Wallpapers");
  const targetResults: WallpaperTargetResult[] = [];
  let lastError: string | undefined;
  for (const item of payload.items) {
    try {
      const written = await writeRenderedWallpaper(item.dataUrl, item.suggestedName);
      const diagnostics = await createWallpaperController().setWallpaper(written.filePath, {
        displayMode: payload.displayMode,
        scope: payload.scope ?? "different-per-desktop",
        targetId: item.targetId
      });
      diagnostics.renderedPath = written.filePath;
      diagnostics.fileSize = written.file.size;
      diagnostics.validImage = true;
      diagnostics.targetId = item.targetId;
      diagnostics.targetLabel = item.targetLabel;
      const ok = diagnostics.changed;
      if (!ok) lastError = diagnostics.lastError ?? `Wallpaper target ${item.targetLabel} did not verify.`;
      targetResults.push({
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        filePath: written.filePath,
        fileSize: written.file.size,
        diagnostics,
        ok,
        error: ok ? undefined : lastError
      });
    } catch (error) {
      const diagnostics = diagnosticsFromError(error) ?? {
        nativeResults: [],
        verifiedPaths: [],
        changed: false,
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        lastError: error instanceof Error ? error.message : "Unable to set wallpaper target."
      };
      lastError = diagnostics.lastError;
      targetResults.push({
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        diagnostics,
        ok: false,
        error: diagnostics.lastError
      });
    }
  }
  await cleanupGeneratedWallpapers(cacheDir, 40);
  const ok = targetResults.length > 0 && targetResults.every((result) => result.ok);
  return {
    ok,
    appliedAt: ok ? new Date().toISOString() : undefined,
    platform: process.platform,
    error: ok ? undefined : lastError ?? "One or more wallpaper targets failed.",
    diagnostics: {
      nativeResults: targetResults.flatMap((result) => result.diagnostics.nativeResults),
      verifiedPaths: targetResults.flatMap((result) => result.diagnostics.verifiedPaths),
      changed: ok,
      targetResults,
      lastError
    },
    targets: targetResults
  };
});

ipcMain.handle("wallpaper:apply-file", async (_event, payload: WallpaperApplyFilePayload) => {
  try {
    const file = await validateRenderedWallpaperImage(payload.filePath);
    const diagnostics = await createWallpaperController().setWallpaper(payload.filePath, {
      monitorMode: payload.monitorMode,
      displayMode: payload.displayMode
    });
    diagnostics.renderedPath = payload.filePath;
    diagnostics.fileSize = file.size;
    diagnostics.validImage = true;
    if (!diagnostics.changed) {
      throw Object.assign(new Error(diagnostics.lastError ?? "macOS did not confirm the desktop wallpaper changed."), { diagnostics });
    }
    return {
      ok: true,
      filePath: payload.filePath,
      fileSize: file.size,
      appliedAt: new Date().toISOString(),
      platform: process.platform,
      diagnostics
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to set wallpaper.",
      platform: process.platform,
      diagnostics: diagnosticsFromError(error)
    };
  }
});

ipcMain.handle("tray:set-state", (_event, state: TrayRuntimeState) => {
  trayRuntimeState = state;
  updateTrayMenu();
  return trayRuntimeState;
});

ipcMain.handle("app:set-login-item", (_event, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  return app.getLoginItemSettings();
});

ipcMain.handle("app:apply-startup-behavior", (_event, startMinimized: boolean) => {
  const openedAtLogin = Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  if (startMinimized && openedAtLogin) mainWindow?.hide();
  return { openedAtLogin, hidden: Boolean(startMinimized && openedAtLogin) };
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    showWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running for wallpaper rotation; use tray/menu-bar Quit to exit.
});

app.on("before-quit", () => {
  isQuitting = true;
});

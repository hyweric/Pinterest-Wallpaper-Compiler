import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, systemPreferences, Tray } from "electron";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CustomTextureResult,
  ExportPayload,
  ExportSetFilePayload,
  ExportSetFileResult,
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
  WallpaperTransitionDiagnostic,
  WallpaperTargetResult,
  TrayRuntimeState
} from "../shared/types.js";
import { PinterestBoardProvider, type PublicPinterestBoardResult } from "./providers.js";
import { createWallpaperController } from "./wallpaper.js";
import { cleanupGeneratedWallpapers, safeWallpaperFileName, validateWallpaperFile } from "./wallpaper-files.js";
import { planFadeOverlayAssignments } from "../shared/wallpaper.js";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);
const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let trayRuntimeState: TrayRuntimeState = { enabled: false, paused: false };
const pinterestJobs = new Map<string, AbortController>();

// The custom BrowserWindow crossfade experiment is disabled until it can be
// verified on real macOS displays without leaking black panel windows. Keep
// wallpaper application stable and immediate in the meantime.
const fadeOverlayTransitionsEnabled = false;
const fadeOverlayWindows = new Set<BrowserWindow>();

function destroyFadeOverlayWindows() {
  for (const overlay of fadeOverlayWindows) {
    if (!overlay.isDestroyed()) overlay.destroy();
  }
  fadeOverlayWindows.clear();
}

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
    ? `Every ${trayRuntimeState.customIntervalValue ?? trayRuntimeState.customIntervalMinutes ?? 1} ${trayRuntimeState.customIntervalUnit ?? "minutes"}`
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
    let latest: { pins: Array<{ id: string; imageUrl: string; mediaType?: "image" | "video" }>; atBottom: boolean; bodyText: string } = {
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
            const mediaType = anchor.querySelector("video") || /video/i.test(String(anchor.getAttribute("aria-label") || "")) || anchor.querySelector('[data-test-id*="video"]') ? "video" : "image";
            root.__pwcPins[match[1]] = { id: match[1], imageUrl, mediaType };
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
        pins: Array<{ id: string; imageUrl: string; mediaType?: "image" | "video" }>;
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
    if (!imageExtensions.has(extension) && !videoExtensions.has(extension)) continue;
    const fileStat = await stat(filePath);
    images.push({
      id: `${filePath}:${entry.name}`,
      name: entry.name,
      path: filePath,
      url: pathToFileURL(filePath).toString(),
      modifiedAt: fileStat.mtime.toISOString(),
      size: fileStat.size,
      mediaType: videoExtensions.has(extension) ? "video" : "image",
      videoThumbnail: videoExtensions.has(extension) ? false : undefined
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
    mediaPolicy: "images-only",
    mediaCounts: { total: images.length, images: images.filter((image) => image.mediaType !== "video").length, videos: images.filter((image) => image.mediaType === "video").length },
    importStatus: "ready",
    importLog: [`Scanned ${images.length} supported images.`],
    lastScannedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function imageFromFilePath(filePath: string): Promise<LocalImageRef> {
  const fileStat = await stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  return {
    id: `${filePath}:${path.basename(filePath)}`,
    name: path.basename(filePath),
    path: filePath,
    url: pathToFileURL(filePath).toString(),
    modifiedAt: fileStat.mtime.toISOString(),
    size: fileStat.size,
    mediaType: videoExtensions.has(extension) ? "video" : "image",
    videoThumbnail: videoExtensions.has(extension) ? false : undefined
  };
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Rendered data is not a valid PNG or JPEG data URL.");
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.length < 16) throw new Error("Rendered image data is empty or corrupt.");
  return buffer;
}

function validateRenderedWallpaperBuffer(buffer: Buffer) {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error("Rendered image data could not be decoded by Electron.");
  const size = image.getSize();
  if (!size.width || !size.height) throw new Error("Rendered image has invalid dimensions.");
  image.toBitmap();
  return size;
}

async function validateRenderedWallpaperImage(filePath: string) {
  const file = await validateWallpaperFile(filePath);
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error("Rendered wallpaper file is not a valid readable image.");
  // Force decoding before the path is handed to macOS. This avoids a target
  // briefly resolving to an undecoded/empty image while Spaces refresh.
  image.toBitmap();
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
  const extension = path.extname(filePath) || ".png";
  const temporaryPath = path.join(cacheDir, `${path.basename(filePath, extension)}.${crypto.randomUUID()}.writing${extension}`);
  const buffer = dataUrlToBuffer(dataUrl);
  validateRenderedWallpaperBuffer(buffer);
  try {
    await writeFile(temporaryPath, buffer);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  const file = await validateRenderedWallpaperImage(filePath);
  return { cacheDir, filePath, file };
}


type FadeOverlayItem = { filePath: string; displayId?: string; current?: boolean; oldFilePath?: string };

type FadeOverlaySession = {
  begin: () => Promise<void>;
  complete: (ok: boolean) => Promise<void>;
  diagnostics: WallpaperTransitionDiagnostic[];
};

function reduceMotionEnabled() {
  if (process.platform !== "darwin") return false;
  try {
    return Boolean(systemPreferences.getUserDefault("reduceMotion", "boolean"));
  } catch {
    return false;
  }
}

function wallpaperMime(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

async function imageDataUrl(filePath?: string) {
  if (!filePath) return undefined;
  try {
    const bytes = await readFile(filePath);
    return `data:${wallpaperMime(filePath)};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function startFadeTransition(
  items: FadeOverlayItem[],
  options: { enabled?: boolean; durationMs?: number; allDisplays?: boolean } = {}
): Promise<FadeOverlaySession | undefined> {
  destroyFadeOverlayWindows();
  if (!fadeOverlayTransitionsEnabled || process.platform !== "darwin" || options.enabled === false || reduceMotionEnabled() || !items.length) return undefined;
  const displays = screen.getAllDisplays();
  if (!displays.length) return undefined;
  const duration = Math.max(200, Math.min(1600, options.durationMs ?? 650));
  const targetPlan = planFadeOverlayAssignments(displays.map((display) => String(display.id)), items, options.allDisplays);
  const targets = targetPlan.map((entry) => ({
    display: displays.find((display) => String(display.id) === entry.displayId)!,
    item: entry.item
  })).filter((entry) => Boolean(entry.display));
  const windows: Array<{ window: BrowserWindow; diagnostic: WallpaperTransitionDiagnostic }> = [];
  try {
    for (const { display, item } of targets) {
      const newDataUrl = await imageDataUrl(item.filePath);
      if (!newDataUrl) continue;
      const oldDataUrl = await imageDataUrl(item.oldFilePath) ?? newDataUrl;
      const diagnostic: WallpaperTransitionDiagnostic = {
        targetType: "physical-display",
        displayId: String(display.id),
        oldImagePath: item.oldFilePath,
        newImagePath: item.filePath,
        overlayCreated: false,
        oldImageDecoded: false,
        newImageDecoded: false,
        animationStarted: false,
        animationCompleted: false,
        durationMs: duration,
        removedAfterVerification: false
      };
      const overlay = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: "#f5f5f2",
        show: false,
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        hasShadow: false,
        type: "panel",
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      overlay.setIgnoreMouseEvents(true);
      overlay.setAlwaysOnTop(true, "screen-saver", 1);
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}
.wall{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;will-change:opacity}
#old{opacity:1}#next{opacity:0;transition:opacity ${duration}ms cubic-bezier(.22,.8,.2,1)}
</style><img id="old" class="wall"><img id="next" class="wall"><script>
const oldImage=document.getElementById('old');const nextImage=document.getElementById('next');
oldImage.src=${JSON.stringify(oldDataUrl)};nextImage.src=${JSON.stringify(newDataUrl)};
const decode=(img)=>img.decode?img.decode():new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject});
window.pwcReady=Promise.all([decode(oldImage),decode(nextImage)]).then(()=>({old:true,next:true}));
window.pwcStart=()=>new Promise(resolve=>{let frames=0;const tick=()=>{frames++;if(frames<2)requestAnimationFrame(tick)};requestAnimationFrame(tick);nextImage.style.opacity='1';setTimeout(()=>resolve({frames,duration:${duration}}),${duration}+60)});
window.pwcRollback=()=>new Promise(resolve=>{nextImage.style.opacity='0';setTimeout(resolve,${duration}+60)});
</script>`;
      await overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const decoded = await overlay.webContents.executeJavaScript("window.pwcReady", true) as { old: boolean; next: boolean };
      diagnostic.oldImageDecoded = Boolean(decoded?.old);
      diagnostic.newImageDecoded = Boolean(decoded?.next);
      overlay.showInactive();
      fadeOverlayWindows.add(overlay);
      overlay.once("closed", () => fadeOverlayWindows.delete(overlay));
      diagnostic.overlayCreated = true;
      windows.push({ window: overlay, diagnostic });
    }
    if (!windows.length) return undefined;
    return {
      diagnostics: windows.map((entry) => entry.diagnostic),
      begin: async () => {
        await Promise.all(windows.map(async ({ window, diagnostic }) => {
          if (window.isDestroyed()) return;
          diagnostic.animationStarted = true;
          diagnostic.startedAt = new Date().toISOString();
          const started = Date.now();
          const result = await window.webContents.executeJavaScript("window.pwcStart()", true) as { frames?: number };
          diagnostic.animationFrames = result?.frames ?? 0;
          diagnostic.actualDurationMs = Date.now() - started;
          diagnostic.animationCompleted = Boolean(result && (result.frames ?? 0) >= 1);
          diagnostic.completedAt = new Date().toISOString();
        }));
      },
      complete: async (ok: boolean) => {
        if (!ok) {
          await Promise.all(windows.filter(({ window }) => !window.isDestroyed()).map(({ window }) => window.webContents.executeJavaScript("window.pwcRollback()", true).catch(() => undefined)));
        }
        for (const { window, diagnostic } of windows) {
          diagnostic.removedAfterVerification = true;
          diagnostic.removedAt = new Date().toISOString();
          if (!window.isDestroyed()) window.destroy();
          fadeOverlayWindows.delete(window);
        }
      }
    };
  } catch (error) {
    for (const { window, diagnostic } of windows) {
      diagnostic.error = error instanceof Error ? error.message : String(error);
      if (!window.isDestroyed()) window.destroy();
      fadeOverlayWindows.delete(window);
    }
    return undefined;
  }
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
      } else if (itemStat.isFile() && (imageExtensions.has(path.extname(itemPath).toLowerCase()) || videoExtensions.has(path.extname(itemPath).toLowerCase()))) {
        images.push(await imageFromFilePath(itemPath));
      }
    } catch {
      // Ignore individual missing paths; the caller shows a summary.
    }
  }

  if (sources.length === 0 && images.length === 0) {
    return { sources: [], images: [], error: "No supported image, video, or folder items were found in the drop." };
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

  const buffer = dataUrlToBuffer(payload.dataUrl);
  validateRenderedWallpaperBuffer(buffer);
  await writeFile(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("export-set:choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose Export Set Folder"
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle("export-set:write-file", async (_event, payload: ExportSetFilePayload): Promise<ExportSetFileResult> => {
  try {
    await mkdir(payload.destinationPath, { recursive: true });
    const safeName = path.basename(payload.fileName).replace(/[^a-zA-Z0-9._-]+/g, "-");
    const filePath = path.join(payload.destinationPath, safeName);
    try {
      await stat(filePath);
      if (!payload.overwrite) return { ok: false, skipped: true, filePath };
    } catch {
      // File does not exist.
    }
    const buffer = dataUrlToBuffer(payload.dataUrl);
    validateRenderedWallpaperBuffer(buffer);
    await writeFile(filePath, buffer);
    return { ok: true, filePath };
  } catch (error) {
    console.error("[export-set:write-file] failed", {
      destinationPath: payload.destinationPath,
      fileName: payload.fileName,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return { ok: false, error: error instanceof Error ? error.message : "Unable to export variation." };
  }
});

ipcMain.handle("texture:import", async (): Promise<CustomTextureResult> => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Import Custom Texture",
    filters: [{ name: "Texture Images", extensions: [...imageExtensions].map((ext) => ext.slice(1)) }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  try {
    const sourcePath = result.filePaths[0];
    const textureDir = path.join(app.getPath("userData"), "Textures");
    await mkdir(textureDir, { recursive: true });
    const extension = path.extname(sourcePath).toLowerCase() || ".png";
    const id = `texture-${crypto.randomUUID()}`;
    const destinationPath = path.join(textureDir, `${id}${extension}`);
    await copyFile(sourcePath, destinationPath);
    return {
      canceled: false,
      texture: {
        id,
        name: path.basename(sourcePath, path.extname(sourcePath)),
        path: destinationPath,
        url: pathToFileURL(destinationPath).toString(),
        createdAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? error.message : "Unable to import texture." };
  }
});

ipcMain.handle("texture:remove", async (_event, texturePath: string) => {
  await rm(texturePath, { force: true });
  return true;
});

ipcMain.handle("texture:reveal", async (_event, texturePath: string) => {
  shell.showItemInFolder(texturePath);
  return true;
});

ipcMain.handle("wallpaper:apply", async (_event, payload: WallpaperApplyPayload) => {
  destroyFadeOverlayWindows();
  try {
    const { cacheDir, filePath, file: generatedFile } = await writeRenderedWallpaper(payload.dataUrl, payload.suggestedName);
    const controller = createWallpaperController();
    const knownTargets = await controller.getTargets?.().catch(() => []) ?? [];
    const requestedTargets = payload.targetId
      ? knownTargets.filter((target) => target.id === payload.targetId)
      : payload.monitorMode === "primary" || payload.scope === "current-desktop"
        ? knownTargets.filter((target) => target.current).slice(0, 1)
        : knownTargets.filter((target) => target.current);
    const fadeItems = requestedTargets.length
      ? requestedTargets.map((target) => ({ filePath, displayId: target.displayId, current: target.current, oldFilePath: target.currentPath }))
      : [{ filePath }];
    const transition = await startFadeTransition(fadeItems, {
      enabled: payload.transitionEnabled,
      durationMs: payload.transitionDurationMs,
      allDisplays: payload.monitorMode !== "primary"
    });
    const transitionAnimation = transition?.begin();
    let diagnostics: WallpaperApplyDiagnostics;
    try {
      diagnostics = await controller.setWallpaper(filePath, {
        monitorMode: payload.monitorMode,
        displayMode: payload.displayMode,
        scope: payload.scope,
        targetId: payload.targetId
      });
      await transitionAnimation;
      diagnostics.transitionDiagnostics = transition?.diagnostics;
      await transition?.complete(diagnostics.changed);
    } catch (error) {
      await transitionAnimation;
      await transition?.complete(false);
      throw error;
    }
    diagnostics.renderedPath = filePath;
    diagnostics.fileSize = generatedFile.size;
    diagnostics.validImage = true;
    if (!diagnostics.changed) {
      throw Object.assign(new Error(diagnostics.lastError ?? "macOS did not confirm the desktop wallpaper changed."), { diagnostics });
    }
    await cleanupGeneratedWallpapers(cacheDir, 120, [filePath]);
    return {
      ok: true,
      filePath,
      fileSize: generatedFile.size,
      appliedAt: new Date().toISOString(),
      platform: process.platform,
      diagnostics
    };
  } catch (error) {
    console.error("[wallpaper:apply] failed", {
      suggestedName: payload.suggestedName,
      scope: payload.scope,
      monitorMode: payload.monitorMode,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      diagnostics: diagnosticsFromError(error)
    });
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
  destroyFadeOverlayWindows();
  const cacheDir = path.join(app.getPath("userData"), "Generated Wallpapers");
  const writtenItems: Array<{ targetId: string; targetLabel: string; displayId?: string; current?: boolean; filePath: string; fileSize: number }> = [];
  const earlyFailures: WallpaperTargetResult[] = [];

  for (const item of payload.items) {
    try {
      const written = await writeRenderedWallpaper(item.dataUrl, item.suggestedName);
      writtenItems.push({
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        displayId: item.displayId,
        current: item.current,
        filePath: written.filePath,
        fileSize: written.file.size
      });
    } catch (error) {
      const diagnostics = diagnosticsFromError(error) ?? {
        nativeResults: [],
        verifiedPaths: [],
        changed: false,
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        lastError: error instanceof Error ? error.message : "Unable to render wallpaper target."
      };
      earlyFailures.push({
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        diagnostics,
        ok: false,
        error: diagnostics.lastError
      });
    }
  }

  const controller = createWallpaperController();
  const knownTargets = await controller.getTargets?.().catch(() => []) ?? [];
  const transition = await startFadeTransition(
    writtenItems.map((item) => ({
      filePath: item.filePath,
      displayId: item.displayId,
      current: item.current,
      oldFilePath: knownTargets.find((target) => target.id === item.targetId)?.currentPath
    })),
    {
      enabled: payload.transitionEnabled,
      durationMs: payload.transitionDurationMs,
      allDisplays: payload.scope === "same-all-desktops"
    }
  );
  const transitionAnimation = transition?.begin();
  let appliedResults: WallpaperTargetResult[] = [];
  if (writtenItems.length && controller.setWallpapers) {
    appliedResults = await controller.setWallpapers(writtenItems, {
      displayMode: payload.displayMode,
      scope: payload.scope ?? "different-per-desktop"
    });
  } else {
    for (const item of writtenItems) {
      try {
        const diagnostics = await controller.setWallpaper(item.filePath, {
          displayMode: payload.displayMode,
          scope: payload.scope ?? "different-per-desktop",
          targetId: item.targetId
        });
        diagnostics.renderedPath = item.filePath;
        diagnostics.fileSize = item.fileSize;
        diagnostics.validImage = true;
        diagnostics.targetId = item.targetId;
        diagnostics.targetLabel = item.targetLabel;
        appliedResults.push({
          targetId: item.targetId,
          targetLabel: item.targetLabel,
          filePath: item.filePath,
          fileSize: item.fileSize,
          diagnostics,
          ok: diagnostics.changed,
          error: diagnostics.changed ? undefined : diagnostics.lastError
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
        appliedResults.push({
          targetId: item.targetId,
          targetLabel: item.targetLabel,
          filePath: item.filePath,
          fileSize: item.fileSize,
          diagnostics,
          ok: false,
          error: diagnostics.lastError
        });
      }
    }
  }

  const targetResults = [...appliedResults, ...earlyFailures];
  await transitionAnimation;
  for (const result of targetResults) result.diagnostics.transitionDiagnostics = transition?.diagnostics;
  await cleanupGeneratedWallpapers(cacheDir, 120, writtenItems.map((item) => item.filePath));
  const ok = targetResults.length === payload.items.length && targetResults.every((result) => result.ok);
  await transition?.complete(ok);
  const lastError = targetResults.find((result) => !result.ok)?.error;
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
  destroyFadeOverlayWindows();
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
  destroyFadeOverlayWindows();
});

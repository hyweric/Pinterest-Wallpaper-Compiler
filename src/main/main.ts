import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, screen, session, shell, systemPreferences, Tray } from "electron";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  WallpaperApplyDiagnostics,
  ImageFileResult,
  LocalImageRef,
  PathImportResult,
  PinterestImportProgress,
  SourceImportProgress,
  PinterestImportRequest,
  WallpaperApplyFilePayload,
  WallpaperSetApplyPayload,
  WallpaperApplyPayload,
  WallpaperApplyResult,
  WallpaperApplyTargetsPayload,
  WallpaperGeneratePayload,
  WallpaperGenerateResult,
  WallpaperProject,
  WallpaperTransitionDiagnostic,
  WallpaperTarget,
  WallpaperTargetMode,
  WallpaperTargetResult,
  TrayRuntimeState
} from "../shared/types.js";
import { PinterestBoardProvider, type PublicPinterestBoardResult } from "./providers.js";
import { finderImageExtensions, importLocalPaths } from "./local-source-import.js";
import { createWallpaperController } from "./wallpaper.js";
import { platformCopy, platformKindFromNodePlatform, platformCapabilities } from "../shared/platform.js";
import { cleanupGeneratedWallpapers, persistWallpaperAsset, safeWallpaperFileName, validateWallpaperFile } from "./wallpaper-files.js";
import { localFileProtocolScheme, pathFromRenderableLocalFileUrl } from "../shared/local-file-url.js";
import { planFadeOverlayAssignments, selectWallpaperTargets } from "../shared/wallpaper.js";
import {
  eraseWallpaperSetRootContents,
  listWallpaperSetRootEntries,
  safeWallpaperSetName,
  uniqueWallpaperSetPath,
  wallpaperSetFolderName,
  wallpaperSetManifestFile,
  wallpaperSetTemporaryPrefix
} from "./wallpaper-sets.js";
import { installStrictMediaPermissionPolicy } from "./media-permissions.js";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);
const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let trayRuntimeState: TrayRuntimeState = { enabled: false, paused: false };
const pinterestJobs = new Map<string, AbortController>();
const nativePlatformKind = platformKindFromNodePlatform(process.platform);
const nativePlatformCopy = platformCopy(nativePlatformKind);
const macOSMainMenuLabelMarkers = { preview: "Preview on Current Desktop" };
const nativePlatformCapabilities = platformCapabilities(nativePlatformKind);
const wallpaperController = createWallpaperController();

type WindowsWallpaperRotationState = {
  timer?: ReturnType<typeof setInterval>;
  folderPath: string;
  files: string[];
  index: number;
  intervalMs: number;
  previousFilePath?: string;
  displayMode?: WallpaperSetApplyPayload["displayMode"];
  transitionEnabled?: boolean;
  transitionDurationMs?: number;
};

let windowsWallpaperRotationState: WindowsWallpaperRotationState | undefined;

function stopWindowsWallpaperRotation() {
  if (windowsWallpaperRotationState?.timer) clearInterval(windowsWallpaperRotationState.timer);
  windowsWallpaperRotationState = undefined;
}

type WallpaperSetSession = {
  id: string;
  rootPath: string;
  stagingPath: string;
  finalPath: string;
  folderName: string;
  createdAt: string;
  projectName: string;
  templateName: string;
  format: "png" | "jpeg";
  variationCount: number;
  canvasWidth: number;
  canvasHeight: number;
  files: Array<{ fileName: string; filePath: string; sizeBytes: number }>;
};

const wallpaperSetSessions = new Map<string, WallpaperSetSession>();

function pinPaperPicturesRoot() {
  return path.join(app.getPath("pictures"), "Pin Paper");
}

function defaultWallpaperSetsRoot() {
  return path.join(app.getPath("desktop"), "Pin Paper Sets");
}

function persistentSourceCacheRoot() {
  return path.join(pinPaperPicturesRoot(), "Source Cache");
}

function persistentWebImportCacheRoot() {
  return path.join(persistentSourceCacheRoot(), "Web Imports");
}

function pinPaperIconPath() {
  return path.join(app.getAppPath(), "build", "icon.png");
}

function pinPaperTrayImage() {
  const image = nativeImage.createFromPath(pinPaperIconPath());
  if (image.isEmpty()) return nativeImage.createEmpty();
  return image.resize({ width: 18, height: 18 });
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function safeWallpaperSetEraseRoot(requestedRootPath?: string) {
  const resolved = path.resolve(requestedRootPath?.trim() || defaultWallpaperSetsRoot());
  const protectedRoots = new Set([
    path.parse(resolved).root,
    app.getPath("home"),
    app.getPath("pictures"),
    app.getPath("documents"),
    app.getPath("desktop"),
    app.getPath("downloads"),
    app.getPath("userData")
  ].map((item) => path.resolve(item)));
  if (protectedRoots.has(resolved)) {
    throw new Error("For safety, choose the dedicated Wallpaper Sets folder rather than a home or system folder.");
  }
  return resolved;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: localFileProtocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

// Full-screen BrowserWindow crossfade overlays could remain visible after an
// interrupted scheduled run and can disturb Mission Control. Keep native
// wallpaper application stable until a non-window transition is available.
const fadeOverlayTransitionsEnabled = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f5f5f2",
    title: "Pin Paper",
    icon: pinPaperIconPath(),
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

  let rendererRecoveryUsed = false;
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process exited unexpectedly", details);
    if (isQuitting || rendererRecoveryUsed || details.reason === "clean-exit") return;
    rendererRecoveryUsed = true;
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (isDev) void mainWindow.loadURL("http://127.0.0.1:5173");
      else void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }, 500);
  });
}

function contentTypeForLocalImage(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".heic") return "image/heic";
  if (extension === ".heif") return "image/heif";
  return "application/octet-stream";
}

function registerLocalFileProtocol() {
  protocol.handle(localFileProtocolScheme, async (request) => {
    const corsHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: corsHeaders });
    }
    try {
      const filePath = pathFromRenderableLocalFileUrl(request.url, process.platform);
      const extension = path.extname(filePath).toLowerCase();
      if (!imageExtensions.has(extension)) {
        return new Response("Unsupported local image type.", { status: 415, headers: corsHeaders });
      }
      const data = request.method === "HEAD" ? undefined : new Uint8Array(await readFile(filePath));
      return new Response(data, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": contentTypeForLocalImage(filePath)
        }
      });
    } catch {
      return new Response("Local image not available.", { status: 404, headers: corsHeaders });
    }
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

function currentPhysicalDisplayId() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return String(screen.getDisplayMatching(mainWindow.getBounds()).id);
    }
    return String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
  } catch {
    return undefined;
  }
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Editor", click: showWindow },
      ...(nativePlatformCapabilities.canPreviewCurrentDesktop ? [{ label: nativePlatformCopy.previewCurrentDesktop, click: () => mainWindow?.webContents.send("tray:command", "generate-apply") } as const] : []),
      ...(nativePlatformCapabilities.canPreviewCurrentDesktop ? [{ label: "Previous Preview", click: () => mainWindow?.webContents.send("tray:command", "previous") } as const] : []),
      { type: "separator" },
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

function pinPaperMainPreloadPath(fileName: string) {
  return path.join(__dirname, fileName);
}

function createTray() {
  if (tray) return;
  tray = new Tray(pinPaperTrayImage());
  tray.setToolTip("Pin Paper");
  tray.on("click", showWindow);
  updateTrayMenu();
}

async function loadPublicPinterestBoard(
  boardUrl: string,
  options: {
    signal?: AbortSignal;
    expectedTotal?: number;
    onProgress?: (current: number, total?: number, message?: string, page?: number) => void;
  }
): Promise<PublicPinterestBoardResult> {
  const scraperSession = session.fromPartition(`pwc-pinterest-import-${crypto.randomUUID()}`);
  installStrictMediaPermissionPolicy(scraperSession as unknown as import("./media-permissions.js").PermissionPolicySession);

  const scraper = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session: scraperSession,
      preload: pinPaperMainPreloadPath("media-deny-preload.js"),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "document-user-activation-required"
    }
  });
  scraper.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const closeScraper = () => {
    if (!scraper.isDestroyed()) scraper.destroy();
  };

  try {
    if (options.signal?.aborted) throw new DOMException("Pinterest import canceled.", "AbortError");
    let loaded = false;
    let loadError: unknown;
    for (let attempt = 0; attempt < 3 && !loaded; attempt += 1) {
      try {
        await scraper.loadURL(boardUrl, { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36" });
        loaded = true;
      } catch (error) {
        loadError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
      }
    }
    if (!loaded) throw loadError instanceof Error ? loadError : new Error("Pinterest board failed to load.");
    await new Promise((resolve) => setTimeout(resolve, 1800));

    let stableRounds = 0;
    let previousCount = 0;
    let previousHeight = 0;
    let latest: { pins: Array<{ id: string; imageUrl: string; mediaType?: "image" | "video"; promoted?: boolean }>; atBottom: boolean; bodyText: string } = {
      pins: [],
      atBottom: false,
      bodyText: ""
    };

    for (let iteration = 0; iteration < 360; iteration += 1) {
      if (options.signal?.aborted) throw new DOMException("Pinterest import canceled.", "AbortError");
      const scanResult = await scraper.webContents.executeJavaScript(String.raw`(() => {
        try {
          const root = window;
          root.__pwcPins = root.__pwcPins && typeof root.__pwcPins === "object" ? root.__pwcPins : {};
          const chooseSrc = (img) => {
            const isHeicUrl = (url) => /\.(heic|heif)(?:[?#]|$)/i.test(String(url || "")) || /[?&](fm|format)=hei[cf]\b/i.test(String(url || ""));
            const entries = String(img.getAttribute("srcset") || "").split(",").map((item) => {
              const parts = item.trim().split(/\s+/);
              return { url: parts[0], width: Number((parts[1] || "").replace(/[^0-9.]/g, "")) || 0 };
            }).filter((item) => item.url);
            for (const url of [img.currentSrc, img.src, img.getAttribute("data-src")]) {
              if (url && !entries.some((entry) => entry.url === url)) entries.push({ url, width: 0 });
            }
            entries.sort((a, b) => Number(isHeicUrl(a.url)) - Number(isHeicUrl(b.url)) || b.width - a.width);
            return entries[0]?.url || "";
          };
          for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
            const match = String(anchor.getAttribute("href") || "").match(/\/pin\/(\d+)/);
            if (!match) continue;
            const card = anchor.closest('[data-test-id], [role="listitem"], div');
            const cardText = String(card?.textContent || anchor.textContent || "").slice(0, 500);
            const promoted = /\b(promoted|sponsored|advertisement|ad)\b/i.test(cardText)
              || Boolean(anchor.closest('[data-test-id*="promoted"], [data-test-id*="sponsor"], [aria-label*="Promoted"], [aria-label*="Sponsored"]'));
            if (promoted) continue;
            const img = anchor.querySelector("img");
            if (!img) continue;
            const imageUrl = chooseSrc(img);
            if (!/^https?:/i.test(imageUrl)) continue;
            const mediaType = anchor.querySelector("video") || /video/i.test(String(anchor.getAttribute("aria-label") || "")) || anchor.querySelector('[data-test-id*="video"]') ? "video" : "image";
            root.__pwcPins[match[1]] = { id: match[1], imageUrl, mediaType, promoted };
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
            scrollHeight: scrollRoot.scrollHeight,
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
        pins: Array<{ id: string; imageUrl: string; mediaType?: "image" | "video"; promoted?: boolean }>;
        atBottom: boolean;
        bodyText: string;
        pageUrl?: string;
        scrollHeight?: number;
        error?: string;
      };
      if (!scanResult.ok) {
        throw new Error(`Pinterest board page scan failed${scanResult.pageUrl ? ` at ${scanResult.pageUrl}` : ""}: ${scanResult.error ?? "unknown page error"}`);
      }
      latest = scanResult;

      const count = latest.pins.length;
      const height = scanResult.scrollHeight ?? 0;
      stableRounds = count === previousCount && height === previousHeight ? stableRounds + 1 : 0;
      previousCount = count;
      previousHeight = height;
      const page = Math.max(1, Math.ceil(count / 50));
      options.onProgress?.(count, options.expectedTotal, `Importing page ${page}: ${count}${options.expectedTotal ? ` / ${options.expectedTotal}` : ""} pins found`, page);

      if (options.expectedTotal && count >= options.expectedTotal) break;
      if (latest.atBottom && stableRounds >= 24) break;
      if (latest.atBottom && stableRounds > 0 && stableRounds % 6 === 0) {
        await scraper.webContents.executeJavaScript(`window.scrollBy(0, -700); setTimeout(() => window.scrollTo(0, document.scrollingElement?.scrollHeight || document.body.scrollHeight), 120);`, true);
      }
      await new Promise((resolve) => setTimeout(resolve, latest.atBottom ? 850 : 500));
    }

    const blocked = /log in|sign up|access denied|something went wrong/i.test(latest.bodyText) && latest.pins.length === 0;
    if (blocked) throw new Error("Pinterest did not expose the public board feed in the embedded browser.");
    const pins = latest.pins.filter((pin) => !pin.promoted);
    const overflow = options.expectedTotal && pins.length > options.expectedTotal ? pins.length - options.expectedTotal : 0;
    return {
      pins,
      total: options.expectedTotal && options.expectedTotal >= pins.length ? options.expectedTotal : pins.length,
      log: [`Full-board browser loader discovered ${pins.length} valid pin cards${overflow ? ` (${overflow} above Pinterest's reported count)` : ""}.`]
    };
  } finally {
    closeScraper();
  }
}

function pinterestProvider() {
  return new PinterestBoardProvider(path.join(persistentSourceCacheRoot(), "Pinterest"), loadPublicPinterestBoard);
}

async function canDecodeImportedImage(filePath: string) {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      const size = image.getSize();
      if (size.width && size.height) {
        image.toBitmap();
        return true;
      }
    }
  } catch {
    // Chromium can decode some formats that nativeImage cannot. Validate their
    // container signatures below instead of rejecting them outright.
  }

  const extension = path.extname(filePath).toLowerCase();
  let handle;
  try {
    handle = await open(filePath, "r");
    const fileStat = await handle.stat();
    if (fileStat.size < 12) return false;
    const head = Buffer.alloc(Math.min(32, fileStat.size));
    await handle.read(head, 0, head.length, 0);
    if (extension === ".png") {
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        && head.subarray(12, 16).toString("ascii") === "IHDR";
    }
    if (extension === ".gif") {
      const signature = head.subarray(0, 6).toString("ascii");
      return (signature === "GIF87a" || signature === "GIF89a") && head.readUInt16LE(6) > 0 && head.readUInt16LE(8) > 0;
    }
    if (extension === ".webp") {
      return head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
    }
    if (extension === ".heic" || extension === ".heif") {
      const brand = head.subarray(8, 12).toString("ascii");
      return head.subarray(4, 8).toString("ascii") === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand);
    }
    if (extension === ".jpg" || extension === ".jpeg") {
      if (head[0] !== 0xff || head[1] !== 0xd8 || fileStat.size < 4) return false;
      const tail = Buffer.alloc(2);
      await handle.read(tail, 0, 2, fileStat.size - 2);
      return tail[0] === 0xff && tail[1] === 0xd9;
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function imageSizeForFile(filePath: string) {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return undefined;
    const size = image.getSize();
    if (!size.width || !size.height) return undefined;
    return { width: Math.round(size.width), height: Math.round(size.height) };
  } catch {
    return undefined;
  }
}

function enrichLocalImageDimensions(image: LocalImageRef): LocalImageRef {
  if (image.width && image.height) return image;
  const size = imageSizeForFile(image.path);
  return size ? { ...image, ...size } : image;
}

function enrichSourceImageDimensions<T extends { images?: LocalImageRef[] }>(source: T): T {
  return { ...source, images: (source.images ?? []).map(enrichLocalImageDimensions) };
}

function enrichImportedImageDimensions<T extends PathImportResult>(result: T): T {
  return {
    ...result,
    images: result.images.map(enrichLocalImageDimensions),
    sources: result.sources.map((source) => enrichSourceImageDimensions(source))
  };
}

const heicLocalImageExtensions = new Set([".heic", ".heif"]);
const heicLocalBrands = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

async function isHeicLikeLocalImage(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (heicLocalImageExtensions.has(extension)) return true;
  let handle;
  try {
    handle = await open(filePath, "r");
    const fileStat = await handle.stat();
    if (fileStat.size < 12) return false;
    const head = Buffer.alloc(Math.min(32, fileStat.size));
    await handle.read(head, 0, head.length, 0);
    return head.subarray(4, 8).toString("ascii") === "ftyp" && heicLocalBrands.has(head.subarray(8, 12).toString("ascii"));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function convertedLocalHeicPath(sourcePath: string, fileStat: Awaited<ReturnType<typeof stat>>) {
  const hash = createHash("sha256")
    .update(`${path.resolve(sourcePath)}\0${Number(fileStat.size)}\0${Math.round(Number(fileStat.mtimeMs))}`)
    .digest("hex")
    .slice(0, 20);
  const stem = sanitizeCacheFileStem(path.basename(sourcePath, path.extname(sourcePath)) || "heic-image");
  return path.join(persistentSourceCacheRoot(), "Converted HEIC", `${stem}-${hash}.png`);
}

async function convertHeicLocalImageToPng(sourcePath: string) {
  if (process.platform !== "darwin") {
    throw new Error("HEIC images need conversion before rendering; automatic HEIC conversion is only available on macOS right now.");
  }
  const sourceStat = await stat(sourcePath);
  const outputPath = convertedLocalHeicPath(sourcePath, sourceStat);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const existing = await stat(outputPath).catch(() => undefined);
  if (!existing || existing.size < 16) {
    await new Promise<void>((resolve, reject) => {
      execFile("sips", ["-s", "format", "png", sourcePath, "--out", outputPath], { timeout: 30_000 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  if (!(await canDecodeImportedImage(outputPath))) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw new Error("HEIC conversion produced an unreadable PNG.");
  }
  return outputPath;
}

async function makeLocalImageRenderable(image: LocalImageRef): Promise<LocalImageRef> {
  if (!(await isHeicLikeLocalImage(image.path))) return image;
  const renderablePath = await convertHeicLocalImageToPng(image.path);
  const renderedStat = await stat(renderablePath);
  return enrichLocalImageDimensions({
    ...image,
    name: path.basename(renderablePath),
    path: renderablePath,
    url: pathToFileURL(renderablePath).toString(),
    modifiedAt: renderedStat.mtime.toISOString(),
    size: renderedStat.size,
    mediaType: "image"
  });
}

async function normalizeImportedRenderableImages<T extends PathImportResult>(result: T): Promise<T> {
  const warnings = [...(result.warnings ?? [])];
  const convertedByKey = new Map<string, LocalImageRef>();
  const failedKeys = new Set<string>();
  const imageKey = (image: LocalImageRef) => `${image.id}\0${image.path}`;
  const allImages = [
    ...result.images,
    ...result.sources.flatMap((source) => source.images ?? [])
  ];
  for (const image of allImages) {
    const key = imageKey(image);
    if (convertedByKey.has(key) || failedKeys.has(key)) continue;
    try {
      convertedByKey.set(key, await makeLocalImageRenderable(image));
    } catch (error) {
      failedKeys.add(key);
      warnings.push(`Skipped ${image.name || path.basename(image.path)}: ${error instanceof Error ? error.message : "image could not be prepared for rendering"}`);
    }
  }
  const convertList = (images: LocalImageRef[]) => images
    .map((image) => convertedByKey.get(imageKey(image)))
    .filter((image): image is LocalImageRef => Boolean(image));
  const images = convertList(result.images);
  const sources = result.sources
    .map((source) => {
      const sourceImages = convertList(source.images ?? []);
      return {
        ...source,
        images: sourceImages,
        mediaCounts: { total: sourceImages.length, images: sourceImages.length, videos: 0 }
      };
    })
    .filter((source) => source.images.length > 0);
  const skippedRenderableCount = failedKeys.size;
  const baseSummary = result.summary ?? {
    requestedPathCount: 0,
    importedFolderCount: 0,
    importedLooseImageCount: 0,
    discoveredImageCount: allImages.length,
    skippedUnsupportedCount: 0,
    skippedUnreadableCount: 0,
    skippedMissingCount: 0,
    duplicatePathCount: 0,
    emptyFolders: []
  };
  const summary = skippedRenderableCount > 0
    ? { ...baseSummary, skippedUnreadableCount: baseSummary.skippedUnreadableCount + skippedRenderableCount }
    : baseSummary;
  return enrichImportedImageDimensions({
    ...result,
    images,
    sources,
    summary,
    warnings,
    error: sources.length === 0 ? (warnings[warnings.length - 1] ?? result.error ?? "No supported readable image or folder items were found.") : result.error
  });
}

async function importValidatedLocalPaths(paths: unknown) {
  const result = await importLocalPaths(paths, { validateImage: canDecodeImportedImage });
  return normalizeImportedRenderableImages(result);
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid image data.");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  return header.includes(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
}

function mimeToImageExtension(mimeType: string, fallback = ".png") {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/heic") return ".heic";
  if (normalized === "image/heif") return ".heif";
  return fallback;
}

function sanitizeCacheFileStem(value: string) {
  const cleaned = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return cleaned || "web-image";
}

async function cacheWebImage(payload: unknown): Promise<ImageFileResult> {
  try {
    if (!payload || typeof payload !== "object") return { canceled: false, error: "No web image was provided." };
    const input = payload as { url?: unknown; dataUrl?: unknown; name?: unknown; mimeType?: unknown };
    const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
    const rawDataUrl = typeof input.dataUrl === "string" ? input.dataUrl.trim() : "";
    const requestedName = typeof input.name === "string" ? input.name.trim() : "";
    const requestedMime = typeof input.mimeType === "string" ? input.mimeType.trim() : "";

    let data: Buffer;
    let mimeType = requestedMime;
    let sourceUrl = rawUrl || undefined;
    let name = requestedName || "web image";

    if (rawDataUrl.startsWith("data:image/")) {
      const header = rawDataUrl.slice(0, rawDataUrl.indexOf(","));
      mimeType = mimeType || header.slice("data:".length).split(";")[0];
      data = dataUrlToBuffer(rawDataUrl);
    } else if (rawUrl.startsWith("data:image/")) {
      const header = rawUrl.slice(0, rawUrl.indexOf(","));
      mimeType = mimeType || header.slice("data:".length).split(";")[0];
      data = dataUrlToBuffer(rawUrl);
      sourceUrl = undefined;
    } else if (/^https?:\/\//i.test(rawUrl)) {
      const response = await fetch(rawUrl, { redirect: "follow" });
      if (!response.ok) return { canceled: false, error: `Web image download failed with HTTP ${response.status}.` };
      mimeType = mimeType || response.headers.get("content-type") || "";
      if (!mimeType.toLowerCase().startsWith("image/")) return { canceled: false, error: "The dropped web item was not an image." };
      data = Buffer.from(await response.arrayBuffer());
      try {
        const url = new URL(rawUrl);
        const basename = path.basename(url.pathname);
        if (!requestedName && basename) name = basename;
      } catch {
        // Keep the fallback name.
      }
    } else {
      return { canceled: false, error: "Drop or paste an image file, copied image, or direct image URL." };
    }

    if (data.length < 16) return { canceled: false, error: "The web image was empty." };
    const extension = mimeToImageExtension(mimeType, path.extname(name).toLowerCase() || ".png");
    const hash = createHash("sha256").update(data).digest("hex");
    const cacheDir = persistentWebImportCacheRoot();
    await mkdir(cacheDir, { recursive: true });
    const destinationPath = path.join(cacheDir, `${sanitizeCacheFileStem(path.basename(name, path.extname(name)))}-${hash.slice(0, 16)}${extension}`);
    await writeFile(destinationPath, data);
    if (!(await canDecodeImportedImage(destinationPath))) {
      await rm(destinationPath, { force: true }).catch(() => undefined);
      return { canceled: false, error: "The web image could not be decoded after caching." };
    }
    const fileStat = await stat(destinationPath);
    const timestamp = new Date().toISOString();
    const image = await makeLocalImageRenderable(enrichLocalImageDimensions({
      id: `web-image-${hash.slice(0, 24)}`,
      name: requestedName || path.basename(destinationPath),
      path: destinationPath,
      url: pathToFileURL(destinationPath).toString(),
      modifiedAt: fileStat.mtime.toISOString(),
      size: fileStat.size,
      sourceUrl,
      mediaType: "image"
    }));
    const source = enrichSourceImageDimensions({
      id: `source-web-${hash.slice(0, 18)}`,
      identityKey: `web-image:${hash}`,
      providerId: "local-file" as const,
      type: "local-file" as const,
      name: requestedName || path.basename(image.path),
      path: image.path,
      cachePath: cacheDir,
      images: [image],
      mediaPolicy: "images-and-video-thumbnails" as const,
      mediaCounts: { total: 1, images: 1, videos: 0 },
      importStatus: "ready" as const,
      importLog: [`Cached web image into ${cacheDir}.`],
      updatedAt: timestamp
    });
    return { canceled: false, image, images: [image], source };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? error.message : "Unable to cache web image." };
  }
}

function wallpaperImageBuffer(imageData: ArrayBuffer) {
  const buffer = Buffer.from(imageData);
  if (buffer.length < 16) throw new Error("Rendered wallpaper data is empty or corrupt.");
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error("Rendered wallpaper data is not a valid readable image.");
  const size = image.getSize();
  if (!size.width || !size.height) throw new Error("Rendered wallpaper has invalid dimensions.");
  image.toBitmap();
  return buffer;
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

async function writeRenderedWallpaper(imageData: ArrayBuffer, suggestedName: string) {
  const cacheDir = path.join(app.getPath("userData"), "Generated Wallpapers");
  await mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, safeWallpaperFileName(suggestedName));
  const extension = path.extname(filePath) || ".png";
  const temporaryPath = path.join(cacheDir, `${path.basename(filePath, extension)}.${crypto.randomUUID()}.writing${extension}`);
  const buffer = wallpaperImageBuffer(imageData);
  try {
    await writeFile(temporaryPath, buffer);
    await validateRenderedWallpaperImage(temporaryPath);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  const file = await validateRenderedWallpaperImage(filePath);
  return { cacheDir, filePath, file };
}

async function cleanupGeneratedWallpaperCache(cacheDir: string, currentFilePath: string) {
  const referenced = await wallpaperController.getReferencedWallpaperPaths?.({ currentDisplayId: currentPhysicalDisplayId() }).catch(() => [] as string[]) ?? [];
  return cleanupGeneratedWallpapers(cacheDir, 160, [currentFilePath, ...referenced]);
}

function wallpaperVaultDirectory() {
  return path.join(pinPaperPicturesRoot(), "Wallpaper Vault");
}

async function persistAppliedWallpaper(filePath: string) {
  const persisted = await persistWallpaperAsset(filePath, wallpaperVaultDirectory());
  await validateRenderedWallpaperImage(persisted.filePath);
  return persisted;
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
  const overlayTransitionsAllowed = process.platform === "win32" || (fadeOverlayTransitionsEnabled && process.platform === "darwin");
  if (!overlayTransitionsAllowed || options.enabled === false || reduceMotionEnabled() || !items.length) return undefined;
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
        backgroundColor: "#000000",
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
        }
      }
    };
  } catch (error) {
    for (const { window, diagnostic } of windows) {
      diagnostic.error = error instanceof Error ? error.message : String(error);
      if (!window.isDestroyed()) window.destroy();
    }
    return undefined;
  }
}

async function windowsWallpaperSetFiles(folderPath: string) {
  const directory = await readdir(folderPath, { withFileTypes: true });
  const files = directory
    .filter((entry) => entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(folderPath, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: "base" }));
  if (!files.length) throw new Error("No wallpaper images were found in the selected wallpaper pack folder.");
  return files;
}

async function applyWindowsWallpaperRotationFile(
  filePath: string,
  payload: Pick<WallpaperSetApplyPayload, "displayMode" | "transitionEnabled" | "transitionDurationMs"> = {},
  oldFilePath?: string
): Promise<WallpaperApplyResult> {
  if (process.platform !== "win32") throw new Error("Wallpaper pack rotation is only available on Windows.");
  const file = await validateRenderedWallpaperImage(filePath);
  const transition = await startFadeTransition([{ filePath, oldFilePath }], {
    enabled: payload.transitionEnabled ?? true,
    durationMs: payload.transitionDurationMs ?? 700,
    allDisplays: true
  });
  const transitionAnimation = transition?.begin();
  let diagnostics: WallpaperApplyDiagnostics;
  try {
    diagnostics = await wallpaperController.setWallpaper(filePath, {
      monitorMode: "span",
      displayMode: payload.displayMode,
      scope: "current-desktop",
      targetMode: "all-visible-monitors"
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
  diagnostics.fileSize = file.size;
  diagnostics.validImage = true;
  if (!diagnostics.changed) {
    throw Object.assign(new Error(diagnostics.lastError ?? "Windows did not confirm the desktop wallpaper changed."), { diagnostics });
  }
  return {
    ok: true,
    filePath,
    fileSize: file.size,
    appliedAt: new Date().toISOString(),
    platform: process.platform,
    diagnostics
  };
}

async function applyWindowsWallpaperSet(payload: WallpaperSetApplyPayload): Promise<WallpaperApplyResult> {
  if (process.platform !== "win32") {
    return { ok: false, error: "Wallpaper pack rotation is only available on Windows.", platform: process.platform };
  }
  const folderPath = payload.folderPath?.trim();
  if (!folderPath) return { ok: false, error: "No wallpaper pack folder was provided.", platform: process.platform };
  const files = await windowsWallpaperSetFiles(folderPath);
  const intervalSeconds = Math.max(5, Math.min(86_400, Math.round(payload.intervalSeconds || 60)));
  stopWindowsWallpaperRotation();
  const state: WindowsWallpaperRotationState = {
    folderPath,
    files,
    index: 0,
    intervalMs: intervalSeconds * 1000,
    displayMode: payload.displayMode,
    transitionEnabled: payload.transitionEnabled ?? true,
    transitionDurationMs: payload.transitionDurationMs ?? 700
  };
  windowsWallpaperRotationState = state;

  const applyNext = async () => {
    const currentState = windowsWallpaperRotationState;
    if (!currentState || currentState.folderPath !== folderPath) return undefined;
    const filePath = currentState.files[currentState.index % currentState.files.length];
    currentState.index = (currentState.index + 1) % currentState.files.length;
    const result = await applyWindowsWallpaperRotationFile(filePath, currentState, currentState.previousFilePath);
    currentState.previousFilePath = filePath;
    return result;
  };

  const firstResult = await applyNext();
  if (files.length > 1) {
    state.timer = setInterval(() => {
      void applyNext().catch((error) => {
        console.error("Windows wallpaper rotation step failed", error);
      });
    }, state.intervalMs);
  }
  return {
    ...(firstResult ?? { ok: true }),
    filePath: firstResult?.filePath ?? files[0],
    appliedAt: firstResult?.appliedAt ?? new Date().toISOString(),
    platform: process.platform,
    diagnostics: firstResult?.diagnostics
  };
}


function sendSourceImportProgress(event: Electron.IpcMainInvokeEvent, progress: SourceImportProgress) {
  if (!event.sender.isDestroyed()) event.sender.send("source:import-progress", progress);
}

function sourceImportItemLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

async function applyWallpaperFilePath(
  filePath: string,
  payload: Omit<WallpaperApplyFilePayload, "filePath"> = {}
): Promise<WallpaperApplyResult> {
  await validateRenderedWallpaperImage(filePath);
  const persisted = await persistAppliedWallpaper(filePath);
  const appliedFilePath = persisted.filePath;
  const generatedFile = persisted.file;
  const controller = wallpaperController;
  const currentDisplayId = currentPhysicalDisplayId();
  const knownTargets = await controller.getTargets?.({ currentDisplayId }).catch(() => []) ?? [];
  const targetMode = payload.targetMode
    ?? (payload.scope === "current-desktop" ? "current-desktop" : payload.monitorMode === "primary" ? "current-monitor" : "all-visible-monitors");
  const requestedTargets = payload.targetId
    ? knownTargets.filter((target) => target.id === payload.targetId || target.displayId === payload.targetId)
    : selectWallpaperTargets(knownTargets, targetMode, payload.monitorId);
  const fadeItems = requestedTargets.length
    ? requestedTargets.map((target) => ({ filePath: appliedFilePath, displayId: target.displayId, current: target.current, oldFilePath: target.currentPath }))
    : [{ filePath: appliedFilePath }];
  const transition = await startFadeTransition(fadeItems, {
    enabled: payload.transitionEnabled,
    durationMs: payload.transitionDurationMs,
    allDisplays: targetMode === "all-visible-monitors" || targetMode === "all-desktops-all-monitors"
  });
  const transitionAnimation = transition?.begin();
  let diagnostics: WallpaperApplyDiagnostics;
  try {
    diagnostics = await controller.setWallpaper(appliedFilePath, {
      monitorMode: payload.monitorMode,
      displayMode: payload.displayMode,
      scope: payload.scope,
      targetMode,
      allSpacesRefreshMode: payload.allSpacesRefreshMode,
      monitorId: payload.monitorId,
      targetId: payload.targetId,
      currentDisplayId
    });
    await transitionAnimation;
    diagnostics.transitionDiagnostics = transition?.diagnostics;
    await transition?.complete(diagnostics.changed);
  } catch (error) {
    await transitionAnimation;
    await transition?.complete(false);
    throw error;
  }
  diagnostics.renderedPath = appliedFilePath;
  diagnostics.fileSize = generatedFile.size;
  diagnostics.validImage = true;
  if (!diagnostics.changed) {
    const baseError = diagnostics.lastError ?? "The operating system did not confirm the desktop wallpaper changed.";
    const permissionHint = diagnostics.permissionStatus === "automation-denied"
      ? " Allow Pin Paper to control System Events in System Settings > Privacy & Security > Automation, then try Preview again."
      : "";
    throw Object.assign(new Error(`${baseError}${permissionHint}`), { diagnostics });
  }
  return {
    ok: true,
    filePath: appliedFilePath,
    fileSize: generatedFile.size,
    appliedAt: new Date().toISOString(),
    platform: process.platform,
    diagnostics
  };
}

ipcMain.handle("dialog:choose-folder", async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Choose Image Folder"
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const folderPath = result.filePaths[0];
  sendSourceImportProgress(event, {
    stage: "scanning",
    title: "Importing folder",
    message: `Scanning ${path.basename(folderPath)} and converting images if needed…`
  });
  const imported = await importValidatedLocalPaths([folderPath]);
  const source = imported.sources.find((item) => item.type === "local-folder");
  return {
    canceled: false,
    path: source?.path,
    name: source?.name,
    images: source?.images,
    source,
    summary: imported.summary,
    warnings: imported.warnings,
    error: imported.error
  };
});

ipcMain.handle("dialog:choose-image-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Choose Image",
    filters: [{ name: "Images", extensions: [...finderImageExtensions].map((ext) => ext.slice(1)) }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };

  const imported = await importValidatedLocalPaths(result.filePaths);
  return {
    canceled: false,
    image: imported.images[0],
    images: imported.images,
    source: imported.sources.find((item) => item.type === "local-file"),
    summary: imported.summary,
    warnings: imported.warnings,
    error: imported.error
  };
});

ipcMain.handle("dialog:choose-image-files", async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: "Choose Images",
    filters: [{ name: "Images", extensions: [...finderImageExtensions].map((ext) => ext.slice(1)) }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  sendSourceImportProgress(event, {
    stage: "scanning",
    title: "Importing images",
    message: `Reading ${sourceImportItemLabel(result.filePaths.length, "image")} and converting HEIC files if needed…`,
    total: result.filePaths.length
  });
  const imported = await importValidatedLocalPaths(result.filePaths);
  return {
    canceled: false,
    image: imported.images[0],
    images: imported.images,
    source: imported.sources.find((item) => item.type === "local-file"),
    summary: imported.summary,
    warnings: imported.warnings,
    error: imported.error
  };
});

ipcMain.handle("source:import-paths", async (event, paths: unknown): Promise<PathImportResult> => {
  const pathCount = Array.isArray(paths) ? paths.length : 0;
  sendSourceImportProgress(event, {
    stage: "scanning",
    title: "Importing dropped items",
    message: pathCount > 0 ? `Reading ${sourceImportItemLabel(pathCount, "item")} and converting images if needed…` : "Reading dropped items…",
    total: pathCount || undefined
  });
  return importValidatedLocalPaths(paths);
});

ipcMain.handle("source:import-web-image", async (_event, payload: unknown): Promise<ImageFileResult> => {
  return cacheWebImage(payload);
});

ipcMain.handle("source:rescan-folder", async (event, folderPath: unknown) => {
  const folderName = typeof folderPath === "string" ? path.basename(folderPath) : "folder";
  sendSourceImportProgress(event, {
    stage: "scanning",
    title: "Rescanning folder",
    message: `Scanning ${folderName} and converting images if needed…`
  });
  const imported = await importValidatedLocalPaths([folderPath]);
  const source = imported.sources.find((item) => item.type === "local-folder");
  if (!source) throw new Error(imported.error ?? "Unable to rescan folder.");
  return source;
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
    const result = mode === "import"
      ? await provider.import(normalizedRequest, sendProgress, controller.signal)
      : await provider.update(normalizedRequest, sendProgress, controller.signal);
    return result.source ? { ...result, source: enrichSourceImageDimensions(result.source) } : result;
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
      filters: [{ name: "Pin Paper Project", extensions: ["pwc.json", "json"] }]
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
    filters: [{ name: "Pin Paper Project", extensions: ["pwc.json", "json"] }]
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

ipcMain.handle("export-set:default-folder", async () => {
  const filePath = defaultWallpaperSetsRoot();
  await mkdir(filePath, { recursive: true });
  return { canceled: false, filePath };
});

ipcMain.handle("export-set:choose-folder", async () => {
  const defaultPath = defaultWallpaperSetsRoot();
  await mkdir(defaultPath, { recursive: true });
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose Wallpaper Sets Folder",
    defaultPath
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle("export-set:begin", async (_event, payload: WallpaperSetBeginPayload): Promise<WallpaperSetBeginResult> => {
  try {
    const rootPath = payload.rootPath?.trim() || defaultWallpaperSetsRoot();
    const variationCount = Math.min(500, Math.max(1, Math.round(payload.variationCount)));
    await mkdir(rootPath, { recursive: true });
    const createdAt = new Date().toISOString();
    const preferredFolderName = wallpaperSetFolderName(safeWallpaperSetName(payload.setName));
    const finalPath = await uniqueWallpaperSetPath(rootPath, preferredFolderName);
    const sessionId = crypto.randomUUID();
    const stagingPath = path.join(rootPath, `${wallpaperSetTemporaryPrefix}${sessionId}`);
    await mkdir(stagingPath, { recursive: false });
    const session: WallpaperSetSession = {
      id: sessionId,
      rootPath,
      stagingPath,
      finalPath,
      folderName: path.basename(finalPath),
      createdAt,
      projectName: payload.projectName,
      templateName: payload.templateName,
      format: payload.format,
      variationCount,
      canvasWidth: Math.max(1, Math.round(payload.canvasWidth)),
      canvasHeight: Math.max(1, Math.round(payload.canvasHeight)),
      files: []
    };
    wallpaperSetSessions.set(sessionId, session);
    return {
      ok: true,
      sessionId,
      rootPath,
      stagingPath,
      finalPath,
      folderName: session.folderName
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to prepare the wallpaper set folder." };
  }
});

ipcMain.handle("export-set:write-file", async (_event, payload: ExportSetFilePayload): Promise<ExportSetFileResult> => {
  const session = wallpaperSetSessions.get(payload.sessionId);
  if (!session) return { ok: false, error: "The wallpaper set export session is no longer available." };
  try {
    const extension = session.format === "png" ? ".png" : ".jpg";
    const baseName = path.basename(payload.fileName, path.extname(payload.fileName)).replace(/[^a-zA-Z0-9._-]+/g, "-") || "wallpaper";
    const safeName = `${baseName}${extension}`;
    const filePath = path.join(session.stagingPath, safeName);
    if (session.files.some((file) => file.fileName === safeName)) {
      return { ok: false, error: `Duplicate wallpaper filename: ${safeName}` };
    }
    const data = dataUrlToBuffer(payload.dataUrl);
    await writeFile(filePath, data, { flag: "wx" });
    session.files.push({ fileName: safeName, filePath, sizeBytes: data.byteLength });
    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to export variation." };
  }
});

ipcMain.handle("export-set:finalize", async (_event, payload: WallpaperSetFinalizePayload): Promise<WallpaperSetFinalizeResult> => {
  const session = wallpaperSetSessions.get(payload.sessionId);
  if (!session) return { ok: false, error: "The wallpaper set export session is no longer available." };
  try {
    if (session.files.length !== session.variationCount) {
      throw new Error(`Expected ${session.variationCount} wallpapers but generated ${session.files.length}. The incomplete set was not published.`);
    }
    const manifest = {
      kind: "pwc-macos-wallpaper-set",
      schemaVersion: 1,
      createdAt: session.createdAt,
      projectName: session.projectName,
      templateName: session.templateName,
      setName: session.folderName,
      variationCount: session.variationCount,
      format: session.format,
      canvas: { width: session.canvasWidth, height: session.canvasHeight },
      immutable: true,
      files: session.files.map((file, index) => ({
        index: index + 1,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes
      }))
    };
    await writeFile(path.join(session.stagingPath, wallpaperSetManifestFile), JSON.stringify(manifest, null, 2), "utf8");
    await rename(session.stagingPath, session.finalPath);
    wallpaperSetSessions.delete(session.id);
    const manifestPath = path.join(session.finalPath, wallpaperSetManifestFile);
    const firstFilePath = session.files[0]?.fileName ? path.join(session.finalPath, session.files[0].fileName) : undefined;
    return { ok: true, finalPath: session.finalPath, manifestPath, fileCount: session.files.length, firstFilePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to finalize the wallpaper set." };
  }
});

ipcMain.handle("export-set:abort", async (_event, sessionId: string) => {
  const session = wallpaperSetSessions.get(sessionId);
  if (!session) return true;
  wallpaperSetSessions.delete(sessionId);
  await rm(session.stagingPath, { recursive: true, force: true });
  return true;
});

ipcMain.handle("export-set:reveal", async (_event, folderPath: string) => {
  const error = await shell.openPath(folderPath);
  return { ok: !error, error: error || undefined };
});

ipcMain.handle("export-set:open-wallpaper-settings", async () => {
  if (process.platform !== "darwin") return { ok: false, error: "Wallpaper Settings is only available on macOS." };
  await shell.openExternal("x-apple.systempreferences:com.apple.Wallpaper-Settings.extension");
  return { ok: true };
});

ipcMain.handle("export-set:cleanup", async (_event, requestedRootPath?: string): Promise<WallpaperSetCleanupResult> => {
  try {
    const rootPath = safeWallpaperSetEraseRoot(requestedRootPath);
    await mkdir(rootPath, { recursive: true });
    const entries = await listWallpaperSetRootEntries(rootPath);
    if (entries.length === 0) {
      return {
        ok: true,
        rootPath,
        deletedEntryCount: 0,
        deletedDirectoryCount: 0,
        deletedFileCount: 0,
        freedBytes: 0
      };
    }
    const totalBytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0);
    const directoryCount = entries.filter((entry) => entry.kind === "directory").length;
    const fileCount = entries.length - directoryCount;
    const response = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      buttons: ["Cancel", "Clean Up Folder"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: "Clean Up Wallpaper Sets Folder",
      message: "Clean up old generated wallpaper set folders?",
      detail: `This permanently deletes all ${entries.length} top-level item${entries.length === 1 ? "" : "s"}, including every subfolder and every file stored inside them. ${directoryCount} folder${directoryCount === 1 ? "" : "s"} and ${fileCount} file${fileCount === 1 ? "" : "s"} will be removed, freeing about ${formatBytes(totalBytes)}.\n\nFolder:\n${rootPath}\n\nThe Wallpaper Sets folder itself will remain. This cannot be undone. Make sure macOS is not currently using one of these folders before continuing.`
    });
    if (response.response !== 1) return { ok: true, canceled: true, rootPath };
    const summary = await eraseWallpaperSetRootContents(rootPath);
    return { ok: true, rootPath, ...summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to delete wallpaper sets." };
  }
});


ipcMain.handle("overlay:import", async (): Promise<ImageFileResult> => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Import Transparent Overlay Image",
    filters: [{ name: "Overlay Images", extensions: [...finderImageExtensions].map((ext) => ext.slice(1)) }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  try {
    const sourcePath = result.filePaths[0];
    if (!(await canDecodeImportedImage(sourcePath))) return { canceled: false, error: "The selected overlay image could not be decoded." };
    const overlaysDir = path.join(app.getPath("userData"), "Overlay Images");
    await mkdir(overlaysDir, { recursive: true });
    const extension = path.extname(sourcePath).toLowerCase() || ".png";
    const id = `overlay-${crypto.randomUUID()}`;
    const destinationPath = path.join(overlaysDir, `${id}${extension}`);
    await copyFile(sourcePath, destinationPath);
    const fileStat = await stat(destinationPath);
    const timestamp = new Date().toISOString();
    let image: LocalImageRef = {
      id: `local-image-${id}`,
      name: path.basename(sourcePath),
      path: destinationPath,
      url: pathToFileURL(destinationPath).toString(),
      modifiedAt: fileStat.mtime.toISOString(),
      size: fileStat.size,
      mediaType: "image" as const
    };
    image = await makeLocalImageRenderable(image);
    const source = {
      id: `source-${id}`,
      identityKey: `managed-overlay:${id}`,
      providerId: "local-file" as const,
      type: "local-file" as const,
      name: `Overlay · ${path.basename(sourcePath, path.extname(sourcePath))}`,
      path: image.path,
      images: [image],
      mediaPolicy: "images-and-video-thumbnails" as const,
      mediaCounts: { total: 1, images: 1, videos: 0 },
      importStatus: "ready" as const,
      importLog: [`Imported managed overlay asset from ${sourcePath}.`],
      updatedAt: timestamp
    };
    return { canceled: false, image, images: [image], source };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? error.message : "Unable to import overlay image." };
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
    const renderablePath = await isHeicLikeLocalImage(destinationPath) ? await convertHeicLocalImageToPng(destinationPath) : destinationPath;
    return {
      canceled: false,
      texture: {
        id,
        name: path.basename(sourcePath, path.extname(sourcePath)),
        path: renderablePath,
        url: pathToFileURL(renderablePath).toString(),
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

ipcMain.handle("wallpaper:generate", async (_event, payload: WallpaperGeneratePayload): Promise<WallpaperGenerateResult> => {
  try {
    const { cacheDir, filePath, file } = await writeRenderedWallpaper(payload.imageData, payload.suggestedName);
    void cleanupGeneratedWallpaperCache(cacheDir, filePath).catch((error) => {
      console.warn("Generated wallpaper cleanup failed", error);
    });
    return {
      ok: true,
      filePath,
      fileSize: file.size,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error("Wallpaper generation failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate the wallpaper file."
    };
  }
});

ipcMain.handle("wallpaper:apply", async (_event, payload: WallpaperApplyPayload): Promise<WallpaperApplyResult> => {
  try {
    const { cacheDir, filePath } = await writeRenderedWallpaper(payload.imageData, payload.suggestedName);
    const result = await applyWallpaperFilePath(filePath, payload);
    void cleanupGeneratedWallpaperCache(cacheDir, filePath).catch((error) => {
      console.warn("Generated wallpaper cleanup failed", error);
    });
    return result;
  } catch (error) {
    console.error("Wallpaper apply failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to set wallpaper.",
      platform: process.platform,
      diagnostics: diagnosticsFromError(error)
    };
  }
});

ipcMain.handle("wallpaper:apply-file", async (_event, payload: WallpaperApplyFilePayload): Promise<WallpaperApplyResult> => {
  try {
    return await applyWallpaperFilePath(payload.filePath, payload);
  } catch (error) {
    console.error("Wallpaper file apply failed", error);
    return {
      ok: false,
      filePath: payload.filePath,
      error: error instanceof Error ? error.message : "Unable to set wallpaper.",
      platform: process.platform,
      diagnostics: diagnosticsFromError(error)
    };
  }
});

ipcMain.handle("wallpaper:apply-set", async (_event, payload: WallpaperSetApplyPayload): Promise<WallpaperApplyResult> => {
  try {
    return await applyWindowsWallpaperSet(payload);
  } catch (error) {
    console.error("Wallpaper set apply failed", error);
    return {
      ok: false,
      filePath: payload.folderPath,
      error: error instanceof Error ? error.message : "Unable to start wallpaper rotation.",
      platform: process.platform,
      diagnostics: diagnosticsFromError(error)
    };
  }
});

ipcMain.handle("wallpaper:targets", async () => {
  const controller = wallpaperController;
  const currentDisplayId = currentPhysicalDisplayId();
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
  return controller.getTargets({ currentDisplayId });
});

ipcMain.handle("wallpaper:macos-diagnostic", async () => {
  if (!wallpaperController.getMacOSDiagnostic) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      activeSpaceUUIDs: [],
      displays: [],
      totalSpaceCount: 0,
      sharedSpaceCount: 0,
      sharedSpaceUUIDs: [],
      wallpaperAgentRunning: false,
      dockRunning: false,
      store: { path: "", exists: false, readable: false, writable: false, schema: "missing", compatible: false, topLevelKeys: [], displayRecordCount: 0, spaceRecordCount: 0, desktopRecordCount: 0, displayKeys: [], spaceDisplayUUIDs: {}, references: [] },
      legacyDatabase: { path: "", exists: false, readable: false, writable: false, compatible: false, tables: [], pictureRecordCount: 0, targetRecordCount: 0, references: [] },
      recommendedStrategy: "unsupported",
      warnings: [],
      errors: ["macOS wallpaper diagnostics are unavailable on this platform."]
    };
  }
  return wallpaperController.getMacOSDiagnostic({ currentDisplayId: currentPhysicalDisplayId() });
});

ipcMain.handle("wallpaper:apply-targets", async (_event, payload: WallpaperApplyTargetsPayload) => {
  const cacheDir = path.join(app.getPath("userData"), "Generated Wallpapers");
  const writtenItems: Array<{ targetId: string; targetLabel: string; displayId?: string; current?: boolean; filePath: string; fileSize: number }> = [];
  const earlyFailures: WallpaperTargetResult[] = [];

  for (const item of payload.items) {
    try {
      const written = await writeRenderedWallpaper(item.imageData, item.suggestedName);
      const persisted = await persistAppliedWallpaper(written.filePath);
      writtenItems.push({
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        displayId: item.displayId,
        current: item.current,
        filePath: persisted.filePath,
        fileSize: persisted.file.size
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

  const controller = wallpaperController;
  const currentDisplayId = currentPhysicalDisplayId();
  const knownTargets = await controller.getTargets?.({ currentDisplayId }).catch(() => []) ?? [];
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
      allDisplays: payload.targetMode === "all-visible-monitors" || payload.targetMode === "all-desktops-all-monitors"
    }
  );
  const transitionAnimation = transition?.begin();
  let appliedResults: WallpaperTargetResult[] = [];
  try {
    if (writtenItems.length && controller.setWallpapers) {
      appliedResults = await controller.setWallpapers(writtenItems, {
        displayMode: payload.displayMode,
        scope: payload.scope ?? "different-per-desktop",
        targetMode: payload.targetMode,
        allSpacesRefreshMode: payload.allSpacesRefreshMode,
        monitorId: payload.monitorId,
        currentDisplayId
      });
    } else {
      for (const item of writtenItems) {
        try {
          const diagnostics = await controller.setWallpaper(item.filePath, {
            displayMode: payload.displayMode,
            scope: payload.scope ?? "different-per-desktop",
            targetMode: payload.targetMode,
            allSpacesRefreshMode: payload.allSpacesRefreshMode,
            monitorId: payload.monitorId,
            targetId: item.targetId,
            currentDisplayId
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
    const appliedTargetCount = targetResults.filter((result) => result.ok).length;
    const partial = appliedTargetCount > 0 && !ok;
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
        partial,
        targetMode: payload.targetMode,
        requestedTargetCount: payload.items.length,
        appliedTargetCount,
        targetResults,
        lastError
      },
      targets: targetResults
    };
  } catch (error) {
    await transitionAnimation;
    await transition?.complete(false);
    throw error;
  }
});

ipcMain.handle("tray:set-state", (_event, state: TrayRuntimeState) => {
  trayRuntimeState = state;
  if (!state.enabled || state.paused) wallpaperController.stopSpaceObserver?.();
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

app.whenReady().then(async () => {
  installStrictMediaPermissionPolicy(session.defaultSession as unknown as import("./media-permissions.js").PermissionPolicySession);
  registerLocalFileProtocol();
  createWindow();
  createTray();

  app.on("activate", () => {
    showWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep the tray available for quick previews; use tray/menu-bar Quit to exit.
});

app.on("before-quit", () => {
  isQuitting = true;
  wallpaperController.dispose?.();
});

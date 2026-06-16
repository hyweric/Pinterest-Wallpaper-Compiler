import { createHash, randomUUID } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ImageSource, LocalImageRef, LocalImportSummary, PathImportResult } from "../shared/types.js";

export const finderImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);

export type LocalSourceImportOptions = {
  includeSubfolders?: boolean;
  validateImage?: (filePath: string) => boolean | Promise<boolean>;
  now?: () => Date;
  createSourceId?: () => string;
  maxPaths?: number;
};

type ScanState = {
  summary: LocalImportSummary;
  seenFiles: Set<string>;
};

function platformPathKey(filePath: string) {
  const normalized = path.normalize(filePath).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function stableImageId(filePath: string) {
  return `local-image-${createHash("sha256").update(platformPathKey(filePath)).digest("hex").slice(0, 24)}`;
}

function localFolderIdentity(folderPath: string) {
  return `local-folder:${platformPathKey(folderPath)}`;
}

function localFileIdentity(images: LocalImageRef[]) {
  return `local-file:${images.map((image) => platformPathKey(image.path)).sort().join("|")}`;
}

function isHiddenName(name: string) {
  return name.startsWith(".") || name === ".DS_Store";
}

async function readableImage(filePath: string, validateImage?: LocalSourceImportOptions["validateImage"]) {
  if (!validateImage) return true;
  try {
    return Boolean(await validateImage(filePath));
  } catch {
    return false;
  }
}

async function imageFromCanonicalPath(filePath: string, validateImage?: LocalSourceImportOptions["validateImage"]): Promise<LocalImageRef | undefined> {
  const extension = path.extname(filePath).toLowerCase();
  if (!finderImageExtensions.has(extension)) return undefined;
  if (!(await readableImage(filePath, validateImage))) return undefined;
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return undefined;
  return {
    id: stableImageId(filePath),
    name: path.basename(filePath),
    path: filePath,
    url: pathToFileURL(filePath).toString(),
    modifiedAt: fileStat.mtime.toISOString(),
    size: fileStat.size,
    mediaType: "image"
  };
}

async function scanFolder(
  folderPath: string,
  includeSubfolders: boolean,
  validateImage: LocalSourceImportOptions["validateImage"],
  state: ScanState
): Promise<LocalImageRef[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const images: LocalImageRef[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (isHiddenName(entry.name)) continue;
    const unresolvedPath = path.join(folderPath, entry.name);
    let canonicalPath: string;
    let itemStat;
    try {
      canonicalPath = await realpath(unresolvedPath);
      itemStat = await stat(canonicalPath);
    } catch {
      state.summary.skippedMissingCount += 1;
      continue;
    }

    if (itemStat.isDirectory()) {
      if (includeSubfolders) images.push(...(await scanFolder(canonicalPath, true, validateImage, state)));
      continue;
    }
    if (!itemStat.isFile()) continue;

    const extension = path.extname(canonicalPath).toLowerCase();
    if (!finderImageExtensions.has(extension)) {
      state.summary.skippedUnsupportedCount += 1;
      continue;
    }
    const fileKey = platformPathKey(canonicalPath);
    if (state.seenFiles.has(fileKey)) {
      state.summary.duplicatePathCount += 1;
      continue;
    }
    const image = await imageFromCanonicalPath(canonicalPath, validateImage);
    if (!image) {
      state.summary.skippedUnreadableCount += 1;
      continue;
    }
    state.seenFiles.add(fileKey);
    images.push(image);
  }

  return images.sort((a, b) => a.name.localeCompare(b.name));
}

function folderSource(folderPath: string, images: LocalImageRef[], now: Date, createSourceId: () => string): ImageSource {
  const timestamp = now.toISOString();
  return {
    id: createSourceId(),
    identityKey: localFolderIdentity(folderPath),
    providerId: "local-folder",
    type: "local-folder",
    name: path.basename(folderPath),
    path: folderPath,
    images,
    includeSubfolders: false,
    mediaPolicy: "images-only",
    mediaCounts: { total: images.length, images: images.length, videos: 0 },
    importStatus: "ready",
    importLog: [`Scanned ${images.length} supported images from ${folderPath}.`],
    lastScannedAt: timestamp,
    updatedAt: timestamp
  };
}

function looseFileSource(images: LocalImageRef[], now: Date, createSourceId: () => string): ImageSource {
  const timestamp = now.toISOString();
  return {
    id: createSourceId(),
    identityKey: localFileIdentity(images),
    providerId: "local-file",
    type: "local-file",
    name: images.length === 1 ? images[0].name : `${images.length} local images`,
    images,
    mediaPolicy: "images-only",
    mediaCounts: { total: images.length, images: images.length, videos: 0 },
    importStatus: "ready",
    importLog: [`Imported ${images.length} local image file${images.length === 1 ? "" : "s"}.`],
    updatedAt: timestamp
  };
}

export async function importLocalPaths(rawPaths: unknown, options: LocalSourceImportOptions = {}): Promise<PathImportResult> {
  const maxPaths = Math.max(1, Math.min(10_000, options.maxPaths ?? 2_000));
  const input = Array.isArray(rawPaths) ? rawPaths.slice(0, maxPaths) : [];
  const summary: LocalImportSummary = {
    requestedPathCount: input.length,
    importedFolderCount: 0,
    importedLooseImageCount: 0,
    discoveredImageCount: 0,
    skippedUnsupportedCount: 0,
    skippedUnreadableCount: 0,
    skippedMissingCount: 0,
    duplicatePathCount: Math.max(0, Array.isArray(rawPaths) ? rawPaths.length - input.length : 0),
    emptyFolders: []
  };
  const state: ScanState = { summary, seenFiles: new Set() };
  const sources: ImageSource[] = [];
  const looseImages: LocalImageRef[] = [];
  const seenTopLevel = new Set<string>();
  const now = options.now?.() ?? new Date();
  const createSourceId = options.createSourceId ?? (() => `source-${randomUUID()}`);

  for (const rawPath of input) {
    if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > 32_768 || rawPath.includes("\0")) {
      summary.skippedUnsupportedCount += 1;
      continue;
    }

    let canonicalPath: string;
    let itemStat;
    try {
      canonicalPath = await realpath(rawPath);
      itemStat = await stat(canonicalPath);
    } catch {
      summary.skippedMissingCount += 1;
      continue;
    }

    const topLevelKey = platformPathKey(canonicalPath);
    if (seenTopLevel.has(topLevelKey)) {
      summary.duplicatePathCount += 1;
      continue;
    }
    seenTopLevel.add(topLevelKey);

    if (itemStat.isDirectory()) {
      const images = await scanFolder(canonicalPath, Boolean(options.includeSubfolders), options.validateImage, state);
      if (images.length === 0) {
        summary.emptyFolders.push(canonicalPath);
        continue;
      }
      sources.push(folderSource(canonicalPath, images, now, createSourceId));
      summary.importedFolderCount += 1;
      summary.discoveredImageCount += images.length;
      continue;
    }

    if (!itemStat.isFile()) {
      summary.skippedUnsupportedCount += 1;
      continue;
    }
    const extension = path.extname(canonicalPath).toLowerCase();
    if (!finderImageExtensions.has(extension)) {
      summary.skippedUnsupportedCount += 1;
      continue;
    }
    const fileKey = platformPathKey(canonicalPath);
    if (state.seenFiles.has(fileKey)) {
      summary.duplicatePathCount += 1;
      continue;
    }
    const image = await imageFromCanonicalPath(canonicalPath, options.validateImage);
    if (!image) {
      summary.skippedUnreadableCount += 1;
      continue;
    }
    state.seenFiles.add(fileKey);
    looseImages.push(image);
    summary.importedLooseImageCount += 1;
    summary.discoveredImageCount += 1;
  }

  if (looseImages.length > 0) sources.push(looseFileSource(looseImages, now, createSourceId));

  const skippedCount = summary.skippedUnsupportedCount + summary.skippedUnreadableCount + summary.skippedMissingCount;
  const warnings: string[] = [];
  if (skippedCount > 0) warnings.push(`${skippedCount} unsupported, unreadable, or missing item${skippedCount === 1 ? " was" : "s were"} skipped.`);
  if (summary.emptyFolders.length > 0) warnings.push(`${summary.emptyFolders.length} folder${summary.emptyFolders.length === 1 ? "" : "s"} contained no supported readable images.`);

  if (sources.length === 0) {
    return {
      sources: [],
      images: [],
      summary,
      warnings,
      error: summary.emptyFolders.length > 0
        ? "No supported images were found in the selected folder."
        : "No supported readable image or folder items were found."
    };
  }

  return { sources, images: looseImages, summary, warnings };
}

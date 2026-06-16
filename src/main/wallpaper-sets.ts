import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export const wallpaperSetManifestFile = "wallpaper-set.json";
export const wallpaperSetTemporaryPrefix = ".pwc-wallpaper-set-";

export interface ManagedWallpaperSet {
  folderPath: string;
  folderName: string;
  createdAt: string;
  sizeBytes: number;
  variationCount: number;
}

export interface WallpaperSetCleanupSummary {
  deletedSetCount: number;
  deletedTemporaryCount: number;
  freedBytes: number;
  keptSetCount: number;
}

export interface WallpaperSetRootEraseSummary {
  deletedEntryCount: number;
  deletedDirectoryCount: number;
  deletedFileCount: number;
  freedBytes: number;
}

export interface WallpaperSetRootEntry {
  entryPath: string;
  entryName: string;
  kind: "directory" | "file" | "other";
  sizeBytes: number;
}

export function safeWallpaperSetName(value: string, fallback = "Wallpaper Set") {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

export function wallpaperSetTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function wallpaperSetFolderName(name: string, date = new Date()) {
  return `${safeWallpaperSetName(name)} - ${wallpaperSetTimestamp(date)}`;
}

export async function uniqueWallpaperSetPath(rootPath: string, preferredFolderName: string) {
  await mkdir(rootPath, { recursive: true });
  let suffix = 1;
  while (true) {
    const folderName = suffix === 1 ? preferredFolderName : `${preferredFolderName} (${suffix})`;
    const candidate = path.join(rootPath, folderName);
    try {
      await stat(candidate);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

async function directorySize(folderPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

export async function listManagedWallpaperSets(rootPath: string): Promise<ManagedWallpaperSet[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const sets: ManagedWallpaperSet[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(wallpaperSetTemporaryPrefix)) continue;
    const folderPath = path.join(rootPath, entry.name);
    try {
      const manifest = JSON.parse(await readFile(path.join(folderPath, wallpaperSetManifestFile), "utf8")) as {
        kind?: string;
        createdAt?: string;
        variationCount?: number;
      };
      if (manifest.kind !== "pwc-macos-wallpaper-set" || !manifest.createdAt) continue;
      sets.push({
        folderPath,
        folderName: entry.name,
        createdAt: manifest.createdAt,
        variationCount: Math.max(0, Number(manifest.variationCount) || 0),
        sizeBytes: await directorySize(folderPath)
      });
    } catch {
      // Never treat a folder without a valid app manifest as managed content.
    }
  }
  return sets.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function listStaleTemporaryWallpaperSets(rootPath: string, olderThanMs = 24 * 60 * 60 * 1000) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [] as Array<{ folderPath: string; sizeBytes: number }>;
  }
  const cutoff = Date.now() - olderThanMs;
  const temporary: Array<{ folderPath: string; sizeBytes: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(wallpaperSetTemporaryPrefix)) continue;
    const folderPath = path.join(rootPath, entry.name);
    try {
      const info = await stat(folderPath);
      if (info.mtimeMs > cutoff) continue;
      temporary.push({ folderPath, sizeBytes: await directorySize(folderPath) });
    } catch {
      // Ignore entries that disappeared during inspection.
    }
  }
  return temporary;
}

export async function cleanupManagedWallpaperSets(rootPath: string, keepNewest = 5): Promise<WallpaperSetCleanupSummary> {
  const sets = await listManagedWallpaperSets(rootPath);
  const staleTemporary = await listStaleTemporaryWallpaperSets(rootPath);
  const removable = sets.slice(Math.max(0, keepNewest));
  let freedBytes = 0;
  for (const set of removable) {
    await rm(set.folderPath, { recursive: true, force: true });
    freedBytes += set.sizeBytes;
  }
  for (const temporary of staleTemporary) {
    await rm(temporary.folderPath, { recursive: true, force: true });
    freedBytes += temporary.sizeBytes;
  }
  return {
    deletedSetCount: removable.length,
    deletedTemporaryCount: staleTemporary.length,
    freedBytes,
    keptSetCount: Math.min(sets.length, Math.max(0, keepNewest))
  };
}

export async function listWallpaperSetRootEntries(rootPath: string): Promise<WallpaperSetRootEntry[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const inspected: WallpaperSetRootEntry[] = [];
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    let sizeBytes = 0;
    try {
      if (entry.isDirectory()) sizeBytes = await directorySize(entryPath);
      else if (entry.isFile()) sizeBytes = (await stat(entryPath)).size;
    } catch {
      // The item can still be removed even if its size cannot be measured.
    }
    inspected.push({
      entryPath,
      entryName: entry.name,
      kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      sizeBytes
    });
  }
  return inspected;
}

export async function eraseWallpaperSetRootContents(rootPath: string): Promise<WallpaperSetRootEraseSummary> {
  await mkdir(rootPath, { recursive: true });
  const entries = await listWallpaperSetRootEntries(rootPath);
  let freedBytes = 0;
  let deletedDirectoryCount = 0;
  let deletedFileCount = 0;
  for (const entry of entries) {
    await rm(entry.entryPath, { recursive: true, force: true });
    freedBytes += entry.sizeBytes;
    if (entry.kind === "directory") deletedDirectoryCount += 1;
    else deletedFileCount += 1;
  }
  return {
    deletedEntryCount: entries.length,
    deletedDirectoryCount,
    deletedFileCount,
    freedBytes
  };
}


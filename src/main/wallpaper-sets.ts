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

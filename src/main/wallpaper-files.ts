import { access, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export async function validateWallpaperFile(filePath: string) {
  await access(filePath, constants.R_OK);
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0) throw new Error("Generated wallpaper file is missing or empty.");
  return info;
}

export function safeWallpaperFileName(suggestedName: string) {
  const requested = path.basename(suggestedName || "wallpaper.png");
  const extension = path.extname(requested) || ".png";
  const stem = path.basename(requested, path.extname(requested))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "wallpaper";
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${stem}-${nonce}${extension.toLowerCase()}`;
}

export async function persistWallpaperAsset(filePath: string, vaultDirectory: string) {
  const sourceInfo = await validateWallpaperFile(filePath);
  await mkdir(vaultDirectory, { recursive: true });
  const source = path.resolve(filePath);
  const destination = path.resolve(vaultDirectory, path.basename(filePath));
  if (source === destination) return { filePath: destination, file: sourceInfo };

  try {
    const existing = await validateWallpaperFile(destination);
    if (existing.size === sourceInfo.size) return { filePath: destination, file: existing };
  } catch {
    // Copy below when the destination does not exist or is invalid.
  }

  const extension = path.extname(destination);
  const temporaryPath = path.join(
    vaultDirectory,
    `${path.basename(destination, extension)}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.writing${extension}`
  );
  try {
    await copyFile(source, temporaryPath);
    await validateWallpaperFile(temporaryPath);
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { filePath: destination, file: await validateWallpaperFile(destination) };
}

export async function cleanupGeneratedWallpapers(directory: string, keep = 40, preservePaths: string[] = []) {
  const names = await readdir(directory).catch(() => [] as string[]);
  const files = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(directory, name);
      try {
        const info = await stat(filePath);
        return info.isFile() ? { filePath, modifiedAt: info.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    })
  );
  const preserved = new Set(preservePaths.map((filePath) => path.resolve(filePath)));
  const sorted = files.filter((item): item is { filePath: string; modifiedAt: number } => Boolean(item)).sort((a, b) => b.modifiedAt - a.modifiedAt);
  const disposable = sorted.filter((item) => !preserved.has(path.resolve(item.filePath)));
  const keptNonPreserved = Math.max(0, keep - preserved.size);
  const removed: string[] = [];
  for (const item of disposable.slice(keptNonPreserved)) {
    await rm(item.filePath, { force: true });
    removed.push(item.filePath);
  }
  return removed;
}

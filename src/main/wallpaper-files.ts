import { access, readdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export async function validateWallpaperFile(filePath: string) {
  await access(filePath, constants.R_OK);
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0) throw new Error("Generated wallpaper file is missing or empty.");
  return info;
}

export function safeWallpaperFileName(suggestedName: string) {
  const base = path.basename(suggestedName || `wallpaper-${Date.now()}.png`);
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-") || `wallpaper-${Date.now()}.png`;
}

export async function cleanupGeneratedWallpapers(directory: string, keep = 40) {
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
  const sorted = files.filter((item): item is { filePath: string; modifiedAt: number } => Boolean(item)).sort((a, b) => b.modifiedAt - a.modifiedAt);
  const removed: string[] = [];
  for (const item of sorted.slice(Math.max(0, keep))) {
    await rm(item.filePath, { force: true });
    removed.push(item.filePath);
  }
  return removed;
}

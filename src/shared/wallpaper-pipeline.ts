import type { WallpaperApplyResult, WallpaperGenerateResult, WallpaperRuntimeStatus } from "./types.js";

export type WallpaperPipelineStatus = Extract<
  WallpaperRuntimeStatus,
  "generating" | "rendering" | "saving" | "generated" | "applying" | "verifying" | "applied"
>;

export interface WallpaperPipelineTimeouts {
  renderMs?: number;
  persistMs?: number;
  applyMs?: number;
}

export interface GenerateWallpaperFileOptions<TImageData> {
  render: () => Promise<TImageData>;
  persist: (imageData: TImageData) => Promise<WallpaperGenerateResult>;
  onStatus?: (status: WallpaperPipelineStatus) => void;
  timeouts?: WallpaperPipelineTimeouts;
}

export interface ApplyWallpaperFileOptions {
  filePath: string;
  apply: (filePath: string) => Promise<WallpaperApplyResult>;
  onStatus?: (status: WallpaperPipelineStatus) => void;
  timeouts?: WallpaperPipelineTimeouts;
}

export interface GenerateAndApplyWallpaperOptions<TImageData> extends GenerateWallpaperFileOptions<TImageData> {
  apply: (filePath: string) => Promise<WallpaperApplyResult>;
}

const defaultRenderTimeoutMs = 60_000;
const defaultPersistTimeoutMs = 30_000;
const defaultApplyTimeoutMs = 45_000;

function resultError(message: string | undefined, fallback: string) {
  return new Error(message?.trim() || fallback);
}

export function withWallpaperTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function generateWallpaperFile<TImageData>(options: GenerateWallpaperFileOptions<TImageData>) {
  options.onStatus?.("generating");
  options.onStatus?.("rendering");
  const imageData = await withWallpaperTimeout(
    options.render(),
    options.timeouts?.renderMs ?? defaultRenderTimeoutMs,
    "Wallpaper rendering timed out. One of the selected images or textures may be unreadable."
  );

  options.onStatus?.("saving");
  const result = await withWallpaperTimeout(
    options.persist(imageData),
    options.timeouts?.persistMs ?? defaultPersistTimeoutMs,
    "Saving the generated wallpaper timed out. Check disk space and app-data permissions."
  );
  if (!result.ok || !result.filePath) {
    throw resultError(result.error, "Unable to generate the wallpaper file.");
  }
  options.onStatus?.("generated");
  return { ...result, imageData, filePath: result.filePath };
}

export async function applyGeneratedWallpaperFile(options: ApplyWallpaperFileOptions) {
  options.onStatus?.("applying");
  const result = await withWallpaperTimeout(
    options.apply(options.filePath),
    options.timeouts?.applyMs ?? defaultApplyTimeoutMs,
    "Applying the wallpaper timed out. macOS may be waiting for wallpaper or Automation permission."
  );
  options.onStatus?.("verifying");
  if (!result.ok || !result.filePath) {
    throw resultError(result.error, "The operating system did not apply the wallpaper.");
  }
  options.onStatus?.("applied");
  return { ...result, filePath: result.filePath };
}

export async function generateAndApplyWallpaper<TImageData>(options: GenerateAndApplyWallpaperOptions<TImageData>) {
  const generated = await generateWallpaperFile(options);
  const applied = await applyGeneratedWallpaperFile({
    filePath: generated.filePath,
    apply: options.apply,
    onStatus: options.onStatus,
    timeouts: options.timeouts
  });
  return { generated, applied };
}

import type { ImageSource, LocalImageRef, MediaType } from "./types.js";

export const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);
export const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

export function classifyLocalMediaPath(filePath: string): MediaType {
  const cleanPath = filePath.split(/[?#]/, 1)[0] ?? filePath;
  const dot = cleanPath.lastIndexOf(".");
  const extension = dot >= 0 ? cleanPath.slice(dot).toLowerCase() : "";
  if (videoExtensions.has(extension)) return "video";
  if (imageExtensions.has(extension)) return "image";
  return "unknown";
}

export function mediaCounts(images: LocalImageRef[]): NonNullable<ImageSource["mediaCounts"]> {
  const videos = images.filter((image) => image.mediaType === "video").length;
  const unknown = images.filter((image) => image.mediaType === "unknown").length;
  return {
    total: images.length,
    images: images.filter((image) => image.mediaType === "image").length,
    videos,
    unknown
  };
}

export function sourceImagesForMediaPolicy(source: ImageSource) {
  const policy = source.mediaPolicy ?? "images-only";
  return source.images.filter((image) => {
    if (image.mediaType === "image") return true;
    if (policy === "images-and-video-thumbnails") return image.mediaType === "video" && image.videoThumbnail !== false;
    return false;
  });
}

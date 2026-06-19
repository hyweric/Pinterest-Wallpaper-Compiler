import type { ImageSource, LocalImageRef } from "./types";

const transparentImageExtensions = new Set([".png", ".webp", ".gif", ".avif"]);

function extensionFromPathLike(value?: string) {
  if (!value) return "";
  let candidate = value;
  try {
    const parsed = new URL(value);
    candidate = parsed.pathname;
  } catch {
    // Plain paths and file names are handled below.
  }
  const clean = decodeURIComponent(candidate.split(/[?#]/)[0] ?? candidate).toLowerCase();
  const match = clean.match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

export function imageMayContainTransparency(image?: Pick<LocalImageRef, "name" | "path" | "url" | "mediaType">) {
  if (!image || image.mediaType === "video") return false;
  return [image.path, image.url, image.name].some((value) => transparentImageExtensions.has(extensionFromPathLike(value)));
}

export function sourceIsManagedOverlay(source?: Pick<ImageSource, "identityKey" | "providerId" | "type">) {
  return Boolean(source?.identityKey?.startsWith("managed-overlay:"));
}

export function sourceLooksLikeTransparentOverlay(source?: Pick<ImageSource, "identityKey" | "providerId" | "type" | "images">) {
  if (!source) return false;
  if (sourceIsManagedOverlay(source)) return true;
  return source.images.some((image) => imageMayContainTransparency(image));
}

export function imageBackgroundColor(baseColor: string | undefined, image?: Pick<LocalImageRef, "name" | "path" | "url" | "mediaType">) {
  return imageMayContainTransparency(image) ? "transparent" : (baseColor || "transparent");
}

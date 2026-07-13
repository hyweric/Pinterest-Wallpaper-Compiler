export const supportedImageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"] as const;

export const supportedImageExtensionSet = new Set<string>(supportedImageExtensions);

export const supportedImageFilePickerExtensions = supportedImageExtensions.map((extension) => extension.slice(1));

export const supportedImageAccept = supportedImageExtensions.join(",");

export const supportedImageExtensionLabel = supportedImageExtensions.join(", ");

export function normalizedImageExtension(fileNameOrPath: string) {
  const clean = String(fileNameOrPath || "").split(/[?#]/)[0] ?? "";
  const slashIndex = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const name = clean.slice(slashIndex + 1);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : "";
}

export function isSupportedImageExtension(extension: string) {
  const normalized = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return supportedImageExtensionSet.has(normalized);
}

export function isSupportedImageFileName(fileNameOrPath: string) {
  const extension = normalizedImageExtension(fileNameOrPath);
  return Boolean(extension) && isSupportedImageExtension(extension);
}

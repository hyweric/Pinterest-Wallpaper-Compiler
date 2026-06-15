export const localFileProtocolScheme = "pwc-file";
export const localFileProtocolHost = "local";

export function renderableLocalFileUrl(src: string) {
  try {
    const url = new URL(src);
    if (url.protocol !== "file:") return src;
    return `${localFileProtocolScheme}://${localFileProtocolHost}${url.pathname}`;
  } catch {
    return src;
  }
}

export function isRenderableLocalFileUrl(src: string) {
  try {
    const url = new URL(src);
    return url.protocol === `${localFileProtocolScheme}:` && url.hostname === localFileProtocolHost;
  } catch {
    return false;
  }
}

export function pathFromRenderableLocalFileUrl(src: string, platform = "") {
  const url = new URL(src);
  if (url.protocol !== `${localFileProtocolScheme}:` || url.hostname !== localFileProtocolHost) {
    throw new Error("Unsupported local file protocol URL.");
  }
  const decodedPath = decodeURIComponent(url.pathname);
  return platform === "win32" && /^\/[a-zA-Z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
}

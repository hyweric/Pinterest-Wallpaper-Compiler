type PermissionDetailsLike = {
  mediaTypes?: string[];
};

export type PermissionRequestHandlerLike = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details?: unknown
) => void;

export type PermissionCheckHandlerLike = (
  webContents: unknown,
  permission: string,
  requestingOrigin?: string,
  details?: unknown
) => boolean;

export type PermissionPolicySession = {
  setPermissionRequestHandler(handler: PermissionRequestHandlerLike | null): void;
  setPermissionCheckHandler(handler: PermissionCheckHandlerLike | null): void;
};

const blockedPermissionNames = new Set([
  "media",
  "microphone",
  "camera",
  "display-capture",
  "mediakeysystem",
  "geolocation",
  "notifications",
  "midi",
  "midisysex",
  "pointerlock",
  "fullscreen",
  "openexternal"
]);

const blockedMediaTypes = new Set(["audio", "video"]);

function detailsLike(details: unknown): PermissionDetailsLike {
  if (!details || typeof details !== "object") return {};
  const maybeDetails = details as { mediaTypes?: unknown };
  return Array.isArray(maybeDetails.mediaTypes)
    ? { mediaTypes: maybeDetails.mediaTypes.map((item) => String(item)) }
    : {};
}

export function shouldDenyBrowserPermission(permission: string, details?: unknown) {
  const normalized = permission.replace(/[-_]/g, "").toLowerCase();
  if (blockedPermissionNames.has(normalized) || blockedPermissionNames.has(permission.toLowerCase())) return true;
  const mediaTypes = detailsLike(details).mediaTypes ?? [];
  return mediaTypes.some((mediaType) => blockedMediaTypes.has(mediaType.toLowerCase()));
}

export function installStrictMediaPermissionPolicy(targetSession: PermissionPolicySession) {
  targetSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (shouldDenyBrowserPermission(permission, details)) {
      const mediaTypes = detailsLike(details).mediaTypes;
      console.warn(`Denied browser permission request: ${permission}${mediaTypes?.length ? ` (${mediaTypes.join(", ")})` : ""}`);
      callback(false);
      return;
    }
    // This app should not grant browser-origin permission prompts. File/folder access
    // is handled only through Electron file dialogs and Finder drag/drop paths.
    callback(false);
  });

  targetSession.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
    if (shouldDenyBrowserPermission(permission, details)) return false;
    return false;
  });
}

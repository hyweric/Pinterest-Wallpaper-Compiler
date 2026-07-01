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
  setDisplayMediaRequestHandler?: (handler: ((request: unknown, callback: (streams: { video?: unknown; audio?: unknown }) => void) => void) | null) => void;
  setDevicePermissionHandler?: (handler: ((details: unknown) => boolean) | null) => void;
};

const blockedPermissionNames = new Set([
  "media",
  "mediaaudio",
  "mediavideo",
  "microphone",
  "audioCapture",
  "audiocapture",
  "camera",
  "videoCapture",
  "videocapture",
  "display-capture",
  "displaycapture",
  "desktop-capture",
  "desktopcapture",
  "mediakeysystem",
  "geolocation",
  "notifications",
  "midi",
  "midisysex",
  "pointerlock",
  "fullscreen",
  "openexternal"
]);

const blockedMediaTypes = new Set(["audio", "video", "microphone", "camera"]);

function detailsLike(details: unknown): PermissionDetailsLike {
  if (!details || typeof details !== "object") return {};
  const maybeDetails = details as { mediaTypes?: unknown; mediaType?: unknown };
  const rawMediaTypes = Array.isArray(maybeDetails.mediaTypes)
    ? maybeDetails.mediaTypes
    : maybeDetails.mediaType !== undefined
      ? [maybeDetails.mediaType]
      : [];
  return { mediaTypes: rawMediaTypes.map((item) => String(item)) };
}

export function shouldDenyBrowserPermission(permission: string, details?: unknown) {
  const normalized = permission.replace(/[-_\s]/g, "").toLowerCase();
  if (blockedPermissionNames.has(normalized) || blockedPermissionNames.has(permission.toLowerCase())) return true;
  const mediaTypes = detailsLike(details).mediaTypes ?? [];
  return mediaTypes.some((mediaType) => blockedMediaTypes.has(mediaType.replace(/[-_\s]/g, "").toLowerCase()) || blockedMediaTypes.has(mediaType.toLowerCase()));
}

export function installStrictMediaPermissionPolicy(targetSession: PermissionPolicySession) {
  targetSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (shouldDenyBrowserPermission(permission, details)) {
      const mediaTypes = detailsLike(details).mediaTypes;
      console.warn(`Denied browser permission request: ${permission}${mediaTypes?.length ? ` (${mediaTypes.join(", ")})` : ""}`);
      callback(false);
      return;
    }
    // Pin Paper should not grant browser-origin permission prompts. File/folder
    // access is handled only through Electron file dialogs and drag/drop paths.
    callback(false);
  });

  targetSession.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
    if (shouldDenyBrowserPermission(permission, details)) return false;
    return false;
  });

  // Chromium can route screen/audio capture through a separate display-media
  // handler. Explicitly cancel it so a remote Pinterest page, accidental input
  // capture attribute, or future dependency cannot trigger macOS microphone or
  // camera prompts.
  targetSession.setDisplayMediaRequestHandler?.((_request, callback) => {
    console.warn("Denied display/media capture request.");
    callback({ video: undefined, audio: undefined });
  });

  // Deny device permissions as an extra guard for newer Electron/Chromium
  // permission paths. This includes microphone/camera-like devices as well as
  // USB/HID/serial prompts that Pin Paper does not need during import.
  targetSession.setDevicePermissionHandler?.(() => false);
}

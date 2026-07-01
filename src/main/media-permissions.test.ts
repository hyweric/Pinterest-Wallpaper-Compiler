import test from "node:test";
import assert from "node:assert/strict";
import {
  installStrictMediaPermissionPolicy,
  shouldDenyBrowserPermission,
  type PermissionCheckHandlerLike,
  type PermissionPolicySession,
  type PermissionRequestHandlerLike
} from "./media-permissions.js";

test("media permission classifier blocks microphone, camera, and media capture aliases", () => {
  assert.equal(shouldDenyBrowserPermission("media", { mediaTypes: ["audio"] }), true);
  assert.equal(shouldDenyBrowserPermission("media", { mediaTypes: ["video"] }), true);
  assert.equal(shouldDenyBrowserPermission("microphone"), true);
  assert.equal(shouldDenyBrowserPermission("camera"), true);
  assert.equal(shouldDenyBrowserPermission("display-capture"), true);
  assert.equal(shouldDenyBrowserPermission("audioCapture"), true);
  assert.equal(shouldDenyBrowserPermission("video-capture"), true);
});

test("strict browser permission policy never grants renderer-origin prompts", () => {
  let requestHandler: PermissionRequestHandlerLike | undefined;
  let checkHandler: PermissionCheckHandlerLike | undefined;
  let displayMediaHandler: ((request: unknown, callback: (streams: { video?: unknown; audio?: unknown }) => void) => void) | undefined;
  let devicePermissionHandler: ((details: unknown) => boolean) | undefined;
  const fakeSession: PermissionPolicySession = {
    setPermissionRequestHandler(handler) { requestHandler = handler ?? undefined; },
    setPermissionCheckHandler(handler) { checkHandler = handler ?? undefined; },
    setDisplayMediaRequestHandler(handler) { displayMediaHandler = handler ?? undefined; },
    setDevicePermissionHandler(handler) { devicePermissionHandler = handler ?? undefined; }
  };
  installStrictMediaPermissionPolicy(fakeSession);

  assert.ok(requestHandler);
  assert.ok(checkHandler);
  assert.ok(displayMediaHandler);
  assert.ok(devicePermissionHandler);

  let granted: boolean | undefined;
  requestHandler({}, "media", (value: boolean) => { granted = value; }, { mediaTypes: ["audio"] });
  assert.equal(granted, false);

  granted = undefined;
  requestHandler({}, "notifications", (value: boolean) => { granted = value; });
  assert.equal(granted, false);
  assert.equal(checkHandler({}, "microphone", "https://example.com"), false);
  assert.equal(checkHandler({}, "clipboard-read", "https://example.com"), false);
  assert.equal(devicePermissionHandler({ deviceType: "microphone" }), false);

  let streams: { video?: unknown; audio?: unknown } | undefined;
  displayMediaHandler({}, (value) => { streams = value; });
  assert.deepEqual(streams, { video: undefined, audio: undefined });
});

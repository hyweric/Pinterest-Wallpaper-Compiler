import assert from "node:assert/strict";
import test from "node:test";
import { isRenderableLocalFileUrl, pathFromRenderableLocalFileUrl, renderableLocalFileUrl } from "../shared/local-file-url.js";

test("local file URLs are converted to the app-owned renderer protocol", () => {
  const renderable = renderableLocalFileUrl("file:///Users/Evelyn/Downloads/test-set-export/Untitled-Wallpaper-004.png");
  assert.equal(renderable, "pwc-file://local/Users/Evelyn/Downloads/test-set-export/Untitled-Wallpaper-004.png");
  assert.equal(isRenderableLocalFileUrl(renderable), true);
  assert.equal(pathFromRenderableLocalFileUrl(renderable, "darwin"), "/Users/Evelyn/Downloads/test-set-export/Untitled-Wallpaper-004.png");
});

test("local file protocol decoding preserves escaped filename characters", () => {
  const renderable = renderableLocalFileUrl("file:///Users/Evelyn/Downloads/My%20File%23A.png");
  assert.equal(pathFromRenderableLocalFileUrl(renderable, "darwin"), "/Users/Evelyn/Downloads/My File#A.png");
});

test("non-file URLs are left untouched", () => {
  const src = "http://127.0.0.1:5173/assets/surface.png";
  assert.equal(renderableLocalFileUrl(src), src);
  assert.equal(isRenderableLocalFileUrl(src), false);
});

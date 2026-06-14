import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGeneratedWallpaperFile,
  generateAndApplyWallpaper,
  generateWallpaperFile
} from "../shared/wallpaper-pipeline.js";

const imageData = new Uint8Array([1, 2, 3, 4]).buffer;

test("manual generation renders once, persists once, and reports generated state", async () => {
  const stages: string[] = [];
  let renderCount = 0;
  let persisted: ArrayBuffer | undefined;
  const result = await generateWallpaperFile({
    render: async () => {
      renderCount += 1;
      return imageData;
    },
    persist: async (value) => {
      persisted = value;
      return { ok: true, filePath: "/tmp/generated.png", fileSize: 123, generatedAt: "2026-06-14T12:00:00.000Z" };
    },
    onStatus: (stage) => stages.push(stage)
  });

  assert.equal(renderCount, 1);
  assert.equal(persisted, imageData);
  assert.equal(result.filePath, "/tmp/generated.png");
  assert.deepEqual(stages, ["generating", "rendering", "saving", "generated"]);
});

test("manual application applies the exact generated file and verifies success", async () => {
  const stages: string[] = [];
  let receivedPath = "";
  const result = await applyGeneratedWallpaperFile({
    filePath: "/tmp/generated.png",
    apply: async (filePath) => {
      receivedPath = filePath;
      return { ok: true, filePath, appliedAt: "2026-06-14T12:00:01.000Z" };
    },
    onStatus: (stage) => stages.push(stage)
  });

  assert.equal(receivedPath, "/tmp/generated.png");
  assert.equal(result.filePath, "/tmp/generated.png");
  assert.deepEqual(stages, ["applying", "verifying", "applied"]);
});

test("generate and apply is sequential and uses the generated file path", async () => {
  const calls: string[] = [];
  const result = await generateAndApplyWallpaper({
    render: async () => {
      calls.push("render");
      return imageData;
    },
    persist: async () => {
      calls.push("persist");
      return { ok: true, filePath: "/tmp/exact.png" };
    },
    apply: async (filePath) => {
      calls.push(`apply:${filePath}`);
      return { ok: true, filePath };
    }
  });

  assert.deepEqual(calls, ["render", "persist", "apply:/tmp/exact.png"]);
  assert.equal(result.applied.filePath, "/tmp/exact.png");
});

test("generation errors prevent application and preserve the real error", async () => {
  let applyCount = 0;
  await assert.rejects(
    generateAndApplyWallpaper({
      render: async () => imageData,
      persist: async () => ({ ok: false, error: "Generated file validation failed" }),
      apply: async () => {
        applyCount += 1;
        return { ok: true, filePath: "/tmp/should-not-run.png" };
      }
    }),
    /Generated file validation failed/
  );
  assert.equal(applyCount, 0);
});

test("render, persist, and apply timeouts reject instead of leaving the UI busy", async () => {
  await assert.rejects(
    generateWallpaperFile({
      render: async () => await new Promise<ArrayBuffer>(() => undefined),
      persist: async () => ({ ok: true, filePath: "/tmp/never.png" }),
      timeouts: { renderMs: 10 }
    }),
    /rendering timed out/i
  );

  await assert.rejects(
    generateWallpaperFile({
      render: async () => imageData,
      persist: async () => await new Promise(() => undefined),
      timeouts: { persistMs: 10 }
    }),
    /saving the generated wallpaper timed out/i
  );

  await assert.rejects(
    applyGeneratedWallpaperFile({
      filePath: "/tmp/generated.png",
      apply: async () => await new Promise(() => undefined),
      timeouts: { applyMs: 10 }
    }),
    /applying the wallpaper timed out/i
  );
});

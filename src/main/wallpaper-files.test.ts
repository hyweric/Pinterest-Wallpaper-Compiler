import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupGeneratedWallpapers, safeWallpaperFileName, validateWallpaperFile } from "./wallpaper-files.js";

test("render file validation rejects missing and empty files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pwc-wallpaper-"));
  await assert.rejects(validateWallpaperFile(path.join(dir, "missing.png")));
  const empty = path.join(dir, "empty.png");
  await writeFile(empty, Buffer.alloc(0));
  await assert.rejects(validateWallpaperFile(empty));
  const valid = path.join(dir, "valid.png");
  await writeFile(valid, Buffer.from([1, 2, 3]));
  assert.equal((await validateWallpaperFile(valid)).size, 3);
});

test("cleanup keeps only the newest generated files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pwc-history-"));
  for (let index = 0; index < 4; index += 1) {
    const file = path.join(dir, `${index}.png`);
    await writeFile(file, Buffer.from([index]));
    const date = new Date(1_700_000_000_000 + index * 1000);
    await utimes(file, date, date);
  }
  const removed = await cleanupGeneratedWallpapers(dir, 2);
  assert.equal(removed.length, 2);
  assert.deepEqual(removed.map((file) => path.basename(file)).sort(), ["0.png", "1.png"]);
});

test("suggested names cannot escape the generated directory", () => {
  assert.match(safeWallpaperFileName("../../bad name.png"), /^bad-name-\d+-[a-z0-9]+\.png$/);
});


test("cleanup never removes preserved active wallpaper files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pwc-preserve-"));
  const files: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const file = path.join(dir, `${index}.png`);
    files.push(file);
    await writeFile(file, Buffer.from([index + 1]));
    const date = new Date(1_700_000_000_000 + index * 1000);
    await utimes(file, date, date);
  }
  const preserved = files[0];
  const removed = await cleanupGeneratedWallpapers(dir, 2, [preserved]);
  assert.equal(removed.includes(preserved), false);
  assert.deepEqual(removed.map((file) => path.basename(file)).sort(), ["1.png", "2.png"]);
  assert.equal((await validateWallpaperFile(preserved)).size, 1);
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importLocalPaths } from "./local-source-import.js";

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), "pwc-import-"));
}

const readable = async (filePath: string) => !filePath.endsWith("broken.png");

test("imports folders and groups loose images while skipping unsupported and broken files", async () => {
  const root = await fixture();
  const folder = path.join(root, "Folder");
  await mkdir(folder);
  await writeFile(path.join(folder, "one.png"), "image");
  await writeFile(path.join(folder, ".hidden.jpg"), "image");
  await writeFile(path.join(folder, "notes.txt"), "text");
  await writeFile(path.join(folder, "broken.png"), "broken");
  const looseA = path.join(root, "a.jpg");
  const looseB = path.join(root, "b.webp");
  await writeFile(looseA, "image");
  await writeFile(looseB, "image");

  const result = await importLocalPaths([folder, looseA, looseB, path.join(root, "missing.jpg")], {
    validateImage: readable,
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    createSourceId: (() => { let index = 0; return () => `source-${++index}`; })()
  });

  assert.equal(result.error, undefined);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].type, "local-folder");
  assert.equal(result.sources[0].images.length, 1);
  assert.equal(result.sources[1].type, "local-file");
  assert.equal(result.sources[1].images.length, 2);
  assert.equal(result.summary?.skippedUnsupportedCount, 1);
  assert.equal(result.summary?.skippedUnreadableCount, 1);
  assert.equal(result.summary?.skippedMissingCount, 1);
});

test("canonicalizes symbolic paths and suppresses duplicate top-level imports", async () => {
  const root = await fixture();
  const image = path.join(root, "photo.jpeg");
  const alias = path.join(root, "photo-alias.jpeg");
  await writeFile(image, "image");
  await symlink(image, alias);

  const result = await importLocalPaths([image, alias], { validateImage: () => true });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].images.length, 1);
  assert.equal(result.summary?.duplicatePathCount, 1);
  assert.equal(result.sources[0].images[0].path, await realpath(image));
});

test("does not create a source for an empty or unsupported folder", async () => {
  const root = await fixture();
  const folder = path.join(root, "Empty");
  await mkdir(folder);
  await writeFile(path.join(folder, ".DS_Store"), "metadata");
  await writeFile(path.join(folder, "readme.txt"), "text");

  const result = await importLocalPaths([folder], { validateImage: () => true });
  assert.equal(result.sources.length, 0);
  assert.match(result.error ?? "", /No supported images/);
  assert.equal(result.summary?.emptyFolders.length, 1);
});

test("folder scanning remains top-level by default", async () => {
  const root = await fixture();
  const folder = path.join(root, "Folder");
  const nested = path.join(folder, "Nested");
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, "nested.png"), "image");

  const topLevel = await importLocalPaths([folder], { validateImage: () => true });
  assert.equal(topLevel.sources.length, 0);

  const recursive = await importLocalPaths([folder], { validateImage: () => true, includeSubfolders: true });
  assert.equal(recursive.sources.length, 1);
  assert.equal(recursive.sources[0].images.length, 1);
});

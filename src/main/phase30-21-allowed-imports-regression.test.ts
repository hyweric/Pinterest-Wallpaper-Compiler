import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importLocalPaths } from "./local-source-import.js";
import { isSupportedImageFileName, supportedImageExtensionLabel } from "../shared/supported-image-formats.js";

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), "pwc-allowed-imports-"));
}

test("Phase 30.21 rejects direct files outside the explicit allowed image list before decode", async () => {
  const root = await fixture();
  const unsupported = path.join(root, "notes.txt");
  await writeFile(unsupported, "not an image");
  let decodeCalls = 0;

  const result = await importLocalPaths([unsupported], {
    validateImage: () => {
      decodeCalls += 1;
      return true;
    }
  });

  assert.equal(decodeCalls, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.summary?.skippedUnsupportedCount, 1);
  assert.match(result.error ?? "", /Allowed image types/);
  assert.match(result.warnings?.join(" ") ?? "", /rejected/);
});

test("Phase 30.21 folder imports keep allowed images and reject unsupported items inside", async () => {
  const root = await fixture();
  const folder = path.join(root, "Mixed Folder");
  await mkdir(folder);
  await writeFile(path.join(folder, "photo.png"), "image");
  await writeFile(path.join(folder, "movie.mov"), "video");
  await writeFile(path.join(folder, "archive.zip"), "zip");

  const result = await importLocalPaths([folder], { validateImage: () => true });

  assert.equal(result.error, undefined);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].type, "local-folder");
  assert.deepEqual(result.sources[0].images.map((image) => image.name), ["photo.png"]);
  assert.equal(result.summary?.skippedUnsupportedCount, 2);
  assert.match(result.warnings?.join(" ") ?? "", /Allowed image types/);
});

test("Phase 30.21 shared allowed list is extension based", () => {
  assert.equal(isSupportedImageFileName("photo.PNG"), true);
  assert.equal(isSupportedImageFileName("photo.txt"), false);
  assert.match(supportedImageExtensionLabel, /\.heic/);
});

test("Phase 30.21 renderer uses the shared allowed import list for drops and browser import", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  assert.match(renderer, /supportedImageAccept/);
  assert.match(renderer, /isSupportedImageFileName\(file\.name \|\| file\.webkitRelativePath\)/);
  assert.match(renderer, /dropImportRejection/);
  assert.match(renderer, /Unsupported files cannot be imported\. Allowed/);
});

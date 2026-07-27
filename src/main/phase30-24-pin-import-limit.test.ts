import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { PinterestBoardProvider, type PinterestBoardPin } from "./providers.js";
import {
  DEFAULT_PIN_IMPORT_LIMIT,
  MAX_PIN_IMPORT_LIMIT,
  MIN_PIN_IMPORT_LIMIT,
  normalizePinImportLimit,
  pinLimitReached
} from "../shared/pin-import-limit.js";
import type { ImageSource, LocalImageRef } from "../shared/types.js";

test("Phase 30.24 normalizes the user pin limit with a safe 1000-pin default", () => {
  assert.equal(normalizePinImportLimit(undefined), DEFAULT_PIN_IMPORT_LIMIT);
  assert.equal(normalizePinImportLimit("1,250"), 1_250);
  assert.equal(normalizePinImportLimit(0), MIN_PIN_IMPORT_LIMIT);
  assert.equal(normalizePinImportLimit(99_999), MAX_PIN_IMPORT_LIMIT);
  assert.equal(pinLimitReached(2_000, 50, 1_000), false, "a reported large board is not complete until the cap is actually reached");
  assert.equal(pinLimitReached(2_000, 1_000, 1_000), true);
});

function cachedImage(pin: PinterestBoardPin): LocalImageRef {
  const filePath = path.join(os.tmpdir(), `${pin.id}.jpg`);
  return {
    id: `image-${pin.id}`,
    name: `${pin.id}.jpg`,
    path: filePath,
    url: pathToFileURL(filePath).toString(),
    modifiedAt: new Date(0).toISOString(),
    externalId: pin.id,
    sourceUrl: pin.imageUrl,
    mediaType: "image"
  };
}

test("Phase 30.24 provider caps imports and trims an existing oversized Pinterest source without treating the cap as partial", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pwc-pin-limit-"));
  const pins = Array.from({ length: 1_200 }, (_, index) => ({
    id: `pin-${index + 1}`,
    imageUrl: `https://images.example.test/${index + 1}.jpg`
  }));
  const existing: ImageSource = {
    id: "source-existing",
    name: "Large board",
    type: "pinterest-board",
    providerId: "pinterest-board",
    url: "https://www.pinterest.com/example/large-board/",
    cachePath: path.join(root, "source-existing"),
    images: pins.map(cachedImage),
    mediaPolicy: "images-and-video-thumbnails",
    updatedAt: new Date(0).toISOString()
  };

  const provider = new PinterestBoardProvider(root, async (_url, options) => {
    assert.equal(options.maxPins, 1_000);
    return {
      pins: pins.slice(0, options.maxPins),
      total: pins.length,
      limitReached: true,
      log: ["mock board loaded"]
    };
  });

  const result = await provider.import({
    url: existing.url!,
    mode: "update",
    existingSource: existing,
    maxPins: 1_000
  });

  assert.equal(result.ok, true);
  assert.equal(result.partial, false);
  assert.equal(result.error, undefined);
  assert.equal(result.imagesCached, 1_000);
  assert.equal(result.pinLimit, 1_000);
  assert.equal(result.pinLimitReached, true);
  assert.equal(result.availablePins, 1_200);
  assert.equal(result.source?.images.length, 1_000);
  assert.equal(result.source?.expectedItemCount, 1_000);
  assert.equal(result.source?.pinImportLimit, 1_000);
  assert.equal(result.source?.pinImportLimitReached, true);
  assert.equal(result.source?.availableItemCount, 1_200);
  assert.equal(result.source?.importCursor, undefined);
  assert.match(result.source?.importLog?.join(" ") ?? "", /configured limit of 1,000 pins/);
});

test("Phase 30.24 exposes a persistent Settings control and sends the limit on import and refresh", async () => {
  const renderer = await readFile(path.join(process.cwd(), "src/renderer/main.tsx"), "utf8");
  const types = await readFile(path.join(process.cwd(), "src/shared/types.ts"), "utf8");
  const main = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");

  assert.match(renderer, /pwc\.pinterestPinLimit\.v1/);
  assert.match(renderer, /Maximum Pinterest pins/);
  assert.match(renderer, /DEFAULT_PIN_IMPORT_LIMIT/);
  assert.ok((renderer.match(/maxPins: pinterestPinLimit/g) ?? []).length >= 2);
  assert.match(renderer, /pinImportLimitReached \? undefined : .*importCursor/);
  assert.match(types, /maxPins\?: number/);
  assert.match(types, /pinImportLimitReached\?: boolean/);
  assert.match(main, /count >= pinLimit/);
});

test("Phase 30.24 does not mistake a large reported board for a completed capped import when discovery stops early", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pwc-pin-limit-partial-"));
  const pins = Array.from({ length: 50 }, (_, index) => ({
    id: `partial-pin-${index + 1}`,
    imageUrl: `https://images.example.test/partial-${index + 1}.jpg`
  }));
  const existing: ImageSource = {
    id: "source-partial",
    name: "Partial board",
    type: "pinterest-board",
    providerId: "pinterest-board",
    url: "https://www.pinterest.com/example/partial-board/",
    cachePath: path.join(root, "source-partial"),
    images: pins.map(cachedImage),
    mediaPolicy: "images-and-video-thumbnails",
    updatedAt: new Date(0).toISOString()
  };
  const provider = new PinterestBoardProvider(root, async () => ({
    pins,
    total: 2_000,
    limitReached: false
  }));

  const result = await provider.import({
    url: existing.url!,
    mode: "update",
    existingSource: existing,
    maxPins: 1_000
  });

  assert.equal(result.pinLimitReached, false);
  assert.equal(result.partial, true);
  assert.match(result.error ?? "", /Partial import/);
  assert.equal(result.source?.expectedItemCount, 1_000);
});

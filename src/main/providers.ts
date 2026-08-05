import { access, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ImageSource,
  LocalImageRef,
  PinterestImportProgress,
  PinterestImportRequest,
  PinterestImportResult
} from "../shared/types.js";
import { collectPinterestPages, PinterestPaginationError } from "./pinterest-pagination.js";
import { normalizePinImportLimit, pinImportTarget, pinLimitReached as didReachPinLimit } from "../shared/pin-import-limit.js";

export interface ImageSourceProvider<TRequest, TResult> {
  id: ImageSource["providerId"];
  validate(input: TRequest): string | undefined;
  import(input: TRequest): Promise<TResult>;
  update?(input: TRequest): Promise<TResult>;
}

export interface PinterestBoardPin {
  id: string;
  imageUrl: string;
  mediaType?: "image" | "video";
  promoted?: boolean;
  metadata?: unknown;
}


export function isLikelyPinterestAd(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const booleanKeys = ["is_promoted", "promoted", "isPromoted", "is_ad", "isAd"];
  if (booleanKeys.some((key) => item[key] === true)) return true;
  const objectKeys = ["promoted_pin", "promotedPin", "ad", "ad_data", "adData"];
  if (objectKeys.some((key) => item[key] !== undefined && item[key] !== null && item[key] !== false)) return true;
  const textKeys = ["type", "label", "display_label", "displayLabel", "badge", "context", "description"];
  return textKeys.some((key) => typeof item[key] === "string" && /\b(promoted|sponsored|advertisement)\b/i.test(item[key] as string));
}

async function existingLocalImages(images: LocalImageRef[]) {
  const checks = await Promise.all(images.map(async (image) => {
    try {
      await access(image.path);
      return image;
    } catch {
      return undefined;
    }
  }));
  return checks.filter((image): image is LocalImageRef => Boolean(image));
}

export interface PublicPinterestBoardResult {
  pins: PinterestBoardPin[];
  total?: number;
  limitReached?: boolean;
  log?: string[];
}

export type PublicPinterestBoardLoader = (
  url: string,
  options: {
    signal?: AbortSignal;
    expectedTotal?: number;
    maxPins?: number;
    onProgress?: (current: number, total?: number, message?: string, page?: number) => void;
  }
) => Promise<PublicPinterestBoardResult>;


const browserRenderableImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const heicImageExtensions = new Set([".heic", ".heif"]);
const heicBrands = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

function imageExtensionFromContentType(contentType: string | null, fallback: string) {
  const normalized = contentType?.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/heic") return ".heic";
  if (normalized === "image/heif") return ".heif";
  return fallback;
}

function isHeicLikeImage(filePath: string, bytes?: Buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (heicImageExtensions.has(extension)) return true;
  if (!bytes || bytes.length < 12) return false;
  return bytes.subarray(4, 8).toString("ascii") === "ftyp" && heicBrands.has(bytes.subarray(8, 12).toString("ascii"));
}

function convertedHeicPath(filePath: string) {
  return `${filePath}.png`;
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function convertHeicToRenderablePng(filePath: string) {
  if (process.platform !== "darwin") {
    throw new Error("HEIC images need conversion before rendering; automatic HEIC conversion is only available on macOS right now.");
  }
  const outputPath = convertedHeicPath(filePath);
  if (await fileExists(outputPath)) return outputPath;
  await new Promise<void>((resolve, reject) => {
    execFile("sips", ["-s", "format", "png", filePath, "--out", outputPath], { timeout: 30_000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const converted = await stat(outputPath).catch(() => undefined);
  if (!converted || converted.size < 16) {
    throw new Error("HEIC conversion did not produce a readable PNG.");
  }
  return outputPath;
}

async function makePinterestImageRenderable(image: LocalImageRef, bytes?: Buffer): Promise<LocalImageRef> {
  const extension = path.extname(image.path).toLowerCase();
  if (browserRenderableImageExtensions.has(extension) && !isHeicLikeImage(image.path, bytes)) return image;
  if (!isHeicLikeImage(image.path, bytes)) {
    throw new Error(`Pinterest cached unsupported image format ${extension || "unknown"}.`);
  }
  const renderablePath = await convertHeicToRenderablePng(image.path);
  const renderedStat = await stat(renderablePath);
  return {
    ...image,
    name: path.basename(renderablePath),
    path: renderablePath,
    url: pathToFileURL(renderablePath).toString(),
    size: renderedStat.size,
    modifiedAt: renderedStat.mtime.toISOString(),
    mediaType: "image"
  };
}

export function validatePinterestBoardUrl(rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "Enter a valid Pinterest board URL.";
  }

  const hostname = url.hostname.replace(/^www\./, "");
  if (hostname !== "pinterest.com" && hostname !== "pin.it") {
    return "Pinterest board links must use pinterest.com or pin.it.";
  }

  const parts = decodedPinterestPathParts(url);
  if (hostname === "pin.it") {
    return "Short pin.it links can hide their final destination. Open the link in a browser and paste the full board URL.";
  }

  if (parts.length < 2 || parts.includes("pin")) {
    return "Paste a board URL, for example https://www.pinterest.com/user/board-name/.";
  }

  return undefined;
}

export class PinterestBoardProvider implements ImageSourceProvider<PinterestImportRequest, PinterestImportResult> {
  id = "pinterest-board" as const;

  constructor(
    private readonly cacheRoot: string,
    private readonly publicBoardLoader?: PublicPinterestBoardLoader
  ) {}

  validate(input: PinterestImportRequest) {
    return validatePinterestBoardUrl(input.url);
  }

  async import(
    input: PinterestImportRequest,
    onProgress?: (progress: PinterestImportProgress) => void,
    signal?: AbortSignal
  ): Promise<PinterestImportResult> {
    const pinLimit = normalizePinImportLimit(input.maxPins);
    const normalizedInput: PinterestImportRequest = { ...input, maxPins: pinLimit };
    const jobId = input.jobId ?? `pinterest-${randomUUID()}`;
    const report = (
      stage: PinterestImportProgress["stage"],
      current: number,
      total: number | undefined,
      progress: number,
      message: string,
      page?: number,
      bookmark?: string
    ) => onProgress?.({ jobId, stage, current, total, progress, message, page, bookmark });

    report("validating", 0, pinLimit, 2, `Validating Pinterest board URL (limit ${pinLimit.toLocaleString()} pins)...`);
    const validationError = this.validate(normalizedInput);
    if (validationError) {
      return { ...failureResult(validationError, [validationError]), pinLimit };
    }

    const existing = normalizedInput.existingSource;
    await mkdir(this.cacheRoot, { recursive: true });
    const sourceId = existing?.id ?? `source-${randomUUID()}`;
    const sourceCachePath = existing?.cachePath ?? path.join(this.cacheRoot, sourceId);
    await mkdir(sourceCachePath, { recursive: true });

    const log = ["Pinterest URL validated.", `Pin import limit: ${pinLimit.toLocaleString()}.`];
    let pins: PinterestBoardPin[] = [];
    let expectedCount: number | undefined;
    let finalBookmark: string | undefined;
    let pageCount: number | undefined;
    let discoveryError: string | undefined;
    let loaderLimitReached = false;

    try {
      report("discovering", 0, pinLimit, 5, `Discovering up to ${pinLimit.toLocaleString()} board pins...`);
      if (normalizedInput.accessToken && normalizedInput.boardId) {
        const official = await this.loadOfficialBoard(normalizedInput, report, signal);
        pins = official.pins;
        finalBookmark = official.bookmark;
        pageCount = official.pageCount;
        discoveryError = official.partialError;
        loaderLimitReached = official.limitReached;
        log.push(`Official API returned ${pins.length} unique pins across ${pageCount} pages.`);
        if (official.partialError) log.push(official.partialError);
      } else {
        const publicResult = await this.loadPublicBoard(normalizedInput.url, pinLimit, report, signal);
        pins = publicResult.pins;
        expectedCount = publicResult.total;
        loaderLimitReached = Boolean(publicResult.limitReached);
        log.push(...(publicResult.log ?? []));
      }
    } catch (error) {
      if (isAbortError(error)) {
        const preservedImages = (existing?.images ?? []).slice(0, pinLimit);
        const source = await this.buildSource({
          existing,
          sourceId,
          sourceCachePath,
          input: normalizedInput,
          images: preservedImages,
          log: [...log, "Import canceled. Cached images were preserved up to the current pin limit."],
          expectedCount: Math.min(expectedCount ?? preservedImages.length, pinLimit),
          availableCount: existing?.availableItemCount ?? expectedCount,
          limitReached: Boolean(existing?.pinImportLimitReached || (existing?.images.length ?? 0) > pinLimit),
          importStatus: "canceled",
          bookmark: finalBookmark
        });
        report("canceled", source.images.length, Math.min(expectedCount ?? pinLimit, pinLimit), 100, "Pinterest import canceled.");
        return {
          canceled: true,
          ok: false,
          source,
          imagesFound: Math.min(pins.length, pinLimit),
          imagesCached: source.images.length,
          progress: 100,
          log: source.importLog ?? [],
          page: pageCount,
          bookmark: finalBookmark,
          pinLimit,
          pinLimitReached: source.pinImportLimitReached,
          availablePins: source.availableItemCount,
          error: "Pinterest import canceled. Import this board again to resume; cached pins will not be downloaded again."
        };
      }
      discoveryError = error instanceof Error ? error.message : "Unable to retrieve Pinterest board.";
      log.push(discoveryError);
    }

    const allUniquePins = dedupePins(pins);
    const limitReached = didReachPinLimit(expectedCount, allUniquePins.length, pinLimit, loaderLimitReached);
    const uniquePins = allUniquePins.slice(0, pinLimit);
    const availablePins = Math.max(expectedCount ?? 0, allUniquePins.length) || undefined;
    const effectiveExpectedCount = pinImportTarget(expectedCount, pinLimit, uniquePins.length) || uniquePins.length;
    if (expectedCount !== undefined && allUniquePins.length > expectedCount) {
      log.push(`Pinterest reported about ${expectedCount} board pins, but ${allUniquePins.length} valid pins were discovered. Using discovered count for progress within the configured limit.`);
    }
    if (limitReached) {
      log.push(`Stopped at the configured limit of ${pinLimit.toLocaleString()} pins${availablePins && availablePins > pinLimit ? ` out of approximately ${availablePins.toLocaleString()} available` : ""}.`);
    }
    if (uniquePins.length === 0) {
      if (!existing) await rm(sourceCachePath, { recursive: true, force: true });
      const message =
        "Pinterest import unavailable. This public board could not be fully read. Pinterest may be blocking automated access or may require a supported integration.";
      report("error", 0, effectiveExpectedCount || pinLimit, 100, message, pageCount, finalBookmark);
      return {
        ok: false,
        imagesFound: 0,
        imagesCached: Math.min(existing?.images.length ?? 0, pinLimit),
        progress: 100,
        log,
        page: pageCount,
        bookmark: finalBookmark,
        pinLimit,
        pinLimitReached: limitReached,
        availablePins,
        error: message
      };
    }

    const selectedPinIds = new Set(uniquePins.map((pin) => pin.id));
    const existingByPinId = new Map(
      (existing?.images ?? [])
        .filter((image) => image.externalId && selectedPinIds.has(image.externalId))
        .map((image) => [image.externalId as string, image])
    );
    const importedImages = new Map<string, LocalImageRef>();
    for (const image of existingByPinId.values()) {
      if (!image.externalId) continue;
      try {
        importedImages.set(image.externalId, await makePinterestImageRenderable(image));
      } catch (error) {
        log.push(`Skipped cached pin ${image.externalId}: ${error instanceof Error ? error.message : "image could not be prepared for rendering"}`);
      }
    }

    const missingPins = uniquePins.filter((pin) => {
      const cached = existingByPinId.get(pin.id);
      return !cached || cached.sourceUrl !== pin.imageUrl;
    });
    log.push(`Selected ${uniquePins.length} unique pins within the limit; ${missingPins.length} need downloading.`);

    const orderedImportedImages = () => uniquePins
      .map((pin) => importedImages.get(pin.id))
      .filter((image): image is LocalImageRef => Boolean(image));

    const canceledResult = async (): Promise<PinterestImportResult> => {
      const canceledImages = orderedImportedImages();
      const source = await this.buildSource({
        existing,
        sourceId,
        sourceCachePath,
        input: normalizedInput,
        images: canceledImages,
        log: [...log, "Import canceled during download. Cached pins were preserved."],
        expectedCount: effectiveExpectedCount,
        availableCount: availablePins,
        limitReached,
        importStatus: "canceled",
        bookmark: finalBookmark
      });
      report("canceled", canceledImages.length, effectiveExpectedCount, 100, "Pinterest import canceled.", pageCount, finalBookmark);
      return {
        canceled: true,
        ok: false,
        source,
        imagesFound: uniquePins.length,
        imagesCached: canceledImages.length,
        progress: 100,
        log: source.importLog ?? [],
        page: pageCount,
        bookmark: finalBookmark,
        pinLimit,
        pinLimitReached: limitReached,
        availablePins,
        error: "Pinterest import canceled. Import this board again to resume; cached pins will not be downloaded again."
      };
    };

    let completed = 0;
    const concurrency = 6;
    for (let offset = 0; offset < missingPins.length; offset += concurrency) {
      if (signal?.aborted) return canceledResult();
      const batch = missingPins.slice(offset, offset + concurrency);
      const results = await Promise.all(
        batch.map(async (pin) => {
          try {
            return await downloadImage(pin, sourceCachePath, signal);
          } catch (error) {
            log.push(`Failed pin ${pin.id}: ${error instanceof Error ? error.message : "download failed"}`);
            return undefined;
          }
        })
      );
      for (const image of results) {
        if (image?.externalId && selectedPinIds.has(image.externalId)) importedImages.set(image.externalId, image);
      }
      completed += batch.length;
      if (signal?.aborted) return canceledResult();
      const total = missingPins.length;
      const overall = total === 0 ? 95 : 40 + Math.round((completed / total) * 55);
      report(
        "downloading",
        importedImages.size,
        effectiveExpectedCount,
        overall,
        `Cached ${importedImages.size} / ${effectiveExpectedCount} pins...`,
        pageCount,
        finalBookmark
      );
    }

    const images = orderedImportedImages();
    const incompleteByCount = !limitReached && expectedCount !== undefined && images.length < expectedCount && uniquePins.length < expectedCount;
    const incompleteByDownload = images.length < uniquePins.length;
    const partial = Boolean(discoveryError || incompleteByCount || incompleteByDownload || (finalBookmark && !limitReached));
    const status: ImageSource["importStatus"] = partial ? "partial" : "ready";
    if (incompleteByCount) log.push(`Partial discovery: found ${uniquePins.length} of approximately ${expectedCount} board pins.`);
    if (incompleteByDownload) log.push(`Partial cache: cached ${images.length} of ${uniquePins.length} selected pins.`);
    if (finalBookmark && !limitReached) log.push(`Pagination stopped with bookmark ${finalBookmark}.`);

    const source = await this.buildSource({
      existing,
      sourceId,
      sourceCachePath,
      input: normalizedInput,
      images,
      log,
      expectedCount: effectiveExpectedCount,
      availableCount: availablePins,
      limitReached,
      importStatus: status,
      bookmark: finalBookmark
    });

    const error = partial
      ? `Partial import: cached ${images.length} pins${incompleteByCount ? ` of approximately ${expectedCount}` : ""}. Import this board again to resume.`
      : undefined;
    const completionMessage = limitReached
      ? `Imported ${images.length} pins and stopped at the configured limit.`
      : `Imported all ${images.length} pins.`;
    report(partial ? "partial" : "complete", images.length, effectiveExpectedCount, 100, error ?? completionMessage, pageCount, finalBookmark);

    return {
      partial,
      ok: images.length > 0,
      source,
      imagesFound: uniquePins.length,
      imagesCached: images.length,
      progress: 100,
      log: source.importLog ?? [],
      error,
      page: pageCount,
      bookmark: finalBookmark,
      pinLimit,
      pinLimitReached: limitReached,
      availablePins
    };
  }

  async update(
    input: PinterestImportRequest,
    onProgress?: (progress: PinterestImportProgress) => void,
    signal?: AbortSignal
  ) {
    return this.import({ ...input, mode: "update" }, onProgress, signal);
  }

  private async loadPublicBoard(
    url: string,
    pinLimit: number,
    report: (
      stage: PinterestImportProgress["stage"],
      current: number,
      total: number | undefined,
      progress: number,
      message: string,
      page?: number,
      bookmark?: string
    ) => void,
    signal?: AbortSignal
  ): Promise<PublicPinterestBoardResult> {
    const board = boardPartsFromUrl(url);
    const scope = pinterestScopeFromUrl(url);
    const endpoint = `https://api.pinterest.com/v3/pidgets/boards/${encodeURIComponent(board.username)}/${encodeURIComponent(board.board)}/pins/`;
    const initialPins: PinterestBoardPin[] = [];
    let expectedCount: number | undefined;
    const log: string[] = [];

    try {
      const response = await fetch(endpoint, { redirect: "follow", signal });
      if (!response.ok) throw new Error(`Pinterest pidgets returned HTTP ${response.status}.`);
      const json = (await response.json()) as PinterestPidgetResponse;
      if (json.status !== "success" || !Array.isArray(json.data?.pins)) {
        throw new Error(json.message || "Pinterest did not return board pins.");
      }
      expectedCount = scope.kind === "section" ? undefined : numberFromUnknown(json.data.board?.pin_count ?? json.data.board?.pins_count);
      for (const pin of json.data.pins) {
        const imageUrl = bestPinterestImageUrl(pin);
        if (pin.id && imageUrl && !isLikelyPinterestAd(pin)) initialPins.push({ id: pin.id, imageUrl, mediaType: isPinterestVideoPin(pin) ? "video" : "image", metadata: pin });
      }
      log.push(scope.kind === "section"
        ? `Initial public endpoint returned ${initialPins.length} whole-board pins; section progress will use discovered section pins.`
        : `Initial public endpoint returned ${initialPins.length} pins${expectedCount ? ` of approximately ${expectedCount}` : ""}.`);
    } catch (error) {
      log.push(error instanceof Error ? error.message : "Initial public endpoint was unavailable.");
    }

    if (!this.publicBoardLoader) {
      const uniqueInitialPins = dedupePins(initialPins);
      return {
        pins: uniqueInitialPins.slice(0, pinLimit),
        total: expectedCount,
        limitReached: didReachPinLimit(expectedCount, uniqueInitialPins.length, pinLimit),
        log
      };
    }

    try {
      const browserResult = await this.publicBoardLoader(url, {
        signal,
        expectedTotal: expectedCount,
        maxPins: pinLimit,
        onProgress: (current, total, message, page) => {
          const target = Math.min(total ?? expectedCount ?? pinLimit, pinLimit);
          report("paginating", Math.min(current, pinLimit), target, 8 + Math.min(30, Math.round((Math.min(current, target) / Math.max(target, 1)) * 30)), message ?? `Importing page ${page ?? 1}: ${Math.min(current, pinLimit)} pins found`, page);
        }
      });
      const browserPins = dedupePins(browserResult.pins);
      const allMergedPins = scope.kind === "section" && browserPins.length > 0 ? browserPins : dedupePins([...initialPins, ...browserPins]);
      const mergedPins = allMergedPins.slice(0, pinLimit);
      const reportedTotal = scope.kind === "section" ? (browserResult.total ?? (browserPins.length || undefined)) : (browserResult.total ?? expectedCount);
      return {
        pins: mergedPins,
        total: reportedTotal,
        limitReached: Boolean(browserResult.limitReached || didReachPinLimit(reportedTotal, allMergedPins.length, pinLimit)),
        log: [...log, ...(browserResult.log ?? []), ...(scope.kind === "section" ? [`Section URL detected; using up to ${mergedPins.length} discovered section pins as the completion target.`] : [])]
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      log.push(`Full-board loader stopped: ${error instanceof Error ? error.message : "unknown error"}`);
      const uniqueInitialPins = dedupePins(initialPins);
      return {
        pins: uniqueInitialPins.slice(0, pinLimit),
        total: expectedCount,
        limitReached: didReachPinLimit(expectedCount, uniqueInitialPins.length, pinLimit),
        log
      };
    }
  }

  private async loadOfficialBoard(
    input: PinterestImportRequest,
    report: (
      stage: PinterestImportProgress["stage"],
      current: number,
      total: number | undefined,
      progress: number,
      message: string,
      page?: number,
      bookmark?: string
    ) => void,
    signal?: AbortSignal
  ) {
    const token = input.accessToken as string;
    const boardId = input.boardId as string;
    const pinLimit = normalizePinImportLimit(input.maxPins);
    const headers = { Authorization: `Bearer ${token}` };
    const allPins: OfficialPinterestPin[] = [];
    let finalBookmark: string | undefined;
    let pageCount = 0;
    let partialError: string | undefined;
    let limitReached = false;
    const uniqueCount = () => new Set(allPins.map((pin) => pin.id).filter(Boolean)).size;

    try {
      const boardPins = await collectPinterestPages(
        async (bookmark) => {
          const url = new URL(`https://api.pinterest.com/v5/boards/${encodeURIComponent(boardId)}/pins`);
          url.searchParams.set("page_size", "250");
          if (bookmark) url.searchParams.set("bookmark", bookmark);
          return fetchOfficialPage<OfficialPinterestPin>(url, headers, signal);
        },
        {
          initialBookmark: input.resumeBookmark,
          signal,
          maxItems: pinLimit,
          onProgress: ({ page, itemCount, bookmark }) =>
            report("paginating", itemCount, pinLimit, Math.min(35, 8 + page * 3), `Loaded API page ${page}: ${itemCount} / ${pinLimit} pins`, page, bookmark)
        }
      );
      allPins.push(...boardPins.items);
      pageCount += boardPins.pageCount;
      finalBookmark = boardPins.finalBookmark;
      limitReached = Boolean(boardPins.limitReached);
    } catch (error) {
      if (error instanceof PinterestPaginationError) {
        allPins.push(...(error.items as OfficialPinterestPin[]).slice(0, pinLimit));
        pageCount += error.pageCount;
        finalBookmark = error.bookmark;
        partialError = error.message;
      } else {
        throw error;
      }
    }

    if (!limitReached && uniqueCount() < pinLimit) {
      try {
        const sections = await collectPinterestPages(
          async (bookmark) => {
            const url = new URL(`https://api.pinterest.com/v5/boards/${encodeURIComponent(boardId)}/sections`);
            url.searchParams.set("page_size", "250");
            if (bookmark) url.searchParams.set("bookmark", bookmark);
            return fetchOfficialPage<OfficialBoardSection>(url, headers, signal);
          },
          { signal }
        );

        sectionLoop:
        for (let sectionIndex = 0; sectionIndex < sections.items.length; sectionIndex += 1) {
          const section = sections.items[sectionIndex];
          let sectionBookmark: string | undefined;
          while (uniqueCount() < pinLimit) {
            const remaining = pinLimit - uniqueCount();
            try {
              const sectionPins = await collectPinterestPages(
                async (bookmark) => {
                  const url = new URL(
                    `https://api.pinterest.com/v5/boards/${encodeURIComponent(boardId)}/sections/${encodeURIComponent(section.id)}/pins`
                  );
                  url.searchParams.set("page_size", "250");
                  if (bookmark) url.searchParams.set("bookmark", bookmark);
                  return fetchOfficialPage<OfficialPinterestPin>(url, headers, signal);
                },
                {
                  signal,
                  initialBookmark: sectionBookmark,
                  maxItems: remaining,
                  onProgress: ({ page, itemCount, bookmark }) =>
                    report("paginating", Math.min(pinLimit, uniqueCount() + itemCount), pinLimit, Math.min(35, 8 + (pageCount + page) * 3), `Loaded section pins: ${Math.min(pinLimit, uniqueCount() + itemCount)} / ${pinLimit}`, pageCount + page, bookmark)
                }
              );
              allPins.push(...sectionPins.items);
              pageCount += sectionPins.pageCount;
              sectionBookmark = sectionPins.finalBookmark;
              if (uniqueCount() >= pinLimit) {
                limitReached = Boolean(sectionPins.limitReached || sectionIndex < sections.items.length - 1);
                finalBookmark = sectionBookmark;
                break sectionLoop;
              }
              if (!sectionPins.limitReached || !sectionBookmark) break;
            } catch (error) {
              if (error instanceof PinterestPaginationError) {
                allPins.push(...(error.items as OfficialPinterestPin[]));
                pageCount += error.pageCount;
                finalBookmark = error.bookmark;
                partialError = partialError ?? `Section ${section.id}: ${error.message}`;
                break;
              }
              throw error;
            }
          }
        }
      } catch (error) {
        if (error instanceof PinterestPaginationError) {
          finalBookmark = error.bookmark;
          partialError = partialError ?? `Board sections: ${error.message}`;
        } else {
          throw error;
        }
      }
    }

    const pins = dedupePins(allPins.map(officialPinToBoardPin).filter((pin): pin is PinterestBoardPin => Boolean(pin)));
    return {
      pins: pins.slice(0, pinLimit),
      bookmark: finalBookmark,
      pageCount,
      partialError,
      limitReached: limitReached || pins.length > pinLimit
    };
  }

  private async buildSource(input: {
    existing?: ImageSource;
    sourceId: string;
    sourceCachePath: string;
    input: PinterestImportRequest;
    images: LocalImageRef[];
    log: string[];
    expectedCount?: number;
    availableCount?: number;
    limitReached?: boolean;
    importStatus: ImageSource["importStatus"];
    bookmark?: string;
  }): Promise<ImageSource> {
    const now = new Date().toISOString();
    const source: ImageSource = {
      ...(input.existing ?? {}),
      id: input.sourceId,
      providerId: "pinterest-board",
      type: "pinterest-board",
      name: input.existing?.name ?? boardNameFromUrl(input.input.url),
      url: input.input.url.trim(),
      images: input.images,
      mediaPolicy: "images-and-video-thumbnails",
      mediaCounts: {
        total: input.images.length,
        images: input.images.filter((image) => image.mediaType !== "video").length,
        videos: input.images.filter((image) => image.mediaType === "video").length
      },
      cachePath: input.sourceCachePath,
      importStatus: input.importStatus,
      importLog: [...input.log, `Cache contains ${input.images.length} unique Pinterest pins.`],
      expectedItemCount: input.expectedCount,
      importedItemCount: input.images.length,
      pinImportLimit: normalizePinImportLimit(input.input.maxPins),
      pinImportLimitReached: Boolean(input.limitReached),
      availableItemCount: input.availableCount,
      importCursor: input.limitReached ? undefined : input.bookmark,
      lastImportCompletedAt: input.importStatus === "ready" ? now : input.existing?.lastImportCompletedAt,
      updatedAt: now
    };
    await writeFile(path.join(input.sourceCachePath, "metadata.json"), JSON.stringify(source, null, 2), "utf8");
    return source;
  }
}

interface PinterestPidgetResponse {
  status: string;
  message?: string;
  data?: {
    pins?: PinterestPidgetPin[];
    board?: {
      pin_count?: number | string;
      pins_count?: number | string;
    };
  };
}

interface PinterestPidgetPin {
  id: string;
  is_promoted?: boolean;
  promoted?: boolean;
  isPromoted?: boolean;
  is_ad?: boolean;
  isAd?: boolean;
  promoted_pin?: unknown;
  promotedPin?: unknown;
  ad?: unknown;
  ad_data?: unknown;
  adData?: unknown;
  label?: string;
  display_label?: string;
  type?: string;
  media_type?: string;
  videos?: unknown;
  story_pin_data?: unknown;
  images?: Record<string, { url?: string; width?: number; height?: number }>;
}

interface OfficialPinterestPin {
  id: string;
  is_promoted?: boolean;
  promoted?: boolean;
  isPromoted?: boolean;
  is_ad?: boolean;
  isAd?: boolean;
  promoted_pin?: unknown;
  promotedPin?: unknown;
  ad?: unknown;
  ad_data?: unknown;
  adData?: unknown;
  label?: string;
  display_label?: string;
  media_type?: string;
  media?: {
    media_type?: string;
    images?: Record<string, { url?: string; width?: number; height?: number }>;
  };
}

interface OfficialBoardSection {
  id: string;
}

function officialPinToBoardPin(pin: OfficialPinterestPin): PinterestBoardPin | undefined {
  const image = Object.values(pin.media?.images ?? {})
    .filter((item) => item.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return pin.id && image?.url ? { id: pin.id, imageUrl: image.url, mediaType: /video/i.test(`${pin.media_type ?? ""} ${pin.media?.media_type ?? ""}`) ? "video" : "image", promoted: isLikelyPinterestAd(pin), metadata: pin } : undefined;
}

async function fetchOfficialPage<T>(url: URL, headers: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(`Pinterest API returned HTTP ${response.status} for ${url.pathname}.`);
  const json = (await response.json()) as { items?: T[]; bookmark?: string | null };
  return { items: json.items ?? [], bookmark: json.bookmark };
}

function failureResult(error: string, log: string[]): PinterestImportResult {
  return { ok: false, imagesFound: 0, imagesCached: 0, progress: 100, log, error };
}

function dedupePins(pins: PinterestBoardPin[]) {
  const byId = new Map<string, PinterestBoardPin>();
  const seenUrls = new Set<string>();
  for (const pin of pins) {
    if (!pin.id || !pin.imageUrl || pin.promoted || isLikelyPinterestAd(pin.metadata)) continue;
    const canonicalUrl = pin.imageUrl.replace(/([?&])(width|height|quality|crop)=[^&]*/gi, "$1").replace(/[?&]+$/, "");
    if (byId.has(pin.id) || seenUrls.has(canonicalUrl)) continue;
    byId.set(pin.id, pin);
    seenUrls.add(canonicalUrl);
  }
  return [...byId.values()];
}

function numberFromUnknown(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function decodePinterestPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodedPinterestPathParts(url: URL) {
  return url.pathname.split("/").filter(Boolean).map(decodePinterestPart);
}

function pinterestScopeFromUrl(rawUrl: string) {
  const url = new URL(rawUrl.trim());
  const parts = decodedPinterestPathParts(url);
  return parts.length >= 3 ? { kind: "section" as const, username: parts[0], board: parts[1], section: parts.slice(2).join("/") } : { kind: "board" as const, username: parts[0], board: parts[1] };
}

function boardPartsFromUrl(rawUrl: string) {
  const scope = pinterestScopeFromUrl(rawUrl);
  return { username: scope.username, board: scope.board };
}

function isPinterestVideoPin(pin: PinterestPidgetPin) {
  return /video|story/i.test(`${pin.type ?? ""} ${pin.media_type ?? ""}`) || Boolean(pin.videos || pin.story_pin_data);
}

function isHeicImageUrl(url?: string) {
  return /\.(heic|heif)(?:[?#]|$)/i.test(url ?? "") || /[?&](fm|format)=hei[cf]\b/i.test(url ?? "");
}

function bestPinterestImageUrl(pin: PinterestPidgetPin) {
  const images = Object.values(pin.images ?? {}).filter((image) => image.url);
  return images
    .sort((a, b) => Number(isHeicImageUrl(a.url)) - Number(isHeicImageUrl(b.url)) || (b.width ?? 0) - (a.width ?? 0))[0]
    ?.url;
}

async function downloadImage(pin: PinterestBoardPin, cachePath: string, signal?: AbortSignal): Promise<LocalImageRef> {
  const response = await fetch(pin.imageUrl, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const url = new URL(pin.imageUrl);
  const urlExtension = path.extname(url.pathname).toLowerCase() || ".jpg";
  const extension = imageExtensionFromContentType(response.headers.get("content-type"), urlExtension);
  const hash = createHash("sha256").update(pin.id).digest("hex");
  const filePath = path.join(cachePath, `${hash}${extension}`);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    await writeFile(filePath, bytes);
    fileStat = await stat(filePath);
  }
  const downloadedImage: LocalImageRef = {
    id: `pinterest:${pin.id}`,
    externalId: pin.id,
    sourceUrl: pin.imageUrl,
    name: path.basename(filePath),
    path: filePath,
    url: pathToFileURL(filePath).toString(),
    modifiedAt: fileStat.mtime.toISOString(),
    size: fileStat.size,
    mediaType: pin.mediaType ?? "image",
    videoThumbnail: pin.mediaType === "video"
  };
  return makePinterestImageRenderable(downloadedImage, bytes);
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("canceled"));
}

export class LocalFileProvider {
  id = "local-file" as const;

  createSource(images: LocalImageRef[]): ImageSource {
    return {
      id: `source-${randomUUID()}`,
      providerId: "local-file",
      type: "local-file",
      name: images.length === 1 ? images[0].name : `${images.length} local images`,
      images,
      mediaPolicy: "images-and-video-thumbnails",
      mediaCounts: { total: images.length, images: images.filter((image) => image.mediaType !== "video").length, videos: images.filter((image) => image.mediaType === "video").length },
      importStatus: "ready",
      updatedAt: new Date().toISOString()
    };
  }
}

function boardNameFromUrl(rawUrl: string) {
  const url = new URL(rawUrl.trim());
  const parts = url.pathname.split("/").filter(Boolean);
  const board = parts.at(-1) ?? "Pinterest Board";
  return board
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

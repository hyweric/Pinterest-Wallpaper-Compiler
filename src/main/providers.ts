import { mkdir, rm, stat, writeFile } from "node:fs/promises";
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
}

export interface PublicPinterestBoardResult {
  pins: PinterestBoardPin[];
  total?: number;
  log?: string[];
}

export type PublicPinterestBoardLoader = (
  url: string,
  options: {
    signal?: AbortSignal;
    expectedTotal?: number;
    onProgress?: (current: number, total?: number, message?: string, page?: number) => void;
  }
) => Promise<PublicPinterestBoardResult>;

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

  const parts = url.pathname.split("/").filter(Boolean);
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

    report("validating", 0, undefined, 2, "Validating Pinterest board URL...");
    const validationError = this.validate(input);
    if (validationError) {
      return failureResult(validationError, [validationError]);
    }

    const existing = input.existingSource;
    await mkdir(this.cacheRoot, { recursive: true });
    const sourceId = existing?.id ?? `source-${randomUUID()}`;
    const sourceCachePath = existing?.cachePath ?? path.join(this.cacheRoot, sourceId);
    await mkdir(sourceCachePath, { recursive: true });

    const log = ["Pinterest URL validated."];
    let pins: PinterestBoardPin[] = [];
    let expectedCount: number | undefined;
    let finalBookmark: string | undefined;
    let pageCount: number | undefined;
    let discoveryError: string | undefined;

    try {
      report("discovering", 0, undefined, 5, "Discovering board pins...");
      if (input.accessToken && input.boardId) {
        const official = await this.loadOfficialBoard(input, report, signal);
        pins = official.pins;
        finalBookmark = official.bookmark;
        pageCount = official.pageCount;
        discoveryError = official.partialError;
        log.push(`Official API returned ${pins.length} unique pins across ${pageCount} pages.`);
        if (official.partialError) log.push(official.partialError);
      } else {
        const publicResult = await this.loadPublicBoard(input.url, report, signal);
        pins = publicResult.pins;
        expectedCount = publicResult.total;
        log.push(...(publicResult.log ?? []));
      }
    } catch (error) {
      if (isAbortError(error)) {
        const source = await this.buildSource({
          existing,
          sourceId,
          sourceCachePath,
          input,
          images: existing?.images ?? [],
          log: [...log, "Import canceled. Cached images were preserved."],
          expectedCount,
          importStatus: "canceled",
          bookmark: finalBookmark
        });
        report("canceled", source.images.length, expectedCount, 100, "Pinterest import canceled.");
        return {
          canceled: true,
          ok: false,
          source,
          imagesFound: pins.length,
          imagesCached: source.images.length,
          progress: 100,
          log: source.importLog ?? [],
          page: pageCount,
          bookmark: finalBookmark,
          error: "Pinterest import canceled. Run Update from Web to resume; cached pins will not be downloaded again."
        };
      }
      discoveryError = error instanceof Error ? error.message : "Unable to retrieve Pinterest board.";
      log.push(discoveryError);
    }

    const uniquePins = dedupePins(pins);
    if (uniquePins.length === 0) {
      if (!existing) await rm(sourceCachePath, { recursive: true, force: true });
      const message =
        "Pinterest import unavailable. This public board could not be fully read. Pinterest may be blocking automated access or may require a supported integration.";
      report("error", 0, expectedCount, 100, message, pageCount, finalBookmark);
      return {
        ok: false,
        imagesFound: 0,
        imagesCached: existing?.images.length ?? 0,
        progress: 100,
        log,
        page: pageCount,
        bookmark: finalBookmark,
        error: message
      };
    }

    const existingByPinId = new Map(
      (existing?.images ?? [])
        .filter((image) => image.externalId)
        .map((image) => [image.externalId as string, image])
    );
    const importedImages = new Map<string, LocalImageRef>();
    for (const image of existing?.images ?? []) {
      if (image.externalId) importedImages.set(image.externalId, image);
    }

    const missingPins = uniquePins.filter((pin) => {
      const cached = existingByPinId.get(pin.id);
      return !cached || cached.sourceUrl !== pin.imageUrl;
    });
    log.push(`Discovered ${uniquePins.length} unique pins; ${missingPins.length} need downloading.`);

    let completed = 0;
    const concurrency = 6;
    for (let offset = 0; offset < missingPins.length; offset += concurrency) {
      if (signal?.aborted) {
        const canceledImages = [...importedImages.values()];
        const source = await this.buildSource({
          existing,
          sourceId,
          sourceCachePath,
          input,
          images: canceledImages,
          log: [...log, "Import canceled during download. Cached pins were preserved."],
          expectedCount,
          importStatus: "canceled",
          bookmark: finalBookmark
        });
        report("canceled", canceledImages.length, expectedCount ?? uniquePins.length, 100, "Pinterest import canceled.", pageCount, finalBookmark);
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
          error: "Pinterest import canceled. Run Update from Web to resume; cached pins will not be downloaded again."
        };
      }
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
        if (image?.externalId) importedImages.set(image.externalId, image);
      }
      completed += batch.length;
      if (signal?.aborted) {
        const canceledImages = [...importedImages.values()];
        const source = await this.buildSource({
          existing,
          sourceId,
          sourceCachePath,
          input,
          images: canceledImages,
          log: [...log, "Import canceled during download. Cached pins were preserved."],
          expectedCount,
          importStatus: "canceled",
          bookmark: finalBookmark
        });
        report("canceled", canceledImages.length, expectedCount ?? uniquePins.length, 100, "Pinterest import canceled.", pageCount, finalBookmark);
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
          error: "Pinterest import canceled. Run Update from Web to resume; cached pins will not be downloaded again."
        };
      }
      const total = missingPins.length;
      const overall = total === 0 ? 95 : 40 + Math.round((completed / total) * 55);
      report(
        "downloading",
        importedImages.size,
        expectedCount ?? uniquePins.length,
        overall,
        `Cached ${importedImages.size} / ${expectedCount ?? uniquePins.length} pins...`,
        pageCount,
        finalBookmark
      );
    }

    const orderedImages = uniquePins
      .map((pin) => importedImages.get(pin.id))
      .filter((image): image is LocalImageRef => Boolean(image));
    const extras = [...importedImages.entries()]
      .filter(([pinId]) => !uniquePins.some((pin) => pin.id === pinId))
      .map(([, image]) => image);
    const images = [...orderedImages, ...extras];

    const incompleteByCount = expectedCount !== undefined && uniquePins.length < expectedCount;
    const incompleteByDownload = images.length < uniquePins.length;
    const partial = Boolean(discoveryError || incompleteByCount || incompleteByDownload || finalBookmark);
    const status: ImageSource["importStatus"] = partial ? "partial" : "ready";
    if (incompleteByCount) log.push(`Partial discovery: found ${uniquePins.length} of approximately ${expectedCount} board pins.`);
    if (incompleteByDownload) log.push(`Partial cache: cached ${images.length} of ${uniquePins.length} discovered pins.`);
    if (finalBookmark) log.push(`Pagination stopped with bookmark ${finalBookmark}.`);

    const source = await this.buildSource({
      existing,
      sourceId,
      sourceCachePath,
      input,
      images,
      log,
      expectedCount,
      importStatus: status,
      bookmark: finalBookmark
    });

    const error = partial
      ? `Partial import: cached ${images.length} pins${expectedCount ? ` of approximately ${expectedCount}` : ""}. Use Update from Web to resume.`
      : undefined;
    report(partial ? "partial" : "complete", images.length, expectedCount ?? uniquePins.length, 100, error ?? `Imported all ${images.length} pins.`, pageCount, finalBookmark);

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
      bookmark: finalBookmark
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
      expectedCount = numberFromUnknown(json.data.board?.pin_count ?? json.data.board?.pins_count);
      for (const pin of json.data.pins) {
        const imageUrl = bestPinterestImageUrl(pin);
        if (pin.id && imageUrl) initialPins.push({ id: pin.id, imageUrl, mediaType: isPinterestVideoPin(pin) ? "video" : "image" });
      }
      log.push(`Initial public endpoint returned ${initialPins.length} pins${expectedCount ? ` of approximately ${expectedCount}` : ""}.`);
    } catch (error) {
      log.push(error instanceof Error ? error.message : "Initial public endpoint was unavailable.");
    }

    if (!this.publicBoardLoader) {
      return { pins: initialPins, total: expectedCount, log };
    }

    try {
      const browserResult = await this.publicBoardLoader(url, {
        signal,
        expectedTotal: expectedCount,
        onProgress: (current, total, message, page) =>
          report("paginating", current, total ?? expectedCount, 8 + Math.min(30, Math.round((current / Math.max(total ?? expectedCount ?? current, 1)) * 30)), message ?? `Importing page ${page ?? 1}: ${current} pins found`, page)
      });
      return {
        pins: dedupePins([...initialPins, ...browserResult.pins]),
        total: browserResult.total ?? expectedCount,
        log: [...log, ...(browserResult.log ?? [])]
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      log.push(`Full-board loader stopped: ${error instanceof Error ? error.message : "unknown error"}`);
      return { pins: initialPins, total: expectedCount, log };
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
    const headers = { Authorization: `Bearer ${token}` };
    const allPins: OfficialPinterestPin[] = [];
    let finalBookmark: string | undefined;
    let pageCount = 0;
    let partialError: string | undefined;

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
          onProgress: ({ page, itemCount, bookmark }) =>
            report("paginating", itemCount, undefined, Math.min(35, 8 + page * 3), `Loaded API page ${page}: ${itemCount} pins`, page, bookmark)
        }
      );
      allPins.push(...boardPins.items);
      pageCount += boardPins.pageCount;
    } catch (error) {
      if (error instanceof PinterestPaginationError) {
        allPins.push(...(error.items as OfficialPinterestPin[]));
        pageCount += error.pageCount;
        finalBookmark = error.bookmark;
        partialError = error.message;
      } else {
        throw error;
      }
    }

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

      for (const section of sections.items) {
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
            { signal }
          );
          allPins.push(...sectionPins.items);
          pageCount += sectionPins.pageCount;
        } catch (error) {
          if (error instanceof PinterestPaginationError) {
            allPins.push(...(error.items as OfficialPinterestPin[]));
            pageCount += error.pageCount;
            finalBookmark = error.bookmark;
            partialError = partialError ?? `Section ${section.id}: ${error.message}`;
          } else {
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

    return {
      pins: dedupePins(allPins.map(officialPinToBoardPin).filter((pin): pin is PinterestBoardPin => Boolean(pin))),
      bookmark: finalBookmark,
      pageCount,
      partialError
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
      importCursor: input.bookmark,
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
  type?: string;
  media_type?: string;
  videos?: unknown;
  story_pin_data?: unknown;
  images?: Record<string, { url?: string; width?: number; height?: number }>;
}

interface OfficialPinterestPin {
  id: string;
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
  return pin.id && image?.url ? { id: pin.id, imageUrl: image.url, mediaType: /video/i.test(`${pin.media_type ?? ""} ${pin.media?.media_type ?? ""}`) ? "video" : "image" } : undefined;
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
    if (!pin.id || !pin.imageUrl) continue;
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

function boardPartsFromUrl(rawUrl: string) {
  const url = new URL(rawUrl.trim());
  const [username, board] = url.pathname.split("/").filter(Boolean);
  return { username, board };
}

function isPinterestVideoPin(pin: PinterestPidgetPin) {
  return /video|story/i.test(`${pin.type ?? ""} ${pin.media_type ?? ""}`) || Boolean(pin.videos || pin.story_pin_data);
}

function bestPinterestImageUrl(pin: PinterestPidgetPin) {
  const images = Object.values(pin.images ?? {}).filter((image) => image.url);
  return images.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
}

async function downloadImage(pin: PinterestBoardPin, cachePath: string, signal?: AbortSignal): Promise<LocalImageRef> {
  const response = await fetch(pin.imageUrl, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const url = new URL(pin.imageUrl);
  const extension = path.extname(url.pathname) || ".jpg";
  const hash = createHash("sha256").update(pin.id).digest("hex");
  const filePath = path.join(cachePath, `${hash}${extension}`);
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, bytes);
  }
  return {
    id: `pinterest:${pin.id}`,
    externalId: pin.id,
    sourceUrl: pin.imageUrl,
    name: path.basename(filePath),
    path: filePath,
    url: pathToFileURL(filePath).toString(),
    modifiedAt: new Date().toISOString(),
    size: bytes.length,
    mediaType: pin.mediaType ?? "image",
    videoThumbnail: pin.mediaType === "video"
  };
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

export interface PinterestPage<T> {
  items: T[];
  bookmark?: string | null;
}

export interface PinterestPaginationProgress {
  page: number;
  itemCount: number;
  bookmark?: string;
}

export class PinterestPaginationError<T extends { id: string }> extends Error {
  constructor(
    message: string,
    readonly items: T[],
    readonly pageCount: number,
    readonly bookmark?: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "PinterestPaginationError";
  }
}

export async function collectPinterestPages<T extends { id: string }>(
  fetchPage: (bookmark?: string) => Promise<PinterestPage<T>>,
  options: {
    initialBookmark?: string;
    signal?: AbortSignal;
    onProgress?: (progress: PinterestPaginationProgress) => void;
    maxPages?: number;
    maxItems?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  } = {}
): Promise<{ items: T[]; pageCount: number; finalBookmark?: string; limitReached?: boolean }> {
  const seen = new Map<string, T>();
  const seenBookmarks = new Set<string>();
  let bookmark = options.initialBookmark;
  let page = 0;
  const maxPages = options.maxPages ?? 10_000;
  const maxItems = Math.max(1, Math.floor(options.maxItems ?? Number.MAX_SAFE_INTEGER));
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 350;

  while (page < maxPages) {
    if (options.signal?.aborted) throw new DOMException("Pinterest import canceled.", "AbortError");
    if (bookmark && seenBookmarks.has(bookmark)) {
      throw new PinterestPaginationError(
        `Pinterest pagination repeated bookmark ${bookmark} on page ${page + 1}.`,
        [...seen.values()],
        page,
        bookmark
      );
    }
    if (bookmark) seenBookmarks.add(bookmark);

    let response: PinterestPage<T> | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        response = await fetchPage(bookmark);
        break;
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) throw new DOMException("Pinterest import canceled.", "AbortError");
        if (attempt < maxRetries) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
    if (!response) {
      throw new PinterestPaginationError(
        `Pinterest pagination stopped before page ${page + 1}${bookmark ? ` at bookmark ${bookmark}` : ""}: ${lastError instanceof Error ? lastError.message : "request failed"}`,
        [...seen.values()], page, bookmark, lastError
      );
    }

    page += 1;
    for (const item of response.items) seen.set(item.id, item);
    const next = response.bookmark ?? undefined;
    const uniqueItems = [...seen.values()];
    const limitedItems = uniqueItems.slice(0, maxItems);
    options.onProgress?.({ page, itemCount: limitedItems.length, bookmark: next });

    if (uniqueItems.length >= maxItems) {
      return {
        items: limitedItems,
        pageCount: page,
        finalBookmark: next,
        limitReached: uniqueItems.length > maxItems || Boolean(next)
      };
    }
    if (!next) return { items: uniqueItems, pageCount: page, limitReached: false };
    bookmark = next;
  }

  throw new PinterestPaginationError(
    `Pinterest pagination exceeded ${maxPages} pages.`,
    [...seen.values()],
    page,
    bookmark
  );
}

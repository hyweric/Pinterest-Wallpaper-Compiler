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
  } = {}
): Promise<{ items: T[]; pageCount: number; finalBookmark?: string }> {
  const seen = new Map<string, T>();
  const seenBookmarks = new Set<string>();
  let bookmark = options.initialBookmark;
  let page = 0;
  const maxPages = options.maxPages ?? 10_000;

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

    let response: PinterestPage<T>;
    try {
      response = await fetchPage(bookmark);
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException("Pinterest import canceled.", "AbortError");
      throw new PinterestPaginationError(
        `Pinterest pagination stopped before page ${page + 1}${bookmark ? ` at bookmark ${bookmark}` : ""}: ${error instanceof Error ? error.message : "request failed"}`,
        [...seen.values()],
        page,
        bookmark,
        error
      );
    }

    page += 1;
    for (const item of response.items) seen.set(item.id, item);
    options.onProgress?.({ page, itemCount: seen.size, bookmark: response.bookmark ?? undefined });

    const next = response.bookmark ?? undefined;
    if (!next) return { items: [...seen.values()], pageCount: page };
    bookmark = next;
  }

  throw new PinterestPaginationError(
    `Pinterest pagination exceeded ${maxPages} pages.`,
    [...seen.values()],
    page,
    bookmark
  );
}

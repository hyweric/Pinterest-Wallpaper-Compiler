import test from "node:test";
import assert from "node:assert/strict";
import { collectPinterestPages } from "./pinterest-pagination.js";

test("collects and deduplicates a mocked 700-pin Pinterest board across bookmarks", async () => {
  const pins = Array.from({ length: 700 }, (_, index) => ({ id: `pin-${index + 1}` }));
  const pageSize = 250;
  const calls: Array<string | undefined> = [];

  const result = await collectPinterestPages(async (bookmark) => {
    calls.push(bookmark);
    const start = bookmark ? Number(bookmark) : 0;
    const items = pins.slice(start, start + pageSize);
    // Deliberately repeat one item on later pages to verify ID-based deduplication.
    if (start > 0) items.push(pins[start - 1]);
    const next = start + pageSize < pins.length ? String(start + pageSize) : undefined;
    return { items, bookmark: next };
  });

  assert.equal(result.items.length, 700);
  assert.equal(result.pageCount, 3);
  assert.deepEqual(calls, [undefined, "250", "500"]);
});

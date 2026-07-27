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


test("retries a transient failed page without losing collected items", async () => {
  let attempts = 0;
  const result = await collectPinterestPages(async (bookmark) => {
    if (!bookmark) return { items: [{ id: "a" }], bookmark: "next" };
    attempts += 1;
    if (attempts === 1) throw new Error("temporary network error");
    return { items: [{ id: "b" }] };
  }, { retryDelayMs: 1 });
  assert.deepEqual(result.items.map((item) => item.id), ["a", "b"]);
  assert.equal(attempts, 2);
});

test("stops on a repeated bookmark instead of looping forever", async () => {
  await assert.rejects(
    collectPinterestPages(async () => ({ items: [{ id: "a" }], bookmark: "same" }), { retryDelayMs: 1 }),
    /repeated bookmark/
  );
});

test("stops pagination at the configured unique item limit and preserves the next bookmark", async () => {
  const pins = Array.from({ length: 1_500 }, (_, index) => ({ id: `pin-${index + 1}` }));
  const calls: Array<string | undefined> = [];
  const result = await collectPinterestPages(async (bookmark) => {
    calls.push(bookmark);
    const start = bookmark ? Number(bookmark) : 0;
    const next = start + 250 < pins.length ? String(start + 250) : undefined;
    return { items: pins.slice(start, start + 250), bookmark: next };
  }, { maxItems: 1_000 });

  assert.equal(result.items.length, 1_000);
  assert.equal(result.pageCount, 4);
  assert.equal(result.limitReached, true);
  assert.equal(result.finalBookmark, "1000");
  assert.deepEqual(calls, [undefined, "250", "500", "750"]);
});

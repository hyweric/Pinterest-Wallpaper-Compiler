# Phase 14 Report

## Implemented

- Extended public Pinterest board discovery so it no longer stops after a short generic stable-count window.
- Added adaptive bottom-of-page settling, scroll-height tracking, bottom nudges, longer lazy-load allowance, load retries, and page-style progress messages.
- Official Pinterest bookmark pagination now retries transient page failures while preserving already collected items.
- Repeated bookmarks and page limits still terminate safely instead of looping forever.
- Pinterest pins are deduplicated by both pin ID and canonicalized image URL.
- Existing cached pins are preserved during update, retry, cancellation, partial discovery, and partial download.
- Import progress now reports messages such as `Importing page N: X pins found`.
- Existing source metadata continues to persist the cache path, imported count, expected count, completion status, and resume bookmark.

## Shared non-repeating selection

- Added a persistent shuffle state to each image source rather than keeping independent queues only on placeholders.
- Placeholders using the same Pinterest board or folder reserve unique images during one generation whenever enough images exist.
- Random and shuffle modes both use the persistent non-repeating source queue.
- Queue progress, cycle number, and each layer's last image are serialized with the project and survive schedules/restarts.
- A source is reshuffled only after its queue is exhausted.
- The same layer avoids receiving its immediately previous image at a cycle boundary when alternatives exist.
- Fixed placeholders do not consume the source queue, while their selected image is still avoided by shuffled placeholders when alternatives exist.
- Reuse occurs only when the available source pool is smaller than the number of requesting placeholders.

## Files changed

- `src/main/main.ts`
- `src/main/pinterest-pagination.ts`
- `src/main/pinterest-pagination.test.ts`
- `src/main/providers.ts`
- `src/main/source-selection.test.ts`
- `src/renderer/main.tsx`
- `src/renderer/project.ts`
- `src/shared/source-selection.ts`
- `src/shared/types.ts`

## Validation

- `npm run typecheck`: passed
- `npm test`: 53 passed, 0 failed
- `npm run build`: passed
- Mocked 700-pin bookmark pagination: passed
- Transient page retry: passed
- Repeated-bookmark loop prevention: passed
- Same-source multi-placeholder uniqueness: passed
- Queue continuation/persistence: passed
- Fixed-plus-shuffle behavior: passed
- Deterministic unavoidable reuse: passed

## Platform limitation

Pinterest can change or restrict its public board page at any time. This implementation imports the full board that Pinterest exposes to the public embedded session and clearly returns a partial result when the expected pin count cannot be reached. It does not bypass login walls, private-board permissions, CAPTCHAs, or anti-bot controls.

The sandbox could not download Electron from GitHub, so the final macOS packaged launch must be verified on the user's Mac. The TypeScript, renderer production, Electron main/preload, and automated test builds all passed.

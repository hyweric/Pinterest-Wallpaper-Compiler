# Phase 22.1.2 — Random Drop Image Aspect + Preview Refresh Fix

## Changes
- Source drops now choose exactly one random eligible image at drop time.
- The chosen image is immediately committed as the placeholder's displayed `generatedImageId`.
- The placeholder aspect ratio is measured from that exact chosen image, not a separate first/source image candidate.
- Dropped source placeholders stay rounded and use Fill/Cover by default.
- Preview on Current Desktop no longer manually advances and then runs generation again; it runs one generation selection from the current state, preventing two-image sources from bouncing back to the same visible image.
- Existing Add Placeholder left alignment from Phase 22.1.1 is preserved.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 208/208.
- `npm run build` passed.

# Phase 22.1.1 Hotfix — Aspect Ratio, Preview Refresh, Add Placeholder Alignment

## Scope

This hotfix targets the remaining Phase 22.1 regressions reported after a full reset:

- Dragged sources/placeholders were still not reliably matching the actual chosen image aspect ratio.
- Preview on Current Desktop did not visibly advance to another source image.
- Add Placeholder needed to be left-aligned in the top bar.

## Changes

### Drag-created placeholder aspect ratio

- Converted canvas source placement to an async flow so the renderer can decode image dimensions before final frame sizing.
- Added `decodedImageAspectRatio()` as a fallback for sources/images missing stored width/height.
- Final drop placement now sizes from the actual image assigned by source selection, not only source metadata.
- If an image is decoded successfully, the project stores a synthetic measured width/height for that image so future sizing is stable.
- Drag-created placeholders still default to rounded and `cover` fill mode.

### Preview on Current Desktop refresh

- Added `advancePreviewProjectImages()` before preview generation.
- Preview now explicitly advances each eligible selected source placeholder to the next image when more than one image is available, then renders/applies that advanced state.
- This makes Preview on Current Desktop function like a manual rotation action rather than re-rendering the same image.

### Top toolbar alignment

- Added Phase 22.1.1 CSS override so Add Placeholder is left-aligned while the main toolbar actions remain stable and the canvas remains the scrollable area.

## Validation

- `npm run typecheck` passed.
- `npm test` passed: 206/206.
- `npm run build` passed.

# Phase 20.1 Report — Overlay Placement, Transparency, and Background UI Fixes

## Summary
Phase 20.1 fixes the overlay and transparent-image regressions reported after Phase 20. It keeps the Phase 20 cleanup intact while making Add Overlay behave like normal canvas placement, preserving transparent image alpha, and improving small UI readability issues.

## Completed work

### Overlay placement
- Replaced the custom square Add Overlay frame with the same canvas placement path used for drag/drop.
- Add Overlay now places the managed overlay at the center of the canvas through `placeSourcesAtCanvasPoint`.
- Managed overlays are still copied into the app-owned Overlay Images folder and saved as managed project assets.
- Managed overlays are fixed to their single imported image and do not depend on temporary source file paths.
- Overlay layers are no longer aspect-ratio locked by default.

### Transparent images
- Added shared transparent-image detection for PNG, WebP, GIF, and AVIF.
- New transparent-capable dropped images use transparent layer backgrounds instead of white fill.
- Managed overlay sources are always treated as transparent-overlay-like.
- Editor preview now uses transparent backgrounds for transparent-capable images.
- Export rendering also skips the inner background fill for transparent-capable images, so PNG/WebP overlays export with preserved alpha.

### Background controls
- Color/Image segmented controls now have a clearer active state.
- The selected button gets a visible tint, border, and elevation.

### Assign source readability
- Increased empty-placeholder Assign source text size and icon size.
- Kept typography aligned with the existing UI style.

## Tests added
- Transparent-capable images render without forced white backgrounds.
- Managed overlay sources are recognized as overlay-like.
- Add Overlay reuses canvas placement instead of the old square contain frame.
- Dropped transparent images and overlays receive transparent, non-framed placement defaults.
- Background active state and Assign source readability CSS are present.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 195/195.
- `npm run build` passed.

## Files touched
- `src/shared/image-transparency.ts`
- `src/renderer/main.tsx`
- `src/renderer/exporter.ts`
- `src/renderer/project.ts`
- `src/renderer/styles.css`
- `src/main/phase20-1-regression.test.ts`

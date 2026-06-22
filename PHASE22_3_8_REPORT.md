# Phase 22.3.8 — Paper Style Cleanup

## Scope
- Removed the Clean Paper effect option from the visible Effects tab.
- Migrated legacy clean/newsprint/photo-print frame types to Polaroid during project normalization.
- Removed the Polaroid Border Size slider from the inspector.
- Replaced the broken Texture slider with a two-option texture selector: Paper or Crumpled Paper.
- Kept Polaroid's previous simple frame behavior and defaults; only removed the extra Border Size control.

## Risk review
- Rendering/export data structures were not removed; legacy projects remain loadable because the old frame type union is preserved and normalized.
- The new texture selector writes to the existing per-layer `effects.paper` surface field, reusing the same bundled Paper/Crumpled Paper assets and defaults used by the main background Surface tab.
- No drag/drop, preview, wallpaper application, source assignment, export set, or toolbar behavior was changed.

## Validation
- npm run typecheck: passed
- npm test: passed, 222/222
- npm run build: passed
- package-lock internal registry audit: passed
- zip hygiene check: passed
- installer bash syntax check: passed

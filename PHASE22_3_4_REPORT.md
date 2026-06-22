# Phase 22.3.4 — Inspector Layer Name Trim

## Scope

This is a focused UI polish patch on top of Phase 22.3.3.

## Changes

- Removed the selected layer name heading that appeared directly under the Image / Effects tabs in the right inspector.
- Left the Image / Effects tabs intact.
- Left all inspector controls, layer list labels, hidden-layer restore labels, rename behavior, rendering, drag/drop, generation, and export logic unchanged.

## Risk Review

- The removed element was presentation-only inside `SelectedLayerInspector`.
- It did not feed any state, layout calculations, rendering, source assignment, wallpaper generation, or persistence logic.
- Existing layer names remain available in the left Layers panel and still persist normally.

## Validation

- `npm ci --ignore-scripts` passed.
- `npm run typecheck` passed.
- `npm test` passed: 215/215.
- `npm run build` passed.
- Package-lock internal registry audit passed.
- Zip hygiene excludes dependency/build artifacts.

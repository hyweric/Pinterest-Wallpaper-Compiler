# Phase 20.4 — Dragged Source Next Image Fix

## Summary
Fixed the regression where dragging a source/image set from the left library onto the canvas created a visually correct placeholder but prevented the **Next Image** action from cycling the assigned image pool.

## User-facing changes
- Dragging a library source onto the canvas now behaves like a normal placeholder plus source assignment.
- Dragged transparent-capable sources still use transparent, unframed visual defaults when appropriate.
- Transparent/overlay-like sources are no longer forced into fixed-image mode.
- **Next Image** now cycles the assigned pool for dragged-in multi-image sources.
- Single-image sources remain fixed because there is no alternate image to cycle.

## Root cause
Phase 20.1 added transparent-overlay handling that forced overlay-like sources into `sourceState.mode = "fixed"`. That helped one-off transparent overlays, but after Add Overlay was removed and sidebar/canvas dragging became the intended workflow, this made dropped transparent-capable image collections behave differently from normal placeholders. The inspector button still appeared, but the selection state could not advance.

## Implementation
- Updated `placeSourcesAtCanvasPoint` so assignment always uses `projectWithSourcesAssignment` as the source of truth.
- Kept transparent placeholder styling: transparent image background, no frame, no shadow for overlay-like images.
- Removed the forced fixed-mode override for overlay-like dropped sources.
- Added a Phase 20.4 regression test proving the render path no longer writes `mode: "fixed"` during canvas placement.
- Added a functional test proving a transparent two-image source in shuffle mode advances from one image to the next.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 204/204.
- `npm run build` passed.
- ZIP integrity passed.
- Installer syntax passed.

## Notes
`npm run app:dir` is still left to the macOS installer because this Linux container cannot reliably complete Electron app packaging when electron-builder reaches out to GitHub.

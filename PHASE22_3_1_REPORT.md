# Phase 22.3.1 — Toolbar Controls + Effects Section Trim

## Scope
- Restore selected-layer top/floating toolbar controls removed in Phase 22.3.
- Remove the extra **Frame Style** effects accordion.
- Do not touch drag/drop, preview rotation, app-level toolbar behavior, source handling, generation, export, or wallpaper apply code.

## Changes
- `ContextToolbar` now keeps compact Fill/Fit/Crop/Zoom controls and restores icon controls for:
  - Move layer up
  - Move layer down
  - Duplicate layer
  - Hide layer
  - Lock layer
- Delete remains absent from the floating toolbar per the earlier simplification request.
- Polaroid and Torn Paper controls now live inside the **Paper** section, under the selected paper style.
- Effects tab now has two visible sections:
  - Paper
  - Shadow and Blend

## Risk review
- This patch only changes renderer UI wiring and CSS.
- No source-selection, image-cache, generation, export, macOS wallpaper, project schema, or preload/main process behavior was changed.
- Existing frame effect data remains compatible; controls are moved, not removed from data structures.
- Layer actions call existing reorder/duplicate and layer patch paths already used elsewhere.

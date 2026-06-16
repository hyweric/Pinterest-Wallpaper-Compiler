# Phase 17.1 Report - Sourced Surface Refresh

## Summary
This follow-up phase keeps the deterministic Phase 17 canvas-wide surface renderer, but replaces the previous curated pack with the user-requested sourced paper surfaces.

## What changed
- Replaced the bundled surface picker set with:
  - Paper
  - Crumpled Paper
  - Grid Paper
  - Dotted Paper
- Used the uploaded Archive.zip textures as the source for Paper and Crumpled Paper.
- Generated matching bundled thumbnails for every new surface.
- Kept the same shared renderer path for editor preview, export, preview apply, and wallpaper-set generation.
- Preserved custom textures and all existing surface controls:
  - enable toggle
  - intensity
  - opacity
  - scale
  - noise / grain
  - roughness
  - light / dark
  - rotation
  - blend mode
  - texture seed
  - regenerate texture
- Added compatibility aliases so older projects using fine-grain, matte-photo, recycled, handmade, or canvas still resolve to the new bundled set instead of breaking.
- Increased zoom responsiveness by making wheel and step zoom a bit faster while keeping pointer-anchored canvas zoom behavior.

## Implementation notes
- New bundled assets live under `src/renderer/assets/textures/bundled/`.
- `src/shared/surfaces.ts` now describes the new 4-item manifest and old-to-new surface aliases.
- `src/renderer/surface-textures.ts` now imports the new assets and thumbnails.
- `src/renderer/surface-renderer.ts` uses a larger deterministic tile size and better procedural fallbacks for the new paper families if an asset fails to load.
- `src/renderer/main.tsx` and `src/renderer/exporter.ts` now use `paper` as the default fallback bundled surface instead of `fine-grain`.
- `src/shared/canvas-zoom.ts` now uses slightly faster multiplicative zoom steps.

## Validation status
- Exact dependencies installed with Electron binary download skipped for container validation.
- Renderer and Electron TypeScript checks passed.
- 135/135 automated tests passed.
- Production renderer and Electron builds passed.
- Phase 17.1.1 fixes the stale Phase 16.3 regression assertion so it expects the intentional faster wheel coefficient of 0.0032 rather than the previous 0.002.

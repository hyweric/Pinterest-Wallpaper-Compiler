# Phase 22.3.9 — Polaroid Borders + Visible Texture Fix

## Scope
- Restored per-side Polaroid border controls without returning the generic Border Size slider.
- Fixed the clipped Reset Photo Placement button by making it a full-width action row.
- Replaced the frame texture preview with the same canvas-based surface renderer used by the main background Surface tab.
- Increased Paper/Crumpled Paper frame texture intensity so the selected texture is visibly different.

## UX/risk review
- Data model risk is low: Polaroid already persisted `borderTop`, `borderRight`, `borderBottom`, and `borderLeft`; this phase only exposes those existing fields.
- Rendering risk is controlled: export already used `drawSurfaceTexture`; the editor preview now uses the same renderer instead of a weaker CSS-only background.
- UI complexity is moderate and intentional: four border fields are specific to Polaroid and do not reintroduce the removed Clean Paper path.
- No drag/drop, source assignment, wallpaper targeting, export-set, or preview-current-desktop logic was changed.

## Validation
- npm ci --ignore-scripts: pass
- npm run typecheck: pass
- npm test: pass, 225/225
- npm run build: pass

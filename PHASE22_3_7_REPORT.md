# Phase 22.3.7 — Effects Copy Cleanup + Texture Controls

## Scope
- Base: Phase 22.3.6 toolbar shell fix source package uploaded by the user.
- Kept this as a narrow UI polish patch.
- Did not change drag/drop, wallpaper preview/apply, source selection, generation, export set, or desktop targeting logic.

## Changes
- Removed visible helper/internal copy from the Effects inspector.
- Renamed the simplified Paper slider from Wrinkles to Texture.
- Added Clean Paper Border Size control.
- Kept Clean Paper controls to: Style, Paper color, Texture, Border Size, Shadow and Blend.
- Removed leftover internal-note styling that no longer has UI.
- Made the single Settings tab neutral instead of blue-highlighted.

## Validation
- npm ci --ignore-scripts: passed
- npm run typecheck: passed
- npm test: passed, 219 tests
- npm run build: passed
- package-lock internal registry audit: passed
- zip hygiene and installer syntax checks: passed

## Risk review
- Texture uses the existing paper-frame texture rendering pipeline, so no new render/export system was added.
- Border Size updates existing `paperFrame.borderWidth` and sets `innerPadding` to zero for predictable Clean Paper sizing.
- Settings-tab change is CSS-only and scoped to `.settings-inspector-tabs`.
- No project schema migration needed.

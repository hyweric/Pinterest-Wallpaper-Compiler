# Phase 20.2 Report — Placeholder/Surface UI Cleanup

## Scope

Phase 20.2 is a focused usability cleanup on top of Phase 20.1.

## Changes

- Removed the visible **Add Overlay** toolbar button.
- Kept the managed overlay import backend in place for compatibility, but no longer exposes it in the main toolbar.
- Empty/unassigned placeholders now remain neutral gray and ignore paper/frame styling until an image source is assigned.
- Assigned transparent images keep transparent interiors, because the neutral gray styling is scoped only to unassigned placeholders.
- Enlarged the on-canvas **Assign source** prompt and icon.
- Restyled Background **Color/Image** active state to match the app's primary **Create Wallpaper Set** shade.
- Reworked bundled surface cards to use neutral swatches instead of inconsistent preview images.
- Made surface cards uniform and more compact.
- Tightened slider spacing, track height, and thumb sizing for a smoother minimal look.
- Added max-height and vertical scrolling to popover menus so overflowing dropdown-style menus remain usable.

## Tests Added/Updated

- Regression coverage for neutral unassigned placeholders.
- Regression coverage that the visible Add Overlay button is gone.
- Regression coverage for Color/Image active-state styling.
- Regression coverage for neutral surface swatches.
- Regression coverage for compact slider styling.
- Regression coverage for scrollable menus.

## Validation

- `npm test`: 197/197 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Fresh ZIP extraction validation passed with dependency installation, typecheck, tests, and production build.
- ZIP integrity: passed.
- Installer syntax: passed.

## Note

`npm run app:dir` is expected to run on the user's Mac through the installer. In this Linux container, Electron binary download/package steps may fail because GitHub DNS access is unavailable.

# Phase 22.1 — Drag Aspect Ratio + Inspector/Layout Hotfix

## Base

Built from `pinterest-wallpaper-compiler-phase22-public-lock-fix.zip`.

## Changes

- Added local image width/height metadata during Finder/image/folder imports and Pinterest cache result enrichment.
- Updated canvas drop placement to accept an image aspect ratio and size the new placeholder to match the chosen image when dimensions are available.
- Updated source-card and Finder drops to behave like adding a rounded placeholder, assigning the source, using Fill/Cover, then sizing the frame to the assigned image aspect ratio.
- Adjusted shuffle generation so Preview on Current Desktop avoids reusing the current generated image when another image exists.
- Added Previous Image / Next Image controls for selected placeholders without changing generation/export duplicate-prevention logic.
- Fixed the right inspector header so Image / Effects / hide inspector stay on one row.
- Restored the softer blue/teal UI styling and removed the Phase 22 lavender/purple overrides.
- Re-centered slider thumbs with explicit Chromium range styling.
- Relaxed the right-panel form grid so Canvas Width/Height and dropdown fields are readable again.
- Kept the top toolbar fixed within the workspace while horizontal scrolling remains inside the canvas stage.
- Replaced the layer forward/back icons with larger, clearer stacked-layer arrow icons.

## Validation

- `npm run typecheck` passed.
- `npm test` passed: 205/205.
- `npm run build` passed.

`npm run app:dir` was not run in the container because Electron package installation scripts are skipped here to avoid external binary downloads. The installer runs a fresh `npm ci`, validation, package build, and app launch on macOS.

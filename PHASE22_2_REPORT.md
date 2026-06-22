# Phase 22.2 — Effects Simplification + Source Preview Hotfix

## Scope
Focused fixes only. No new providers, templates, text layers, or scheduler work.

## Functional fixes
- Source drops now choose one random starting image at drop time, assign that image to the new layer, and display it immediately.
- Source drops now use the same stable frame sizing as Add Placeholder instead of resizing the frame to the random image aspect ratio.
- Preview on Current Desktop now advances eligible source-backed layers once before rendering, with duplicate avoidance across the preview pass when possible.
- The floating canvas toolbar with Fill/Fit/Zoom/Crop now lives outside the horizontally scrollable canvas stage.

## Inspector simplification
- Removed Lock frame ratio from the inspector.
- Removed the Fit and Crop inspector category.
- Kept Previous Image / Next Image and Shuffle in Frame Position.
- Removed visible Delete Layer buttons from the right inspector, floating canvas toolbar, and layer context menu.
- Removed checkbox UI from the renderer.
- Simplified Effects to one Paper Frame section:
  - Style
  - Paper color
  - Wrinkles
  - Drop Shadow
  - Blend
- Polaroid controls reduced to:
  - Border Size
  - Corner Radius
  - Reset Photo Placement
- Torn Paper controls reduced to:
  - Tear Depth
  - Ridge Count
  - Regenerate Tear

## Compatibility notes
- Existing saved effect data still normalizes and renders; the UI simply hides advanced legacy controls.
- Export/render code was not rewritten, preserving existing wallpaper and set generation behavior.
- The shared duplicate-prevention generation path is unchanged.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 208/208.
- `npm run build` passed.
- `npm run app:dir` reached electron-builder packaging but could not download Electron from GitHub in this container (`getaddrinfo EAI_AGAIN github.com`). The Mac installer runs this step with normal network access.

# Phase 22.3.10.8 — Adaptive Aspect Frame Mode

## Summary
- Added a new placeholder `frameMode` with `fixed` and `adaptive` modes.
- Fixed Shape remains the default and preserves existing placeholder behavior.
- Adaptive Aspect treats the stored layer rectangle as a target visual-size box and computes the rendered frame from the selected image's natural aspect ratio.
- Adaptive frames keep the same center anchor while preserving approximately the same target area.
- Adaptive image rendering uses Fit/Contain with centered alignment and reset crop so the whole image is visible.

## UI
- Added a compact Frame Mode toggle in the Image inspector under Frame Position.
- Adaptive Aspect shows Target W / Target H controls because resizing changes the target visual size, not a permanent crop shape.
- Fill/Crop/Zoom quick controls are disabled while Adaptive Aspect is active so the mode keeps the whole image visible.

## Rendering
- Canvas rendering, selection overlay, paper frames, torn edges, shadows, filters, texture overlays, and export rendering use the computed adaptive frame bounds.
- Selection marquee hit-testing now checks computed adaptive bounds.
- Export/wallpaper generation resolves adaptive dimensions from loaded image dimensions, so saved wallpapers match the editor view.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 251/251.
- `npm run build` passed.

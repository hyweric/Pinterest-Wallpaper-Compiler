# Phase 16.3 Report — Smooth Canvas Zooming

## Summary

Phase 16.3 replaces per-element zoom resizing with a single cursor-aware canvas transform. Trackpad, mouse-wheel, keyboard, and visible zoom controls now share one bounded zoom engine.

## Problems Found

The previous editor implementation:

- Updated React zoom state for every wheel event.
- Recomputed the canvas width, height, every placeholder position, image placement, border, guide, crop region, and background placement whenever zoom changed.
- Used additive fixed zoom increments that behaved differently at low and high zoom levels.
- Attached both wheel and gesture handlers, allowing competing input paths.
- Used React's wheel handler instead of an explicitly non-passive editor-scoped listener.
- Used a fixed 36% fit value rather than calculating fit from the available stage size.
- Limited zoom to approximately 12%–160% rather than the requested 10%–500%.

## Implementation

### One transformed logical canvas

The editor canvas and all of its children now remain in logical project coordinates. A `canvas-zoom-shell` owns the scaled layout footprint while the canvas itself is rendered with:

```css
transform: scale(...);
transform-origin: 0 0;
```

Placeholder geometry, crop placement, guides, borders, backgrounds, and image layout are no longer recalculated for every live zoom update.

### Frame-coalesced wheel input

Command/Control + wheel input is handled by one native event listener attached only to the editor stage with `{ passive: false }`.

Raw wheel events are:

1. Normalized for pixel, line, and page delta modes.
2. Accumulated during the current frame.
3. Capped to prevent a single frame from producing an excessive jump.
4. Applied once through `requestAnimationFrame`.

Normal scrolling without Command/Control is not intercepted.

### Cursor anchoring

Before each zoom update, the engine converts the pointer's client position into a logical canvas coordinate. After changing the scale, it adjusts the stage scroll position so the same logical canvas point remains under the pointer.

### Shared zoom engine

All zoom paths use the same functions and bounds:

- Minimum: 10%
- Maximum: 500%
- Mouse/trackpad: multiplicative exponential scaling
- Buttons: multiplicative 15% steps
- Fit: calculated from the current stage viewport and canvas dimensions
- Reset: exactly 100%

### Keyboard shortcuts

- Command/Control + Plus: zoom in
- Command/Control + Minus: zoom out
- Command/Control + 0: reset to 100%
- Command/Control + 1: fit canvas

### Visible controls

The floating canvas status now contains:

- Zoom out
- Live rounded percentage
- Zoom in
- Fit canvas

The displayed percentage is updated imperatively during live gestures, so the full React project tree does not rerender for every raw event.

### Settled state

Live zoom is stored in refs and applied directly to the canvas surface. After 120 ms without another update, the final zoom value is committed to React state once.

### Listener cleanup

The editor removes the native wheel listener, pending animation frame, accumulated delta, and settle timer when the stage or app unmounts. The previous global gesture listeners were removed.

## New Tests

Added pure zoom-engine tests covering:

- 10%–500% clamping
- Pixel, line, and page wheel normalization
- Multiplicative wheel and button scaling
- Dynamic fit calculations
- Cursor-to-logical-coordinate mapping

Added regression tests covering:

- One non-passive editor-scoped wheel listener
- Animation-frame event coalescing
- Removal of competing gesture and React wheel handlers
- Single-surface CSS transform scaling
- Logical unscaled placeholder geometry
- Shared keyboard and button functions
- Cursor anchoring
- Live percentage updates and delayed final commit

## Validation

- TypeScript renderer check passed.
- TypeScript Electron check passed.
- 126/126 automated tests passed.
- Vite production renderer build passed.
- Renderer assets were inlined successfully.
- Electron main and preload build passed.

## Live Testing Still Required

This environment cannot physically test a MacBook trackpad or a packaged macOS window. On the target Mac, verify:

- Command + two-finger scroll and pinch behavior.
- Standard mouse-wheel speed.
- Cursor anchoring when zooming near canvas edges.
- Zoom responsiveness with twenty or more high-resolution placeholders.
- No passive-listener warning in the runtime log.

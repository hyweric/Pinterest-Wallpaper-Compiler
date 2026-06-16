# Phase 18.2 Report — Resize Handle Restoration

## Problem
Resize handles were rendered inside each placeholder. Normal placeholders use clipped overflow to preserve rounded masks and paper-frame edges, which also clipped the resize dots positioned just outside the frame. Resizing still worked only when the narrow invisible edge happened to be hit.

## Fix
- Moved selection controls into a separate canvas-level sibling overlay.
- The overlay copies the placeholder position, dimensions, and rotation.
- It is not affected by placeholder `overflow`, border radius, masks, opacity, blend modes, or paper-frame clipping.
- The visual dots remain compact at 12 px.
- Each resize handle now has a 28 × 28 px pointer target.
- Added stronger hover/focus feedback.
- Kept the rotate handle above the selected frame with a 30 × 30 px target.
- The overlay itself ignores pointer events, so only the actual controls intercept input.

## Validation
- TypeScript checks passed.
- 139/139 automated tests passed.
- Production renderer and Electron builds passed.
- Added regression tests for unclipped sibling rendering and enlarged hit targets.

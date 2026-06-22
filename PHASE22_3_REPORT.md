# Phase 22.3 — Drag Fill + Compact Toolbar + Effects Balance

## Scope
Focused regression repair only. No new source providers, templates, text layers, export concepts, or data-model rewrites.

## Manager plan
1. Fix normal source/image drops so the first displayed image is Fill/Cover, not Fit/Contain.
2. Shrink the selected-image quick toolbar so it does not read as a full-screen top bar or move with canvas scroll.
3. Rebalance the Effects tab from one over-condensed section into three simple, user-facing sections.
4. Run static regression checks, dependency/install audit, and package a destructive installer that runs full checks on macOS.

## Engineering changes
- Changed canvas source-drop overlay detection from `sourceLooksLikeTransparentOverlay(source)` to `sourceIsManagedOverlay(source)`.
  - Normal dragged sources and PNG/WebP image sources now use the standard Add Placeholder-style frame and Fill/Cover image placement.
  - Managed overlay assets still use contain/rectangle/no-frame behavior.
- Source-drop assignment now explicitly resets crop to `{ offsetX: 0, offsetY: 0, zoom: 1 }` and center alignment when the starting image is assigned.
- Replaced the selected-image quick toolbar with compact controls only: Fill, Fit, Crop, Zoom.
  - Lock/hide still exist on the selected layer controls.
  - Duplicate/order still exist in the layer menu.
- Kept the main toolbar visually lighter with pill groups instead of one full-width slab.
- Effects tab now has three simple sections:
  - Paper: Style, Paper color, Wrinkles
  - Frame Style: Polaroid or Torn controls when relevant
  - Shadow and Blend: Drop Shadow, Blend

## QA / review
- Checked that the normal drop path still creates a placeholder first, then assigns a source.
- Checked that only managed overlays keep contain behavior.
- Checked that source drops still lock the chosen image into `generatedImageId`.
- Checked that no generate/export data structures were simplified or removed.
- Checked that the toolbar simplification did not remove duplicate/order/visibility functionality from the app; those controls remain elsewhere.
- Checked that Effects regained 3 sections without restoring per-edge/per-shadow/per-border overcustomization.

## Validation performed in this sandbox
- Static regression assertions using Node built-in `assert`: passed.
- package-lock internal registry audit: passed.
- zip hygiene planned: excludes `node_modules`, `dist`, `release`, and caches.

## Validation deferred to installer
This sandbox could not complete `npm ci` because dependency fetching hung with no completed install, so `npm run typecheck`, `npm test`, `npm run build`, and `npm run app:dir` are executed by the installer on the target Mac after a clean dependency install.

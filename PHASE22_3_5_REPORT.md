# Phase 22.3.5 — Selected Toolbar Backing Trim

## Scope
- Removed the extra visible capsule/backing around the selected-image top/floating toolbar controls.
- Kept the actual Fill/Fit/Crop, Zoom, move up/down, duplicate, and lock controls unchanged.
- Did not touch source assignment, drag/drop, generation, effects, export, or inspector logic.

## QA Notes
- The fix is CSS-only and scoped to `.context-toolbar.compact-context-toolbar`.
- The main toolbar, inspector tabs, dropdown styles, crop toolbar, and floating canvas status are not affected.
- The zoom slider keeps its own subtle pill for readability; the unwanted outer/group capsules are transparent.

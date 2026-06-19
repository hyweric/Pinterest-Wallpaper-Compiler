# Phase 20.3 Report — Drag-to-Placeholder Cleanup

## Scope
Built on Phase 20.2. This phase removes the remaining wallpaper-rotation settings panel, cleans up sidebar wording, makes dragged sources create natural-aspect placeholders, removes lock-frame-ratio UI, and improves the empty-placeholder double-click flow.

## Changes

### Wallpaper rotation/settings cleanup
- Removed the visible Wallpaper Rotation inspector panel.
- Settings now show canvas/background/surface controls only when no placeholder is selected.
- Export set dialog language now says Wallpaper Set instead of Wallpaper Rotation.

### Source/sidebar cleanup
- Renamed the visible left-panel source tab/header to Library / Image Library.
- Kept source-library functionality because drag-to-canvas, reusable folders, Pinterest boards, and assignments still depend on it.
- Updated visible helper text to talk about collections rather than exposing source implementation language.

### Drag source to canvas behavior
- Dragging an existing sidebar collection/source onto the canvas now creates a new placeholder at the drop point and assigns that source.
- The new placeholder uses Fill mode by default.
- The new placeholder is sized to match the first image's natural aspect ratio when the browser can read it.
- Folder drops and image-file drops use the same aspect-aware placement path.
- Transparent-capable images keep transparent inner backgrounds.

### Frame inspector cleanup
- Removed the Lock frame ratio checkbox.
- Hidden keepAspectRatio no longer affects resize handles; Shift remains the temporary aspect-lock gesture.
- Moved Match Image and Reset Frame above X/Y/Width/Height fields.
- Match Image no longer silently turns on a hidden aspect lock.

### Empty placeholder double-click behavior
- Double-clicking an empty placeholder no longer enters crop mode.
- It opens the left library panel if it is closed.
- It switches the left panel to the library.
- It shows a short, non-clickable fading hint: Assign a collection from the left sidebar.
- Double-clicking a placeholder with an assigned image still enters crop mode.

## Files changed
- `src/renderer/main.tsx`
- `src/renderer/styles.css`
- `src/shared/drop-placement.ts`
- `src/main/drop-placement.test.ts`
- `src/main/phase20-3-regression.test.ts`
- Updated legacy regression tests whose expectations referenced the removed Wallpaper Rotation panel.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 202 / 202.
- `npm run build` passed.

## Notes
- The renderer uses browser image decoding to measure the first image when possible. If dimensions cannot be read, it falls back to the previous safe default placement size.
- Core source/assignment logic is preserved; only the visible terminology and drag placement behavior were changed.

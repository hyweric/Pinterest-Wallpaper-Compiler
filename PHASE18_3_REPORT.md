# Phase 18.3 Report — Resize Isolation and Add Source Chevron

## Resize behavior

The resize interaction was corrected in two places:

1. Resize handles now fully isolate their pointer-down event from the placeholder move gesture using `preventDefault`, propagation blocking, and immediate native propagation blocking.
2. Resize direction parsing now reads only the handle suffix (`n`, `nw`, `e`, etc.). The previous implementation inspected the entire string such as `resize-nw`, which accidentally matched direction letters inside the word `resize` and could apply incorrect dimensions/position changes together.

Resize geometry is now centralized in `src/shared/resize-geometry.ts`.

New behavior:
- Dragging a resize dot changes size only.
- The layer center remains fixed during resize, so the image does not translate across the canvas.
- Clicking and dragging the image body remains the only way to move it.
- Aspect-ratio lock still works.
- Resizing remains bounded to the canvas and retains a 40 px minimum size.

## Add Source state

The Add Source trigger now transitions from:

- Plus icon while closed
- Downward chevron while open

The change uses a short opacity/transform transition rather than abruptly swapping icons.

## Validation

- TypeScript checks passed.
- 144/144 automated tests passed.
- Production Vite renderer build passed.
- Electron main/preload build passed.
- New tests cover centered resize geometry, canvas bounds, aspect locking, move-gesture isolation, and Add Source icon transition states.

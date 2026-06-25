# Phase 22.3.10.10 — Frame Position Inspector Ordering

## Request
Move the Image inspector's Frame Position section to the very top so position/size controls are immediately available.

## Changes
- Reordered the Image inspector so `Frame Position` appears before `Border and Shape` and `Adjustments`.
- Kept the existing Frame Mode button-grid styling from Phase 22.3.10.9.
- Left Adaptive Aspect behavior unchanged.
- Updated the renderer order regression test to lock the new ordering.

## Validation
- `npm run typecheck`
- `npm test` — 251/251 passing
- `npm run build`

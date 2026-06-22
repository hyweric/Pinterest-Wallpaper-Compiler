# Phase 22.3.10.1 — None Paper Texture

## Changes
- Added `None` to the frame Texture selector next to `Paper` and `Crumpled Paper`.
- Selecting `None` disables the layer paper texture overlay instead of forcing a paper texture fallback.
- Selecting `None` also zeros Polaroid/Torn texture grain state so no hidden paper texture remains.
- Frame texture rendering now returns no overlay when the paper texture type is `none` or intensity is `0`.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 231/231.
- `npm run build` passed.
- Added `src/main/phase22-3-10-1-regression.test.ts`.

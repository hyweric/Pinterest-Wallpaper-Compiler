# Phase 22.3.10.2 — Paper Texture Crash + Lock Option Removal

## Scope
- Fixed the React crash when changing Polaroid paper texture between None, Paper, and Crumpled Paper.
- Removed the Lock Layer option from the selected-image floating toolbar.
- Removed the on-canvas lock/unlock button from the selected layer controls.
- Left existing layer lock data/infrastructure intact so older projects do not lose data unexpectedly.

## Root Cause
`FrameSurfaceTextureOverlay` returned before all hooks when the texture was None. Switching to Paper/Crumpled caused a different hook count, producing minified React error #310.

## Fix
- `FrameSurfaceTextureOverlay` now always calls hooks in the same order.
- Texture visibility is handled by a `textureVisible` flag and post-hook return.
- The effect body no-ops safely when texture is not visible.

## Validation
- `npm run typecheck` passed.
- `npm test` passed with 233/233 tests.
- `npm run build` passed.
- Added regression coverage for stable hook order and lock-button removal.

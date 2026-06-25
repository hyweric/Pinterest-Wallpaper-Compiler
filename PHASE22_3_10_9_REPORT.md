# Phase 22.3.10.9 — Adaptive Aspect Selector Style

## Request
Make the new Frame Mode selector use the same clear purple selection style as the image Adjustments preset controls, without the segmented-control external container.

## Changes
- Replaced the Frame Mode segmented-control wrapper with a lightweight `frame-mode-choice-grid`.
- Removed the grey external segmented-control container from Frame Mode.
- Styled Fixed Shape / Adaptive Aspect buttons to match the Adjustments preset button style: compact, no outer container, purple active state.
- Left Adaptive Aspect behavior unchanged.

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 251/251.
- `npm run build` passed.

# Phase 22.3.10.11 — Fixed-shape restore after Adaptive Aspect

## Changes
- Fixed the Adaptive Aspect → Fixed Shape toggle so fixed mode restores normal fixed-frame image behavior immediately.
- Switching back to Fixed Shape now resets to centered Fill/Cover instead of leaving the previous Adaptive/Fit state behind.
- This makes the layer fill the fixed rectangle without needing Preview on Current Desktop to advance the image first.

## Validation
- Added a regression check that the Fixed Shape toggle restores `cropMode: "cover"` and centered crop state.

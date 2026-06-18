# Phase 20 Report — UI Cleanup, Simplified Effects, and Managed Overlays

## Summary
Phase 20 continues from Phase 19.6 and focuses on simplifying the app for normal use without changing the core wallpaper-generation pipeline. The work reduces redundant effect choices, adds project-managed transparent overlay images, removes noisy controls, improves rotation guidance, and tightens several UI details.

## Effect simplification
- Merged Deckle into Torn Paper.
- Removed Newsprint from the visible effect picker by mapping legacy Newsprint into Clean Paper.
- Kept legacy `deckle`, `deckle-edge`, `newsprint`, and `newspaper-cutout` values readable so old projects do not break.
- Simplified Torn Paper presets to three clearer bundled presets:
  - Soft Paper
  - Natural Torn
  - Aged Scrap
- Calmed the default Polaroid and Torn Paper starting parameters so new effects begin closer to a user-friendly design rather than an extreme customizable state.

## Managed transparent overlay images
- Added a new Add Overlay action in the top bar.
- Imported overlay files are copied into the app-managed user data folder under `Overlay Images`.
- Overlay layers use managed project sources rather than temporary file paths.
- Overlay placeholders are created with transparent-friendly defaults:
  - contain crop
  - fixed source assignment
  - no border
  - no shadow
  - unlocked and directly editable on the canvas

## Requested UI cleanup
- Preview on Current Desktop now reports a visible confirmation after success.
- Left panel and inspector collapse buttons are now on the actual panels, with separate reopen buttons at the canvas edges.
- Export JPEG was removed from the visible UI. Export controls now use PNG only.
- Add Placeholder moved to the top bar, next to Add Overlay.
- Home page cleanup:
  - removed Active Rotation
  - removed Recently Used
  - removed the old eyebrow text
  - changed headline to one-line “Wallpaper, made personal”
- Removed the noisy Wallpaper Assignment/status block from the wallpaper panel.
- Replaced it with a concise Wallpaper Rotation guide explaining macOS folder shuffle.
- Renamed Delete All Wallpaper Sets to Clean Up Folder.
- Restyled sliders to be smoother, sleeker, and closer to the app color scheme.
- Background/Surface/Canvas UI received a compact cleanup pass without changing the underlying behavior.
- Layer action labels were clarified so reorder/duplicate/delete controls are easier to understand.

## Active rotation workflow
The app does not run a hidden background scheduler. The supported active rotation workflow is:
1. Create a Wallpaper Set in the app.
2. Generate multiple PNG variations.
3. Open macOS Wallpaper Settings.
4. Select the exported folder.
5. Enable Shuffle and Show on all Spaces in macOS.

This keeps long-running rotation managed by macOS instead of an Electron background scheduler.

## Validation
- `npm run typecheck` passed.
- `npm test` passed with 190/190 tests.
- `npm run build` passed.
- `npm run app:dir` was attempted in the container, but electron-builder could not complete because the container could not resolve GitHub while trying to fetch packaging resources. The installer still runs `npm run app:dir` on the Mac, where network access is expected.

## Files touched
- `src/main/main.ts`
- `src/preload/index.ts`
- `src/renderer/main.tsx`
- `src/renderer/styles.css`
- `src/renderer/project.ts`
- `src/shared/frame-effects.ts`
- `src/shared/paper.ts`
- `src/shared/types.ts`
- `src/main/phase20-regression.test.ts`
- Several older regression tests updated to match the simplified Phase 20 UI wording.

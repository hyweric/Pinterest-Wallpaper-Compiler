# Phase 22.3.10.3 — Media Permission Lock + Current Desktop Preview Randomization

## Fixed

- Added a strict Electron browser-permission policy before any app, scraper, or import window is created.
- Denies microphone, camera, media capture, display capture, notifications, geolocation, MIDI, fullscreen, pointer lock, openExternal-style browser permission requests, and all other renderer-origin permission prompts.
- Confirmed the package source does not contain `getUserMedia`, `mediaDevices`, `askForMediaAccess`, `desktopCapturer`, `NSMicrophoneUsageDescription`, or `audio-input`.
- Moved current-desktop preview image advancement into a shared helper that chooses shuffled/randomized candidates instead of taking the first alternative.
- Current desktop preview now avoids the current image when possible, avoids duplicate images across placeholders in the same preview, and tracks recently used image IDs so it does not bounce between only two images when more are available.

## Files changed

- `src/main/main.ts`
- `src/main/media-permissions.ts`
- `src/main/media-permissions.test.ts`
- `src/shared/preview-selection.ts`
- `src/main/preview-selection.test.ts`
- `src/shared/source-selection.ts`
- `src/renderer/main.tsx`
- `src/main/phase22-1-regression.test.ts`

## Validation

- `grep` for forbidden media API/plist/entitlement terms: no matches.
- `npm run typecheck`: passed.
- `npm test`: passed, 237/237 tests.
- `npm run build`: passed.

## Notes

- File and folder imports still use Electron dialogs and Finder drag/drop file paths; they do not need microphone, camera, or browser-origin media permissions.
- The installer resets stale macOS Camera/Microphone TCC records for this bundle id so old denied/allowed entries do not confuse testing.

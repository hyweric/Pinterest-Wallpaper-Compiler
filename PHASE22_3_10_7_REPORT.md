# Phase 22.3.10.7 — macOS media plist fix

## Summary

- Confirmed the microphone/camera refusal was an actual packaged-app issue: Electron Builder was producing a `Pin Paper.app/Contents/Info.plist` with camera and microphone usage-description keys even though the source did not intentionally request those permissions.
- Added `scripts/strip-macos-media-usage.cjs` as an Electron Builder `afterPack` hook.
- The hook recursively removes `NSMicrophoneUsageDescription` and `NSCameraUsageDescription` from the built macOS app bundle before launch/signing checks.
- The strict runtime permission blocker remains in place, so renderer-origin microphone/camera/media permission requests are still denied even if a dependency tries to request them.

## Validation

- `npm run typecheck` passed.
- `npm test` passed: 248/248.
- `npm run build` passed.

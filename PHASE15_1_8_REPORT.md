# Phase 15.1.8 — Direct All-Space Bridge With Zero-Flash Fallback

## Objective

Remove the desktop-overlay architecture and all disruptive refresh methods. Attempt an immediate native macOS wallpaper-subsystem refresh after the verified modern Store transaction. If the direct route cannot be confirmed, keep only the already-applied visible-monitor wallpaper and report the limitation.

## Execution plan completed

1. Removed the Electron/JXA desktop-layer implementation entirely.
2. Removed every legacy wallpaper database mutation and Dock refresh path.
3. Removed every WallpaperAgent kill, restart, HUP, and force-reload path.
4. Kept the permanent Wallpaper Vault and the transactional modern `Index.plist` update.
5. Added a compiled Swift helper that loads the installed private wallpaper frameworks at runtime.
6. The helper inspects installed wallpaper binaries for notification-like identifiers and posts only discovered Apple wallpaper notifications through distributed and Darwin notification centers.
7. Added post-bridge Store verification and rollback.
8. The active-Space observer starts only after the direct transaction reports success; it is never used as a failure fallback.
9. If the helper is unavailable, discovers no safe signals, or the Store does not remain verified, inactive-Space changes are rolled back and only visible monitors remain changed.
10. Added explicit bridge and fallback telemetry in the Wallpaper Targets panel.

## Safety behavior

Phase 15.1.8 contains no all-Space fallback that can flash black or interrupt Mission Control:

- No Dock restart.
- No WallpaperAgent restart or signal.
- No desktop overlay window.
- No foreground helper window.
- No legacy `desktoppicture.db` write.
- No observer-based update after a direct failure.

## Main implementation changes

- Added `src/main/pwc-wallpaper-bridge.swift`.
- Added `scripts/build-macos-wallpaper-bridge.cjs`.
- Packaged the compiled helper outside ASAR so macOS can execute it.
- Updated `src/main/macos-spaces.ts` with direct-bridge execution, verification, rollback, and visible-only fallback.
- Updated `src/main/wallpaper.ts` so direct failure stops the observer and reports visible-only application.
- Updated `src/main/main.ts` to remove desktop-layer management.
- Updated `src/renderer/main.tsx` with honest direct-bridge telemetry.
- Updated `src/shared/types.ts` for bridge/fallback status.
- Deleted `src/main/desktop-layer.ts`.
- Replaced obsolete overlay/restart regression tests with Phase 15.1.8 safety tests.

## Validation

- TypeScript renderer typecheck: passed.
- Electron main/preload typecheck: passed.
- Automated tests: 73 passed, 0 failed.
- Production Vite renderer build: passed.
- Electron main/preload production build: passed.
- Overlay/restart prohibition tests: passed.
- Store rollback and visible-only fallback tests: passed.
- Helper packaging configuration test: passed.
- `electron-builder --dir`: reached packaging but could not download Electron because `github.com` DNS was unavailable in the sandbox.

## Native limitation

The compiled Swift helper is built on the user's Mac during `npm run app:dir`. Private wallpaper interfaces are not stable or documented. Phase 15.1.8 therefore does not claim all inactive Spaces changed merely because a private framework loaded or a notification was posted. Failure remains safe and visible-only.

## Expected status

Direct route succeeds:

- Background method: `private-wallpaper-notification`
- WallpaperAgent restarted: no
- Dock restarted: no
- Overlay created: no
- Direct bridge attempted: yes
- Direct bridge available: yes
- Verified desktop counts are nonzero

Direct route unavailable:

- Background method: `visible-monitors-fallback`
- Only currently visible monitor targets changed
- Observer not started
- No system process restart
- No overlay

# Phase 15.1.5 — Silent Background All-Desktop Updates

## Baseline

Implemented on top of Phase 15.1.4, preserving the working modern macOS Store mutation strategies that successfully updated all existing Mission Control desktops.

## Root cause of the black flash and gesture interruption

Phase 15.1.4 used two disruptive refresh mechanisms after writing the wallpaper Store:

- `killall -9 WallpaperAgent` during every modern Store attempt.
- A bounded legacy compatibility bridge that could write `desktoppicture.db` and restart Dock when modern attempts were rejected.

Restarting WallpaperAgent could briefly remove the desktop surface. Restarting Dock interrupts Mission Control and Space animations, which explains the canceled swipe-up gesture.

## Phase 15.1.5 changes

### Silent modern Store path

- The preferred modern path writes and validates `Index.plist` atomically.
- It waits for the existing WallpaperAgent to observe the Store naturally.
- It verifies all targeted desktop, display, and shared records again after the settling period.
- No process is restarted when the Store remains accepted.
- A single graceful `SIGHUP` to WallpaperAgent is retained only as a bounded fallback if WallpaperAgent immediately rewrites the verified Store.
- `SIGKILL` is never used for WallpaperAgent.
- Rollback no longer restarts WallpaperAgent.

### No modern-to-legacy Dock bridge

- macOS 14 and later never use `desktoppicture.db` as a compatibility bridge.
- Dock is never restarted on the macOS 15 modern Store path.
- Legacy database support remains only for operating systems whose diagnostic strategy is actually `legacy-dock`.

### One visible redraw

- All-desktop operations perform one visible AppKit pass rather than the normal retry path.
- The previous active-Space observer is stopped before the transaction starts.
- The observer is restarted only after the transaction completes.

### Idempotent observer V3

- The observer no longer applies a wallpaper immediately when it starts.
- After a Space-change notification, it waits 650 ms for the workspace animation to settle.
- It reads the current wallpaper for each screen first.
- It repairs only screens whose current path does not match the requested path.
- This prevents the observer from redrawing the wallpaper created by the same transaction.

### Live telemetry

The Wallpaper Targets panel now reports:

- Background reload method.
- Whether WallpaperAgent restarted.
- Whether Dock restarted.
- Number of visible redraw passes.
- Whether the observer was suppressed during the transaction.
- Store-operation duration.

Possible reload methods include:

- `natural-store-observation`
- `wallpaper-agent-hup`
- `observer-fallback`
- `legacy-dock`

### Fade separation

The existing full-screen fade overlay remains disabled during this phase.

## Validation

- Type checking: passed.
- Automated tests: 86 passed, 0 failed.
- Production renderer build: passed.
- Electron main/preload build: passed.
- Electron packaging reached `electron-builder`; final runtime download failed because the sandbox could not resolve `github.com`.

## Mac acceptance test

1. Select **All desktops on all monitors**.
2. Leave inactive desktops unopened.
3. Run **Generate and Apply** while moving the pointer and opening Mission Control.
4. Check the status line.
5. Preferred result: `natural-store-observation`, WallpaperAgent restarted `no`, Dock restarted `no`, visible redraw passes `1`.
6. Switch through all desktops and confirm they were already updated.
7. Run three scheduled changes and confirm no black flash or workspace interruption.

If the status reports `wallpaper-agent-hup`, the Store was rewritten by WallpaperAgent and the graceful fallback was required. That result should be reported separately because it may still cause a small redraw on some macOS builds.

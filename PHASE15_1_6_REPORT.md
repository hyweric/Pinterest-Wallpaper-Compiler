# Phase 15.1.6 Report — Silent All-Space Desktop-Layer Fallback

## Purpose

Phase 15.1.5 removed the disruptive Dock and WallpaperAgent refresh behavior, which eliminated the black flash but also showed that macOS 15.6.1 does not immediately adopt inactive-Space wallpaper Store changes on this machine. Only the currently visible Space changed.

Phase 15.1.6 keeps the modern Store update and observer repair path, then adds a silent native desktop-layer fallback so every Mission Control Space on the selected monitor(s) shows the requested wallpaper immediately without restarting Dock or WallpaperAgent.

## Architecture

### Modern Store remains authoritative

The existing modern `Index.plist` transaction remains in place. The app continues to update and verify display, Space, shared, and global records and keeps generated wallpapers in the permanent Wallpaper Vault.

### Native desktop-level visual coverage

When an all-desktop target is selected, the main process prepares one exact-size wallpaper image per selected display and launches a nonactivating native AppKit helper. The helper creates one borderless `NSWindow` per display with these properties:

- Positioned one level below Finder desktop icons and above the system wallpaper.
- Joined to all Mission Control Spaces.
- Stationary during Space switching.
- Excluded from normal window cycling.
- Ignores mouse events.
- Uses accessory activation policy, so it does not create a Dock icon or steal focus.
- Uses no animation, shadow, title bar, overlay, or foreground activation.

The helper stays alive in the background and provides immediate visual coverage on inactive Spaces while macOS gradually adopts or the existing observer repairs the underlying Store records.

### Gapless replacement

A new helper is started and given time to display its prepared images before the previous helper is terminated. This prevents a blank interval between scheduled or manual wallpaper changes.

### Per-display preparation

The app decodes the validated wallpaper with Electron `nativeImage`, center-crops it to the selected display aspect ratio, resizes it to the display's physical pixel dimensions, and writes the prepared PNG into:

`~/Pictures/Pinterest Wallpaper Compiler/Wallpaper Vault/Desktop Layers`

This directory is part of the permanent Wallpaper Vault and is preserved by clean replacement commands.

### Lifecycle and cleanup

- Stale `PWC_DESKTOP_LAYER_V1` helper processes are terminated on app startup.
- The current helper is terminated on app quit.
- Switching to a target mode that does not include inactive Spaces stops the desktop layer.
- Prepared images are retained in a bounded cache.
- The existing Space observer remains delayed and idempotent and does not restart Dock or WallpaperAgent.

## Honest status reporting

The targeting panel now distinguishes between:

- System Store records already adopted and verified by macOS.
- Immediate visual coverage supplied by the silent desktop layer.
- Pending Store adoption that the observer will repair as Spaces are visited.

When active, the panel reports:

- `Background method: desktop-layer`
- Desktop-layer display count.
- Helper process ID.
- Prepared image paths.
- Whether system Store adoption remains pending.

This does not falsely claim that macOS has already adopted every inactive-Space record when the visual fallback is responsible for the immediate result.

## Files changed

- `src/main/desktop-layer.ts` — new native desktop-layer manager and JXA AppKit helper.
- `src/main/main.ts` — integrates desktop-layer activation, diagnostics, lifecycle cleanup, and target-mode cleanup.
- `src/shared/types.ts` — adds desktop-layer diagnostic fields and reload method.
- `src/renderer/main.tsx` — displays honest desktop-layer and Store-adoption status.
- `src/main/phase15-1-6-regression.test.ts` — regression coverage for native layer behavior, lifecycle, diagnostics, and target integration.

## Validation

- `npm run typecheck` — passed.
- `npm test` — 91 passed, 0 failed.
- `npm run build` — passed.
- Renderer production build — passed.
- Electron main/preload TypeScript build — passed.
- `npm run app:dir` reached `electron-builder` and failed only because the sandbox could not resolve `github.com` to download the Electron runtime.

## Required macOS validation

1. Select `All desktops on current monitor`.
2. Generate and Apply while staying on one Space.
3. Confirm the status says `Background method: desktop-layer` and coverage is active on one display.
4. Switch through all five Spaces and confirm the selected monitor already shows the new wallpaper on each one.
5. Open Mission Control and swipe between Spaces during a second update.
6. Confirm there is no black flash, no Dock restart, no focus change, and no canceled gesture.
7. Select `All desktops on all monitors` and repeat on both displays.
8. Run several scheduled changes and verify replacement is gapless.
9. Quit the app and confirm the helper exits. The underlying macOS wallpaper then remains whatever the modern Store/observer has adopted.

## Platform limitation

The desktop layer guarantees immediate visual all-Space coverage while the app is running. macOS may still delay adopting private inactive-Space Store records. Phase 15.1.6 reports that distinction explicitly rather than claiming the private Store update succeeded when it did not.

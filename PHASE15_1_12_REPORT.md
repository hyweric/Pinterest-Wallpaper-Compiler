# Phase 15.1.12 — Native Global Wallpaper Adoption

## Objective

Replace the Phase 15.1.11 stable-file-slot approach. Updating image bytes behind wallpaper paths already stored for inactive Mission Control Spaces did not reliably invalidate WallpaperAgent's cached images. The result could report successful file verification while inactive Spaces still displayed older pixels.

## New approach

Phase 15.1.12 delegates the all-Space transition to macOS's own **Show on all Spaces** setting:

1. Generate a new immutable wallpaper file path for the apply operation.
2. Apply that file once to the currently visible physical display targets through the existing AppKit `NSWorkspace` path.
3. Open the macOS Wallpaper settings pane in the background.
4. Locate **Show on all Spaces** through the macOS Accessibility hierarchy.
5. Enable it, or safely switch it off and back on when it is already enabled, to initiate a fresh system-owned global adoption transaction.
6. Re-read the modern wallpaper Store only for verification and confirm that `AllSpacesAndDisplays` references the newly generated file.
7. If either the native control or Store verification fails, retain only the already verified visible-display change.

The app no longer uses stable-slot byte replacement as its active all-desktops mechanism.

## Why this is different

Open-source wallpaper tools such as `desktoppr` and `macos-wallpaper` use the public AppKit screen API. That API is dependable for currently visible `NSScreen` instances but does not provide direct control over every inactive Mission Control Space. The `macos-wallpaper` same-path refresh workaround briefly applies another value before restoring the target, which can produce a visible flash. Other community solutions observe active-Space changes and repair a Space only after the user visits it.

This phase instead invokes the user-facing macOS global setting, allowing WallpaperAgent and System Settings to own the inactive-Space propagation. No third-party library code was copied or bundled.

## Removed from the active transaction

- No replacement of wallpaper file contents behind existing paths.
- No direct mutation of the modern wallpaper Store.
- No legacy Dock wallpaper database mutation.
- No `killall Dock`.
- No WallpaperAgent restart.
- No blank-image or empty-URL cache-busting pass.
- No overlay or fade window.
- No Mission Control Space switching.
- No active-Space maintenance observer fallback.

## Eligibility and safety rules

Apple's **Show on all Spaces** setting represents one shared wallpaper across all Spaces and displays. Therefore:

- `All desktops · all monitors` is eligible only when every display assignment resolves to the same generated file.
- `All desktops · current monitor` is eligible when only one physical display is connected.
- Different images per display are not forced through the global setting.
- A current-monitor-only request is not broadened to every display when multiple monitors are connected.
- In an ineligible or failed case, the app reports visible-monitor fallback rather than claiming inactive-Space success.

## Permissions

The first use can cause macOS to request permission for Pinterest Wallpaper Compiler to control System Events/System Settings. Accessibility or Automation access must be allowed for the native settings transaction. The installer does not modify the macOS privacy database or bypass this prompt.

## Diagnostics added

The all-desktops diagnostic now reports:

- Native global setting attempted.
- Native global setting enabled.
- Native global setting re-armed.
- Wallpaper settings UI opened.
- Accessibility permission denial detected.
- Matched Accessibility control label.
- Global Store reference verified.
- Direct Store writes: no.
- Wallpaper files overwritten: no.
- Dock restarted: no.
- WallpaperAgent restarted: no.

## Validation completed

- TypeScript typecheck: passed.
- Electron/main-process tests: 82 passed, 0 failed.
- Renderer production build: passed.
- Electron TypeScript build: passed.
- Embedded JXA syntax check: passed.

The build environment is Linux, so the final Accessibility hierarchy and actual inactive-Space visual adoption cannot be exercised here. The target Mac must perform the final integration test. Failure remains bounded to the visible-display wallpaper change and is surfaced in diagnostics.

## Target Mac test

1. Create at least three Mission Control desktop Spaces.
2. Use one monitor for the first test.
3. Select `All desktops · current monitor` or `All desktops · all monitors`.
4. Keep `Native Show on all Spaces` selected.
5. Generate and apply a visibly distinct wallpaper.
6. Approve any System Events/System Settings permission prompt.
7. Move through every Space and confirm there was no black flash and no stale wallpaper.
8. Run **macOS diagnostic** and confirm:
   - Native global setting enabled: yes.
   - Global Store verification: yes.
   - WallpaperAgent restarted: no.
   - Dock restarted: no.
   - Overlay created: no.

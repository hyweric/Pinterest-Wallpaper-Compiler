# Phase 15.1.9 — Evidence-Based Native Bridge Guardrail

## Objective

Finish Phase 15.1 without claiming silent inactive-Space adoption unless macOS accepts a real native request. Preserve the working visible-display AppKit path and transactional modern Store mutation, but remove the guessed-notification bridge from Phase 15.1.8.

## Investigation Summary

- Local macOS 15.6.1 binaries expose private wallpaper symbols in `WallpaperAgent`.
- The installed framework set includes:
  - `/System/Library/PrivateFrameworks/Wallpaper.framework`
  - `/System/Library/PrivateFrameworks/WallpaperFoundation.framework`
  - `/System/Library/PrivateFrameworks/WallpaperExtensionKit.framework`
- `WallpaperAgent` exposes `Wallpaper.AgentXPCProtocol` metadata, including:
  - `updateDesktopWallpaperUserSettings(_:sender:)`
  - `diagnosticState(sender:)`
  - `snapshotAllSpaces(sender:)`
  - `setDisplaySpacesInfo(info:sender:)`
  - `registerSettingsObserver(sender:)`
- The repo does not yet have a proven callable client connection for that private Swift XPC protocol.
- External references reviewed during this phase still use one of three patterns: visible `NSWorkspace`, Store edits plus `killall WallpaperAgent`, or active-Space observers. None provided a confirmed silent all-Space adoption API for macOS 15.

## Implementation

- Reworked `src/main/pwc-wallpaper-bridge.swift` so it no longer guesses or posts notification names.
- The bridge now reports framework availability, discovered XPC service/protocol/selector metadata, and whether a request was accepted.
- `refresh` fails closed until the helper can make a real accepted WallpaperAgent request.
- The existing Store transaction remains transactional and rolls back inactive-Space writes when the bridge is not accepted.
- The renderer now shows:
  - direct bridge attempted
  - direct bridge available
  - request accepted
  - mechanism
- Regression tests now prohibit distributed/Darwin notification posting in the helper.

## Current Behavior

Confirmed:

- Current desktop/current monitor/all visible monitors still use the working visible AppKit path.
- All-desktop modes still validate and stage the modern Store transaction.
- Because silent inactive-Space adoption is not accepted by a native request yet, all-desktop modes safely fall back to visible monitors only.
- No overlay is created.
- Dock is not restarted.
- WallpaperAgent is not killed, restarted, or signaled.
- `desktoppicture.db` remains diagnostic-only.

Not confirmed:

- Silent visual adoption of inactive Mission Control Spaces on macOS 15.

## Validation

- Swift helper build: passed.
- Swift helper probe: passed and returned `Wallpaper.AgentXPCProtocol` metadata.
- `npm run typecheck`: passed.
- `npm test`: passed, 73 tests.
- `npm run build`: passed.


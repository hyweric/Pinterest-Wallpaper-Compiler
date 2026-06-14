# Phase 15 Report — Wallpaper Targeting Across Monitors and macOS Desktops

## Summary

Phase 15 replaces the previous macOS wallpaper targeting path with a safe AppKit-only implementation that targets currently visible physical displays. It no longer edits the private Dock wallpaper database or restarts Dock.

## Implemented target modes

- Current desktop only
  - Applies to the active Space on the physical display containing the app window.
- Current monitor only
  - Applies to the active Space on a specifically selected physical monitor.
- All visible monitors
  - Applies to the active Space currently visible on every connected display.
- All desktops on current monitor
  - Listed in the UI, but intentionally refused with a clear limitation message because inactive Mission Control Spaces are not exposed by the supported public wallpaper API.
- All desktops on all monitors
  - Listed in the UI, but intentionally refused for the same reason.

The application does not silently downgrade an unsupported all-Spaces request into a visible-monitor request.

## macOS implementation

- Physical displays are enumerated through AppKit `NSScreen`.
- Display names, IDs, dimensions, and current wallpaper paths are returned to the renderer.
- The display containing the Electron app window is marked as current.
- Wallpapers are applied with `NSWorkspace.setDesktopImageURL(... forScreen ...)`.
- Each requested display is verified independently through `NSWorkspace.desktopImageURL(for:)`.
- Partial success is reported as partial failure rather than full success.
- Permission or native API errors are preserved in diagnostics.
- No `desktoppicture.db`, `sqlite3`, Dock restart, or other private database modification remains in the macOS apply implementation.

## UI changes

The Wallpaper Targets section now separates:

- Apply-to scope.
- Explicit monitor selection.
- Same wallpaper versus different template/playlist assignment.
- Physical displays versus Mission Control Spaces.
- Supported visible-display targeting versus unsupported inactive-Space targeting.

The UI explains that a “desktop” is the active Space on the display containing the app and that “visible monitors” means the current Space on each connected display.

## Migration

Older projects without `wallpaper.targetMode` are normalized automatically:

- Legacy current-desktop or primary-monitor settings migrate to Current desktop only.
- Other legacy settings migrate to All visible monitors.

## Modified files

- `src/main/export-set.test.ts`
- `src/main/main.ts`
- `src/main/wallpaper-targeting.test.ts` (new)
- `src/main/wallpaper.ts`
- `src/renderer/main.tsx`
- `src/renderer/project.ts`
- `src/renderer/styles.css`
- `src/shared/types.ts`
- `src/shared/wallpaper.ts`

## Validation performed

- `npm run typecheck` — passed.
- `npm test` — 59 passed, 0 failed.
- `npm run build` — passed.
- Renderer production bundle and asset inlining — passed.
- Electron main/preload TypeScript build — passed.
- `npm run app:dir` reached electron-builder but could not download the Electron runtime because this sandbox could not resolve `github.com`.

New tests cover:

- Current desktop selection.
- Explicit current-monitor selection.
- All-visible-monitor selection.
- Unsupported inactive-Space modes not being silently downgraded.
- Presence of all requested UI modes.
- Removal of Dock database editing and Dock restart behavior.

## Remaining platform limitation

The public macOS wallpaper API operates on currently available `NSScreen` instances. This implementation therefore supports the active Space visible on each connected display. It does not modify inactive Mission Control Spaces because doing so would require private or undocumented state manipulation that was not approved.

Manual validation on a Mac is still required for:

- One monitor with one Space.
- One monitor with several Spaces.
- Several monitors with separate Spaces enabled and disabled.
- Display disconnection/reconnection.
- Native error and permission behavior.

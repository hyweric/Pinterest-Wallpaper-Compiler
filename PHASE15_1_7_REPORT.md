# Phase 15.1.7 — Electron Desktop-Window Backend

## Scope

Replace the failing JXA/AppKit desktop-layer helper without changing the verified wallpaper generation, vault persistence, modern Store transaction, scheduler, or visible-monitor application paths.

## Root cause

The optional desktop-layer process was implemented as a long-running JavaScript for Automation (`osascript -l JavaScript`) program. On the tested macOS 15 machine, the JXA bridge did not expose `NSWindow.orderFrontRegardless` as a callable JavaScript function. The helper terminated before creating any all-Space visual coverage, even though the normal AppKit wallpaper assignment had already succeeded on the visible display.

The submitted diagnostics confirm that the rendered vault file was valid and that `NSWorkspace` eventually reported the requested path on the visible display. The only failing stage was the desktop-layer helper.

## Implementation plan executed

1. Preserve generation, persistent vault, Store mutation, and visible display application.
2. Remove the JXA window process entirely.
3. Create desktop-level windows directly in Electron's main process.
4. Use Electron's macOS `type: "desktop"` window level.
5. Make each window frameless, non-focusable, noninteractive, taskbar-free, and sized exactly to its physical display.
6. Join all Spaces with `setVisibleOnAllWorkspaces` while using `skipTransformProcessType: true` to avoid the app/Dock hide-show transformation.
7. Load an exact-resolution prepared PNG through a local HTML document.
8. Wait for the image to decode before showing the window.
9. Use `showInactive()` so the helper cannot steal focus.
10. Show the replacement windows before destroying the previous set.
11. Expose the backend and Electron window IDs in diagnostics.
12. Continue cleaning legacy `PWC_DESKTOP_LAYER_V1` JXA helpers left by older builds.

## Modified files

- `src/main/desktop-layer.ts`
- `src/main/main.ts`
- `src/main/phase15-1-6-regression.test.ts`
- `src/renderer/main.tsx`
- `src/shared/types.ts`
- `PHASE15_1_7_REPORT.md`

## Validation

- `npm run typecheck` — passed
- `npm test` — 92 passed, 0 failed
- `npm run build` — passed
- Renderer production build and asset inlining — passed
- Electron main/preload TypeScript build — passed
- `npm run app:dir` — application code rebuilt successfully; packaging could not download the Electron runtime because the sandbox could not resolve `github.com`

## Expected diagnostics

A successful all-desktop visual fallback should report:

- `desktopLayerActive: true`
- `desktopLayerBackend: electron-desktop-window-v2`
- one Electron window ID per selected physical display
- no `orderFrontRegardless` or JXA error

## Platform limitation

The Electron desktop windows can be validated only on macOS. This Linux environment cannot verify their Mission Control rendering order or visual behavior. The full-clean command launches the exact newly built Mac executable for that test.

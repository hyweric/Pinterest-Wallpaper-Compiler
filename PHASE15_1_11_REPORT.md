# Phase 15.1.11 — Stable Wallpaper Asset Slots

## Root cause confirmed by Phase 15.1.10

The System Events request was accepted, but it only changed the active desktop. WallpaperAgent then restored or retained older inactive-Space paths, so stable verification failed. Repeating Store writes, System Events, private XPC probing, observer repair, process restarts, overlays, or Space switching would repeat approaches already proven unsuitable.

## New approach

Phase 15.1.11 does not ask macOS to adopt a new path for every inactive Space. Instead, it uses the paths macOS already owns and already associates with those Spaces.

After the visible display is applied normally:

1. Read the modern Store only to discover the existing wallpaper file path assigned to each selected Space and display.
2. Require every target file to be inside the permanent Pinterest Wallpaper Compiler Wallpaper Vault.
3. Copy the new rendered image bytes into each existing target file path without changing the Store path.
4. Touch each updated file so macOS receives a filesystem timestamp change.
5. SHA-256 verify every updated slot.
6. Roll back file contents if any copy or verification fails.

This is intentionally different from every previous attempt: the Store paths and WallpaperAgent in-memory path assignments are left unchanged.

## Safety rules

- Never overwrite a user file outside the permanent Wallpaper Vault.
- No `Index.plist` mutation in the active all-desktop path.
- No System Events request.
- No private XPC bridge.
- No Dock restart.
- No WallpaperAgent signal, kill, or restart.
- No overlay window.
- No Mission Control Space switching.
- No observer fallback.
- Failure leaves the already verified visible-monitor update in place.

## Removed obsolete build path

The unused Swift private-wallpaper bridge and its build step were removed from the packaged build. They discovered private symbols but never established an accepted WallpaperAgent request.

## UI and diagnostics

The refresh mode is now `Stable asset refresh`.

Diagnostics report:

- Stable asset slots attempted and verified.
- Number of slot files updated.
- User desktop and shared-record counts separately.
- Store paths changed: no.
- System Events used: no.
- Private XPC used: no.
- WallpaperAgent/Dock restarted: no.
- Exact unsafe or missing path that caused visible-only fallback.

## Modified files

- `src/main/macos-spaces.ts`
- `src/main/wallpaper.ts`
- `src/main/stable-asset-slots.test.ts`
- `src/main/phase15-1-8-regression.test.ts`
- `src/renderer/main.tsx`
- `src/renderer/project.ts`
- `src/shared/types.ts`
- `src/shared/wallpaper.ts`
- `package.json`

Removed:

- `src/main/pwc-wallpaper-bridge.swift`
- `scripts/build-macos-wallpaper-bridge.cjs`

## Validation

- `npm run typecheck`: passed.
- `npm test`: 81 passed, 0 failed.
- `npm run build`: passed.
- `npm run app:dir`: reached Electron packaging; the sandbox could not resolve `github.com` to download the Electron runtime.

## Required Mac result

A successful run should report:

- `Background method: stable-asset-slots`
- `Stable asset slots: verified`
- `Store paths changed: no`
- `System Events used: no`
- `Private XPC used: no`
- `WallpaperAgent restarted: no`
- `Dock restarted: no`

The final visual behavior still needs to be checked on the target macOS 15.6.1 machine because WallpaperAgent may cache decoded images independently of both the Store path and the file contents.

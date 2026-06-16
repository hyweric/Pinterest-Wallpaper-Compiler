# Phase 15.1.10 — Native System Events Adoption With Stable Verification

## Why Phase 15.1.9 did not update inactive Spaces

The Phase 15.1.9 diagnostic proved that the modern Store mutation itself was not the missing piece. The transaction could read back all five targeted Space records immediately, but WallpaperAgent still held older settings in memory and later rewrote inactive Space records. The private `Wallpaper.AgentXPCProtocol` bridge was discoverable but did not accept a callable update request. The observer fallback therefore only repaired a Space after the user visited it.

## New approach

This phase does not retry the previous WallpaperAgent restart, Dock restart, overlay, hidden Space switching, keyboard sweep, or observer fallback approaches.

After the visible monitor has been updated and the modern Store has been staged, the app now makes one standard macOS automation request through `System Events`:

- `set picture of desktop N to POSIX file ...`

This uses the native desktop picture scripting API rather than manipulating Mission Control or restarting a wallpaper process.

The app then performs two delayed Store inspections. It only reports immediate all-desktop success when every selected display and every targeted Space still references the new vault file in both inspections. This catches the exact Phase 15.1.9 failure mode where an immediate read-back looked successful but WallpaperAgent rewrote the Store moments later.

## Failure behavior

If System Events is denied, unavailable, or the Store records do not remain stable:

- The staged inactive-Space transaction is rolled back to the visible-preserving Store baseline.
- The active visible monitor wallpaper remains applied.
- No Space observer is started.
- No wallpaper process is killed, restarted, or signaled.
- No overlay window is created.
- No Mission Control Space is switched.
- The result is reported as a visible-monitor fallback.

## UI and diagnostics

The all-desktop refresh control is now labeled `Native desktop refresh`.

Diagnostics include:

- System Events attempted/accepted
- Stable Store verification passed/failed
- Actual background method
- Store rollback result
- Verified display, desktop, and shared-record counts

## Modified files

- `src/main/macos-spaces.ts`
- `src/main/wallpaper.ts`
- `src/main/phase15-1-8-regression.test.ts`
- `src/renderer/main.tsx`
- `src/renderer/project.ts`
- `src/shared/types.ts`
- `src/shared/wallpaper.ts`

## Validation

- `npm run typecheck`: passed
- `npm test`: 77 passed, 0 failed
- `npm run build`: passed
- `npm run app:dir`: reached Electron packaging; this Linux sandbox could not download the Electron runtime from GitHub

## Mac acceptance result still required

The System Events adoption path must be tested on the target macOS 15.6.1 machine. The first run may request Automation permission for Pinterest Wallpaper Compiler to control System Events. Denying that permission intentionally triggers the safe visible-monitor fallback.

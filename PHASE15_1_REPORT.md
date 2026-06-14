# Phase 15.1 — All-Monitor / All-Space Targeting and Scheduler Recovery

## Summary

Phase 15.1 replaces the original visible-screen-only implementation with a hybrid macOS wallpaper targeting system and fixes the scheduler race that could leave Generate and Apply unusable after a scheduled run.

## Root causes

### Generate and Apply stopped after scheduling

The renderer used a single Boolean lock and, when a scheduled timer fired while another wallpaper operation was active, rewrote `nextScheduledAt` to one second later. A long render/apply operation could therefore create repeated one-second retries, repeated project/autosave updates, and a stale busy lock. Manual Generate and Apply then appeared permanently unavailable.

### All monitors versus all Spaces

Apple's AppKit wallpaper API targets an `NSScreen`, which reliably covers each connected display's currently active Space. It does not directly enumerate inactive Mission Control Spaces. Phase 15 originally stopped at that public API boundary.

## Phase 15.1 implementation

### Connected displays

- Continues to enumerate every connected `NSScreen` by physical display ID.
- Applies the requested image to every selected visible display through `NSWorkspace`.
- Verifies the reported path independently for each display.
- Retries once after a one-second WallpaperAgent catch-up delay when the first apply or verification is incomplete.

### All desktops / Spaces

For `All desktops on current monitor` and `All desktops on all monitors`, the app now uses two coordinated mechanisms:

1. **Immediate macOS 14+ Store update**
   - Reads `~/Library/Application Support/com.apple.wallpaper/Store/Index.plist`.
   - Maps physical display IDs to display UUIDs.
   - Enumerates managed Space UUIDs.
   - Updates the relevant display and Space wallpaper records.
   - Creates `Index.plist.pwc-backup` before modifying anything.
   - Writes the property list atomically and reads it back before declaring the update successful.
   - Restores the backup if the transaction fails.
   - Restarts WallpaperAgent only after successful validation.

2. **Active-Space observer fallback/reinforcement**
   - Keeps one process-wide observer while the app is running.
   - Listens for `NSWorkspaceActiveSpaceDidChangeNotification`.
   - Reapplies the desired wallpaper whenever the user switches Spaces.
   - Covers newly created Spaces and cases where WallpaperAgent ignores an immediate Store refresh.
   - Replaces the prior observer rather than creating duplicates.
   - Stops when the targeting mode changes or the app quits.

The app does not modify the legacy Dock `desktoppicture.db` and does not restart the Dock.

### Scheduler and operation stability

- Replaced the raw Boolean operation lock with a token-based single-flight guard.
- Manual, scheduled, history, and source-triggered wallpaper operations cannot overlap.
- A scheduled run that becomes due during an active operation is deferred without rewriting state every second.
- The schedule is recalculated once after the active operation completes.
- Stale operation leases can be recovered instead of leaving the UI permanently busy.
- Completion from an older operation cannot unlock a newer replacement operation.
- The wallpaper controller is now process-wide, preventing duplicate active-Space observers.

## Modified files

- `src/main/macos-spaces.ts`
- `src/main/main.ts`
- `src/main/wallpaper.ts`
- `src/main/phase15-1-regression.test.ts`
- `src/main/scheduler-runtime.test.ts`
- `src/main/wallpaper-targeting.test.ts`
- `src/renderer/main.tsx`
- `src/shared/scheduler.ts`
- `src/shared/wallpaper.ts`

## Validation

- `npm run typecheck` — passed.
- `npm test` — 64 passed, 0 failed.
- `npm run build` — passed.
- Renderer production build — passed.
- Electron main/preload build — passed.
- Scheduler overlap, stale-lock recovery, and no-one-second-retry-loop tests — passed.
- All-display and All-Spaces target-selection tests — passed.
- Store transaction / rollback / observer source regression checks — passed.
- Legacy Dock database modification regression check — passed.

`npm run app:dir` reached electron-builder after all source builds passed, then failed because this Linux sandbox could not resolve `github.com` to download the Electron runtime. The packaged macOS application and native Space behavior must be tested on the user's Mac.

## Platform limitations

The macOS 14+ wallpaper Store schema and managed-Space inventory are not public stable APIs. Phase 15.1 protects the file with an adjacent backup, atomic validation, rollback, direct visible-display verification, and the active-Space observer fallback. A future macOS release may change the Store schema; in that case visible displays should still apply, and other Spaces will synchronize when activated while the app remains running.

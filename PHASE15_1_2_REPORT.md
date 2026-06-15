# Phase 15.1.2 Report — Reliable macOS 15 All-Desktop Targeting

## Baseline

Built from `pinterest-wallpaper-compiler-phase15-1-1-fixed.zip` and corrected using the user's macOS 15.6.1 diagnostic.

## Root causes confirmed by the diagnostic

- Physical displays were reported as `[OBJECT REF]` instead of real UUID strings.
- Neither display had Space UUID ownership, so current-monitor all-desktop targeting could not select the correct Store records.
- macOS 15 incorrectly selected `modern-store+legacy-dock` even though the legacy database contained 147 stale target rows for only six current Spaces.
- The modern Store referenced generated files that previous full-clean commands had deleted, creating a black-desktop risk.
- The Store transaction verified zero display and Space records, leaving only observer fallback active.

## Implemented corrections

### Display and Space mapping

- Added multiple real display UUID extraction routes:
  - `NSScreen` `_UUIDString` when available.
  - `NSScreenUUID` device metadata.
  - `CGDisplayCreateUUIDFromDisplayID` with an Objective-C reference conversion.
  - Store-record inference by matching the currently reported wallpaper path when the bridge cannot return a UUID.
- Added Store-derived Space ownership through `Spaces.<space UUID>.Displays.<display UUID>`.
- Diagnostic output now includes `displayKeys` and `spaceDisplayUUIDs`.
- Display diagnostics merge private Mission Control data with authoritative Store ownership instead of depending on one private API.

### macOS 15 strategy

- macOS 14 and later use `modern-store` when the Store is compatible and writable.
- `desktoppicture.db` is ignored on macOS 14+ even if its legacy tables still exist.
- The legacy path remains available only for older systems where it is the active compatible architecture.
- Diagnostics explicitly warn when a stale legacy database is present but ignored.

### Permanent wallpaper vault

- Every wallpaper is copied and validated before application into:

  `~/Pictures/Pinterest Wallpaper Compiler/Wallpaper Vault`

- The Store and visible-display APIs receive only the permanent vault path.
- Generated cache cleanup cannot delete vault assets.
- Multi-target generation also persists every target image before any macOS Store transaction.

### Modern Store transaction

- The Store controller receives the real display UUID and owned Space UUIDs from the diagnostic.
- For each selected target it updates:
  - Top-level `Displays` records.
  - Each selected Space's `Default` desktop record.
  - Every selected per-display record inside that Space.
  - `SystemDefault` and `AllSpacesAndDisplays` when the same wallpaper applies globally.
- Existing unrelated metadata, placement data, and untouched display/Space records are preserved.
- Every supplied image is checked for existence, readability, nonzero size, and AppKit decoding before Store mutation.
- Writes remain temporary-file based, validated, atomic, and rollback-capable.
- Verification now checks every selected display and Space record, not an `OR` match between Default and per-display records.
- Global records are verified when used.
- After restarting only `WallpaperAgent`, the Store is read and verified a second time to detect agent rewrites.
- If post-reload verification fails, the original Store is restored and WallpaperAgent is reloaded again.

### Observer behavior

- A successful immediate Store transaction starts the observer as maintenance for newly created or externally changed Spaces.
- A failed transaction starts it only as a clearly labeled fallback.
- The observer is not counted as immediate inactive-Space success.

## Validation

- `npm run typecheck`: passed.
- `npm test`: 74 passed, 0 failed.
- `npm run build`: passed.
- Renderer production build: passed.
- Electron main/preload build: passed.
- New tests cover:
  - macOS 15 ignoring a stale 147-row legacy database.
  - Persistent vault copying.
  - Real display UUID extraction routes.
  - Store-derived display-to-Space mapping.
  - Display, Space, global, and post-WallpaperAgent verification.
- `npm run app:dir` reached Electron packaging after a successful production build, then failed because the sandbox could not resolve `github.com` to download Electron. Native macOS packaging and Mission Control behavior must be verified on the user's Mac.

## Full-clean installation rule

Future full-clean commands must preserve:

- `~/Pictures/Pinterest Wallpaper Compiler/Wallpaper Vault`
- Existing legacy `Generated Wallpapers` files that may still be referenced by the current macOS Store until a successful Phase 15.1.2 all-desktop apply repairs those records.

The installation command supplied with this phase follows that rule.

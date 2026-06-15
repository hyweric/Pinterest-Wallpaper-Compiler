# Phase 15.1.3 — Immediate Inactive-Space Repair

## Root causes addressed

The macOS 15 diagnostic showed five user-visible Mission Control desktops plus one Store record shared by both displays. The previous implementation counted the shared record as a sixth desktop. It also wrote an image URL into the encoded `Configuration` field. Static image Store records instead use `Files` for the URL and a binary configuration containing background color and placement. WallpaperAgent could therefore reject or normalize the transaction, causing rollback and leaving only visible-monitor application active.

## Changes

- Classifies Store Space records with one display owner as user-visible desktops.
- Classifies records with multiple display owners as shared Store records.
- Reports five desktops and one shared Store record for the supplied two-monitor fixture.
- Updates and verifies shared records, but excludes them from the desktop count and verification denominator.
- Uses the accepted static-image configuration structure with `backgroundColor` and `placement`.
- Keeps the wallpaper URL only in `Content.Choices[0].Files[0].relative`.
- Reduces each patched static wallpaper record to one image choice, clears shuffle state, and removes stale encoded option data.
- Patches each display and Space from its own existing record rather than cloning one record across the entire Store.
- Removes the internal AppKit visible-screen call from the Store transaction so it cannot rewrite active records before Store verification.
- Restarts only WallpaperAgent, waits for it to relaunch and settle, then verifies displays, five user desktops, shared records, and global records separately.
- Keeps transactional rollback if WallpaperAgent rejects any requested record.

## Validation

- Type checking passed.
- 77 automated tests passed.
- Production renderer build passed.
- Electron main/preload build passed.
- The actual inactive-Space behavior must be verified on the user's macOS 15.6.1 machine.
- `electron-builder --dir` could not complete in the Linux sandbox because GitHub could not be resolved for the Electron runtime download.

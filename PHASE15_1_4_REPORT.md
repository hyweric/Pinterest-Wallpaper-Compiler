# Pinterest Wallpaper Compiler — Phase 15.1.4 Report

## Scope

Phase 15.1.4 continues debugging immediate wallpaper application to inactive Mission Control Spaces on macOS 15.6.1. The user diagnostic showed that only currently visible Space records were changing, while the modern wallpaper Store transaction verified 0 of 5 user desktops, 0 of 2 displays, and 0 of 1 shared Store records.

## Diagnostic conclusion

The modern Store schema and display/Space mapping are now detected correctly. The remaining failure was not enumeration: WallpaperAgent was rejecting or normalizing the Store mutation. The diagnostic showed the currently visible Space records pointing to the new permanent-vault image while inactive Space records still referenced older or missing files. This means the public per-screen AppKit application succeeded, but the private Store rewrite did not survive verification.

## Phase 15.1.4 strategy

The app no longer relies on one guessed Store shape. It applies the visible screens first so macOS itself creates a version-correct active wallpaper record, waits for WallpaperAgent to settle, and then tries several bounded, transactional inactive-Space strategies in order.

### Attempt 1 — Clone macOS-generated active records

- Uses each display's exact active Space record created by macOS.
- Deep-clones the full section, preserving private Configuration, Provider, Type, placement, and unrelated metadata.
- Changes only the Files path to the validated permanent-vault image.
- Copies that record to inactive Spaces belonging to the same display.
- Verifies all targeted user Space records after write and after WallpaperAgent restart.

### Attempt 2 — Path-only Store patch

- Preserves each existing inactive Space record.
- Changes only its Files path.
- Does not replace Configuration or Provider data.
- Verifies all targeted user Space records after write and after WallpaperAgent restart.

### Attempt 3 — Global AllSpacesAndDisplays record

Used only when the same generated wallpaper is intended for all displays.

- Updates the global Show on all Spaces record.
- Also updates SystemDefault where present.
- Verifies the global record and user Space records after WallpaperAgent reload.

### Final bounded bridge — current legacy rows

Only after every modern Store approach fails:

- Uses only the newest legacy row for each current `(Space, display)` pair.
- Prefers Space UUIDs that still exist in the modern Store.
- Does not treat all 147 historical rows as current desktops.
- Is reported as a fallback attempt, not as verified modern Store success.

The app does not automate private CGS Space switching because that can move or visually disturb user windows. The existing observer remains the non-invasive fallback when every immediate strategy fails.

## Transaction and safety behavior

- Every attempt starts from the original Store snapshot.
- Every failed attempt restores the original Store before the next attempt.
- Wallpaper files are validated and copied into the permanent vault before Store mutation.
- The modern Store is written through a validated temporary property list and atomic move.
- Only WallpaperAgent is restarted for modern Store attempts.
- User desktop records are the authoritative verification target.
- Top-level display records are still reported, but their mismatch no longer causes a false rollback when all five actual user Space records verify.
- The shared Store record remains separately counted and verified.
- The renderer receives a per-attempt diagnostic list with success/failure and the exact error.

## Scheduler and operation safety

- Manual and scheduled wallpaper operations still use the existing single-flight guard.
- All-desktop apply timeout is now 120 seconds so the multi-attempt controller can complete without leaving the UI permanently busy.
- Observer fallback retains its fallback status and does not count as immediate inactive-Space success.

## Modified files

- `src/main/macos-spaces.ts`
- `src/main/wallpaper.ts`
- `src/renderer/main.tsx`
- `src/shared/types.ts`
- `src/main/phase15-1-1-regression.test.ts`
- `src/main/phase15-1-4-regression.test.ts` (new)

## Validation

- `npm run typecheck` — passed.
- `npm test` — 81 passed, 0 failed.
- `npm run build` — passed.
- Vite production renderer build — passed.
- Electron main/preload TypeScript build — passed.
- Embedded macOS diagnostic, modern Store apply, and observer JXA scripts — syntax checked successfully.
- `npm run app:dir` reached `electron-builder`; packaging could not download Electron because the sandbox could not resolve `github.com`.

## Native macOS acceptance test

1. Select **All desktops on all monitors**.
2. Leave inactive desktops unopened.
3. Run **Generate and Apply**.
4. Expand **Last all-desktop strategy attempts**.
5. A successful immediate method should be labeled successful and report 5 of 5 user desktops verified.
6. Visit each desktop only after the operation finishes and confirm it already has the new wallpaper.
7. If every immediate method fails, provide only the compact attempt list and errors rather than the full legacy database diagnostic.

## Remaining limitation

The private macOS wallpaper Store is undocumented and can change between OS releases. Phase 15.1.4 now adapts by cloning macOS's own active record first and records the exact outcome of each fallback, but native confirmation is required on the target Mac.

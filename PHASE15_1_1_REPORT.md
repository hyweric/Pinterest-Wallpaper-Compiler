# Phase 15.1.1 — Reliable Immediate All-Desktop Wallpaper Application

## Baseline

Implemented on top of `pinterest-wallpaper-compiler-phase15-1-fixed.zip`.

## Recovered working mechanism

The earlier Phase 12 source contained the behavior that had previously changed unopened Mission Control desktops:

1. Read every wallpaper target row from `~/Library/Application Support/Dock/desktoppicture.db`.
2. Update the `data` and `preferences` records in one SQLite transaction.
3. Restart Dock once so inactive Space records refresh.
4. Reapply the visible displays through AppKit after Dock restarts.

That route was removed in Phase 15 because it is private and version-sensitive. Phase 15.1 attempted to replace it with the macOS 14+ wallpaper Store, but its generated Desktop record had an empty `Files` array and it did not verify every requested Space record. The active-Space observer therefore became the only behavior the user could actually observe.

## Black-screen risk found

The previous legacy implementation could leave macOS records pointing at generated files that the app later deleted during cache cleanup. It also relied on a Dock restart without a complete transactional rollback path. Those two conditions are credible causes of black or missing desktop images.

Phase 15.1.1 now:

- validates the finished image through Electron and macOS before system records are changed;
- keeps generated images in the persistent Electron user-data directory;
- discovers all wallpaper paths referenced by both the modern Store and legacy database;
- prevents cache cleanup from deleting any currently referenced image;
- updates each store in a transaction;
- verifies every intended record after writing;
- restores the original Store/database on mismatch or service-reload failure;
- reapplies connected displays after the service refresh.

## Read-only diagnostic

A new diagnostic IPC route and Wallpaper Targets UI action report:

- macOS version and build;
- connected display IDs, UUIDs, names, bounds, and visible wallpaper paths;
- managed Mission Control Space UUIDs and current Space UUIDs;
- the inferred “Displays have separate Spaces” state;
- WallpaperAgent and Dock process state;
- modern `Index.plist` existence, permissions, schema, record counts, and file references;
- legacy database existence, permissions, tables, target-row counts, and file references;
- missing/unreadable wallpaper references;
- the selected immediate-update strategy.

The diagnostic does not modify system data.

## Version-aware strategy

The controller selects one of:

- `modern-store+legacy-dock` when both schemas are present, writable, and populated;
- `modern-store` when only the macOS 14+ Store is compatible;
- `legacy-dock` when only the proven older database schema is compatible;
- `observer-only` when neither private schema can be safely identified;
- `unsupported` outside macOS.

The legacy route is never used merely because the database file exists. The expected tables and usable target rows must be present.

## Modern Store transaction

The modern updater now:

- inspects the real Store before editing;
- clones an existing Desktop configuration rather than replacing the entire record blindly;
- preserves unrelated Desktop metadata;
- writes the new image path into both encoded `Configuration` data and the `Files` array;
- updates top-level display records;
- updates both `Default` and display-specific records for every selected Space;
- updates `AllSpacesAndDisplays` and `SystemDefault` when one wallpaper is requested everywhere;
- writes a temporary binary property list;
- validates the temporary property list;
- commits it with a same-volume atomic rename;
- reads the Store back and verifies every intended display and Space record;
- restores the backup if verification fails;
- reloads WallpaperAgent and verifies that it recovers.

## Legacy database transaction

When the compatible legacy schema is detected, the updater:

- creates a SQLite backup;
- chooses rows by display UUID for current-monitor mode or all rows for all-monitor mode;
- updates all requested rows inside one `BEGIN IMMEDIATE` transaction;
- reads every row back and compares its exact path;
- restarts Dock only once;
- verifies that Dock recovers;
- restores the database backup on any failure.

## Observer behavior

The active-Space observer remains, but is now reported as either:

- maintenance after an immediate verified update; or
- fallback when immediate Store/database synchronization fails.

It also reapplies after wake. Only one observer process exists. It is stopped when scheduling is disabled or paused, replaced when a new all-Space assignment begins, and stopped when the app quits.

## Scheduler safety

The existing single-flight operation guard remains intact:

- scheduled and manual runs cannot overlap;
- due scheduled runs are deferred without a one-second retry loop;
- stale operation tokens cannot unlock newer operations;
- pausing scheduling stops the Space observer;
- failure paths release the wallpaper operation lock.

## UI status

Removed the unconditional advanced-mode claim. The panel now shows live information such as:

- detected monitors and desktops;
- selected strategy;
- diagnostic warnings/errors;
- verified Space and display record counts from the most recent apply;
- whether the observer is maintenance or fallback.

The full diagnostic remains available in a collapsible section.

## Modified files

- `src/main/macos-spaces.ts`
- `src/main/main.ts`
- `src/main/wallpaper.ts`
- `src/main/wallpaper-targeting.test.ts`
- `src/main/phase15-1-1-regression.test.ts` (new)
- `src/preload/index.ts`
- `src/renderer/main.tsx`
- `src/renderer/styles.css`
- `src/shared/types.ts`

## Validation completed

- `npm run typecheck` — passed
- `npm test` — 71 passed, 0 failed
- `npm run build` — passed
- renderer production build — passed
- Electron main/preload build — passed
- all embedded JXA scripts passed JavaScript syntax checking with `node --check`
- `npm run app:dir` reached electron-builder packaging but the sandbox could not resolve `github.com` to download the Electron runtime

## Required macOS validation

The private Store/database behavior cannot be visually validated in this Linux sandbox. On the target Mac:

1. Run the full clean replacement.
2. Select **All desktops on all monitors**.
3. Run **macOS diagnostic** and confirm the detected monitor/Space counts and strategy.
4. Leave several Spaces unopened.
5. Generate and Apply.
6. Confirm the last-apply status verifies all requested Space records.
7. Switch through each previously unopened Space and confirm it was already updated.
8. Confirm no Space is black.
9. Run two scheduled updates, pause scheduling, and confirm manual Generate and Apply still works.
10. Restart the app and confirm the wallpaper remains valid.

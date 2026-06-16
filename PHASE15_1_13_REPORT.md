# Phase 15.1.13 — Immutable macOS Wallpaper Sets

## Objective

Replace the unreliable one-click inactive-Space wallpaper transaction with a supported user-assisted workflow. Pinterest Wallpaper Compiler now exports a folder of complete wallpaper variations and lets macOS own folder selection, Shuffle, and Show on all Spaces.

## User workflow

When a macOS all-desktop target is selected, the main action changes from **Generate and Apply** to **Create Wallpaper Set**.

1. Choose a set name and 1–500 variations.
2. Generate the set.
3. The app reveals the finished set and opens macOS Wallpaper Settings.
4. In **Your Photos**, choose **Add Photo → Choose Folder**.
5. Select the newly created folder.
6. Enable **Shuffle** and **Show on all Spaces**.

Current-desktop and visible-monitor targets still use direct application.

## Immutable versioned folders

Default parent folder:

`~/Pictures/Pinterest Wallpaper Compiler/Wallpaper Sets/`

Every run creates a new timestamped folder such as:

`Anime Rotation - 2026-06-16 143215/`

The app never adds to, replaces, or removes files inside a previously published set. This avoids relying on macOS to re-index a folder whose contents changed after selection.

## Atomic publication

Generation occurs inside a hidden staging directory. The final set is published with one directory rename only after every requested variation succeeds.

- Cancellation removes the staging directory.
- A render or write failure removes the staging directory.
- No partial folder appears in the set library.
- Filenames are deterministic inside the unique versioned folder.
- Every published folder contains `wallpaper-set.json` with set metadata and a file manifest.

## Variation limit

The set dialog accepts 1–500 variations. Rendering remains sequential so a large set does not retain hundreds of full-resolution canvases in memory simultaneously.

## Cleanup command

**Clean Up Wallpaper Sets…** is available in the set dialog and the editor overflow menu.

Cleanup behavior:

- Inspects only direct child folders containing a valid Pinterest Wallpaper Compiler manifest.
- Keeps the five newest managed sets.
- Deletes older managed sets after a native warning and confirmation.
- Deletes incomplete hidden staging folders older than 24 hours.
- Never touches unrelated or personal folders without the app manifest.
- Warns the user to ensure macOS is not actively using an old set before deleting it.

## Scheduling behavior

For all-desktop targets, app-controlled scheduling is disabled. The user chooses the rotation interval in macOS Wallpaper Settings. This prevents scheduled background runs from returning to the unreliable inactive-Space application path.

## Existing direct wallpaper behavior

- Current desktop: unchanged.
- Current monitor: unchanged.
- All visible monitors: unchanged.
- Inactive Mission Control Spaces: routed to wallpaper-set export on macOS.

The previous native-global implementation remains bounded in the codebase for compatibility and diagnostics, but it is no longer the primary renderer workflow for manual or scheduled all-desktop changes.

## Validation

- TypeScript renderer and Electron typechecks: passed.
- Main-process test suite: 88 passed, 0 failed.
- Production renderer build: passed.
- Electron build: passed.
- Cleanup tests verify unrelated folders are preserved.
- Atomic set tests verify unique paths, staged publication, cancellation cleanup, and a 500-item cap.

## Target Mac verification

1. Select **All desktops on current monitor** or **All desktops on all monitors**.
2. Confirm the toolbar action reads **Create Wallpaper Set**.
3. Generate a small set first, such as five variations.
4. Confirm Finder opens a new timestamped folder containing five images and `wallpaper-set.json`.
5. Confirm macOS Wallpaper Settings opens.
6. Add the folder under **Your Photos** and enable Shuffle and Show on all Spaces.
7. Visit each Mission Control Space and verify macOS rotates the folder without black flashes.
8. Generate another set and confirm it creates a different folder without modifying the first.
9. Create more than five test sets, invoke **Clean Up Wallpaper Sets…**, and confirm only app-managed older sets are offered for deletion.

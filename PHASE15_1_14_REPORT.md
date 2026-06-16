# Phase 15.1.14 Report — Manual Wallpaper Setup Handoff

## Summary

Phase 15.1.14 removes the app-controlled wallpaper schedule from the product UI and makes the two remaining workflows explicit:

1. **Preview on Current Desktop** changes only the currently active Mission Control desktop.
2. **Create Wallpaper Set** exports an immutable folder for macOS to manage through Wallpaper Settings.

The wallpaper-set export no longer opens Finder or Wallpaper Settings automatically. After export, the app displays a dedicated, legible setup screen and waits for the user to click the relevant buttons.

## User-facing changes

### Preview action

- Replaced the toolbar action **Generate and Apply** with **Preview on Current Desktop**.
- The preview request always uses:
  - `targetMode: current-desktop`
  - `scope: current-desktop`
  - `monitorMode: primary`
- Saved all-desktop targeting preferences cannot redirect the preview to inactive Spaces.
- Previous/Next history previews are also constrained to the current desktop.
- Template-card **Apply** was renamed to **Preview**.
- The tray action is now **Preview on Current Desktop**.

### Scheduling removal

- Removed the Schedule section from the inspector.
- Removed Pause/Resume rotation and interval information from the tray menu.
- Removed the renderer `SingleRunScheduler` instance and scheduled-run effect.
- Any older project that contains enabled scheduling is normalized to:
  - disabled
  - unpaused
  - manual interval
  - no next scheduled time
- Wallpaper operations still use the single-flight guard to prevent overlapping previews.

### Wallpaper-set completion dialog

After a successful export, the configuration form is replaced by a dedicated setup screen containing:

- A clear heading explaining that Wallpaper Settings will not open automatically.
- The exact exported folder path.
- A Copy Folder Path action.
- Four large numbered instructions:
  1. Show the set in Finder.
  2. Open Wallpaper Settings.
  3. Add the exact folder through Your Photos → Add Photo → Choose Folder.
  4. Enable Shuffle, select an interval, and turn on Show on all Spaces.
- Separate **Show Set in Finder** and **Open Wallpaper Settings** buttons.
- A retention warning explaining not to delete a folder while macOS is using it.

### Automatic opening removed

- Removed the export options that opened Wallpaper Settings or Finder when generation finished.
- Simplified `WallpaperSetFinalizePayload` to contain only the export session ID.
- Removed all finalizer-side `shell.openPath` and `shell.openExternal` calls.
- Wallpaper Settings can now open only through the explicit `export-set:open-wallpaper-settings` action triggered by the user button.

## Existing wallpaper-set safeguards retained

- 1–500 variations.
- New timestamped/versioned folder for every set.
- Hidden staging directory during generation.
- Atomic publication only after all requested images succeed.
- No partial set after cancellation or failure.
- Manifest-scoped cleanup.
- Five newest managed sets retained during cleanup.
- Personal folders without the app manifest are never touched.

## Validation

Completed successfully in the build environment:

- `npm run typecheck`
- `npm test` — **92/92 tests passed**
- `npm run build`
- Renderer production build
- Electron TypeScript build

New regression coverage verifies:

- Preview always targets the current desktop.
- Schedule controls and tray rotation commands are absent.
- Wallpaper Settings does not open during export finalization.
- The setup dialog keeps the exact folder path and readable numbered instructions.

## Live macOS checks still required

The build environment is not macOS, so verify on the target Mac that:

1. Preview changes only the active desktop.
2. Export completion leaves both Finder and Wallpaper Settings closed.
3. **Show Set in Finder** opens the correct immutable set folder.
4. **Open Wallpaper Settings** opens the expected Settings pane.
5. The setup dialog remains available when returning to the app.
6. The selected folder shuffles across all Spaces after enabling **Show on all Spaces**.

# Phase 15.1.15 Report — Current Desktop Preview Repair

## Summary

Phase 15.1.15 repairs **Preview on Current Desktop** without changing the immutable macOS Wallpaper Set workflow.

Two independent failures were addressed:

1. The Phase 15.1.14 preview function rendered the unprepared editor state instead of running the generation planner. Placeholders assigned to shuffled folders or Pinterest sources could therefore remain unchanged or empty.
2. The native preview path relied only on `NSWorkspace`/AppKit verification. When the current wallpaper was managed by a macOS folder shuffle, macOS could continue reporting the folder source or immediately rotate away from the generated image.

## Renderer repair

`previewOnCurrentDesktop()` now:

1. Copies the current project into a preview-only configuration.
2. Forces `targetMode` and `scope` to `current-desktop`.
3. Disables scheduling state.
4. Calls `prepareGeneratedProject(...)` so every assigned source pool resolves to an actual image before rendering.
5. Renders and applies the resulting prepared project.
6. Commits shuffle queue state only after successful application through the existing application pipeline.

This restores the generation behavior that existed behind the previous Generate and Apply action while keeping the new current-desktop-only scope.

## Native macOS repair

The controller retains its existing AppKit attempt first. If that attempt does not verify for a current-desktop preview, it now performs a separate System Events fallback that:

- Targets the visible desktop associated with the selected screen index.
- Disables picture rotation for that desktop.
- Disables random ordering for that desktop.
- Sets the generated image as the desktop picture.
- Reads the desktop picture back and verifies the exact persisted file path.

The fallback is used only for `current-desktop`. It is not used for inactive Mission Control Spaces, does not restart Dock or WallpaperAgent, does not create an overlay, and does not alter the Wallpaper Set export workflow.

## Permission handling

If macOS denies Automation access to System Events and AppKit also fails, the error now directs the user to:

`System Settings > Privacy & Security > Automation`

and asks them to allow Pinterest Wallpaper Compiler to control System Events before retrying Preview.

## Wallpaper Set behavior retained

- 1–500 variations.
- Immutable timestamped set folders.
- Hidden staging and atomic publication.
- Manual, readable setup instructions.
- Wallpaper Settings opens only after the user clicks the button.
- Manifest-scoped cleanup retaining the five newest managed sets.
- No app-controlled schedule.

## Validation

Completed successfully in the build environment:

- `npm run typecheck`
- `npm test` — **95/95 tests passed**
- `npm run build`
- Renderer production build
- Electron TypeScript build

New regression coverage verifies:

- Preview invokes the source-pool generation planner.
- Preview remains constrained to the current desktop.
- The System Events fallback exists only in the native current-desktop path.
- Folder rotation is disabled before fallback application.
- Automation denial produces an actionable error.

## Live macOS checks still required

The build environment is not macOS. On the target Mac, verify:

1. A placeholder assigned to a shuffled source changes to a generated image when Preview is clicked.
2. Preview works before configuring a Wallpaper Set.
3. Preview works after configuring a shuffled Wallpaper Set folder.
4. macOS requests Automation permission if needed.
5. The preview applies only to the currently visible desktop/display target.
6. Create Wallpaper Set and its manual setup dialog remain unchanged.

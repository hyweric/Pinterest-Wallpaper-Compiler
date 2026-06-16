# Phase 16.1.1 Report — Finder Drag-and-Drop Import

## Summary

Phase 16.1.1 contains the Phase 16.1 Finder drag-and-drop implementation and corrects a macOS-only validation assertion. Phase 16.1 adds Electron-safe Finder drag-and-drop importing for local folders and images. The implementation replaces the deprecated renderer-side `File.path` assumption with Electron 39's `webUtils.getPathForFile`, then validates every received path in the Electron main process before the project can use it.

## Supported Drop Targets

### Sources panel

- A folder becomes one reusable local-folder source.
- One image becomes one local-image source.
- Multiple images become one grouped local-image source.
- Multiple folders create one source per non-empty folder.
- Mixed folders and images import together in one operation.
- Pinterest URL drops remain supported.

### Placeholder

- A dropped folder is imported or reused and assigned as the placeholder's complete source pool.
- A single image is assigned in fixed mode.
- Multiple images are grouped and assigned in shuffle mode.
- Multiple folders or mixed inputs assign all resulting pools to the placeholder in shuffle mode.
- Existing source-row drag assignment remains supported.

### Empty canvas

- Finder drops import reusable sources only.
- No placeholder is created automatically.
- Existing internal source-row drops retain their prior create-placeholder behavior.

## Main-Process Import Service

A new shared main-process service lives in `src/main/local-source-import.ts`.

It is used by:

- Finder path drops
- Add Folder picker
- Add Local Images picker
- Single-image picker
- Folder rescanning

The service:

- Accepts untrusted path input as `unknown`.
- Rejects invalid, oversized, null-containing, missing, and unsupported entries.
- Resolves paths with `realpath` before use.
- Normalizes path identity for duplicate prevention.
- Keeps folder scanning top-level, matching the preexisting folder-picker behavior.
- Ignores hidden files and `.DS_Store`.
- Skips unreadable images without blocking valid items in the same drop.
- Does not create a source for an empty folder.
- Groups loose images from one operation into one source.
- Assigns stable image IDs based on canonical file paths.

## Supported Finder Image Formats

- PNG
- JPEG / JPG
- WebP
- GIF
- HEIC / HEIF when the Electron/macOS decoding pipeline supports the file

Electron `nativeImage` is attempted first. A conservative container-signature fallback prevents valid WebP, GIF, and HEIF-family files from being rejected solely because `nativeImage` lacks a decoder for that format.

## Duplicate Prevention

Sources now support a persisted `identityKey` based on canonical paths.

The renderer:

- Reuses folders with the same canonical identity.
- Reuses exact local-image groups.
- Reuses an existing local-image source when it already contains every dropped image.
- Preserves existing source IDs, names, selection state, and placeholder references during reuse.
- Prevents symbolic-link aliases from creating duplicate imports during the same operation.

## Drag Feedback

The editor now displays target-specific feedback:

- `Add folder as source`
- `Add images as source`
- `Assign folder to this placeholder`
- `Assign images to this placeholder`
- `Unsupported files cannot be imported`

Visual behavior includes:

- Sources-panel overlay
- Empty-canvas import overlay
- Per-placeholder highlight and label
- Separate invalid-drop styling
- Immediate cleanup on drop, drag exit, or drag end

## Import Feedback

Completion messages distinguish:

- New versus reused sources
- Folder image count
- Grouped image count
- Placeholder assignment
- Unsupported, unreadable, or missing items skipped
- Empty folders skipped

Examples:

- `Folder source added — 42 images`
- `3 images added as a source`
- `Existing source assigned to Placeholder 2`
- `8 images added as a source; 2 unsupported or unreadable items skipped`

## Persistence

Imported sources are stored in the normal project data model and therefore persist through:

- Renderer autosave
- Explicit project save
- App restart
- Project reopen

The Phase 16.1 installer preserves existing Electron application data instead of deleting project/source autosave state.

## Files Added

- `src/main/local-source-import.ts`
- `src/main/local-source-import.test.ts`
- `src/main/phase16-1-regression.test.ts`
- `PHASE16_1_REPORT.md`

## Files Updated

- `src/main/main.ts`
- `src/preload/index.ts`
- `src/renderer/main.tsx`
- `src/renderer/styles.css`
- `src/shared/types.ts`

## Validation

- Renderer TypeScript check passed.
- Electron TypeScript check passed.
- 105/105 automated tests passed, including on macOS path layouts where `/var` canonicalizes to `/private/var`.
- Production Vite renderer build passed.
- Renderer assets were inlined successfully.
- Electron main/preload build passed.
- Clean source-package dependency installation passed.
- Clean source-package tests and production build passed.
- Installer shell syntax passed.
- ZIP integrity and exclusion checks passed.

## Remaining Live Verification

The build environment is not macOS, so the following require a live Finder/Electron check on the target Mac:

- Dragging a Finder folder into the Sources panel.
- Dragging multiple Finder images into the Sources panel.
- Dragging a Finder folder directly onto a placeholder.
- Finder-provided HEIC/HEIF decoding on that macOS release.
- Persistence after closing and relaunching the packaged app.

## Phase 16.1.1 Validation Correction

The original symbolic-path test compared a temporary path returned by `os.tmpdir()` directly against the canonical path returned by `realpath()`. On macOS, `/var` is a symbolic alias of `/private/var`, so the implementation correctly returned `/private/var/...` while the test expected `/var/...`. The assertion now compares against `await realpath(image)`, which tests the intended canonicalization behavior consistently across macOS and Linux. Runtime import behavior is unchanged.

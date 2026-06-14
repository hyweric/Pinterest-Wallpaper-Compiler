# Pinterest Wallpaper Compiler Architecture

## Selected Stack

- **Electron** for the macOS and Windows desktop shell, native dialogs, and future wallpaper-setting adapters.
- **React + TypeScript + Vite** for the editor UI and fast local development.
- **Local JSON project files** for the MVP, with a migration path to SQLite if source metadata and cache state become more complex.
- **Browser canvas export** for exact-resolution PNG/JPEG output. This keeps the MVP small while leaving room for a headless renderer later.

Key tradeoff: Electron is heavier than a fully native app, but it gives one codebase for both target platforms and keeps the design-editor surface easy to iterate. Platform-specific wallpaper APIs stay isolated in the Electron main process layer.

## High-Level Architecture

- `main`: Electron entry point, filesystem access, native dialogs, project save/open, image export, and future OS wallpaper adapters.
- `preload`: Safe IPC bridge exposed as `window.wallpaperApi`.
- `renderer`: React editor, canvas interactions, source assignment, random generation, preview rendering, and autosave.
- `shared`: TypeScript data contracts used by both Electron and the UI.

The renderer never reads arbitrary disk paths directly through Node. It asks the main process to choose folders/files and receives typed local image references with `file://` URLs for preview and export.

## Project Directory Structure

```text
.
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── main/
│   │   └── main.ts
│   ├── preload/
│   │   └── index.ts
│   ├── renderer/
│   │   ├── exporter.ts
│   │   ├── main.tsx
│   │   ├── project.ts
│   │   ├── styles.css
│   │   └── vite-env.d.ts
│   └── shared/
│       └── types.ts
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.electron.json
└── vite.config.ts
```

## Data Model

- `WallpaperProject`: Root saved library with global image sources, the active editor workspace, template metadata, generated history, and timestamps.
- `CanvasSettings`: Width, height, preset/orientation, background color, and optional local background image.
- `ProjectLayer`: Currently an image placeholder layer. The model is shaped so text, shapes, and decorative layers can be added later.
- `PlaceholderLayer`: Position, size, rotation, crop mode, alignment, effects, visibility, locking, source assignment, and generated image selection.
- `ImageSource`: Common provider record for local folders, local files, mock web sources, and future Pinterest/web providers.
- `LocalImageRef`: Stable reference to a local image path plus a renderable URL.
- `WallpaperTemplate`: A reusable composition containing canvas/background settings, layers, linked source IDs, per-placeholder cycling/effects, wallpaper settings, thumbnail, and library metadata.
- `TemplateLibrary`: Saved templates, filters/collections, active-template identity, and rotation membership.
- `GeneratedCombination`: Saved/recent mapping of placeholder IDs to image IDs.

Templates never embed complete source records. Local folders and Pinterest boards remain in the project-level source library and templates reference them by stable source ID. During schema migration, the previous single workspace is preserved as the first default template; legacy template-embedded sources are merged into the global source library.

## Phased Implementation Plan

1. **MVP desktop shell and local editor**
   - Electron app shell
   - Canvas presets and custom size
   - Background color and local background image
   - Image placeholders with move, resize, delete, and properties
   - Local-folder image sources
   - Random generation without duplicate images where possible
   - PNG/JPEG export
   - Project save/load and autosave recovery

2. **Editor depth**
   - Undo/redo command stack
   - Reorderable layer panel
   - Text, shape, and decorative layers
   - More complete image alignment controls
   - Keyboard shortcuts and snapping

3. **Offline web cache**
   - Image-provider interface in main process
   - Cache directory with source metadata
   - Update progress and graceful offline fallback
   - Mock provider first, then compliant production providers

4. **Wallpaper automation**
   - macOS and Windows wallpaper-setting adapters
   - Generation history management
   - Scheduled rotation and login trigger
   - User-controlled cache cleanup

5. **Pinterest support**
   - Add only if a compliant, maintainable API or user-authorized integration is available.
   - Keep it behind the same provider interface as every other web source.

## Phase 2: Template-Linked Sources

The source library is split into two UI scopes without duplicating data:

- **This Template** shows only source IDs stored by the active template.
- **Global Sources** shows every reusable folder, Pinterest board, and grouped local-image collection.

Linking adds a stable source ID to the active template. Unlinking removes that reference and clears active-template placeholder assignments, but leaves the global source and original files intact. Deleting a global source removes its ID and assignments from every template after a usage warning.

## Pinterest Import Pipeline

Pinterest import now uses a staged, cancellable provider pipeline:

1. Validate the public board URL.
2. Read the lightweight public board response for initial pins and an expected pin count when available.
3. Load the public board in a hidden Electron browser and repeatedly scroll while accumulating pin IDs and best available image URLs.
4. Deduplicate by Pinterest pin ID.
5. Reuse cached files for unchanged pin IDs and download only new or changed image URLs.
6. Persist partial/canceled state so Update from Web can safely resume without redownloading completed pins.

The provider also contains an official Pinterest API pagination path. It requests the maximum page size, follows every bookmark, and separately includes board-section pins. Pagination state and exact failure bookmarks are retained in partial-import diagnostics.

`src/main/pinterest-pagination.ts` contains the reusable bookmark collector. Its Node test verifies a mocked 700-pin board split across three pages is fully collected and deduplicated.

## Phase 4 rendering model

Frame geometry (`x`, `y`, `width`, `height`, `rotation`) is independent from image placement (`cropMode`, alignment, crop offset, and zoom). Preview and export both use `shared/geometry.ts` so Fill, Fit, Stretch, Original, Tile, alignment, and crop transforms resolve through the same placement math. Canvas backgrounds retain their solid color separately from the optional image and store fit, alignment, transform, opacity, blur, brightness, transparency, and paper settings per template.

## Phase 5 wallpaper runtime

Wallpaper generation is now transactional. The renderer prepares a candidate template and source-cycle state, renders it, and asks the Electron main process to verify, write, and apply the file. Template/source shuffle state and applied-history metadata are committed only after the native adapter confirms success. Failed automatic updates retain the previous generation state and pause rotation after three consecutive failures.

Applied history stores the rendered file path, template identity, image assignments, timestamp, and monitor mode. Previous/Next reapply those saved files without mutating template data. The main process validates files, limits the generated-wallpaper cache, isolates macOS/Windows adapters, and keeps the renderer active while the window is hidden. The tray exposes generate, previous, pause/resume, open, and quit actions.

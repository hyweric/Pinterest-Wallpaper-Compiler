# AGENTS.md

## Project Overview

Pinterest Wallpaper Compiler is an Electron desktop app for macOS and Windows. It combines a wallpaper generator with a lightweight graphic-design editor. The current codebase is an MVP: users can create a local wallpaper project, edit a canvas, add image placeholders, assign local-folder image sources, generate random combinations, preview the result, export PNG/JPEG files, and save/load projects.

The larger product direction is documented in `docs/ARCHITECTURE.md`. The current priority is a polished desktop-editor workflow: local image sources, public Pinterest board importing when available, template rotation, native wallpaper control, and scheduling/tray polish.

## Current Stack

- Electron for the desktop shell and native file dialogs.
- React + TypeScript + Vite for the editor UI.
- Local JSON project files for saved projects.
- Browser canvas rendering for exact-resolution preview/export.
- `electron-builder` for packaged desktop builds.

## Important Files

- `src/main/main.ts`: Electron main process, native dialogs, project file read/write, image export.
- `src/main/providers.ts`: Image-source provider interface plus local/Pinterest provider implementations. Pinterest public-board import uses Pinterest's public pidgets board endpoint and succeeds only after at least one image is cached locally. It must not bypass login walls, CAPTCHAs, private-board permissions, or other access controls.
- `src/main/wallpaper.ts`: Platform-specific wallpaper adapters for macOS and Windows.
- `src/preload/index.ts`: Safe IPC bridge exposed as `window.wallpaperApi`.
- `src/shared/types.ts`: Shared project, layer, source, and export data model.
- `src/renderer/main.tsx`: Main React editor UI and workflow logic.
- `src/renderer/exporter.ts`: Canvas renderer used for previews and PNG/JPEG export.
- `src/renderer/project.ts`: Project defaults, presets, IDs, and helper functions.
- `src/renderer/styles.css`: App layout and visual styling.
- `scripts/start-electron.cjs`: Cross-platform dev launcher that clears inherited `ELECTRON_RUN_AS_NODE`.
- `docs/ARCHITECTURE.md`: Architecture, data model, and implementation roadmap.

## Common Commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run app:dir
npm run app:mac
npm run app:win
```

Use `npm run app:dir` when you want an unpacked app bundle for quick local testing. On macOS it creates a double-clickable app under `release/mac-arm64/` or `release/mac/` depending on architecture. Use `npm run app:mac` for DMG/ZIP distribution. Use `npm run app:win` on Windows or CI for NSIS/portable Windows builds.

## Development Notes

- Keep filesystem and OS integration in `src/main` behind IPC. Do not access Node APIs directly from the React renderer.
- Keep data contracts in `src/shared/types.ts` when both main and renderer need them.
- The renderer autosaves projects to `localStorage` for crash recovery. Project files are still saved explicitly through the Electron main process.
- The production renderer assets are intentionally inlined into `dist/renderer/index.html` by `scripts/inline-renderer-assets.cjs`. This avoids packaged Electron builds showing a blank window or raw JavaScript when external Vite asset paths are not available.
- Local folder sources are image collections. Placeholders can use fixed, sequential, random, shuffle-without-repeats, newest, and oldest modes. Preserve `sourceState` so sequence/shuffle progress survives restarts.
- Local image sources are referenced by path and rendered through `file://` URLs. Generated wallpapers are cached under app user data before being passed to the OS wallpaper adapter.
- Pinterest support must remain compliant. Public-board importing can use documented/public Pinterest responses that are accessible without account login. Do not add scraping that bypasses anti-bot protections, CAPTCHA bypassing, private-board access, or login-wall workarounds. Keep OAuth/client-id/cache-path diagnostics out of the normal import flow; place technical details behind collapsed diagnostics only.
- Platform-specific wallpaper setting should live outside the editor/generation logic, likely under a future `src/main/platform/` module.

## MVP Gaps

- Broader Pinterest fallback/integration support when the public pidgets endpoint is unavailable.
- More detailed cached web-image update progress and deduplication controls.
- Virtualized image browsing for extremely large boards.
- Text and shape layers.
- More complete tray/menu-bar behavior across platforms.
- Multi-monitor wallpaper behavior beyond all-desktops macOS support.

## Style Guidance

- Preserve the current local-first architecture.
- Prefer focused additions over broad rewrites.
- Keep the UI dense and app-like, not marketing-page-like.
- Use existing typed models and helpers before adding new abstractions.
- Run `npm run typecheck` and `npm run build` after substantial changes.

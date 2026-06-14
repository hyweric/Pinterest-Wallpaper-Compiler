# Phase 10 implementation plan

1. Add per-display fade overlays in the Electron main process and pass display IDs with target payloads.
2. Consolidate the inspector into Settings for canvas/background/wallpaper and Image/Effects for placeholders.
3. Remove redundant rotation, startup, preview, vignette, video-only, and paper-texture controls from the visible UI.
4. Debounce source click assignment and automatically render/apply the final selected source, with rollback on failure.
5. Move lock/hide controls onto selected canvas layers and add hidden-layer recovery in the Layers panel.
6. Normalize generic layer names independently from source names and simplify adjustment/paper presets.
7. Add fast polished tooltips for icon-only controls.
8. Run typecheck, tests, build, review diff, and package the updated source.

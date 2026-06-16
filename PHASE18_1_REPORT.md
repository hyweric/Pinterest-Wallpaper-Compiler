# Phase 18.1 Report — Background-Only Surface Rendering

## Summary
Phase 18.1 corrects the canvas-surface compositing order so global wallpaper surfaces affect only the background layer. Uploaded source images and placeholders remain in front and are not tinted, textured, or blended by the canvas-wide Surface section.

## Render order
The shared editor/export render order is now:

1. Canvas color, transparency, or background image
2. Canvas-wide Surface texture
3. Uploaded source placeholders and their frames
4. Canvas vignette

Per-placeholder texture and paper-frame effects remain separate and continue to affect only the placeholder where they were explicitly configured.

## Blend-mode behavior
- `Normal` is now the default blend mode for newly created surface settings.
- Paper, Crumpled Paper, Grid Paper, and Dotted Paper presets all select with `Normal` blending by default.
- `Multiply`, `Screen`, `Overlay`, and `Soft Light` remain available as optional background-surface blend modes.
- Even when Multiply is selected, the canvas surface stays behind source placeholders and cannot alter uploaded source images.

## Editor/export parity
The same corrected order is used by:

- Editor canvas preview
- PNG and JPEG export
- Preview on Current Desktop
- Generated wallpaper files
- macOS Wallpaper Sets
- Template thumbnails

## Validation
- `npm run typecheck` passed.
- `npm test` passed: 137/137.
- `npm run build` passed.

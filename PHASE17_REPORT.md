# Phase 17 Report — Surface Texture Rendering and Zoom Polish

## Summary

Phase 17 fixes canvas-wide Surface rendering and includes the requested follow-up adjustments to Phase 16.3 zooming.

## Zoom follow-up

- Increased Command/Control + scroll sensitivity from `0.0012` to `0.002`.
- Removed the permanently visible zoom percentage/control panel.
- Retained keyboard shortcuts:
  - Command/Control + Plus: zoom in
  - Command/Control + Minus: zoom out
  - Command/Control + 0: 100%
  - Command/Control + 1: fit canvas
- Reworked scroll correction so the exact logical canvas point beneath the pointer stays beneath that pointer after zoom.
- Wheel events remain editor-scoped, non-passive, and coalesced through one animation frame.

## Surface rendering architecture

### Shared renderer

`src/renderer/surface-renderer.ts` now provides the common implementation used by:

- the editor canvas surface preview;
- PNG/JPEG export;
- Preview on Current Desktop;
- generated wallpaper files;
- macOS Wallpaper Set export;
- template thumbnails.

The editor calls `drawSurfacePreview`, which calls the same `drawSurfaceTexture` implementation used by the exporter.

### Canvas-wide placement

The canvas Surface effect is drawn after all placeholders in both editor and export. It therefore covers the complete wallpaper composition rather than sitting behind image placeholders.

Layer-specific paper/grain effects remain separate and continue to apply only to the explicitly selected placeholder.

### Stable procedural rendering

Surface generation is deterministic from the saved seed. The seed is not changed during opening, previewing, exporting, applying, or restarting the app.

The only Surface action that changes the seed is the explicit **Regenerate Texture** button.

### Performance and memory

- Procedural and bundled surface tiles are generated at 256 × 256 and repeated.
- Tile cache is limited to 24 entries.
- Bundled image cache is limited to 12 entries.
- Full-resolution custom images are not retained in the image cache after their small tile is created.
- Editor preview buffers are capped at 1024 pixels on the longest side and 1.2 million pixels total.
- Slider changes redraw only the bounded preview canvas after a short coalescing delay.
- Full-resolution work occurs only during actual export or wallpaper generation.

## Surface controls

The Surface section now includes:

- Enable surface texture
- None / Fine Paper / Matte Paper / Recycled Paper / Canvas / Handmade Paper
- Imported custom surfaces
- Intensity
- Opacity
- Scale
- Noise / grain
- Roughness
- Light / dark
- Rotation
- Blend mode
- Texture seed
- Regenerate Texture

Every control changes either the generated tile, its transform, its alpha, or its compositing behavior.

## Persistence and compatibility

The following fields are stored in `canvas.backgroundPaper`:

- `enabled`
- `type`
- `intensity`
- `scale`
- `rotation`
- `opacity`
- `blendMode`
- `seed`
- `noise`
- `roughness`
- `tone`
- `customTextureId`

Older projects that already selected a non-None texture are automatically treated as enabled. New fields receive deterministic defaults during project normalization.

## Validation

- Renderer TypeScript check passed.
- Electron TypeScript check passed.
- 135/135 automated tests passed.
- Production Vite build passed.
- Renderer assets were successfully inlined.
- Electron main/preload build passed.
- Surface-specific tests cover deterministic seeds, cache keys, bounded preview dimensions, memory limits, shared preview/export rendering, complete-canvas ordering, and required controls.

## Live checks still required

The build environment cannot reproduce a physical MacBook trackpad or visually compare the macOS desktop after native wallpaper application. The packaged build should therefore receive a final live check for:

- pointer-centered trackpad zoom feel;
- each Surface slider in the editor;
- editor versus exported PNG comparison;
- Preview on Current Desktop with Surface enabled;
- a multi-image Wallpaper Set with Surface enabled.

# Phase 18 Report — Surface Defaults and Dropdown Styling

## Summary
Phase 18 sets the bundled sourced surface presets to the requested default control values and tightens inspector/dropdown presentation without redesigning the rest of the application.

## Completed work

### 1. Bundled surface defaults
Applied requested per-surface default values when selecting the built-in sourced textures:

- Paper
  - Intensity 100
  - Opacity 0.66
  - Scale 0.2
  - Noise / grain 100
  - Roughness 100
  - Light / dark 12
  - Rotation 0
- Crumpled Paper
  - Intensity 67
  - Opacity 0.36
  - Scale 0.2
  - Noise / grain 68
  - Roughness 100
  - Light / dark 9
  - Rotation 39
- Grid Paper
  - Intensity 100
  - Opacity 0.62
  - Scale 0.95
  - Noise / grain 52
  - Roughness 0
  - Light / dark 37
  - Rotation 0
- Dotted Paper
  - Intensity 100
  - Opacity 0.9
  - Scale 0.95
  - Noise / grain 52
  - Roughness 0
  - Light / dark 63
  - Rotation 0

Behavior:
- Selecting a bundled surface now applies its requested defaults.
- Turning surface textures on from `None` defaults to `Paper` with the requested Paper settings.
- Turning a surface off preserves the currently selected surface type/settings so re-enabling restores them.
- Custom imported surfaces keep their existing numeric settings.

### 2. Dropdown and control styling cleanup
Improved control presentation across the inspector panels with no broad UI redesign:

- Standardized select/input trigger height, radius, padding, line-height, and focus treatment.
- Added reliable right-side arrow spacing so labels are not covered by the dropdown arrow.
- Improved vertical centering of selected values.
- Reduced unnecessary truncation of trigger text.
- Strengthened disabled-state readability.
- Raised open inspector sections in stacking order and ensured detail sections remain overflow-visible.
- Prevented inspector content from clipping the trigger presentation horizontally.
- Unified spacing/alignment for Details, Canvas, Background, Surface, Advanced, Wallpaper Targets, and Schedule-style controls.
- Hid native details markers inside these sections so only the existing custom chevron remains.

## Validation
- `npm run typecheck` ✅
- `npm test` ✅ (`136/136` passing)
- `npm run build` ✅

## Files touched
- `src/shared/surfaces.ts`
- `src/renderer/main.tsx`
- `src/renderer/styles.css`
- `src/main/surfaces.test.ts`

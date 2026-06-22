# Phase 22.3.3 — Hide Control Removal + Dropdown Padding Standard

## Scope

Focused hotfix only. No wallpaper generation, preview, source assignment, drag/drop, effects structure, export, or persistence code was changed.

## Changes

- Removed the selected-image floating toolbar's **Hide layer** button.
- Kept Move layer up, Move layer down, Duplicate, and Lock on the selected-image floating toolbar.
- Left the hidden-layer restore panel and layer-list visibility infrastructure intact so older projects with hidden layers can still be recovered.
- Added a final dropdown style standard for select controls across sidebar/inspector layouts:
  - 35px height
  - 12px left padding
  - 38px right padding for arrow space
  - consistent arrow position
  - consistent line-height and ellipsis behavior

## Risk review

- Low functional risk: no model/schema/export/renderer pipeline changes.
- Low UI risk: final CSS override is scoped to `select` controls and standardizes previous conflicting select rules.
- Compatibility preserved: existing hidden layers are still restorable from the Hidden Layers panel.

## Validation

- `npm ci --ignore-scripts` passed.
- `npm run typecheck` passed.
- `npm test` passed: 215/215.
- `npm run build` passed.
- `npm run app:dir` was attempted and reached electron-builder packaging, then failed in this container due GitHub DNS/download restrictions.

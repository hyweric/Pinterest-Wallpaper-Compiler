# Phase 11 Implementation Record

## Checkpoint 1 — Wallpaper engine

Root causes found:

- Visible/inactive Mission Control targets were inferred from wallpaper paths. When several Spaces shared one path, every matching Dock row could be treated as visible.
- Transition overlays did not expose enough lifecycle diagnostics to distinguish overlay creation, image decode, animation, verification, and cleanup failures.
- A partial per-Space failure only rolled back failed rows, leaving a mixed wallpaper batch.

Changes:

- Added explicit physical-display, active-Space, and inactive-Space target typing in diagnostics.
- Added duplicate-safe visible-Space classification that consumes each visible desktop match only once.
- Created one predecoded click-through overlay per visible Electron display and recorded animation timing/frame diagnostics.
- Kept inactive Space changes unanimated and marked their visual verification as unavailable until activated.
- Made a failed Dock target batch roll back all rows and restore visible screens.

## Checkpoint 2 — Shared UI system

Root causes found:

- Native selects inherited conflicting one-off widths/padding and could overflow narrow inspector columns.
- The right inspector had nested scrolling and conflicting panel overflow rules.
- Multiple legacy tooltip implementations competed with native `title` behavior.

Changes:

- Added shared control tokens for heights, typography, borders, focus rings, and section spacing.
- Standardized selects and inputs with contained one-line text, ellipsis, fixed chevron alignment, and width constraints.
- Consolidated inspector scrolling into one stable scroll region.
- Reduced default expanded Settings sections to Background and Schedule.

## Checkpoint 3 — Selection, tooltips, and Home

Changes:

- Added Shift-click toggle selection and Shift-drag marquee selection for visible unlocked layers.
- Kept Shift range selection in the Layers panel and Cmd/Ctrl toggling.
- Multi-selected layers now move, duplicate, delete, copy/paste, lock, and hide together.
- Added a portal-based tooltip system with a short delay, viewport clamping, keyboard-focus support, accessible role, arrow, and optional shortcut.
- Replaced Home messaging with “Wallpaper, made personal.” and “Turn the images you love into an evolving visual space.”

## Checkpoint 4 — Curated surfaces

Changes:

- Replaced weak built-in paper procedures with five processed CC0 ambientCG assets: Fine Paper, Matte Paper, Recycled Paper, Canvas, and Handmade Paper.
- Added thumbnails, shared manifest metadata, SHA-256 checksums, and `THIRD_PARTY_ASSETS.md`.
- Kept Film Grain procedural.
- Wired the same bundled assets into editor preview and canvas export/wallpaper rendering.
- Missing or unsupported surfaces safely render as no texture instead of crashing.

## Validation

- `npm run typecheck` — passed.
- `npm test` — 33 tests passed.
- `npm run build` — passed.
- `npm run app:dir` — source build passed; Linux Electron packaging could not download the Electron binary because GitHub DNS/network access was unavailable in the execution environment.

## Manual macOS checks still required

- Crossfade visibility on each physical display.
- Three or more Mission Control Spaces in Different mode.
- Immediate Mission Control thumbnail refresh and inactive-Space activation.
- Packaged-app dropdown layout, keyboard tooltips, and texture appearance.

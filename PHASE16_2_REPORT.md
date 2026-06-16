# Phase 16.2 Report — Add Source Control and Settings Cleanup

Date: 2026-06-16

## Summary

Phase 16.2 replaces the three permanently visible source-import icon buttons with one compact, labeled `+ Add Source` control. The control supports both hover and click interaction, presents all existing import workflows with visible labels and descriptions, stays inside the application viewport, and provides complete keyboard navigation.

The repeated Settings heading in the inspector was also removed. The inspector tab is now the single page-level Settings label, while Canvas, Background, Surface, Advanced, Wallpaper Targets, and other subsection labels remain unchanged.

## Add Source control

The Sources header now contains one control:

- Plus icon
- `Add Source` text
- Compact styling consistent with the Sources panel

The previous individual folder, Pinterest, and image icon buttons were removed from the header.

## Add Source menu

The menu contains the same three existing workflows:

1. `Local Folder`
   - Folder icon
   - `Use images from a folder`
   - Runs the existing folder-source picker and import pipeline
2. `Local Images`
   - Image icon
   - `Select one or more image files`
   - Runs the existing local-image picker and import pipeline
3. `Pinterest Board`
   - Pinterest-style sparkle icon
   - `Import images from a board`
   - Opens the existing Pinterest import dialog

No source-import functionality was removed or reimplemented separately.

## Pointer interaction

- Hover opens the menu after 120 ms.
- Moving from the trigger into the menu keeps it open.
- Leaving both the trigger and menu closes it after a 220 ms grace period.
- Clicking the trigger toggles the menu.
- Clicking outside closes the menu.
- Selecting an option closes the menu before launching its workflow.

The grace period prevents the menu from disappearing while the pointer crosses the small gap between the trigger and the menu.

## Positioning and clipping prevention

The menu is rendered through a React portal attached to `document.body`, rather than inside the clipped Sources-panel scroll area.

On open and whenever the window resizes or scrolls, the menu:

- Measures the trigger and menu with `getBoundingClientRect()`.
- Opens below the trigger by default.
- Flips above when there is insufficient room below.
- Clamps its horizontal and vertical position to a 10 px viewport margin.
- Uses fixed positioning and a high overlay layer so it remains visible over the editor.

## Keyboard and accessibility behavior

- Trigger uses `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`.
- Menu uses `role="menu"` and an accessible label.
- Options use `role="menuitem"` and visible text labels.
- Enter and Space use the button's normal activation behavior.
- Arrow Down opens the menu and focuses the first option.
- Arrow Up opens the menu and focuses the last option.
- Arrow Up and Arrow Down cycle through options.
- Home and End move to the first and last options.
- Escape closes the menu and restores focus to the trigger.
- Tab closes the menu while preserving normal focus movement.
- Focus states remain visibly outlined.

## Settings cleanup

The `CanvasDesignPanel` previously rendered an internal `<h2>Settings</h2>` below the inspector's own Settings tab. That duplicate heading was removed.

The remaining page-level label is the inspector tab:

- `Settings`

Existing subsection labels remain intact, including:

- Canvas
- Background
- Surface
- Advanced
- Wallpaper Targets
- Diagnostics

## Regression coverage

Added Phase 16.2 regression tests covering:

- A single Add Source control in the Sources header.
- Removal of the three old icon-only controls.
- Preservation of all three import workflows.
- Visible menu labels and descriptions.
- Hover open and close delays.
- Click toggling and outside-click dismissal.
- Menu and menu-item accessibility roles.
- Arrow, Home, End, Escape, and Tab keyboard handling.
- Portal rendering and viewport clamping.
- Fixed overlay styling and visible focus states.
- Removal of the repeated Settings heading.
- Preservation of Settings subsection headings.

## Validation

Completed successfully:

- `npm run typecheck`
- `npm test`
- 116 of 116 tests passed
- `npm run build`
- Vite production renderer build
- Renderer asset inlining
- Electron main/preload TypeScript build

The local package installation used `ELECTRON_SKIP_BINARY_DOWNLOAD=1` because the build environment temporarily could not resolve GitHub while downloading the Electron runtime. This does not alter source code or the user installer; the installer continues to run a normal `npm ci` on the connected target Mac.

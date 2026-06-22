# Phase 22.3.6 — Floating Toolbar Shell Restore

## Scope
- Restore the selected-image floating toolbar's main white shell.
- Keep the unwanted inner blue-tinted button group capsules removed.
- Do not change drag/drop, preview, effects, source assignment, rendering, export, or inspector behavior.

## Implementation
- Updated only `src/renderer/styles.css`.
- Replaced the Phase 22.3.5 fully-transparent toolbar override with a narrower Phase 22.3.6 override:
  - `.context-toolbar.compact-context-toolbar` regains white background, border, blur, padding, and shadow.
  - `.context-toolbar.compact-context-toolbar .context-toolbar-button-group` remains transparent with no border/shadow.

## Risk Review
- Behavior risk is very low: CSS-only visual patch.
- Existing toolbar buttons remain unchanged.
- No data model or generation logic touched.

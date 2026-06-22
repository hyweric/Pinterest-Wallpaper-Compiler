# Phase 22.3.2 — Add Placeholder Polish + Soft Number Minimums

## Scope
- Remove the extra visual backing rectangle behind the Add Placeholder control.
- Replace immediate-clamp numeric fields with soft-minimum text inputs for constrained fields.
- Keep minimums/maxes, but allow normal backspace/editing and show a short fading notice on invalid commit.

## Notes
- Does not alter drag source, preview, effects, wallpaper export, renderer/export data models, or layer context logic.
- Affected fields include wallpaper set variation count, canvas width/height, border/radius/opacity, and layer width/height.

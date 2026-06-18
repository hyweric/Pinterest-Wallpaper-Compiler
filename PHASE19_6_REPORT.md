# Phase 19.6 Report — Effect Selection and Direct Polaroid Editing

## Summary
This hotfix addresses two issues found after the full Phase 19 release:

1. Selecting Clean, Torn, Deckle, or Newsprint immediately reverted the Paper Frame selector to None.
2. Polaroid photo placement depended on numeric scale/offset/rotation controls instead of direct canvas manipulation.

## Effect selector fix
The project migration code accepted legacy aliases such as `torn-paper`, but accidentally rejected the current canonical values `clean`, `torn`, `deckle`, and `newsprint`. Because every project mutation is normalized, those values were rewritten to `none` immediately after selection.

The normalizer now preserves all supported current frame values:

- None
- Clean
- Polaroid
- Torn
- Deckle
- Newsprint

Legacy aliases continue migrating to the matching current values. Polaroid and Torn/Deckle enabled state is synchronized to the selected Paper Frame style during normalization.

## Direct Polaroid photo editing
When a selected layer uses Polaroid and the Effects inspector is open, the photo area now exposes direct manipulation controls:

- Drag inside the photo to reposition it.
- Drag any corner dot to resize the photo uniformly.
- Drag the round top handle to rotate the photo.
- Drag the surrounding white Polaroid frame to move the complete layer.
- Outer selection handles still resize the complete Polaroid frame.

The photo controls stop pointer propagation, so they cannot accidentally move or resize the outer Polaroid. Frame rotation is accounted for while dragging the internal photo.

The number-heavy photo scale, X/Y, and rotation controls were removed from the Polaroid inspector. Crop mode and Reset Photo Placement remain available.

## Undo and persistence
A complete project snapshot is captured when a direct photo drag begins. Releasing the pointer creates one undo step, matching normal canvas movement and resizing. The existing Polaroid effect fields remain persisted, duplicated, exported, and migrated normally.

## Validation

- `npm run typecheck` passed.
- `npm test` passed: 186/186 tests.
- `npm run build` passed.
- New tests cover canonical Paper Frame values, legacy aliases, direct drag geometry, scale, rotation, event isolation, and undo history.

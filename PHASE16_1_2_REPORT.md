# Phase 16.1.2 — Positioned Canvas Drop Fix

## Problem

Phase 16.1 introduced contradictory empty-canvas behavior:

- Existing source drags displayed “Create a placeholder from this source.”
- Finder drops displayed “No placeholder will be created.”
- Existing source drops created frames at the generic default position rather than at the cursor.
- Finder drops on empty canvas imported sources without creating anything visible.

This made the canvas feel like a fixed import target instead of a spatial editor.

## New Interaction Model

### Existing source → empty canvas

- A live placeholder outline follows the cursor.
- The preview uses the same size as the frame that will be created.
- Releasing creates a new placeholder centered on the exact drop point.
- The source is assigned immediately.
- The new placeholder is selected.

### Finder folder or images → empty canvas

- Paths are still validated and canonicalized in the main process.
- Valid sources are imported or reused.
- One positioned placeholder is created per resulting source.
- Multiple loose images remain one grouped source and therefore create one placeholder.
- Multiple folders create multiple placeholders in a small cascade beginning at the drop point.
- Imported placeholders use Fixed mode for one eligible image and Shuffle mode for image pools.

### Source or Finder item → existing placeholder

- Existing behavior is retained: the dropped source replaces or assigns the selected placeholder’s source.
- No new placeholder is created.

### Finder item → Sources panel

- Existing behavior is retained: sources are imported or reused without creating a canvas object.

## UI Changes

- Removed the full-canvas valid-drop overlay that hid the intended placement location.
- Removed “This imports sources only. No placeholder will be created.”
- Added a live dashed frame preview under the pointer.
- Added concise copy: “Release to place … here.”
- Added a count badge for multi-source drops.
- Invalid drops retain a clear red rejection overlay.

## Positioning Details

- Pointer coordinates are converted from the rendered canvas back into project coordinates using the active zoom.
- The frame is centered on the drop point.
- Placement is clamped so the full frame stays inside the canvas.
- Additional sources receive a deterministic diagonal cascade offset.
- Position, import, assignment, template linking, and selection are committed as one undoable operation.

## Validation

- TypeScript renderer and Electron typechecks passed.
- 108/108 automated tests passed.
- Added tests for cursor-centered placement, edge clamping, and multi-source cascade behavior.
- Production renderer build passed.
- Electron main and preload build passed.

A final tactile Finder drag test should be performed on macOS because the build environment cannot reproduce Finder’s native drag session.

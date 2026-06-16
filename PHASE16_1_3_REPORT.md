# Phase 16.1.3 — Wallpaper Set Delete-All Fix

## Summary

Phase 16.1.3 fixes the broken wallpaper-set cleanup action and replaces the old “keep five newest sets” behavior with an explicit, destructive delete-all workflow.

## User-facing changes

- Renamed the toolbar command to **Delete All Wallpaper Sets…**.
- Renamed the wallpaper-set dialog action to **Delete All Sets…**.
- The action now inspects the selected Wallpaper Sets parent folder every time.
- If the folder contains anything, macOS shows a native confirmation dialog before deletion.
- The confirmation states that every subfolder and file inside the selected folder will be permanently erased.
- The exact target path is shown in the confirmation.
- **Cancel** is the default and Escape/cancel closes the dialog without deleting anything.
- The parent Wallpaper Sets folder remains in place after deletion.
- If the folder is already empty, the app reports that clearly instead of appearing unresponsive.
- Errors are shown in the main app status area even when the export dialog is closed.

## Filesystem safety

The delete-all command rejects broad or dangerous roots, including:

- Filesystem root
- User home folder
- Pictures
- Documents
- Desktop
- Downloads
- Application Support data root

Only direct children of the selected dedicated Wallpaper Sets folder are removed. Recursive deletion removes the contents of child folders, while the selected parent folder itself is preserved.

## Confirmation copy

The native warning asks:

> Are you sure you want to erase everything inside the Wallpaper Sets folder?

It also reports the number of top-level folders/files, estimated disk usage, exact folder path, and warns that the action cannot be undone or used safely while macOS still references one of the sets.

## Validation

- TypeScript renderer and Electron checks passed.
- 111/111 automated tests passed.
- Production Vite build passed.
- Electron main/preload build passed.
- Added deletion tests covering nested folders, loose files, temporary exports, parent-folder preservation, destructive confirmation, and status reporting.

# Phase 22.3.10.6 — Source UI Cleanup

## Changes

- Removed the selected-source media policy row that showed `Media` and `Images + video thumbnails`.
- Removed the selected-source technical `Details` dropdown from the source panel.
- Simplified selected-source helper copy so it no longer says `Source details` or asks users to view details.
- Removed the duplicate visible `Color` label inside the Background color mode. The segmented Color tab is now the visible label.
- Removed editor and home bottom status bars, including diagnostic/toast-style messages such as unlink summaries.
- Removed the visible Pinterest `Update from Web` modal action. `Import Board` is now the single action and still detects an existing matching board URL to resume/update using the cached source.
- Updated Pinterest partial/canceled copy to say users can import the board again to resume.

## Verification

- `npm run typecheck` passed.
- `npm test` passed: 248/248.
- `npm run build` passed.

## Notes

`Update from Web` and `Import Board` were effectively the same path in the modal because both sent the current URL plus any existing matching cached Pinterest source into the same provider. The provider's `update()` method delegates back to `import()` with update mode, so the visible duplicate button was removed. Existing source refresh still uses the update API internally when refreshing a saved Pinterest source from the source card.

# Phase 15.1.8.1 Build Hotfix

## Root cause

`scripts/build-macos-wallpaper-bridge.cjs` imported `spawnSync` from `node:fs`. Node's filesystem module does not export `spawnSync`, so the build failed before Swift compilation began.

## Fix

- Import filesystem helpers from `node:fs`.
- Import `spawnSync` from `node:child_process`.
- Add a regression assertion so this import cannot silently regress.

## Validation

- `npm run typecheck` passed.
- `npm test` passed: 73 tests, 0 failures.
- `npm run build` passed in the validation environment.
- The build script now runs on non-macOS and exits through its intended unavailable-marker path.

## macOS note

On macOS, the corrected script will now reach `/usr/bin/xcrun swiftc`. The native helper still needs to compile on the user's Mac during `npm run app:dir`.

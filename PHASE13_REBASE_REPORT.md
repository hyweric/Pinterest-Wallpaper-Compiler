# Phase 13 Rebase Report

## Baseline and approach

This repair was rebuilt from `pinterest-wallpaper-compiler-phase11-white-screen-hotfix.zip`, rather than layering more changes onto the unstable Phase 13 branches.

The work was intentionally limited to generation, wallpaper application, scheduling, and the stability issues directly connected to those operations. The Phase 11 editor layout and feature behavior were otherwise preserved.

Implementation plan followed:

1. Trace the Phase 11 Test Export, Generate and Apply, IPC, macOS application, scheduler, and autosave paths.
2. Identify the smallest missing or unsafe pieces.
3. Add a shared, explicit Generate -> Save -> Apply pipeline.
4. Replace component-owned schedule timeouts with one cancelable scheduler.
5. Remove known full-screen and storage failure paths that could produce an apparent white screen.
6. Add regression tests before packaging.

## Root causes found

- The preload bridge exposed `wallpaper:apply-file`, but the Electron main process did not register a matching handler.
- The old generation path did not create and retain a validated generated wallpaper file before application.
- Test Export and wallpaper application used different rendering/data-transfer paths.
- Scheduled runs were controlled by React effect timers that could be replaced, duplicated, or lost while another operation was running.
- Full-resolution wallpaper images were transferred and retained as base64 data URLs, increasing renderer memory pressure.
- Crash-recovery autosave could repeatedly serialize large generated preview data into `localStorage`.
- The optional full-screen fade used separate overlay windows. If a run was interrupted, an overlay could remain visible and resemble a white or blank application.
- There were two normal Generate and Apply controls in the Phase 11 interface.

## Repairs

- Added a shared sequential wallpaper pipeline with explicit rendering, saving, generated, applying, verifying, and applied stages.
- Added `wallpaper:generate` and the missing `wallpaper:apply-file` Electron IPC handlers.
- Generate now renders asynchronously, validates the image, writes it atomically to the generated-wallpaper cache, and returns its exact path.
- Apply consumes the exact generated file path rather than re-rendering or relying on transient renderer state.
- Generate and Apply stops immediately and reports the original error if generation fails.
- Replaced wallpaper ArrayBuffer transport for scheduled generation/apply to avoid large base64 strings in the hot path.
- Added operation timeouts so a failed render, save, or apply cannot leave the UI permanently stuck on Working.
- Added a single-owner scheduler with replacement, cancellation, stale-callback protection, and duplicate prevention.
- The 5-second countdown now displays 5, 4, 3, 2, 1, and 0, then triggers exactly once.
- If a scheduled run becomes due during an active operation, it retries rather than silently losing that run.
- Reduced crash-recovery autosave size and made autosave debounced and failure-safe.
- Added an application-level React recovery screen instead of leaving an empty renderer root.
- Added one-time renderer reload after an unexpected renderer-process crash.
- Disabled the separate full-screen fade-overlay windows; wallpaper application remains immediate.
- Removed the duplicate sidebar Generate and Apply control. The normal editor now has one top-toolbar action.

## Modified files

- `src/main/main.ts`
- `src/preload/index.ts`
- `src/renderer/exporter.ts`
- `src/renderer/main.tsx`
- `src/renderer/project.ts`
- `src/renderer/styles.css`
- `src/shared/types.ts`
- `src/shared/wallpaper.ts`

## Added files

- `src/shared/scheduler.ts`
- `src/shared/wallpaper-pipeline.ts`
- `src/main/wallpaper-pipeline.test.ts`
- `src/main/scheduler-runtime.test.ts`
- `src/main/phase13-rebase-regression.test.ts`

## Validation performed

### Type checking

`npm run typecheck`

Result: passed.

### Automated tests

`npm test`

Result: 47 passed, 0 failed.

Coverage includes:

- Test Export regression behavior.
- Manual generation.
- Manual application of the exact generated file.
- Sequential Generate and Apply.
- Generation-error propagation and prevention of application.
- Render, save, and apply timeouts.
- Five-second countdown progression.
- Exactly-once scheduler execution.
- Timer replacement and cancellation.
- Duplicate-schedule prevention.
- Single visible Generate and Apply action.
- IPC handler registration.
- Compact autosave without live-state mutation.
- Visible renderer recovery boundary.
- Existing editor, source, export, surface, history, target-discovery, and wallpaper-planning tests.

### Production build

`npm run build`

Result: passed, including the Vite renderer build and Electron main/preload TypeScript build.

### Packaged application build

`npm run app:dir` reached Electron Builder after the application code built successfully, but this Linux sandbox could not resolve `github.com` to download the Electron runtime. Therefore, a packaged macOS application could not be produced or launched here.

## Remaining platform limitations

- Actual macOS wallpaper application, Automation permission prompts, display/Space targeting, and packaged application launch must be verified on a Mac.
- The old full-screen fade-overlay implementation is intentionally disabled for stability. The setting may remain visible for project compatibility, but application is immediate rather than crossfaded.
- The crash-recovery autosave is compact and may omit generated preview thumbnails. Explicit project saves preserve normal project content.

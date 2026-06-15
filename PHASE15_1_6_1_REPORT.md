# Phase 15.1.6.1 Report

## Scope

Targeted hotfix for the macOS desktop-layer helper crash. No generation, scheduler, Store transaction, source selection, or visible wallpaper application logic was changed.

## Root cause

The JXA Objective-C bridge exposes zero-argument selectors as property accesses. The helper incorrectly invoked `window.orderFrontRegardless()` as a JavaScript function, producing `TypeError: window.orderFrontRegardless is not a function`. The same ambiguity existed for `NSApplication.run`.

## Fix

- Invoke `window.orderFrontRegardless` using JXA zero-argument selector syntax.
- Invoke `application.run` using the same syntax.
- Emit `PWC_DESKTOP_LAYER_READY:<count>` after all native windows are ordered onscreen.
- Wait for the readiness marker instead of assuming the helper succeeded after 900 ms.
- Capture stdout/stderr and return the actual helper startup error.
- Terminate a helper that never becomes ready.

## Expected behavior

The already-working visible AppKit wallpaper apply remains unchanged. For inactive-Space visual coverage, the native helper must now report ready before the app labels the desktop layer active.

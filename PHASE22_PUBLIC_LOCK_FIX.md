# Phase 22 Public Lock Fix

This package is the same Phase 22 launch-polish build, regenerated with the original public `package-lock.json` so `npm ci` resolves packages from `registry.npmjs.org` instead of the temporary internal registry used by the build container.

Validation before packaging:
- `npm ci --ignore-scripts` passed in the container.
- `npm run typecheck` passed.
- `npm test` passed: 200/200.
- `npm run build` passed.

Installer hardening:
- checks that `package-lock.json` contains no `applied-caas` / OpenAI internal registry URLs.
- runs `npm ci` with `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/`.

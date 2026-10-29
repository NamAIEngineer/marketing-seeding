# Account projection worker report

## Outcome
Integrated the independently verified Wave 6 GPM profile catalog projection into `SeedingService.dashboard()` through an optional dependency-injected observation. The dashboard always returns a bounded, read-only `gpmAccountCatalog`; absent observations normalize to `UNKNOWN`/`NOT_OBSERVED`.

## Files
- `src/gpm-account-catalog-projection.mjs` — copied Wave 6 pure projection; exact profile ID matching, fingerprints, bounded allowlist, secret omission, fail-closed flags.
- `src/service.mjs` — stores only the injected observation reference and projects it during dashboard reads; no state writes or server changes.
- `test/gpm-account-catalog-projection.test.mjs` — projection safety and linkage coverage.
- `test/runtime-projection.test.mjs` — injected catalog, raw ID/secret omission, unknown restart-equivalent read, and revision invariance.

## Verification evidence
- `node --test test/gpm-account-catalog-projection.test.mjs test/runtime-projection.test.mjs` — 10 passed, 0 failed.
- `node --check src/service.mjs`
- `node --check src/gpm-account-catalog-projection.mjs`
- `git diff --check`

## Limitations
No live GPM endpoint, browser profile, lifecycle operation, readiness, authorization, or execution state was touched. The injected observation is process-local and not persisted; a restarted service without injection correctly reports UNKNOWN.

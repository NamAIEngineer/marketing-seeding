# Wave 8 GPM catalog observation

Status: COMPLETE (build lane; awaiting independent verification)

## Outcome
- Wired `SeedingService` to resolve an injected async `gpmAccountCatalogObservation` provider on dashboard reads.
- Server provider reuses the existing metadata-only `probeGpmRuntime` GET probe against discovered endpoints and `/api/v1/profiles`.
- Probe failure/unavailability is projected as UNKNOWN/UNAVAILABLE fail-closed; no lifecycle adapter, persistence, or state mutation is used.
- Mission Control now displays catalog linkage and bounded state counts using profile fingerprints only.

## Evidence
- `node --test test/runtime-projection.test.mjs` — 5 passed.
- `node --check src/server.mjs` and `node --check src/service.mjs` — passed.
- `git diff --check` — passed.
- Tests assert provider invocation, revision unchanged, raw profile ID/secret absence, and UNKNOWN on provider failure.

## Files
- `src/server.mjs`
- `src/service.mjs`
- `ui/src/App.tsx`
- `test/runtime-projection.test.mjs`

## Limitations
- No live GPM endpoint was called; tests use injected fakes. Full UI bundling was not run.

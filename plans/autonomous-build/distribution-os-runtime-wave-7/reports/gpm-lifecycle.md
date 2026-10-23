# GPM profile lifecycle wave 7

## Outcome
Implemented a provider-neutral, explicitly invoked `GpmProfileLifecycle` adapter with injected fake HTTP, dynamic debugging endpoint parsing, bounded acknowledgements, strict validation, and secret-like field rejection.

## Files
- `src/gpm-profile-lifecycle.mjs`: lifecycle adapter; constructor has no I/O, retains only normalized endpoint candidates, and exposes `start(profileId)` / `stop(profileId)`.
- `test/gpm-profile-lifecycle.test.mjs`: fake-fetch coverage for URL encoding, API prefix, endpoint variants, acknowledgement, errors, no retries, secrets, and constructor I/O.

## Verification
- `node --check src/gpm-profile-lifecycle.mjs`
- `node --test test/gpm-profile-lifecycle.test.mjs` — 6 passed, 0 failed.
- No installed GPM runtime or real endpoint was called.

## Acceptance
Addresses A3, A4, A5 and constraints C1-C5. Verification evidence covers V1-V3 through focused syntax/tests and diff review.

## Limitations
Real GPM endpoint behavior remains unverified and forbidden in this wave. Adapter intentionally performs no persistence, profile selection, retries, health/projection wiring, or transport submission. The approved observed lifecycle contract uses GET requests at `/api/v1/profiles/start/:id` and `/api/v1/profiles/stop/:id`; `apiPrefix` accepts `/v1` or `/api/v1` without duplication.

Status: DONE_WITH_CONCERNS (real runtime remains unverified and forbidden).

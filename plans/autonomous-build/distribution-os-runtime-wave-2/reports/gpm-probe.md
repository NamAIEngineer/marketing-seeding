# GPM Local API Probe

## Acceptance IDs addressed

A1, A4, A5.

## Summary

Added a read-only, endpoint-driven GPM capability probe. It never assumes port
9495, starts/stops/creates profiles, or returns credential material. It reports
`READY`, `UNKNOWN`, or `UNAVAILABLE` with bounded runtime/profile references and
redacted endpoint metadata.

## Evidence

- `src/gpm-runtime-probe.mjs`
- `test/gpm-runtime-probe.test.mjs`
- Focused probe/router tests pass.
- No GPM executable or endpoint was contacted during this audit.

## Confidence

Confident for endpoint discovery, redaction, typed fail-closed states, and
read-only behavior under injected responses. Actual installed GPM API version,
profile startup, CDP attach, and session health remain unverified.

## Out-of-scope noticed

No profile mutation, browser launch, credential access, live social action,
deployment, or canonical runtime change.

Status: DONE_WITH_CONCERNS
Summary: Dynamic GPM probe is implemented and tested; no real GPM runtime proof exists.
Concerns/Blockers: Endpoint/profile pool must be supplied by the host runtime.

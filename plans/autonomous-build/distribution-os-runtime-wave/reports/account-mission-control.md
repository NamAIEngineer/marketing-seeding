# Account Registry / Mission Control

## Acceptance IDs addressed

A4, A5, A6 (V1 partial).

## Summary

Added a pure bounded account registry, deterministic eligibility/selection
projection, challenge quarantine, and secret rejecting read-only Mission Control
projection. The module never starts profiles, reads credentials, or mutates
runtime state.

## Evidence

- `src/account-runtime-registry.mjs`
- `test/account-runtime-registry.test.mjs`
- `node --test test/account-runtime-registry.test.mjs test/account-runtime-projection.test.mjs test/authorized-account-candidate-projection.test.mjs`
- `node --check src/account-runtime-registry.mjs`
- `git diff --check`

## Confidence

Confident for deterministic local projection, secret rejection, and challenge
quarantine. Live profile startup, session recovery, quotas, and service/UI
integration remain unverified and out of scope.

## Out-of-scope noticed

No browser attachment, account mutation, live social action, migration, or
deployment was performed.

Status: DONE_WITH_CONCERNS
Summary: Bounded account/runtime projection is implemented and locally tested; service integration and live multi-account operation remain future work.
Concerns/Blockers: No live GPM profile pool or credential broker was exercised.

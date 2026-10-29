# Wave 9 Session Readiness Projection

## Evidence ledger

- FACT: `projectSessionReadiness` is a pure function over bounded execution-account metadata and optional observed session records.
- FACT: It emits exact platform/account/profile fingerprint binding, status, expiry, reasons, and `executionEligible`.
- INFERENCE: A READY row is safe for Mission Control display only when observed identity exactly binds and both configured and observed health are healthy.
- ASSUMPTION: Callers provide already-authorized account metadata; authorization ownership itself remains outside this projection.
- UNKNOWN: No live GPM/CDP session was inspected by this worker.

## Acceptance

- A3: exact account/profile binding and deterministic fingerprint projection.
- A4: challenge, quarantine, unknown, mismatch, and expiry are explicit.
- A5: execution eligibility fails closed unless exact healthy observed binding exists.
- Safety fix: missing or invalid `expiresAt` is explicit `EXPIRED` with `readiness_expiry_invalid`; it is never eligible.
- C2: read-only; no lifecycle, lease, authority, or state mutation.
- C3: no identity inference from profile names, tags, or browser metadata; no secrets accepted.

## Verification

- `node --test test/session-readiness-projection.test.mjs`: 5 pass, 0 fail.
- `node --check src/session-readiness-projection.mjs`: pass.
- `git diff --check`: pass.

## Scope

Out of scope: server/UI wiring, live GPM/ORCA/browser calls, persistence, authority/grant/lease creation, publication, and deployment.

Status: DONE_WITH_CONCERNS — bounded projection complete; integration and runtime proof remain for the release lane.

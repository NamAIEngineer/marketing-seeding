# Distribution OS Runtime Wave 6 — GPM profile to account observability

## Requirements

- A1: Add a pure read-only projection that reconciles the observed allowlisted GPM profile catalog with the existing execution account registry by exact profile ID only.
- A2: Preserve fail-closed semantics: catalog presence never proves account identity, session health, eligibility, authorization, or runtime readiness.
- A3: Expose bounded profile/account linkage in Mission Control without raw credentials, storage paths, proxy material, or secret-like metadata.
- A4: Do not mutate canonical state, start/stop profiles, attach CDP/WebSocket, login, navigate, click, submit, restart ORCA, or change workload route policy.
- A5: Add focused tests and a report; worker changes must be independently verified before any integration decision.

## Constraints

- C1: Exact profile ID equality is the only binding key; never infer identity from profile name, browser version, tags, or ordering.
- C2: Unknown/unbound catalog rows remain observable but ineligible and must not be synthesized into execution accounts.
- C3: Existing account/runtime readiness and UNKNOWN submission history remain unchanged.
- C4: Keep implementation bounded to read-only projection and tests; no live provider mutation.

## Verification

- V1: Unit tests cover exact binding, name-only mismatch, duplicate/ambiguous account rows, schema/unknown catalog, and secret-free output.
- V2: Full npm test, focused account/runtime tests, syntax, and diff checks pass after final worker change.
- V3: Independent verifier confirms no state mutation and no route/irreversible-submit fence changes.

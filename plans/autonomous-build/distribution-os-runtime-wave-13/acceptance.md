# Wave 13 — Provider-neutral session transport consumption + LinkedIn certification lane

## Requirements

- A1. Define a secret-free provider-neutral `ExecutionSession` with explicit lifecycle, authority binding, transport identity, capabilities, attestation, and validity.
- A2. Define a generic `ExecutionTransport` surface for health, attach, navigation, observation, semantic resolution, input, activation observation, and detach.
- A3. Implement bounded GPM-backed transport/session attach using injected profile/session references; fail closed on missing protocol, identity mismatch, stale state, challenge, or attach failure.
- A4. Refactor LinkedIn execution to consume the injected transport for navigation, identity/readiness, composer/content, target validation, submit-control discovery, activation observation, verification, and detach.
- A5. Integrate the real JEV worker path so one selected session/transport remains authoritative from pre-intent selection through adapter completion and release.
- A6. Freeze transport identity after durable submit intent; no fallback or silent provider replacement after the boundary.
- A7. Add explicit host/runtime attestation and bounded non-mutating readiness evidence without secrets.
- A8. Add worker, adapter, lifecycle, mismatch, stale/challenge, detach, restart, and UNKNOWN quarantine coverage.
- A9. Produce a fresh harmless certification package without creating a live execution or mutating social state.
- A10. Preserve historical UNKNOWN immutability and avoid all live social mutation in this wave.

## Constraints

- C1. Base remains Wave 10 RC `2e4d72f`; Wave 11/12 candidates are reviewed/reimplemented selectively, never blindly merged.
- C2. No cookies, passwords, raw tokens, session secrets, profile impersonation, account rotation, CAPTCHA/MFA bypass, or credential extraction.
- C3. No Post/final submit click, publication, deploy, merge, migration, or live ORCA/GPM profile mutation.
- C4. Business logic remains provider-neutral; no GPM/ORCA branch inside LinkedIn behavior.
- C5. Existing ORCA path remains explicit compatibility only; no hidden fallback.
- C6. Durable irreversible intent freezes selected transport and uncertain outcomes quarantine without retry.
- C7. Workers own disjoint files; independent verifier is read-only and runs after final edits.
- C8. Current canonical state and six UNKNOWN executions remain untouched.

## Verification

- V1. Focused execution-session, transport, GPM, adapter, worker, attestation, restart, authority, and quarantine tests pass with zero failures.
- V2. Full marketing-seeding suite passes with known skips separately classified.
- V3. Syntax, diff, and UI compatibility gates pass.
- V4. Independent reviewer confirms injected transport consumption, frozen identity, fail-closed lifecycle, no secret leakage, and no historical/live mutation.
- V5. Fresh certification package identifies exact external authority still required and does not claim publication.

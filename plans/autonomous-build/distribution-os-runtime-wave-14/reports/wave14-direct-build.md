# Wave 14 — bounded GPM protocol/resolver seam

## Unverified first

- No live GPM endpoint, profile lifecycle, CDP socket, browser page, LinkedIn
  session, social action, final Post click, publication, merge, or deployment
  was used.
- The protocol client is contract-tested with fake WebSocket objects only;
  no live provider compatibility is claimed.
- Actual GPM CDP endpoint shape and authenticated identity observation remain
  external/provider evidence requirements.

## Implemented

- `src/gpm-cdp-client.mjs`: inert, injected WebSocket/CDP client. Explicit
  credential-free WebSocket endpoint, profile reference, session authority and
  optional target. Browser target attach, bounded target listing, navigation,
  evaluation, snapshot, fill/type, semantic resolve/click, waits, identity
  observer, timeout/disconnect handling and idempotent detach. Cookie/storage/
  credential commands are absent and secret-like responses fail closed. Every
  evaluation requires a host expression policy; arbitrary mutation is rejected
  unless the bounded fill/click primitive and policy explicitly authorize it.
  Target URL/identity and malformed target lists fail closed. Protocol errors
  close the socket and reject all pending calls.
- `src/gpm-execution-session-resolver.mjs`: explicit GPM resolver factory over
  the Wave 13 `GpmExecutionSession`. Construction performs no attach or I/O;
  acquire requires exact configured profile/account, injected coordinator and
  attach implementation, fresh host attestation, and explicit authority.
- Tests: `test/gpm-cdp-client.test.mjs`,
  `test/gpm-execution-session-resolver.test.mjs`.

## Verification

- `node --check src/gpm-cdp-client.mjs src/gpm-execution-session-resolver.mjs`: PASS.
- Wave 14 tests: **9 pass, 0 fail, 0 skip**.
- Wave 13 focused tests: **103 pass, 0 fail, 0 skip**.
- Full `npm test` after the final Wave 13/14 verification edits: **698 total,
  696 pass, 0 fail, 2 skip**. The two skips remain host-environment ACL checks.
- `git diff --check`: PASS.
- Independent review: target binding, protocol fail-closed behavior, timer and
  socket cleanup, mandatory expression policy, mutation hash registry/authorizer
  enforcement, and generated-operation policy coverage reviewed after patch;
  no release-blocking correctness finding remains. Normalized expression bytes
  are hashed consistently by the provider-neutral helper and CDP client.
- No canonical state files or historical UNKNOWN records changed.

## Limits

- Resolver is not wired into `src/server.mjs`; host-specific account registry,
  coordinator, protocol factory, expression policy and attestation must be
  supplied explicitly.
- No live GPM protocol compatibility or LinkedIn reversible calibration is
  claimed. No final-submit eligibility is created by this wave.

FACT: software seam and fake tests pass; full suite is green.
INFERENCE: the seam can consume a compatible GPM browser WebSocket endpoint
when the host supplies a permitted expression policy and exact target binding.
UNKNOWN: installed GPM's exact returned endpoint/target protocol and account
identity observer behavior.

Current tree state: Wave 14 changes remain dirty on the Wave 13 candidate
branch; no merge, deployment, live GPM attach, browser mutation, or social
action was performed.

Status: DONE_WITH_EXTERNAL_PROVIDER_EVIDENCE_REQUIRED

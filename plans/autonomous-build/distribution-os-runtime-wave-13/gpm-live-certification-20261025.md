# GPM LinkedIn live certification preparation — 2026-10-25

## Result

`HOST_ATTESTATION_FAILED`

The existing GPM profile is authenticated and independently visible through the
macOS browser UI, but the provider does not expose a credential-free browser
attachment endpoint for the running instance. The injected GPM transport cannot
attach, so host attestation, reversible calibration, authority-package creation,
governance, and composer dry-run remain blocked. No final Post click or social
mutation occurred.

## Repository and runtime

- Repository: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`
- Branch: `wave/distribution-os-runtime-wave-13-bridge`
- HEAD: `6cc72b08831ae504c68e25affd95c874032854fe`
- Working tree: clean before this report; this report is documentation-only.
- GPM: `/Applications/GPMLoginGlobal.app`, `GPMLogin Global v5.1.2-stable`
- Local API: `http://127.0.0.1:9495`
- GPM profile: `Profile 5671`
- Provider profile ID: `82614dc6-2b75-4515-896c-32f73cb5ec51`
- Browser: Chrome `154.0.8037.98`
- GPM process: PID `39067`; browser PID `46186`

## Identity evidence

- `https://www.linkedin.com/feed/` loaded in the same Profile 5671 window.
- Authwall/login screen: not observed.
- Visible LinkedIn identity: `Nam Phạm Phương`.
- Profile navigation resolved to:
  `https://www.linkedin.com/in/nam-ph%E1%BA%A1m-ph%C6%B0%C6%A0ng-b48897278/`
- Expected identity match: PASS.
- Security/MFA/login challenge: not observed.

This is UI evidence only. It is not an injected transport attestation.

## Attach investigation

- GPM catalog read-only lookup returned the exact profile above.
- Running browser command has no `--remote-debugging-port`.
- No CDP listener was present on the running browser or standard local probe
  ports.
- GPM start/stop was not called in this continuation; the existing Profile 5671
  browser remained running.
- The documented GPM MCP setting was checked as a possible supported control
  surface. Its endpoint is bearer-protected and exposes no credential-free
  attach reference. The setting was restored to disabled.
- No cookies, passwords, access tokens, raw session secrets, profile copies, or
  cloned sessions were read or persisted.

Therefore:

- Host attestation: FAIL.
- Real GPM attach: FAIL / unproven.
- `LinkedInAdapter` consumption of this live GPM instance: unproven.
- ORCA fallback: not used.
- Reversible calibration: `0` trials.
- GPM transport certification: `NOT_CERTIFIED`.

## Package and governance

- `external-input.json`: absent.
- No authority package was fabricated without an attach reference and fresh
  host attestation.
- Fresh content identity: not created.
- Governance preflight: not run.
- JIT readiness/composer dry-run: not run.
- Final Post clicks: `0`.
- Publication attempts: `0`.
- New UNKNOWN executions: `0`.

## State safety

- Canonical state: schema `8`, revision `54861`.
- Canonical SHA-256 before/after audit: `2ed58f8972072c9f5a0921830c0af6a1502b443017c0db2c2f82856f388eb1d7`.
- Submission uncertainties: `6` before/after.
- Historical UNKNOWN execution IDs were not retried, reconciled, mutated, or
  reused.
- No canonical runtime write occurred.

## Verification

- Focused GPM/session/worker/LinkedIn/exact-dispatch gate: `185 pass, 0 fail,
  0 skip`.
- Full `npm test`: `698 total, 696 pass, 0 fail, 2 skip`.
- GPM MCP endpoint after cleanup: disabled (`404 MCP is disabled`).

## Exact blocker and next action

`HOST_ATTESTATION_FAILED`: the running GPM browser has no supported,
credential-free CDP/provider attach reference. Obtain or enable a documented
local GPM attach mechanism for the already-running Profile 5671 instance, then
rerun this bounded lane. Do not provide credentials, export cookies/tokens, or
click LinkedIn Post in this task.

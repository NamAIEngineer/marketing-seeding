# Distribution OS Runtime Wave 8 — runtime observation and bounded session coordinator

## Requirements

- **A1** Feed the existing read-only GPM profile catalog observation into the service dashboard from the server's already discovered endpoint/probe, without profile lifecycle mutation or persisted runtime secrets.
- **A2** Render bounded GPM catalog/account linkage in Mission Control using fingerprints and explicit `EXACT`/`UNBOUND`/`MISSING`/`AMBIGUOUS`/`NOT_OBSERVED` states; never infer identity/readiness/eligibility from catalog metadata.
- **A3** Add a provider-neutral GPM session coordinator that uses the existing deterministic account selector and the explicit lifecycle adapter to acquire/release one owned profile session, with no automatic retry, fallback, profile switching, login, challenge bypass, or persistence.
- **A4** Coordinator outputs and errors are bounded and secret-free; a missing/unknown/mismatched health observation remains non-ready and never becomes live execution authority.
- **A5** Add focused tests/reports and independently verify the final release candidate; preserve all irreversible-submit fences and UNKNOWN quarantine.

## Constraints

- **C1** Isolated worktrees and disjoint ownership; builders do not merge to `main`, deploy, publish, mutate canonical state, restart ORCA, or contact live social accounts.
- **C2** No raw cookies, passwords, access tokens, proxy/storage material, session secrets, or raw profile IDs may enter dashboard/UI output, reports, or coordinator results.
- **C3** No real GPM `/profiles/start/*` or `/profiles/stop/*` call, CDP/WebSocket attach, login, navigation, click, or social action. Lifecycle/session tests use injected fakes only.
- **C4** No silent transport/account failover after an explicit lifecycle start or durable intent; no new submit/retry path.
- **C5** Existing UNKNOWN submissions, canonical state, active ORCA/GPM processes, and main/integration refs remain untouched.

## Verification

- **V1** Independent verifier directly inspects each lane against its pin, checks secret/foreign changes, and reruns focused tests after final edits.
- **V2** Wave 8 RC runs full Node suite, syntax, diff checks, and applicable UI gate without external side effects.
- **V3** Release report separates installed read-only probe evidence from fake lifecycle/coordinator proof and does not claim live identity, publication, metrics, or 24/7 readiness.

## Dispatch trace

- Run: `distribution-os-runtime-wave-8-20261023`
- Baseline: `wave/distribution-os-runtime-wave-7-rc` commit `8a1421e`
- Controller: `/root`
- Independent verifier: `/root/release_verify_wave3` read-only attempt

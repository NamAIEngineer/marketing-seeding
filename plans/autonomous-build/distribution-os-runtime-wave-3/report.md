# Distribution OS Runtime Wave 3 — report

## Unverified items first

- UI typecheck/build is not verified in this RC: `ui/node_modules/.bin/vite` and `tsc` are absent (`vite: command not found`).
- GPM profile listing, profile startup, CDP/WebSocket attach, account identity and session health remain unverified. The discovered root API is identity/liveness only.
- Camoufox has a real cached executable, but no injected debugger/Marionette client, disposable profile factory, public-only egress policy, or live observation proof is integrated.
- No live LinkedIn submission, final Post click, publication, metrics collection, deploy, merge to `main`, ORCA restart, browser profile start/stop, or canonical state mutation occurred.

## Outcome

The RC now adds a bounded runtime-observability slice for the product-level distribution OS:

- ORCA accessibility and pointer health call the client's read-only executable and connected-runtime version probe. They report `READY` only after both versions match the configured certification pin; missing probes stay `UNKNOWN`, and mismatch/unavailable conditions are `UNAVAILABLE`.
- GPM listener discovery inspects only listeners owned by an already-running GPM process via `lsof`; it does not guess a port, start a profile, read the local profile database, or send a WebSocket frame.
- The GPM transport uses discovered listener candidates for a GET-only root probe. The observed GPM root (`GPMLoginGlobal v5.1.2-stable`) is projected as identity/liveness evidence, while absent account/profile binding keeps authenticated execution `UNKNOWN` with `profileBindingRequired=true`.
- Mission Control runtime projection includes bounded observed provider version, endpoint candidates and profile-binding requirement; it remains read-only and secret-free.

## Source / RC

- Worktree: `/Users/nam/Documents/marketing-seeding-wave-rc`
- Branch: `wave/distribution-os-runtime-rc`
- Base RC before Wave 3: `9f002c3`
- Final implementation commit: `0d6fb02` (`feat: observe provider runtime readiness safely`).
- Latest clean RC commit: `631674e` (`docs: record camoufox protocol boundary`),
  which adds the Wave 4 feasibility report only.
- Final RC worktree is clean after the bounded commit.
- Main remains `98a499e`; integration remains `6899679`; neither was changed or merged.

## Changed files

- `src/browser-interaction-transport.mjs` — truthful ORCA health observation.
- `src/gpm-runtime-probe.mjs` — listener discovery and identity-only version parsing.
- `src/browser-runtime-transports.mjs` — bounded endpoint-candidate projection and GPM unbound-profile health semantics.
- `src/browser-runtime-router.mjs` — existing provider-neutral policy reused unchanged.
- `src/runtime-projection.mjs` — bounded observed version, endpoint candidates and profile-binding flag.
- `src/server.mjs` — read-only GPM listener discovery/probe wired into default router.
- `test/browser-interaction-transport.test.mjs`, `test/browser-runtime-router.test.mjs`, `test/gpm-runtime-probe.test.mjs`, `test/runtime-projection.test.mjs` — regression coverage.

## Runtime evidence

- ORCA executable: `/Applications/Orca 2.app/Contents/Resources/bin/orca`, `--version` = `1.4.237`.
- ORCA `status --json`: app running, runtime `ready`, `reachable=true`, `connectionState=connected`, graph ready, appVersion `1.4.237`.
- RC's configured ORCA pin remains `1.4.232`; the new projection therefore correctly reports `UNAVAILABLE` until a release config is intentionally aligned and independently reviewed. No config or active session was changed in this wave.
- GPM process: `GPMLoginGlobal` PID 3068, listeners discovered at `127.0.0.1:9495` (HTTP identity root) and `127.0.0.1:9496` (WebSocket upgrade; protocol not used). Root GET returned `GPMLoginGlobal v5.1.2-stable`; no profile route was called.
- Camoufox cached executable: `156.0.1-beta.36`, headless/debugger/Marionette flags present; no process/profile launch occurred.

## Verification

Independent final recheck after the last source change:

- `npm test`: **616 total / 614 pass / 0 fail / 2 skip**, exit 0.
- Focused runtime/GPM/router/ORCA/authority/safety batch: **81 total / 81 pass / 0 fail / 0 skip**.
- `node --check src/*.mjs`: PASS.
- `git diff --check`: PASS.
- Canonical state unchanged: schema 8, revision 54861, SHA-256 `2ed58f8972072c9f5a0921830c0af6a1502b443017c0db2c2f82856f388eb1d7`; six `UNKNOWN` uncertainties and six `submit_result_unknown` posts remain unchanged; zero published posts and zero leases.
- Independent verifier report: `plans/autonomous-build/distribution-os-runtime-wave-3/reports/recheck-wave3-release.md`.

## Capability classification after Wave 3

- Browser Runtime Router: **LOCAL_REAL contract / provider health partial**.
- ORCA runtime health: **LOCAL_REAL read-only probe**, final-submit certification remains absent.
- GPM runtime: **LOCAL_REAL identity/liveness probe**, profile/session execution remains **UNKNOWN**.
- Camoufox runtime: **LOCAL_REAL executable discovery**, isolated observer execution remains **UNKNOWN**.
- Product Factory: **PARTIAL**, bounded staged syntax/evidence path only.
- Live publication, independent publication verification, metrics, learning from live outcomes, 24/7 readiness and multi-platform execution: **NOT PROVEN**.

## Blocker reconciliation

- `ORCA-RUNTIME-CONFIG-001`: historical configuration repair is resolved in the ledger, but the RC observes a current pin drift (`1.4.232` vs installed `1.4.237`) and keeps health fail-closed. Aligning a release pin requires a separate reviewed release action.
- `LIVE-LINKEDIN-AUTH-001`: still an external hard blocker. No effective exact live authorization/window/grant/lease exists; historical UNKNOWN execution is immutable and was not retried.
- `ORCA-TRANSPORT-LIVE-CERT-001`: still open. Reversible fixture/control evidence exists; no fresh irreversible LinkedIn semantic activation, platform acceptance or independent publication proof.
- `METRICS-CHECKPOINT-LIVE-001`: remains quarantined; no authenticated live provider evidence.
- `PRODUCT-FACTORY-SANDBOX-001`: remains open; arbitrary build/run/render/media attestation is absent.
- `RELEASE-JOURNAL-DRIFT-001`: historical ledger entry is resolved; this wave has a current RC report and independent recheck.

## Next bounded action

Review and approve the RC source before any merge/deploy. After release approval, align the ORCA runtime pin to the observed installed version in the deployment configuration, then separately obtain a fresh exact authorized LinkedIn lane. Do not retry historical UNKNOWN executions. Build the Camoufox disposable-profile adapter and GPM profile/CDP provider only after their safe API contracts are documented and independently verified.

Status: DONE_WITH_CONCERNS
Summary: Wave 3 provides truthful ORCA health and read-only GPM runtime discovery while keeping profile/session and Camoufox execution fail-closed. RC gates are green; UI build and live distribution remain unverified.
Concerns/Blockers: UI dependencies absent; GPM profile API, Camoufox isolated adapter, ORCA pin alignment, live authority and live publication proof remain open.

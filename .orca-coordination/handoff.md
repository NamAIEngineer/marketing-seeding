# Handoff

## Candidate handoff

- Candidate: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`, branch `integration/session-c-reconciled`.
- Code/test checkpoint: `7378f8cac202ce8efc0c5c66cb789e67f504f32e`.
- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- A checkpoint represented: `1ed57710f66d8ca1a6284d16b149d9039fcb032e`; current A overlay preserved outside candidate.
- B owner checkpoint: `b675a98e6dd2da3c12133dff715eddea616c91f5`; not cherry-picked because candidate already contains/adapts substantive behavior and B has unrelated obsolete differences.
- Source pins: oi-browser `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm `9368098477d78f75d57fdf5db276129948f3a183`.

## Evidence

- `plans/oi-browser-integration/fixture-run-7378f8c.json`: `FIXTURE_VERIFIED`, controlled Product X / Community A+B, learning-driven before/after candidate change, static browser intent activation, idempotent replay, restart persistence.
- `plans/oi-browser-integration/server-smoke-7378f8c.json`: `RUNTIME_VERIFIED`, exact source SHA, isolated port `4337`, auth/memory/static snapshot/restart persistence, explicit local-Qwen route success, `feed_not_generated`.
- Current tests: focused integration/authority slices `106/106`; full `790 total, 788 pass, 0 fail, 2 skipped`; baseline `576/574/0/2`; Auto-GTM `158/158`, `pip check` clean.

## Native session evidence

- A: `SESSION-A-ACK-20261028T1210Z`, Orca terminal `term_58af59e8-f5dd-4968-a724-78b48a04cf3c`, HEAD `1ed5771`, dirty scope preserved.
- B: `SESSION-B-ACK-20261028T1210Z`, Orca terminal `term_41a5601e-887e-4ac0-a8d7-35112fedb375`, HEAD `b675a98`, tracked scope clean.

## Runtime boundary

- Runtime `127.0.0.1:4318` remains A-owned and untouched.
- No login, MFA/CAPTCHA handling, authority grant, live submit, deployment, push, merge, PR, or external side effect occurred.
- Fixture and isolated runtime evidence do not upgrade live publication, authenticated Camoufox readiness, or external metrics.

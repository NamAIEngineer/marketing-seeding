# Integration status

## Candidate

- Candidate worktree: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`
- Branch: `integration/session-c-reconciled`
- Exact candidate revision: `20ba20f6f8f273a72cb0db88b216d645aeecaeb1`
- Candidate source tree was clean before C-owned evidence/docs updates; A/B worktrees untouched.
- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`
- Remote observed: `origin=https://github.com/DevAngular333/marketing-seeding.git`; remote `main` and `integration/autonomous-build` observed at `98a499e25c2fab75de6aef85f265e6c2a7364651`.

## A/B/C connectivity and ownership

- SESSION A: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`, branch `wave/distribution-os-runtime-wave-13-bridge`, HEAD `52072ceaf371836a0783b9f8b3c4eda8a46415c5`, dirty Camoufox/runtime/server/UI files, owns `127.0.0.1:4318` PID `30842`.
- SESSION B: `/Users/nam/Documents/marketing-seeding-integration`, branch `integration/autonomous-build`, HEAD `689967903aea51a4935659c33c2fcc8513ef8565`, dirty authority/standing-delegation/service/test/report files.
- SESSION C: this candidate, exact HEAD above; owns integration/docs/evidence.
- Orca `worktree list`, `terminal list`, `worktree ps`, and inbox were checked on 2026-10-28. A and B have no attached terminal, receiver, inbox, or live agent handle. Native handshake remains `UNVERIFIED`; prior sends returned `terminal_not_found` (`0408b48d-877a-4cbb-8ff7-f390cd60c111`, `82daa91d-7d44-40e8-9780-5537883d9b39`).
- No A/B file was edited, staged, reset, stashed, cleaned, or committed by C. Port `4318` was not restarted.

## Verified candidate evidence

- Baseline `79985bb411afc141f0edf10ae635fb91824d8bc9`: `npm test` → 576 total, 574 pass, 0 fail, 2 skipped.
- Controlled Product X / Community A+B fixture: `plans/oi-browser-integration/fixture-run-20ba20f.json`, `FIXTURE_VERIFIED`, PASS; before/after candidate changed, learning applied, restart/idempotent browser replay passed.
- Isolated server/runtime: `plans/oi-browser-integration/server-smoke-20ba20f.json`, `RUNTIME_VERIFIED`, port `4333`, exact source SHA, auth/memory/static snapshot/restart passed. Qwen `/v1/models` health was ready but inference failed `FAILED/nonzero` because the MLX generation thread died from Metal insufficient memory. Auto-GTM `feed_not_generated`; no external side effect.
- Focused: 37 pass, 0 fail. Full: 790 total, 788 pass, 0 fail, 2 skipped, exact source tree at `20ba20f`.
- Auto-GTM `.venv` suite: 154 pass, 0 fail; `pip check` clean.
- Camoufox disposable smoke remains unauthenticated runtime proof only; fresh authenticated identity/readiness and publication remain unverified.

## State

`PARTIAL`. Native A/B receiver evidence, live authority/readiness/publication/metrics, and Auto-GTM generation are not proven. Do not report COMPLETE.

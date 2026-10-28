# Handoff

## Candidate handoff to integration owner

- Candidate: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`, branch `integration/session-c-reconciled`, final SHA `e9a7bfa9dc561a4dad06035caaeabff35ee0d8f0`; code/test evidence ran at `20ba20f6f8f273a72cb0db88b216d645aeecaeb1`; worktree clean.
- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- A committed checkpoint included in candidate history: `52072ceaf371836a0783b9f8b3c4eda8a46415c5` via merge commit `d195756af715e686de46b2f6de8fbb11b7cace9b`.
- B owner checkpoint: `b675a98e6dd2da3c12133dff715eddea616c91f5`, created by B after focused `41/41`; C has not cherry-picked it yet.
- Source pins: oi-browser `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm `9368098477d78f75d57fdf5db276129948f3a183`.

## New evidence

- `plans/oi-browser-integration/fixture-run-20ba20f.json`: `FIXTURE_VERIFIED`, controlled Product X / Community A+B, `runCampaignControlCycle`, learning-driven candidate change, static browser intent activation, idempotent replay, restart persistence.
- `plans/oi-browser-integration/server-smoke-20ba20f.json`: `RUNTIME_VERIFIED`, exact source SHA, isolated port `4333`, auth/memory/static snapshot/restart persistence, Qwen provider failure preserved as `FAILED/nonzero` after observed MLX Metal OOM, Auto-GTM `feed_not_generated`.
- `plans/oi-browser-integration/regression-20ba20f.json`: baseline/candidate/full/focused/Auto-GTM test evidence at exact revisions.

## Native session evidence

- A review returned `RESULT-A-20261028T0420Z` through `term_58af59e8-f5dd-4968-a724-78b48a04cf3c`; A remains at `52072ce` with owner checkpoint pending.
- B review returned `RESULT-B-20261028T0420Z` through `term_41a5601e-887e-4ac0-a8d7-35112fedb375`; owner checkpoint `b675a98` is durable and tracked scope clean.

## Runtime boundary

- Runtime at `127.0.0.1:4318` remains A-owned and untouched.
- No login, MFA/CAPTCHA handling, authority grant, live submit, deployment, push, merge, or PR operation was performed.
- Fixture and isolated runtime evidence do not upgrade live publication or Camoufox authenticated readiness.

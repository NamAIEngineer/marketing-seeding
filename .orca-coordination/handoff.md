# Handoff

## Candidate handoff to integration owner

- Candidate: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`, branch `integration/session-c-reconciled`, SHA `20ba20f6f8f273a72cb0db88b216d645aeecaeb1`; current evidence/docs remain uncommitted C-owned changes.
- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- A committed checkpoint included in candidate history: `52072ceaf371836a0783b9f8b3c4eda8a46415c5` via merge commit `d195756af715e686de46b2f6de8fbb11b7cace9b`.
- B observed checkpoint: `689967903aea51a4935659c33c2fcc8513ef8565`, dirty and not ACKed/committed by C.
- Source pins: oi-browser `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm `9368098477d78f75d57fdf5db276129948f3a183`.

## New evidence

- `plans/oi-browser-integration/fixture-run-20ba20f.json`: `FIXTURE_VERIFIED`, controlled Product X / Community A+B, `runCampaignControlCycle`, learning-driven candidate change, static browser intent activation, idempotent replay, restart persistence.
- `plans/oi-browser-integration/server-smoke-20ba20f.json`: `RUNTIME_VERIFIED`, exact source SHA, isolated port `4333`, auth/memory/static snapshot/restart persistence, Qwen provider failure preserved as `FAILED/nonzero` after observed MLX Metal OOM, Auto-GTM `feed_not_generated`.
- `plans/oi-browser-integration/regression-20ba20f.json`: baseline/candidate/full/focused/Auto-GTM test evidence at exact revisions.

## Runtime boundary

- Runtime at `127.0.0.1:4318` remains A-owned and untouched.
- No login, MFA/CAPTCHA handling, authority grant, live submit, deployment, push, merge, or PR operation was performed.
- Fixture and isolated runtime evidence do not upgrade live publication or Camoufox authenticated readiness.

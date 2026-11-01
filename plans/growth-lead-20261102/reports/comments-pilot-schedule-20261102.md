# Comments and pilot schedule checkpoint

Date: 2026-11-02

## Outcome

- Added additive pilot state collections (`pilotExperiments`, `pilotReports`).
- Added deterministic 10-slot daily window from 07:00 to 23:00 ICT, armed status, account READY gate, first-post 15-minute contract, missed-slot shift/no-burst policy, metric dimensions, 30% next-day mix limit and 48-hour warning reduction.
- Added service methods to arm a pilot and persist a 23:30 report artifact.
- Added reply send guards: one reply per interaction, READY account, 20/account/day, 2–15 minute delay, sensitive topics routed to CẦN NAM.

## Verification

`node --test test/growth-pilot.test.mjs` — 2 passed.
`node --check src/service.mjs` — passed.
`node --check src/guards.mjs` — passed.

`git diff --check` remains blocked by pre-existing conflict markers in `src/chrome-account-profile.mjs` (unrelated file, untouched).

No live publication, reply, credential, or account side effect was performed. Current accounts remain blocked/unknown, so the armed schedule fails closed.

## Follow-up verification at HEAD a00214be

- Added tests for no-burst exhaustion and durable 23:30 observation-only report.
- Added assertions for armed status, READY activation gate, 15-minute first-post contract, 48-hour warning reduction, and 30% next-day mix bound.
- `node --test test/growth-pilot.test.mjs` — 4 passed.
- `node --check src/growth-pilot.mjs` — passed.
- Scoped `git diff --check` — passed.

FACT: tests cover deterministic local pilot policy only. UNKNOWN: live account readiness, publication, reply delivery, platform metrics, permalink, and GitHub star observations. No live side effects occurred.

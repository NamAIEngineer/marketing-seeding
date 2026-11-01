# Independent verification — growth projection

Observed: 2026-11-02 ICT session; read-only checks only. Source checkout: `6803809e6d4f9a64ba7b5366f6d0debe733566dd`.

## Acceptance

- **A PASS (FACT):** `GET http://127.0.0.1:4321/health` returned HTTP 200. Runtime reported `sourceCommit=6803809e6d4f9a64ba7b5366f6d0debe733566dd`, `sourceDirty=false`, schema 8, PID 89943. Port 4318 remains PID 35020 (`/usr/local/bin/node src/server.mjs`).
- **B PASS (bounded FACT):** `/api/dashboard` returned JSON with one campaign; `pilotExperiments` contains one `armed` experiment, `slotCount=10`, timezone `Asia/Ho_Chi_Minh`, slots 07:00 through 23:00; `communityDiscoveries` length 30. Two accounts are truthfully blocked: `facebook_group/facebook_nam` and `linkedin/linkedin_nam`, provider `chrome`, sources `chrome-account:facebook_nam` and `chrome-account:linkedin_nam`, with human challenge/control blockers. No targets, posts, or schedules present.
- **C PARTIAL/UNKNOWN:** Unauthenticated `GET /api/account-credentials/linkedin/linkedin_primary` returned HTTP 401 JSON `{"ok":false,"error":"operator_token_required"}`. JSON route evidence passes; account credential state itself cannot be inspected without operator authorization. No token used.
- **D PASS (FACT):** `public/index.html` references `/assets/index-DAFJIQV3.js` and `/assets/index-DPuh7Khs.css`; both files exist and SHA-256 were recorded during check.
- **E PASS (bounded FACT):** Two consecutive dashboard reads preserved revision 452, campaign count 1, pilot count 1, discovery count 30, targets 0, schedules 0, posts 0. No retry, publish, target, schedule, or external side effect performed by verifier.

## Risks / limits

- **UNKNOWN:** Authenticated credential endpoint response; no operator token supplied.
- **UNKNOWN:** Whether the account provider should be Camoufox; current canonical state explicitly reports `provider=chrome` and `source=chrome-account:*`, which is a product-state concern outside this read-only verification scope.
- HTTP success proves route/process response only; it does not prove live social readiness or publication.

## Verdict

`PASS (bounded)` — A, B, D, E directly verified; C route shape verified but authenticated credential state intentionally not inspected.

Status: DONE_WITH_CONCERNS

# Community engine report — 2026-11-01

Run: `run_6a12be5c1b06`  |  Lane: BUILD  |  Scope: Facebook Groups + LinkedIn Groups only

## Ledger

- **FACT:** `src/community-engine.mjs` is side-effect free. It accepts bounded public observations, scores relevance/size/activity/language/promo policy, projects join intents under `3/account/day` and `15/account/week`, derives truthful-answer support, classifies rules, and derives warm-up/postable state.
- **FACT:** `test/community-engine.test.mjs` covers score + unauthenticated join handling, daily cap, `no_promo`, truthful answers, seven-day warm-up, and dashboard receipt fields.
- **FACT:** `plans/growth-lead-20261102/evidence/community-receipt-20261101.json` records two candidate rows, score inputs, source/time fields, join intent receipts, cap counters, rule classification, warm-up/postable state, and dashboard counts.
- **INFERENCE:** Candidate scoring is useful for prioritization when public metadata is available. Fixture values do not prove current group membership, approval, audience, activity, or posting rights.
- **UNKNOWN:** Authenticated Facebook/LinkedIn account state, live group read, actual join approval, group rules, profile facts, warm-up interactions, and live postability. No live request was sent.

## Implementation

`src/community-engine.mjs` exports:

- `scoreCommunity()` — deterministic 0–100 score with explainable inputs. `no_promo` and `unclear` are ineligible.
- `projectJoinIntents()` — enforces daily/weekly caps and emits `UNKNOWN_AUTH_BLOCKED` intent without an external side effect when auth is absent.
- `answerMembershipQuestions()` — answers only from declared account profile/product facts; otherwise `UNKNOWN_NEEDS_HUMAN`.
- `derivePostableState()` — requires `JOINED`, `promo_ok`, captured rule evidence, at least seven warm-up days, and at least two meaningful interactions.
- `communityDashboard()` / `buildCommunityReceipt()` — produces `discovered`, `join_requested_today`, `approved`, `postable`, auth-unknown and rule-blocked counts.

The fixture receipt deliberately uses `observedHttpStatus=UNKNOWN` and `authenticatedGroupRead=false`; it does not promote HTTP 200 or a login shell into authenticated evidence. Publication is disabled, and every join receipt states `externalSideEffect=false`.

## Verification

Command: `node --check src/community-engine.mjs` — exit `0`.

Command: `node --test test/community-engine.test.mjs` — exit `0`; 4 passed, 0 failed.

Expected key assertions: candidate score `96` and eligible; join status `UNKNOWN_AUTH_BLOCKED`; postable is false until membership/rules/warm-up evidence; `no_promo` is blocked; receipt dashboard reports `discovered=1` in the unit fixture and `discovered=2` in the durable lane receipt.

## Acceptance mapping

- **A9:** only `facebook_group` and `linkedin_group` are accepted by the module; no other surfaces enter this lane.
- **A10:** discovery/scoring, bounded join state, truthful-answer basis, rule classes, warm-up/postable decision, caps, and dashboard counts are represented. Live auth and approval remain UNKNOWN.
- **V7:** durable receipt includes source/time, score inputs, join receipt/status, truthful-answer basis, rules, warm-up/postable, cap counters, and dashboard counts.
- **V4/V5:** report ends with orchestration `Status:` line; unknown account/publication state and paused scope remain explicit.

## Out of scope / CẦN NAM

No credential entry, OTP/MFA/CAPTCHA, external join request, message, publication, deploy, merge, or push. If a future run has an authenticated session, Nam must supply credentials or solve a platform challenge; the engine then records an observed receipt before any request. No promotional link may be scheduled for `no_promo` or `unclear` communities.

Confidence: **MEDIUM for bounded local engine behavior; LOW for live community state**.

Status: `DONE_WITH_CONCERNS` — A10/V7 local evidence complete; live auth, membership, approval, rules, warm-up, and postability remain UNKNOWN.

# Growth Lead task graph — 2026-11-02

Run mode: supervised Orca orchestration. Controller: Growth Lead in `ms-growth-lead-20261101`. Independent verifier: a fresh read-only Codex attempt after the last integration change. Max concurrent workers: 2; completed workers are reused or released before new work starts.

## Wave 0 — parallel build

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-runtime | BUILD · runtime | P0 source pin, additive state backup/migration, LaunchAgent/rollback rehearsal, health and credential onboarding evidence | none | A1, V2 |
| T-content | BUILD · content | Grounded LinkedIn/Facebook-only copy buffer (≥14), `design-os-vietnamese` pin/gate evidence, campaign drafts, source map | none | A2, A3, A6, V3 |

## Wave 1 — parallel build, after any free worker

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-video | BUILD · video | Measure reference MP4; produce/validate ≥10 distinct MP4s or bounded blocker; thumbnails, hashes, post mapping | none, may consume content claims read-only | A8, V6 |
| T-community | BUILD · community | Facebook/LinkedIn Group discovery, scoring, bounded join flow, rule/warm-up evidence, dashboard/community data contract | account state may be UNKNOWN; no credential bypass | A10, V7 |

## Wave 2 — serialized integration and verification

| Task | role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-integrate | BUILD · integration | Controller-only cherry-pick/reconcile disjoint worker commits into current branch; update decisions/status/Overview seams; no external publish/deploy/merge | T-runtime, T-content, T-video, T-community | A1–A10 |
| T-verify | VERIFY · independent | Fresh read-only inspection after T-integrate; rerun bounded gates; inspect pins/foreign changes; write unique verification report | T-integrate | V1–V7 |

Paused scope: Threads, Reddit, Product Hunt, Indie Hackers, X publication; no W3b platform outside Facebook/LinkedIn Groups. Credential entry and CAPTCHA/MFA/OTP remain the only `CẦN NAM` actions.

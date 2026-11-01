# Growth Lead task graph — 2026-11-02

Run mode: supervised Orca orchestration. Controller: Growth Lead in `ms-growth-lead-20261101`. Independent verifier: a fresh read-only Codex attempt after the last integration change. Max concurrent workers: 2; completed workers are reused or released before new work starts. P0 login blocks account-dependent publishing/comments, but content/video/public community lanes continue.

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

## Wave 1-P0 — account browser architecture (immediate, before account-dependent lanes)

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-chrome-login | BUILD · runtime/account | Visible Playwright Chromium persistent profile manager, manual-login API/UI for LinkedIn/Facebook, native host fingerprint, identity redirect verification, retry with Keychain credential only, canonical `JsonStore`/`SeedingService` source/evidence records, Camoufox public-only routing | none; may read existing runtime/account contracts | A11, A12, V8 |

## Wave 2 — serialized integration and verification

| Task | role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-integrate | BUILD · integration | Controller-only cherry-pick/reconcile disjoint worker commits into current branch; update decisions/status/Overview seams; no external publish/deploy/merge | T-runtime, T-content, T-video, T-community | A1–A10 |
| T-verify | VERIFY · independent | Fresh read-only inspection after T-integrate; rerun bounded gates; inspect pins/foreign changes; write unique verification report | T-integrate | V1–V7 |

## Wave 3 — after Chrome account readiness (do not claim READY before evidence)

| Task | Lane / role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-comments-pilot | BUILD · publish/learning | Account-owned comment polling/reply safety, 07:00–23:00 schedule, pilot variable/metric schema, daily 23:30 and 2026-11-09 08:00 reports, warning/checkpoint frequency reduction | T-chrome-login; at least one account identity verified for live side effects | A13, A14, V9 |

## Wave 3 — account pool after the Chrome gate

`T-account-pool` starts only after `CHROME_LOGIN_READY` is recorded. It does not weaken the manual-login gate: credentials may be supplied only through the local UI/CSV picker, are written to Keychain, and are never persisted in state, logs, repo, or chat.

| Task | role | Scope | Dependencies | Acceptance |
|---|---|---|---|---|
| T-account-pool | BUILD · account/runtime | Local account-list form plus one-shot local CSV import; validate LinkedIn/Facebook rows; create one app-owned Chrome profile per account; read Keychain credentials for bounded auto-login; stop challenged accounts and surface `CẦN NAM`; continue independent pool accounts; project all rows through the single `JsonStore`/`SeedingService` with source/evidence hash | `CHROME_LOGIN_READY`; existing account credential seam | Mission 14, A11, V8 |
| T-linkedin-pilot | LIVE-PREP · publish | After at least one account reaches READY, run exactly one LinkedIn browser post with one approved MP4, independently verify permalink/media, and record evidence before enabling schedule | T-account-pool; READY account; kill switch/campaign gate | one real permalink or explicit BLOCKED/UNKNOWN; no fabricated publication |
| T-schedule-pilot | BUILD · publish/learning | Enable 10/day 07:00–23:00 only after pilot post proof; allocate across account pool under per-account caps, spacing, warning 50% reduction, and kill switch | T-linkedin-pilot; verified permalink | A13, A14, V9 |

Paused scope: Threads, Reddit, Product Hunt, Indie Hackers, X publication; no W3b platform outside Facebook/LinkedIn Groups. Credential entry and CAPTCHA/MFA/OTP remain the only `CẦN NAM` actions. T-comments-pilot may implement guards and scheduling before login but must not perform live writes until a READY account and kill switch are evidenced.

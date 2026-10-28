# oi-browser integration report

## Status

`PARTIAL`. Integration base: `79985bb411afc141f0edf10ae635fb91824d8bc9`; final C source/test checkpoint: `fa3ebda996041498e44800e181507bd494ee4b72`; prior integration evidence checkpoint: `7f2b74a`; continuation implementation began at `3d1c380`. Live publication, live metrics/conversion, authenticated Camoufox readiness, Auto-GTM generation/media, and A's dirty overlay reconciliation remain unproven.

## Baseline, ownership, integration

- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- SESSION A: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`, `wave/distribution-os-runtime-wave-13-bridge`, checkpoint `1ed5771`; native `SESSION-A-ACK-20261028T1210Z`; latest read-only status 13 tracked dirty + 90 untracked entries; owns runtime `127.0.0.1:4318` PID `79925`. C did not touch it.
- SESSION B: `/Users/nam/Documents/marketing-seeding-integration`, `integration/autonomous-build`, checkpoint `b675a98`; native `SESSION-B-ACK-20261028T1210Z`; tracked scope clean with 16 untracked report/artifact paths. Exact B commit is not cherry-picked because candidate history already contains/adapts the required authority guard behavior and the remaining diff contains obsolete provider/GPM-era changes.
- SESSION C: `/Users/nam/Documents/marketing-seeding-session-c-reconciled`, `integration/session-c-reconciled`, owns integration/docs/evidence.
- Native communication proof: `SESSION-C-HANDSHAKE-20261028T1210Z` delivered through Orca terminals; both A/B returned `turn_started`, ACK markers, exact checkpoint/dirty scope, and ownership.
- Origin: `https://github.com/DevAngular333/marketing-seeding.git` (GitHub reports canonical repository `NamAIEngineer/marketing-seeding`). Branch `integration/session-c-reconciled` is pushed; draft PR [#2](https://github.com/NamAIEngineer/marketing-seeding/pull/2) is open against `main`. No merge, deployment, login, grant, publication, or external message.

## oi-browser and auto-GTM

- Source pins: oi-browser `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm `9368098477d78f75d57fdf5db276129948f3a183`.
- Reused/adapted: memory/entity/consolidation concepts, bounded provider registry/health/fallback concepts, static DOM parsing and semantic identity. Native code: `src/oi-browser-integration.mjs`, `src/oi-browser-provider-adapters.mjs`, `src/oi-browser-camoufox-bridge.mjs`.
- Not used: oi-browser companion shell, fruit catalog, seeded demo state, SQLite workspace store, and CLI simulation as execution proof. One `JsonStore`, one `SeedingService`, one Decision Plane, one dashboard.
- Audit: [docs/integrations/oi-browser-audit.md](../../docs/integrations/oi-browser-audit.md), with source behavior, overlap, decision, target, risk, owner, and tests.
- Auto-GTM is proven only at `lead-feed`; `feed_not_generated` remains unavailable. Generation/media is not relabeled or fabricated.

## Memory and community intelligence

Memory records distinguish `RAW_EVENT`, `OBSERVATION`, `FACT`, `INFERENCE`, `LEARNING`, and `POLICY`; store scope, provenance/source revision, evidence refs, timestamps, confidence, freshness/expiry, support, sample IDs, retraction, and campaign/account/community bindings. Retrieval is bounded and scope checked. Duplicate polls merge support. Consolidation requires distinct verified/measured evidence; stale, UNKNOWN, unverified, retracted, unsupported, or cross-scope evidence cannot create learning. Community evidence and prohibition state feed strategy fit and target selection.

## Provider / Decision Plane

`AgentTask` and `ProviderDecision` are versioned and persisted in canonical state. Routing filters capability, tools, privacy, context, reasoning class, availability, health, timeout, and history. Installed, auth-ready, healthy, and execution success are separate. Runtime smoke on isolated port `4337` with explicit loopback Qwen config returned `SUCCEEDED`; the response included `decisionPersisted=true` and a persisted decision ID, and restart retained one successful route. This is local `RUNTIME_VERIFIED`; it does not prove A runtime configuration or an external provider.

## Browser intelligence / Camoufox / execution

`BrowserSnapshot` and `InteractiveElement` are versioned, fingerprint-bound, redacted, frame-aware, and separate `STATIC_HTTP` from `LIVE_DOM`. Parser, annotation, and executor use shared semantic IDs. Stale, duplicate, ambiguous, forged, or runtime-unbound identities fail closed. Camoufox bridge validates exact profile/page/url binding and persists `LIVE_DOM` through `JsonStore`. Execution stays behind canonical authority, pre-submit, idempotency, verification, and UNKNOWN quarantine. No parallel publish path exists. Fresh authenticated readiness and live publication are blocked.

## Authority, verification, metrics

Standing authorization guards remain canonical. Candidate tests cover scope collision, second-campaign rejection, delegation validation before browser input and worker start, expiry/revocation/limits, idempotency, kill switch, and UNKNOWN preservation. No grant or approvedAt was fabricated. No live post ID/permalink, metrics, conversion, or external side effect exists.

## Closed learning proof — fixture

Artifact: [fixture-run-7378f8c.json](fixture-run-7378f8c.json). Controlled Product X developer-awareness campaign: Community A has technical/educational evidence; Community B prohibits direct promotion while allowing educational context. `SeedingService.runCampaignControlCycle` chose a candidate before consolidation. Two distinct verified fixture observations consolidated into one `LEARNING` with `sampleSupport=2`, `verifiedCount=2`, and evidence `fixture:fixture-publication-a` / `fixture:fixture-publication-b`. The next production strategy entrypoint selected a different candidate and included `memory:learning-1adbd95424b288d5e6db412b`. Browser semantic CLICK crossed `BrowserInteractionFixture`, verified `CONTROL_ACTIVATED`, replay clicked once, and restart retained memory, learning, snapshot, execution, and provider decisions. Evidence: `FIXTURE_VERIFIED`; no external side effect.

Final C source/test checkpoint: `fa3ebda996041498e44800e181507bd494ee4b72`; metadata/evidence commits follow this checkpoint on the candidate branch.

## Runtime proof — isolated candidate

Artifact: [server-smoke-7378f8c.json](server-smoke-7378f8c.json). Port `4337`, temporary state directory, exact source SHA `7378f8c`; `/health` 200, unauthorized provider route 401, memory and `STATIC_HTTP` snapshot writes 201, restart persistence passed. Explicit local-Qwen inference returned `SUCCEEDED` and remained visible after restart. Dashboard reported `feed_not_generated`. Evidence: `RUNTIME_VERIFIED`; no credentials, login, publication, or external side effect. Runtime A `4318` stayed untouched.

## Tests and hygiene

- Baseline `79985bb411afc141f0edf10ae635fb91824d8bc9`: `npm test` → 576 total, 574 pass, 0 fail, 2 skipped.
- Historical integration slices: authority/bootstrap/delegation 47/47; oi-browser/browser/provider/transport 59/59; combined 106/106. Current coordinator/native focused suite is 17/17; current oi-browser/provider/live bridge focused suite is 34/34.
- Historical candidate `7f2b74a`: `node --test test/*.test.mjs` → 794 total, 792 pass, 0 fail, 2 skipped. Pre-regression candidate `10ce868`: `node --test test/*.test.mjs` → 802 total, 800 pass, 0 fail, 2 skipped. Historical `9875db3`/`5f6f08d`: `npm test` → 805 total, 803 pass, 0 fail, 2 skipped.
- Durable memory/provider regression evidence: [regression-final-9875db3.json](regression-final-9875db3.json), exact source SHA, command, timestamp and output hash. Historical recovery and provider cancellation evidence remain in [regression-final-1589518.json](regression-final-1589518.json) and [regression-final-35cc224.json](regression-final-35cc224.json); current candidate evidence is [regression-final-service-signal.json](regression-final-service-signal.json) at source/test revision `fa3ebda`. Prior artifacts remain available.
- Auxiliary System Agentic READ_ONLY verifier task `0e9f9242-0019-4f11-9453-9d155a419221` was rejected by the selected REA provider because `context.target_authorized=true` was absent; no retry, artifact, file edit or external side effect. Direct independent verifier PASS remains the final review evidence.
- Auto-GTM: `/Users/nam/Documents/auto-gtm/.venv/bin/python -m unittest discover tests` → 160 total, 160 pass, 0 fail; `pip check` clean. The Auto-GTM owner worktree is dirty; C did not modify it.
- Prior C cancellation regression at `35cc224`: focused oi-browser/provider/live bridge `34/34`, coordinator/native `17/17`, and full `npm test` `813 total, 811 pass, 0 fail, 2 skipped`; output hashes are recorded in [regression-final-35cc224.json](regression-final-35cc224.json). The queue task `ad044fdf-fbbf-4a99-a4eb-9165dc35987e` remains `UNKNOWN / QUEUE_RECEIPT_AMBIGUOUS` after one exact-ID reconciliation; no duplicate submission; direct C implementation is authoritative code evidence.
- Controlled repro artifact [memory-provider-regression-repro-590f70a.json](memory-provider-regression-repro-590f70a.json) records one canonical fixture sample despite caller ID changes and `UNKNOWN/provider timeout` after a stalled JSON body at the bounded 100 ms deadline.
- Syntax checks for native adapters/service/server passed. `git diff --check` passed. Secret scan hits are redaction test fixtures/generated UI text, not credentials.
- Evidence artifact: [regression-7378f8c.json](regression-7378f8c.json).
- Fresh independent read-only review at `2026-10-28T07:49:24Z`, historical HEAD `7f2b74a`; follow-up review fixed malformed native recovery ID handling at `10ce868`; final memory/provider review at `13:58:13Z` passed on `9875db3`. Gstack queue review was unavailable because the Codex queue provider is unauthenticated; no gstack review claim is made. Stale metadata was corrected in this report and the coordination ledger.

## Remaining blockers

- A dirty overlay must receive an owner-created clean checkpoint before serial C reconciliation.
- Fresh authenticated Camoufox readiness, valid live standing authority, publication ID/permalink, live metrics/conversion remain blocked.
- Auto-GTM generation/media unavailable; only lead-feed capability proven.
- Latest A `/health` recheck (`2026-10-28T12:04:21Z`) reports `sourceCommit=1ed5771`, `sourceDirty=true`, schema 8, `UNKNOWN=6`, verified 0, publication unverified 150; candidate local inference smoke remains isolated and does not prove A runtime provider inference.

## Current coordination and continuation evidence

- Exact ChatGPT thread was matched from a fresh Chrome AX tree by marker `ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01` and URL conversation `6ae09d26-12c4-83ec-bd1f-d53553e707cc`. Fresh bounded bridge receipt `xchg-50bacbd9c3064aa2a7e0` correlated the nonce and marker in a completed assistant turn.
- Current A/B handshakes were delivered through Orca request IDs `461d4128-4075-41ea-b07f-291c421385bb` and `7cdca6e2-c446-4d8c-b4d6-686e061e9da8`; A returned receiver READY, B returned a real read-only result but follow-up capability unconfirmed.
- `src/project-coordinator.mjs` provides durable project-scoped dependency state and bounded wake/replay. Current coordinator/native focused tests pass 17/17; the broader prior native/coordinator/LinkedIn verifier slice is 69/69. Rehearsal artifact: `coordination-rehearsal-20261028.json` (`FIXTURE_VERIFIED`, one worker attempt, accepted artifact hash, restart result retained, replay false).
- Existing orchestrator remains healthy at `8879`, but GoalRuns v60–v63 remain failed for concrete provider/artifact/approval/reply reasons; this coordinator proof does not upgrade those historical runs or prove automatic agent resume after chat termination.

### Native resume status

- `IMPLEMENTED`: durable coordinator v3, exact Orca request retry, project supervisor, launchd startup/recovery, raw-output scrubbing, safe artifact contract, restart-safe dedupe, bounded 5s/10s/20s recovery backoff, crash-interrupted attempt accounting and fail-closed malformed recovery metadata.
- `NATIVE_RESUME_VERIFIED`: C launchd #1 request `fc821d69-2281-4757-b5c2-8d1f5628a63b`, one attempt, artifact hash `a6cf8a3201799ff1aaf0ff5aaba1a5ff7b5e727ba848a8caa162d7bc1b9e1960`; C launchd #2 request `4f19fde8-0f31-4f8d-8b40-0d36de8dd45a`, one attempt after exact request replay, artifact hash `4b3e51dad6b2d8aaf63377f416a8a30ecc9f25041986dd19aa21b1f29b0f4770`.
- A/B native follow-up artifacts/hashes are in the evidence file. A's dirty scope remained untouched. A later Orca listing marked B orphaned; this does not invalidate its earlier completed native request/artifact but leaves continuous receiver availability unproven.
- Launchd restart kept two results and `attemptCount=1` for both; no replay. Artifacts are rehearsal only (`liveEligible=false`, no external effects, no UNKNOWN retry).
- Coordinator recovery regression is `FIXTURE_VERIFIED` at source/test revision `35cc224` (recovery implementation introduced at `1589518`): exact request ID is preserved, recovery stops after three attempts, restart consumes an interrupted in-flight attempt, and invalid request/timestamp metadata blocks closed. Current focused result: 17/17.
- C LaunchAgent restart is `NATIVE_RESUME_VERIFIED`: schema v2/revision 26 migrated to schema v3/revision 27, retained all three completed results and attempt counts, and replayed no completed task. Evidence: [coordinator-runtime-restart-20261028.json](coordinator-runtime-restart-20261028.json). Scope was the C coordinator only; A runtime 4318 and B worktree were untouched.
- Product closed-loop remains `FIXTURE_VERIFIED`; port `4337` remains `RUNTIME_VERIFIED`. No `LIVE_VERIFIED` publication, metric, or conversion.
- A owner checkpoint request completed natively: request `8ec39d22-ec26-48a9-94b9-1717cf75af60`, artifact hash `94aa53a52b514b198375774fb2ba2cdfd1bebe8731110e3324d00dd0af0803c7`, HEAD `1ed5771`, 12 tracked dirty files, 567 untracked paths. A reports that clean checkpointing requires ownership reconciliation and fresh tests; C did not stage or alter those files.

## C follow-up: immutable browser intent binding (2026-10-29)

- Revision `dd814bf1df82a0371171ce0ca3674d16a1009368` (historical predecessor of current C source/test checkpoint `35cc224`) adds fail-closed binding checks in `src/oi-browser-integration.mjs`: immutable intent ID, action/element/snapshot binding, semantic target identity, frame, and action-to-role compatibility are validated before transport input.
- Regression test `browser executor rejects forged action, frame, and semantic identity bindings` covers mutations of action, frame, semantic identity, and intent ID. No browser provider call occurs for these rejected bindings.
- Historical focused oi-browser/Camoufox command: 32/32 pass. Current focused and full evidence is recorded under the C provider cancellation follow-up above.
- Classification: source change `IMPLEMENTED`; fixture checks `FIXTURE_VERIFIED`; prior C LaunchAgent follow-up and restart checks remain `NATIVE_RESUME_VERIFIED`. No `LIVE_VERIFIED` publication or external side effect.
- Final branch head is pushed and matches `origin/integration/session-c-reconciled`; draft PR #2 remains open. A/B worktrees and runtime `4318` were not changed.

## C follow-up: provider cancellation (2026-10-29)

- Revision `35cc224febb5eb9c8368cf88f5f28b6a119b6be3` accepts a caller `AbortSignal` in `routeAgentTask`, aborts the active provider, records `FAILED/cancelled`, and stops fallback execution.
- A post-race abort check closes the case where the provider returns an invalid result after cancellation. Regressions cover pending cancellation and this invalid-result race.
- Evidence: [regression-final-35cc224.json](regression-final-35cc224.json), focused oi-browser/provider/live bridge `34/34`, coordinator/native `17/17`, full `npm test` `813/811/0/2`, independent verifier PASS.
- Classification: source change `IMPLEMENTED`; tests `FIXTURE_VERIFIED`; C supervisor remains `NATIVE_RESUME_VERIFIED`; no live provider, publication, authority, or external side effect.

## C follow-up: service cancellation wiring (2026-10-29)

- Revision `fa3ebda996041498e44800e181507bd494ee4b72` forwards `input.signal` through `SeedingService.routeOiAgentTask` into the canonical provider router. The service-level regression verifies active-provider abort, fallback suppression, and persisted `FAILED/cancelled` decision state.
- Evidence: [regression-final-service-signal.json](regression-final-service-signal.json), focused oi-browser/provider/live bridge `35/35`, coordinator/native `17/17`, full `npm test` `814/812/0/2`, independent verifier PASS.
- Classification: source change `IMPLEMENTED`; tests `FIXTURE_VERIFIED`; no external side effect. The JSON HTTP endpoint cannot carry a live `AbortSignal`; internal service callers can.

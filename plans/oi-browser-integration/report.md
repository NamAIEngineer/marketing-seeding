# oi-browser integration report

## Status

`PARTIAL` at candidate `integration/session-c-reconciled` / `20ba20f6f8f273a72cb0db88b216d645aeecaeb1`.

The candidate integrates oi-browser memory, provider routing, browser snapshot identity, persistence, and Camoufox bridge seams into marketing-seeding's existing `JsonStore`, `SeedingService`, Decision Plane, canonical authority, executor, verification, metrics, and dashboard. It does not claim live publication, live metrics, Auto-GTM generation, fresh authenticated Camoufox readiness, or native A/B receiver connectivity.

## Baseline, ownership, and integration

- Base: `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- SESSION A: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`, `wave/distribution-os-runtime-wave-13-bridge`, HEAD `52072ce`, dirty Camoufox/runtime/server/UI scope, owner of runtime `127.0.0.1:4318` PID `30842`. Its committed checkpoint is present through merge `d195756`.
- SESSION B: `/Users/nam/Documents/marketing-seeding-integration`, `integration/autonomous-build`, HEAD `6899679`, dirty authority/standing-delegation/service/test/report scope. C did not edit, stash, reset, clean, or commit B files.
- SESSION C: this candidate, owner of oi-browser audit, native integration, tests, evidence, and coordination docs. The current code tree is clean at `20ba20f`; C-owned evidence/docs are updated in this commit.
- Orca `worktree ps`, `terminal list`, and inbox were checked on 2026-10-28. A and B have zero attached terminals/receivers. Prior sends returned `terminal_not_found`; the remaining inbox marker has no delivery/ACK evidence. Native A/B handshake is `UNVERIFIED`.
- Origin observed: `https://github.com/DevAngular333/marketing-seeding.git`; no push, PR, merge, deployment, or external message performed.

## Source reuse

- oi-browser pin: `1e471c44b5d63aa5aadb708623b21090b6f325b2`.
- auto-gtm pin: `9368098477d78f75d57fdf5db276129948f3a183`.
- Audit: [docs/integrations/oi-browser-audit.md](../../docs/integrations/oi-browser-audit.md).
- Reused/adapted: oi-browser memory shape and consolidation concepts, bounded provider registry/router concepts, static DOM parsing and semantic identity concepts. Native code is in `src/oi-browser-integration.mjs`, `src/oi-browser-provider-adapters.mjs`, `src/oi-browser-camoufox-bridge.mjs`.
- Not used: oi-browser companion application shell, SQLite workspace store, fruit catalog, seeded demo state, and CLI simulation path as execution proof.
- Auto-GTM remains the existing `lead-feed` consumer. `feed_not_generated` stays unavailable; generation/media is not relabeled.
- GPM is not active in the server runtime. Historical compatibility modules remain only where existing contracts require them.
- Attribution/license notice retained in the audit and the source license URL in the audit.

## Memory and community intelligence

Memory records distinguish `RAW_EVENT`, `OBSERVATION`, `FACT`, `INFERENCE`, `LEARNING`, and `POLICY`, with scope, provenance/source revision, evidence refs, timestamps, confidence, freshness/expiry, sample IDs, and retraction. Retrieval is bounded and campaign/community scoped. Duplicate polling merges support; consolidation requires distinct supported evidence and does not learn from unknown, stale, unverified, or retracted material. Community discovery/profile evidence is consumed by strategy fit and prohibition checks.

## Provider / agent router

`AgentTask` and `ProviderDecision` are versioned and persisted in the canonical store. Routing filters capability, tools, privacy, context, reasoning class, health, and availability, then applies bounded ranking and fail-closed timeout/nonzero/empty-result handling. Installed, auth-ready, healthy, and execution success are separate states. The server only loads a configured local provider; absent configuration reports unavailable. The isolated runtime smoke supplied explicit loopback Qwen configuration: `/v1/models` was health-ready, but generation failed with HTTP 404 after the MLX server logged `generation thread died` caused by Metal `Insufficient Memory`. The route remained `FAILED/nonzero`; no false success was recorded.

## Browser intelligence / Camoufox

`BrowserSnapshot` and semantic `InteractiveElement` identities are versioned, fingerprint-bound, redacted, frame-aware, and separated between `STATIC_HTTP` and `LIVE_DOM`. Intent mapping uses the same IDs as snapshot parsing. Stale, ambiguous, duplicate, forged, or runtime-unbound live identities fail closed. The Camoufox bridge validates exact profile/page/url bindings and persists live snapshots through the canonical store. Execution continues through existing authority/pre-submit/verification hooks; it does not create a parallel publisher.

## Auto-GTM and execution

Auto-GTM capability is verified only at lead/feed level. The configured feed is unavailable with `feed_not_generated`. No artifact is fabricated. Camoufox/API/direct transport seams remain bounded by existing authority, idempotency, UNKNOWN quarantine, and verification contracts. No login, MFA/CAPTCHA handling, grant, public submit, permalink, conversion, or live metric was performed.

## Closed learning proof: fixture

Artifact: [fixture-run-20ba20f.json](fixture-run-20ba20f.json).

Controlled Product X developer-awareness campaign used local provenance for Community A educational evidence and Community B direct-promotion prohibition. `SeedingService.runCampaignControlCycle` selected a target before consolidation. Two distinct verified fixture observations consolidated into one `LEARNING` (`sampleSupport=2`, `verifiedCount=2`, evidence `fixture:fixture-publication-a`, `fixture:fixture-publication-b`). The next production strategy entrypoint selected a different candidate and included the learning evidence. A static semantic CLICK crossed `BrowserInteractionFixture`, verified `CONTROL_ACTIVATED`, and idempotent replay did not click twice. Restart retained memory, learning, snapshot, execution, provider decisions, and strategy. Evidence level: `FIXTURE_VERIFIED`, no external side effect. Exact source: `20ba20f6f8f273a72cb0db88b216d645aeecaeb1`.

## Runtime proof: isolated candidate

Artifact: [server-smoke-20ba20f.json](server-smoke-20ba20f.json).

Exact candidate `20ba20f6f8f273a72cb0db88b216d645aeecaeb1` ran on private port `4333` with a temporary state directory. `/health` reported schema v8 and the exact source SHA. Unauthorized provider route returned `401`; operator session returned `200`. Memory and `STATIC_HTTP` snapshot writes persisted after restart. The configured local Qwen provider was listed by `/v1/models`, but its inference route returned `FAILED/nonzero` (`exit_code_404`); the model server log recorded `generation thread died` / Metal `Insufficient Memory`. Provider decision persistence remained visible after restart, with `successfulProviderRoutes=0`. Auto-GTM remained `feed_not_generated`. No credential, login, publication, or external write occurred. Evidence level: `RUNTIME_VERIFIED`, not live proof.

## Tests

- Baseline `79985bb411afc141f0edf10ae635fb91824d8bc9`: `npm test` → `576 total, 574 pass, 0 fail, 2 skipped`.
- Focused exact candidate: `node --test test/oi-browser-integration.test.mjs test/browser-runtime-router.test.mjs test/oi-browser-provider-adapters.test.mjs test/oi-browser-live-bridge.test.mjs` → `37 total, 37 pass, 0 fail`.
- Full exact candidate: `node --test test/*.test.mjs` → `790 total, 788 pass, 0 fail, 2 skipped`.
- Auto-GTM pinned checkout: `/Users/nam/Documents/auto-gtm/.venv/bin/python -m unittest discover tests` → `154 total, 154 pass, 0 fail`; `pip check` clean.
- Syntax: `node --check src/oi-browser-integration.mjs`, `src/oi-browser-provider-adapters.mjs`, `src/oi-browser-camoufox-bridge.mjs`, `src/service.mjs`, `src/server.mjs` passed.
- `git diff --check` passed after the current source/evidence run.
- The two skipped tests are existing ACL environment checks.
- Latest independent verifier task `2fdee808-270a-491c-a042-14dc3fad3972` failed with `Remote end closed connection without response` and produced no report. A prior queue review attempt failed on its no-progress guard. Manual review is `DONE_WITH_CONCERNS`; no independent verifier PASS is claimed.

## Remaining blockers

- Native A/B receiver/ACK/result delivery unavailable; B dirty work is not reconciled into this candidate.
- Fresh authenticated Camoufox readiness and live publication/permalink/metrics/conversion remain unverified.
- Auto-GTM generation/media capability is unavailable; only lead-feed is proven.
- Production provider configuration is absent in A-owned runtime `4318`; candidate local Qwen smoke is isolated and explicit, with inference blocked by the observed MLX Metal memory failure.
- Independent verifier PASS remains unavailable.

No blocker is cleared by fixture success, process liveness, dashboard rendering, or historical evidence.

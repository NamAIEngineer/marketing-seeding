# Handoff

## C → integration owner

- Current candidate code: `integration/session-c-candidate` at `6600387b254db13bf0494fc14a8f512a6f990e1a`; isolated smoke source revision: `df2f775ee23dd4475e9b358bc42f5e1770b73e29`.
- Runtime evidence: `plans/oi-browser-integration/server-smoke-6600387-rerun.json` (`RUNTIME_VERIFIED`, isolated port `4323`, local Qwen loopback route, unauthorized POST `401`, no external side effect).
- Final rerun: isolated port `4324`, exact source `df2f775`, local Qwen route succeeded, restart retained memory/snapshot, unauthorized provider route returned `401`, no external side effect.
- Machine-readable final rerun: `plans/oi-browser-integration/server-smoke-df2f775.json`.
- Review receipt: `plans/oi-browser-integration/independent-review-6600387.md`; queue verifier failed on no-progress guard, so manual review is `DONE_WITH_CONCERNS`, not independent PASS.
- A/B native handshake remains `UNVERIFIED`; Orca worktree metadata exists but no A/B terminal or inbox receiver is attached. Handshake sends returned `terminal_not_found` for both worktrees.

- Branch: `integration/session-c-oi-browser`; base `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- Implementation commits: `f2ccb030be6d118320c1c5ced9d51c523ea83a89` and `9ce01f9`.
- Source pins: oi-browser `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm `9368098477d78f75d57fdf5db276129948f3a183`.
- C-owned files: `src/oi-browser-integration.mjs`, `src/store.mjs`, `src/service.mjs`, `src/strategy.mjs`, `src/server.mjs`, `test/oi-browser-integration.test.mjs`, `docs/integrations/oi-browser-audit.md`, `plans/oi-browser-integration/`, `.orca-coordination/`.
- Native paths are wired into the canonical `JsonStore`, existing `SeedingService`, strategy decision, dashboard, and API. No second app/store/orchestrator; no GPM path.
- Safe fixture proof: static snapshot → semantic click intent → validated fixture transport → `CONTROL_ACTIVATED`, evidence refs `fixture:before`, `fixture:after`; restart and idempotent replay verified. Memory evidence uses `publication:fixture-1` and `publication:fixture-2`; strategy before/after candidate changes through a persisted `LEARNING`.
- Focused: `node --test test/oi-browser-integration.test.mjs test/browser-runtime-router.test.mjs test/oi-browser-provider-adapters.test.mjs` → `24/24`. Full final run: `node --test test/*.test.mjs` → `732 tests, 730 pass, 0 fail, 2 skipped`.
- Legacy fixture summary: `plans/oi-browser-integration/fixture-evidence.json` (oi-browser source pin in provenance; current candidate artifact below is authoritative).
- Latest controlled case artifact: `plans/oi-browser-integration/fixture-run-6600387.json` (`runCampaignControlCycle`, learning-driven candidate change, provider route, static snapshot click, restart persistence; `FIXTURE_VERIFIED`). `fixture-run-20261027.json` is historical and superseded.
- A/B worktrees remain untouched. Reconcile C commit with A Camoufox/runtime and B authority/standing-delegation changes serially; resolve overlapping `src/server.mjs`, `src/service.mjs`, and `src/strategy.mjs` hunks by owner evidence.
- Do not call fixture evidence live. Current Auto-GTM feed is unavailable (`feed_not_generated`); fresh Camoufox identity/readiness/live publication remains unproven.
- `deriveStrategy` now accepts an optional provider task, routes through the persisted native provider decision path, and records bounded provider rationale without creating authority or execution artifacts.

# Handoff

## C → integration owner

- Branch: `integration/session-c-oi-browser`; base `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- Implementation commits: `f2ccb030be6d118320c1c5ced9d51c523ea83a89` and `9ce01f9`.
- Source pins: oi-browser `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm `9368098477d78f75d57fdf5db276129948f3a183`.
- C-owned files: `src/oi-browser-integration.mjs`, `src/store.mjs`, `src/service.mjs`, `src/strategy.mjs`, `src/server.mjs`, `test/oi-browser-integration.test.mjs`, `docs/integrations/oi-browser-audit.md`, `plans/oi-browser-integration/`, `.orca-coordination/`.
- Native paths are wired into the canonical `JsonStore`, existing `SeedingService`, strategy decision, dashboard, and API. No second app/store/orchestrator; no GPM path.
- Safe fixture proof: static snapshot → semantic click intent → validated fixture transport → `CONTROL_ACTIVATED`, evidence refs `fixture:before`, `fixture:after`; restart and idempotent replay verified. Memory evidence uses `publication:fixture-1` and `publication:fixture-2`; strategy before/after candidate changes through a persisted `LEARNING`.
- Focused: `node --test test/oi-browser-integration.test.mjs` → `11/11`. Full final run: `node --test test/*.test.mjs` → `587 tests, 585 pass, 0 fail, 2 skipped`.
- Fixture summary: `plans/oi-browser-integration/fixture-evidence.json`.
- Latest controlled case artifact: `plans/oi-browser-integration/fixture-run-20261027.json` (`runCampaignControlCycle`, learning-driven candidate change, provider route, static snapshot click, restart persistence; `FIXTURE_VERIFIED`).
- A/B worktrees remain untouched. Reconcile C commit with A Camoufox/runtime and B authority/standing-delegation changes serially; resolve overlapping `src/server.mjs`, `src/service.mjs`, and `src/strategy.mjs` hunks by owner evidence.
- Do not call fixture evidence live. Current Auto-GTM feed is unavailable (`feed_not_generated`); fresh Camoufox identity/readiness/live publication remains unproven.
- `deriveStrategy` now accepts an optional provider task, routes through the persisted native provider decision path, and records bounded provider rationale without creating authority or execution artifacts.

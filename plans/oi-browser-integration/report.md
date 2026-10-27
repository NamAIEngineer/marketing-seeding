# oi-browser integration report

## Current candidate

- Candidate branch: `integration/session-c-candidate`.
- Candidate code revision: `6600387b254db13bf0494fc14a8f512a6f990e1a`.
- Isolated smoke source revision: `df2f775ee23dd4475e9b358bc42f5e1770b73e29`; this documentation commit may advance the candidate HEAD without changing the smoke provenance (no source/test changes after the code checkpoint).
- Candidate source tree was clean before review artifacts were generated; evidence artifacts are C-owned.

## Outcome

`PARTIAL`. Useful oi-browser primitives are native in marketing-seeding's existing control plane. Live social publication, fresh Camoufox readiness, Auto-GTM generation, and A/B reconciliation remain unproven.

## Baseline and ownership

- C base: `79985bb411afc141f0edf10ae635fb91824d8bc9`, branch `integration/session-c-oi-browser`.
- C implementation commits: `f2ccb030be6d118320c1c5ced9d51c523ea83a89` (`feat: absorb oi-browser primitives into distribution OS`) and `9ce01f9` (`feat: route provider context through strategy`).
- SESSION A: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`, `wave/distribution-os-runtime-wave-13-bridge`, HEAD `52072ce`, dirty Camoufox/runtime/server/UI files. Observed server `127.0.0.1:4318` reports source commit `52072ce` and dirty state; it is not this C revision.
- SESSION B: `/Users/nam/Documents/marketing-seeding-integration`, `integration/autonomous-build`, HEAD `6899679`, dirty authority/service/standing-delegation files.
- Orca records A and B as worktree metadata only. `orca terminal list` has no terminal attached to either path, and `orca orchestration inbox` is empty. Handshake sends returned `terminal_not_found`; no live native session ID, receiver, handshake, ACK, or task consumption was observed. A/B files were not edited or committed by C.

## Files and architecture

- `src/oi-browser-integration.mjs`: bounded memory contracts/consolidation, provider routing, BrowserSnapshot normalization/semantic identity, validated CLICK/TYPE/UPLOAD seam, redaction, dashboard projection.
- `src/store.mjs`: additive `memoryItems`, `browserSnapshots`, `browserExecutions`, `providerDecisions` collections; existing migration/lease remains canonical.
- `src/service.mjs`: service/API call paths for persistence, retrieval, consolidation, routing, snapshot/intent/execution, replay and failure recording.
- `src/strategy.mjs`: campaign-scoped fresh memory retrieval; verified supported `prefer_target:<targetId>` learning changes candidate selection and rationale; optional provider routing context is persisted through the same `deriveStrategy` and control-cycle entrypoints.
- `src/server.mjs`: authenticated operator/automation routes under `/api/oi-browser/*`.
- `docs/integrations/oi-browser-audit.md`: source-grounded decisions and risks.

No second dashboard, database, orchestrator, authority, or GPM lane was introduced.

## Source reuse decisions

- oi-browser memory engine: `REUSE_AND_ADAPT`; observation/entity shape retained, consolidation made support-aware, deduplicated, scoped, fresh, retractable, and evidence-bound.
- oi-browser CLI harness: `DO_NOT_USE` for execution; status/simulation/timeout behavior is not inference proof. Native router requires installed/auth-ready/healthy/privacy/capability checks and classifies timeout/nonzero/invalid results as failure.
- oi-browser DOM service: `REUSE_AND_ADAPT` for bounded static research/preflight. Static snapshots never claim authenticated live DOM. Element IDs combine semantic fields and fingerprints; stale/ambiguous targets fail closed.
- oi-browser companion orchestrator and SQLite store: `DO_NOT_USE`; existing `SeedingService` and leased `JsonStore` remain sole owners.
- official fruit companion catalog: `DO_NOT_USE`.
- auto-gtm: existing lead-feed boundary retained (`MERGE_INTO_EXISTING_MODULE`); generation/media is not claimed. Source revision pinned in audit and code.

## Memory

Memory kinds: `RAW_EVENT`, `OBSERVATION`, `FACT`, `INFERENCE`, `LEARNING`, `POLICY`. Records carry scope, entity, provenance/source revision, evidence refs, timestamps, confidence, freshness/expiry, sample IDs, support count, and retraction. Duplicate publication polling merges support instead of creating independent samples. Consolidation requires at least two distinct samples and all support evidence in `VERIFIED`, `MEASURED`, or `RUNTIME_VERIFIED` state. Retrieval is bounded, scoped, and freshness checked. Retraction invalidates dependent items.

## Provider / agent router

Provider records distinguish installed, auth-ready, healthy, and execution success. Routing filters capability, privacy class, context size, requested tools, reasoning class, then ranks bounded cost, success history, latency, and ID before timeout/fallback. Invalid/empty/nonzero/timeout outcomes fail closed. Telemetry stores metadata and output digest, never output text.

The C HTTP server does not invent or auto-discover an inference adapter. Its provider route therefore returns `FAILED/unavailable` until a configured adapter is injected by the owning runtime. The controlled fixture injects `local-fixture-provider` and records `SUCCEEDED`; the server smoke verified the fail-closed production behavior and dashboard projection.

## Browser intelligence / execution

`BrowserSnapshot` is versioned and includes URL/title/headings/text/forms/buttons/links/elements/frame/visibility/enabled/confidence/capturedAt/fingerprint/source/evidence status. Static HTTP and live DOM are distinct; `LIVE_DOM` requires verified provider runtime evidence plus a service-injected runtime validator. Intent identity binds action, element, snapshot fingerprint, target identity, and transient value digest. Executor requires explicit authority, immediate pre-provider validation, certified click transport, verification, and idempotent replay. Live execution additionally requires an injected runtime authority validator; static execution is restricted to safe fixture hosts and `externalSideEffects=false`. Provider-started failures become `OUTCOME_UNKNOWN`.

## Community / Auto-GTM / execution

Community evidence enters the existing discovery path and campaign-scoped memory. Auto-GTM remains a real lead-feed capability with source revision `9368098477d78f75d57fdf5db276129948f3a183`; configured v26 feed currently reports `feed_not_generated`. Camoufox/API/direct transports remain owned by A/B; C provides no competing live publisher and no GPM activation.

## Closed learning proof

Controlled fixture campaign has two eligible targets. Before memory consolidation, deterministic strategy selected one candidate. Two verified observations with evidence `publication:fixture-1` and `publication:fixture-2` consolidated into a `LEARNING` with support `2` and `decisionHint=prefer_target:<targetId>`. The second strategy decision selected the other target and included the learning ID in rationale/evidence. This proof ran through the production `deriveStrategyDecision` path and persisted state; it is fixture evidence, not live publication proof.

## Fixture browser proof

`https://fixture.test/community` static snapshot produced a semantic button ID. A CLICK intent crossed the validated fixture transport once, emitted `COMMAND_COMPLETED`, observed `CONTROL_ACTIVATED`, and retained `fixture:before`/`fixture:after` evidence. A replay after restart returned the persisted execution without a second click. `TYPE` transient value mismatch is rejected before transport.

Machine-readable summary: `plans/oi-browser-integration/fixture-evidence.json` (legacy summary; its `provenance.sourceRevision` is the pinned oi-browser source, not the candidate revision).

Latest controlled run artifact: `plans/oi-browser-integration/fixture-run-6600387.json`. It executed `SeedingService.runCampaignControlCycle` on exact candidate revision `6600387b254db13bf0494fc14a8f512a6f990e1a` with a temporary `JsonStore`, then crossed the persisted static snapshot → CLICK intent → validated fixture transport → `CONTROL_ACTIVATED` path. Before/after candidate IDs differ after a supported learning (`sampleSupport=2`, `verifiedCount=2`), provider routing is `SUCCEEDED`, and restart retains memory, snapshot, execution, provider decision, and strategy records. This remains `FIXTURE_VERIFIED`; no public publication occurred.

Latest server case: `plans/oi-browser-integration/server-smoke-6600387-rerun.json`. Exact candidate server ran on isolated port `4323` with local Qwen model health observed from loopback `/models`; provider inference succeeded through the authenticated operator API and was persisted as a digest. Unauthorized provider POST returned `401`. Auto-GTM returned `feed_not_generated`; no external side effect occurred. This is `RUNTIME_VERIFIED`, not live publication proof.

Final isolated rerun on port `4324` used exact source `df2f775ee23dd4475e9b358bc42f5e1770b73e29`, private state, and loopback Qwen. Health reported source clean/schema v8; provider route succeeded; memory and static snapshot remained visible after restart; unauthorized provider route returned `401`; Auto-GTM remained unavailable; no external side effect occurred. This is `RUNTIME_VERIFIED`, not live publication proof.

Machine-readable final rerun: `plans/oi-browser-integration/server-smoke-df2f775.json`.

Latest isolated rerun: `plans/oi-browser-integration/server-smoke-d75ce02.json`. Exact candidate HEAD `d75ce028b4cfeef80822b760686afae1813634bb` ran on port `4325` with a private temporary state directory. Loopback Qwen routing returned `SUCCEEDED`; the unauthorized route returned `401`; a scoped memory observation and `STATIC_HTTP` snapshot persisted; after restart the same state exposed one memory item, one snapshot, and one successful provider route. The provider persistence field is deliberately described as verified by restart/dashboard because the API returns the persisted row object, not a boolean. Auto-GTM remained unavailable (`feed_not_generated`). No login, credential, publication, or external write occurred.

Final isolated rerun: `plans/oi-browser-integration/server-smoke-17993d2.json`. Exact candidate HEAD `17993d287a4a047a5994af140799c8963b86d94f` produced the same bounded result on port `4325`: local Qwen route `SUCCEEDED`, unauthorized route `401`, scoped memory and static snapshot retained after restart, provider decision visible after restart, schema v8, and Auto-GTM `feed_not_generated`. The run used a private temporary state directory and no external side effect.

Final provenance rerun: `plans/oi-browser-integration/server-smoke-3794177.json`. Exact final candidate `379417778e1bd007e990030b12c7d448af6b02ba` produced the same result on isolated port `4325`; restart retained one memory item, one static snapshot, and one successful provider decision. No external side effect occurred.

## Verification evidence

Commands run in C worktree:

```text
node --test test/oi-browser-integration.test.mjs test/browser-runtime-router.test.mjs test/oi-browser-provider-adapters.test.mjs
24 tests, 24 pass, 0 fail

node --test test/*.test.mjs
732 tests, 730 pass, 0 fail, 2 skipped

node --check src/oi-browser-integration.mjs
node --check src/service.mjs
node --check src/server.mjs
git diff --check
```

The full-suite result above is from exact candidate revision `6600387b254db13bf0494fc14a8f512a6f990e1a`, including transient-value binding, semantic identity validation, provider nonzero/reasoning/tool/cost selection, authenticated memory query scoping, live runtime hook boundaries, and provider routing through the production strategy entrypoint. Two ACL environment checks were skipped. No external write, credential use, live social submit, merge, deploy, or publication was performed.

Independent read-only review attempt `oi-browser-candidate-independent-review-6600387-local` reached `FAILED` with exit code `1` because the local worker hit its repeated-tool-call no-progress guard. Its provisional report is not accepted as verifier completion. Manual bounded review covered persistence, memory, routing, snapshot redaction, live/static boundaries, authority, API safety, A/B ownership, and exact runtime artifacts. Receipt: `plans/oi-browser-integration/independent-review-6600387.md`.

## Known limitations / next action

- A/B dirty work remains unintegrated; overlapping server/service/strategy files need serial reconcile and rerun after a real owner checkpoint or receiver ACK.
- Current runtime at `127.0.0.1:4318` is A's `52072ce`, not C's branch. Do not treat its health or Camoufox process as proof of C integration. C's current isolated runtime case used port `4323` and was stopped after the check.
- `plans/oi-browser-integration/fixture-run-20261027.json` is a historical superseded fixture artifact from `2e92827511ec48d68cb02cf048360997c2d91e26`; use `fixture-run-6600387.json` for current candidate evidence.
- Auto-GTM feed generation is unavailable; no artifact is fabricated.
- The live server at `4318` has no proven configured inference adapter. C's isolated server can use the explicitly configured loopback Qwen adapter, but production provider configuration and owner integration remain dependencies for the final runtime branch.
- Fresh Camoufox identity/readiness and live publication/verification remain blocked or unproven.
- Next autonomous action: reconcile C with A Camoufox/runtime and B authority/standing-delegation checkpoints in a clean candidate, resolve owned hunks, rerun focused/full checks, then perform only explicitly authorized safe/runtime verification. Live publication still requires valid standing authority, healthy account, certified transport, and independent verification.

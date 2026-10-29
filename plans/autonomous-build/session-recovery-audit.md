# Session Recovery Audit — 2026-10-28

Repository: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`
Audit mode: read-only runtime/repository inspection plus safe tests/UI build. No login, browser mutation, authority refresh, restart, publication, final Post click, or UNKNOWN retry.

## Current state vs historical state

**CURRENT:** wave-13 bridge branch, HEAD `52072ceaf371836a0783b9f8b3c4eda8a46415c5`, dirty (104 porcelain entries); live dashboard PID 38672 on `127.0.0.1:4318`; source provenance reported by runtime is `unknown/clean`, therefore deployed-source match is UNKNOWN. State schema 8, revision 73653. 13 campaigns, 1 target, 18 posts, 151 execution records, 6 immutable UNKNOWN, 0 verified publications. Camoufox metadata stale; canonical readiness UNKNOWN/ineligible; GPM unavailable; effective authorizations/windows/grants/leases 0/0/0/0; Auto-GTM feed unavailable; Product Factory sandbox unsupported.

**HISTORICAL:** prior ORCA 1.4.237 read-only readiness/connected evidence, reversible fixture certification, six quarantined UNKNOWN submissions, local dry-run/restart tests, and older reports claiming earlier revisions/heads. Historical `COMMAND_COMPLETED`/`CLICK_EMITTED` evidence never established semantic activation, platform acceptance, or publication.

## Git state

- `MAIN_HEAD`: `98a499e25c2fab75de6aef85f265e6c2a7364651` (`origin/main`)
- `INTEGRATION_HEAD`: `689967903aea51a4935659c33c2fcc8513ef8565` (`origin/integration/autonomous-build`)
- `CURRENT_HEAD`: `52072ceaf371836a0783b9f8b3c4eda8a46415c5`
- `CURRENT_BRANCH`: `wave/distribution-os-runtime-wave-13-bridge`
- `WORKTREE`: `/Users/nam/Documents/marketing-seeding-wave-13-bridge`
- `AHEAD_BEHIND`: `main...CURRENT = 0 72`; `integration...CURRENT = 0 56`
- `MAIN_MERGED`: NO. Integration is not ancestor of main; main is ancestor of integration.
- `CANONICAL_DEPLOYED`: UNKNOWN. Live `/health` reports `sourceCommit=unknown`, `sourceDirty=false`; launch wrapper intends to export current HEAD/dirty state, but no restart/provenance proof was performed.
- `MERGED_WORK`: main contains historical foundation/release work through `98a499e`; current wave-13 dirty Camoufox/market/UI changes are not proven on main.
- `UNMERGED_WORK`: integration branch and wave-13 bridge work; worker branches remain separate. Useful work exists on `integration/session-c-reconciled` (`e9a7bfa`) and related session branches but is not current canonical main.
- `DIRTY_FILES`: 14 tracked source/UI/test/assets files modified.
- `UNTRACKED_FILES`: 90 entries, including Camoufox modules/tests, market intelligence, continuation journals, runtime scripts, and team state.

Latest meaningful commits: `e9a7bfa`, `20ba20f`, `cd87cc5`, `74a45be`, `0232a3e`, `0ec4fda`, `9fb39cf`, `3794177`, `17993d2`, `d75ce02`, `df2f775`, `16a86d5`, `34acef8`, `4f1066f`, `6600387`, `769e87f`, `80a20ff`, `2e92827`, `9ce01f9`, `f2ccb03`.

## Fresh verification

`npm test`: **758 total, 756 pass, 0 fail, 2 skip**. UI `npm run build`: PASS. Focused Camoufox/router/readiness tests: PASS, 0 failures. `git diff --check`: PASS. No new regression observed.

## Runtime and live evidence

- ORCA executable/version/process: historical read-only evidence `1.4.237`, ready/connected; no live action in this audit. Current active ORCA connection was not mutated.
- GPM: `UNAVAILABLE`, `PROVIDER_NOT_CONFIGURED`; no configured profiles/sessions.
- Router: authenticated social execution and independent verification policy select Camoufox. Camoufox readiness code correctly fails closed when resolver/session observation is absent; ORCA fallback remains compatibility-only for non-Camoufox requests.
- Camoufox: installed local runtime evidence exists (`0.5.8`, browser `156.0.1-beta.36`) from bounded unauthenticated smoke. Current sanitized metadata is `STALE`, `CAMOUFOX_SESSION_METADATA_EXPIRED`; session readiness `UNKNOWN`, executionEligible `false`.
- LinkedIn evidence: `FRESH_EXECUTION_ID=NONE`; durable fresh submit intent `NONE`; autonomous final Post click `0`; platform accepted `NO PROOF`; post ID/permalink `NONE`; author/content/time/media match `NONE`; independent verification `NONE`; canonical published receipt `NONE`; published count `0`; UNKNOWN count `6`; social mutation count `0` in this audit; historical UNKNOWN rows remain immutable.
- Authority: standing authorization implementation exists and is tested locally. Effective live counts: active authorizations `0`, time-valid authorizations `0`, active/available windows `0`, active/time-valid grants `0`, active leases `0`. Current account/profile/target/content/media/audience/schedule package is incomplete; account runtime is ineligible due `readiness:expiry_invalid`.
- Product Factory: local typed/fixture evidence and Seatbelt seams exist. Current sandbox is `UNSUPPORTED`, `executionEligible=false`; arbitrary repo execution, screenshots, demo capture, rendering/export, video/GIF are not production-proven.
- Auto-GTM: `feed_not_generated`, zero leads/opportunities. Reader/normalizer and strategy advisory consumer exist; producer/export contract absent.
- Automation: campaign queue enabled at 30 seconds but latest cycle has six `BOOTSTRAP_RENEWAL_BINDING_BLOCKED` failures. Discovery, control cycle, metrics, browser tracking, daily production and fixture worker disabled.

## Capability matrix

| Component | Status | Implementation files | Latest proof | Real / synthetic | Remaining gap |
|---|---|---|---|---|---|
| PRODUCT_FACTORY | PARTIAL | `src/product-factory*.mjs`, `src/product-factory-seatbelt.mjs` | typed/fixture tests; sandbox projection | bounded local-real + fixtures | audited sandbox, arbitrary repo build/run/render/media |
| PRODUCT_INTELLIGENCE | LOCAL_REAL | `src/product-intelligence.mjs`, handoff modules | grounded repository inspection tests | local-real evidence | broader artifact capture/live product proof |
| EVIDENCE_GROUNDING | LOCAL_REAL | `src/evidence-grounding.mjs`, claim graph | hashes/claim quarantine tests | local-real | no external publication evidence |
| SYSTEM_AGENTIC_HANDOFF | LOCAL_REAL | `src/system-agentic-handoff-bridge.mjs` | versioned dry-run envelope tests | local persistent dry-run | live execution host |
| DISCOVERY | PARTIAL | `src/discovery*.mjs`, public observer | bounded HTTP/RSS/Atom tests | local observer/fixtures | continuous crawler fleet, platform search |
| AUDIENCE_INTELLIGENCE | PARTIAL | audience/channel fit modules | deterministic fit tests | advisory/local | live audience feedback |
| CHANNEL_INTELLIGENCE | LOCAL_REAL | channel policy/readiness modules | policy/readiness tests | bounded policy data | fresh platform proof |
| STRATEGY_ENGINE | PARTIAL | `src/strategy.mjs`, learning modules | deterministic NBA/UNKNOWN tests | local/advisory | outcome-driven adaptation |
| CONTENT_ENGINE | PARTIAL | content/product intelligence modules | exact bytes/hash/grounding tests | local-real drafts | adaptive contextual generation/live package |
| CONTEXTUAL_ENGAGEMENT | DESIGN_ONLY | continuity/context projections | read-only tests | advisory only | bounded comment/reply execution + verification |
| ACCOUNT_REGISTRY | LOCAL_REAL | `src/account-agent-registry.mjs`, service projections | secret-safe deterministic projections | bounded metadata | live authorized pool |
| ACCOUNT_SELECTOR | LOCAL_REAL | selector/authority modules | deterministic selection tests | local deterministic | live health/failover |
| SESSION_RUNTIME | PARTIAL | `src/execution-session.mjs`, Camoufox/GPM seams | binding/transport tests | injected/synthetic protocol | live attach/reattach |
| MULTI_ACCOUNT_RUNTIME | PARTIAL | registry, selector, leases | local pool tests | single-pool fixtures | many-account operation |
| LINKEDIN_ADAPTER | PARTIAL | `src/linkedin-adapter.mjs`, readiness/verifier | dry-run and safety gates | local/ORCA fixtures | fresh irreversible proof |
| BROWSER_TRANSPORT | PARTIAL | router, ORCA, Camoufox, GPM transport modules | reversible fixture certification | local reversible | production certification |
| ORCA_RUNTIME | LOCAL_REAL | `src/orca-browser-client.mjs` | historical 1.4.237 ready/connected probe | live observation only | fresh action certification |
| STANDING_CAMPAIGN_AUTHORIZATION | LOCAL_REAL | authority/bootstrap service | standing/renewal tests | local durable controls | effective live authority |
| ZERO_TOUCH_AUTHORITY_BOOTSTRAP | LOCAL_REAL | bootstrap/renewal paths | product-only and idempotence tests | isolated local | external permission/session |
| EXECUTION_WINDOW_GRANT_LEASE | LOCAL_REAL | window/grant/lease service | exact binding/consumption tests | local durable | fresh valid package |
| PUBLISH_VERIFICATION | PARTIAL | LinkedIn verifier/receipts | strict fixture verification | synthetic/local | real post ID/permalink |
| METRICS | PARTIAL | metrics collectors/projections | collector/retry tests | local/advisory | live provider snapshots |
| OUTCOME_ATTRIBUTION | PARTIAL | attribution/learning modules | verified/UNKNOWN isolation tests | local persisted evidence | verified outcome stream |
| LEARNING_LOOP | PARTIAL | outcome + strategy learning | UNKNOWN dominance tests | advisory/local | measured live outcomes |
| MISSION_CONTROL | LOCAL_REAL | `src/server.mjs`, `src/service.mjs`, `ui/src/App.tsx` | API GET + UI build; advisory accountAgents patch | local projection | deployed source match/engineering ledger |
| RESTART_RECOVERY | PARTIAL | store/lease/soak/session modules | local dry-run restart tests | local fixtures | live browser reattach/soak |
| 24_7_READINESS | BLOCKED | schedulers/queue/soak scripts | no provider soak | none | certified runtime + long soak |
| MULTI_PLATFORM_SUPPORT | DESIGN_ONLY | adapter registry + worker branch foundations | contracts only | design/contracts | integrate/certify platforms |

## Zero-touch bootstrap

`repo/product`: CALLER_REQUIRED. `campaign`, `product binding`, `evidence-grounded content`, `exact payload bytes`, `content hash`, `canonical audience`, `UTC bounds`, `schedule`, `execution authorization`, `window`, `grant`, `lease`, `execution request`: AUTO_DERIVED when exact bounded inputs and authority exist. `LinkedIn target`, `account/profile`, `standing authorization`: EXTERNAL_AUTHORITY_REQUIRED. `media declaration`: CALLER_REQUIRED (safe no-media default; media requires policy). No deterministic ID/hash/timestamp is an external blocker.

## Canonical service/deployment

- `MAIN_MERGED=NO`; `CANONICAL_DEPLOYED=UNKNOWN`.
- `SERVICE_SOURCE_COMMIT=unknown`; `REPO_MAIN_COMMIT=98a499e25c2fab75de6aef85f265e6c2a7364651`; `SOURCE_MATCH=UNKNOWN`.
- `STATE_SCHEMA=8`; `STATE_REVISION=73653`; `STATE_HASH=not recomputed in this audit`.
- `RESTART_PROOF=local dry-run/restart tests PASS; live source/restart proof UNKNOWN`.
- `ROLLBACK_READY=historical main/integration commits available; no release deployment performed`.

## Blocker reconciliation

| Blocker | Current status | Class | Evidence | Software remediation | True external input | Next action |
|---|---|---|---|---|---|---|
| `ORCA-RUNTIME-CONFIG-001` | RESOLVED/stale | software/config | installed pinned ORCA read-only evidence | YES, complete | NO | retain probe/pin |
| `LIVE-LINKEDIN-AUTH-001` | OPEN | external authority | effective auth/window/grant/lease `0/0/0/0` | contracts complete | YES | supply fresh authorized package |
| `ORCA-TRANSPORT-LIVE-CERT-001` | OPEN | environment/provider evidence | no fresh irreversible certification; GPM unavailable | seam/tests complete | YES for live proof | certify reversible transport with fresh session |
| `METRICS-CHECKPOINT-LIVE-001` | QUARANTINED | provider observation | no live metric snapshots | partial software exists | YES provider access | authorize/attach live metric source |
| `PRODUCT-FACTORY-SANDBOX-001` | OPEN | environment/safety | sandbox checks unsupported, execution ineligible | adapter exists | YES audited sandbox capability | provide attested bounded backend |
| `AUTO-GTM-FEED-001` | OPEN | software/integration | `feed_not_generated`, no producer export | YES | NO if producer contract is implemented | define producer-owned versioned export |
| `DEPLOYED-SOURCE-PROVENANCE-001` | OPEN | software/operations | live `sourceCommit=unknown`, dirty source unproven | YES | NO | controlled restart/provenance verification |
| `ENGINEERING-LOOP-PROJECTION-001` | OPEN | software/product | no engineering ledger projection in dashboard | YES | NO | add bounded ledger projection after release scope |

## Truthful classification

`CURRENT_PRODUCT = FOUNDATION_ONLY`

This is a bounded local distribution runtime with real contracts, durable state, deterministic bootstrap/authority logic, read-only discovery/strategy/content intelligence, strict execution fences, and local reversible transport evidence. It is not a live-proven autonomous distribution OS, not production-ready, and not 24/7 ready.

## Recommended next action

Prepare a clean release candidate from the current dirty wave, then perform a controlled non-social restart solely to prove source provenance and state recovery. Separately obtain the smallest external package needed for fresh authorized, reversible transport certification. Do not retry six UNKNOWN submissions or perform irreversible publication during this audit.

### Additional current host verification

- ORCA executable `/Applications/Orca 2.app/Contents/Resources/bin/orca`, installed version `1.4.242`; read-only `status`: app running, runtime READY/REACHABLE/CONNECTED. No restart or browser command issued. Prior reports of 1.4.237 are historical and stale.
- All `src/*.mjs` passed `node --check`.
- Repeated `npm --prefix ui run build` passed with Vite 8.0.5.
- `git diff --check` passed after the UI patch and report update.
- Effective authority counts remain 0/0/0/0. For exact standing authorization/effective window/grant/lease semantics, inspect the `authority` projection in `/api/dashboard`; `/health` does not expose it.

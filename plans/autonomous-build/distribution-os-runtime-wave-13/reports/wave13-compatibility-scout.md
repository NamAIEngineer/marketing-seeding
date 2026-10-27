# Wave 13 Compatibility Scout

## Unverified first

- No live GPM/ORCA/browser/profile attach, host attestation, social navigation, publication, deploy, merge, or state migration was performed.
- The branch is not clean: Wave 13 builder work is present as commits `7b170b6` and `b260f8f` plus unstaged `src/linkedin-adapter.mjs` and `test/linkedin-verification.test.mjs`, and untracked Wave 13 plan/pin/report files. No source edits were made by this scout.
- Current tests prove isolated contracts and adapter selection behavior; they do not prove server/JEV live wiring or real provider lifecycle.

## FACT

### Commit and path map

| Wave | Commit/base | Owned changes | Current relation |
|---|---|---|---|
| Wave 10 RC | `2e4d72f` | `GpmExecutionSession`, GPM browser session/coordinator composition, capability projection/server wiring | Current branch HEAD base. Canonical starting point. |
| Wave 11 | `eed9893` | `ui/src/App.tsx`, dashboard UI test, report | Descendant of `2e4d72f`; additive UI only. |
| Wave 12 | `b080e46` | `src/execution-session-bridge.mjs`, `src/jev-execution-worker.mjs`, bridge test/report | Separate branch based on `2e4d72f`; not an ancestor of current branch. Selective reimplementation required. |
| Wave 13 | `7b170b6`, `b260f8f` | `ExecutionSession`, generic `ExecutionTransport`, `GpmExecutionTransport`, JEV resolver/identity fence, focused tests/reports | Current branch commits based on `2e4d72f`; current adapter changes remain unstaged. |

Wave 11 is independent UI and can be cherry-picked after the runtime work without source conflict. Wave 12 changes the same JEV worker seam that Wave 13 must integrate; blindly cherry-picking it would omit the new session contract and preserve an adapter-consumption gap.

### Authoritative contracts

- Wave 10 remains authoritative for exact account/profile selection, `GpmSessionCoordinator` acquire/release ownership, `GpmBrowserSession` attach identity checks, and read-only capability projection.
- Wave 13 `ExecutionSession` is authoritative for immutable lifecycle, platform/account/profile binding, expected identity, capabilities, attestation, and expiry checks.
- Wave 13 `ExecutionTransport` is the provider-neutral interaction surface. `GpmExecutionTransport` owns injected protocol attach, observed identity matching, attestation gate, challenge/stale failure, pre-click validation, and idempotent detach.
- Existing `browser-interaction-transport.mjs` certification and `assertTransportCannotChangeAfterIntent` remain authoritative for durable submit identity and pre-provider validation.
- Existing `LinkedInAdapter` remains authoritative for LinkedIn readiness/composer/content/target/submit/verification semantics. Its current unstaged injection change makes an injected `{ transport, browserSurface }` authoritative and prevents certified transport re-selection.
- `b260f8f` adds an optional `executionSessionResolver` to `JevExecutionWorker`, passes session/transport metadata to the adapter, fences submit identity, and releases in `finally`. `src/server.mjs` does not construct or inject this resolver, so production wiring remains absent.

### Compatibility matrix

| Capability | Wave 10 | Wave 11 | Wave 12 | Wave 13 current | Decision |
|---|---|---|---|---|---|
| GPM selection/attach/release | `GpmExecutionSession` + coordinator | unchanged | generic bridge provider seam | new transport requires injected refs/protocol | Preserve Wave 10 ownership; adapt provider into Wave 13 session. |
| Read-only capability UI | dashboard projection/UI | UI panel in `App.tsx` | none | none | Cherry-pick Wave 11 independently; no runtime conflict. |
| Provider-neutral session | absent | absent | `ExecutionSessionBridge` returns ad hoc bounded object | immutable `ExecutionSession` | Reimplement Wave 12 bridge output using `ExecutionSession`; do not blindly merge ad hoc bridge. |
| Generic transport | router/browser interaction contracts | absent | router only | `ExecutionTransport` + GPM implementation | Use Wave 13 transport; retain existing certification helpers. |
| LinkedIn consumption | ORCA-owned adapter | unchanged | worker passes `executionSession`, adapter ignores it | unstaged adapter selects injected transport | Complete adapter surface/browser-surface integration before claiming A4. |
| JEV worker | no bridge | unchanged | optional ad hoc bridge resolver | `b260f8f` resolver acquire/release/frozen identity | Retain `b260f8f` seam but resolve a typed `ExecutionSession`; wire server injection. |
| Durable intent freeze | existing adapter/service checks | unchanged | worker bridge identity check | adapter injected transport prevents reselection | Keep both worker and adapter checks; add exact identity equivalence test. |
| Lifecycle/detach | GPM coordinator/browser session release | unchanged | bridge release only | GPM transport detach, but no worker call-site | Define one owner: adapter/session release must invoke transport detach before coordinator release. |

### Test impact observed

Current focused command:

```text
node --test test/execution-session-transport.test.mjs test/linkedin-verification.test.mjs test/jev-execution-worker.test.mjs
89 total, 89 pass, 0 fail, 0 skipped
```

Additional baseline-focused run (transport, GPM session/browser, browser transport, JEV): **66 total, 66 pass, 0 fail, 0 skipped**.

Existing relevant tests include:

- `test/gpm-execution-session.test.mjs`: exact selector/coordinator/attach/release and secret-free handle behavior.
- `test/gpm-browser-session.test.mjs`: missing/mismatched/challenge/unknown identity and attach failure.
- `test/gpm-session-coordinator.test.mjs`: health, lease, cleanup, and bounded runtime identity.
- `test/browser-interaction-transport.test.mjs`: certification, attestation/runtime version, stale/overlay preflight, frozen transport identity.
- `test/linkedin-verification.test.mjs`: readiness/composer/submit/verification, no-click gates, transport certification, identity mutation, and current injected transport constructor assertion.
- `test/jev-execution-worker.test.mjs`: lease/readiness/live authorization, pre-submit stop, submit uncertainty, no duplicate dispatch, dry-run, and reconciliation.
- `test/service.test.mjs`, `test/readiness-execution.test.mjs`, `test/dry-run-restart-soak.test.mjs`: restart persistence, readiness, execution state, and UNKNOWN quarantine.

Missing acceptance coverage:

- No test wires `GpmExecutionTransport` through a real `ExecutionSession` into `JevExecutionWorker` and `LinkedInAdapter` end to end.
- No test proves injected transport methods are used for LinkedIn navigation, identity/readiness, composer, target resolution, activation observation, verification, and detach.
- No test proves server construction injects one selected session/transport into worker/adapter.
- No restart/detach test spans an attached Wave 13 transport and Wave 10 coordinator release.
- No test proves attestation freshness/expiry beyond session expiry and required static attestation fields.
- No full suite run was requested for this scout; only read-only source/test inspection and focused gates were run.

## INFERENCE

### Conflicts and selective merge decisions

1. **Do not cherry-pick Wave 12 wholesale.** Its `ExecutionSessionBridge` produces an ad hoc object, carries `handle.transport` without a provider-neutral contract, and its JEV hook is absent from this branch. Reimplement its route/acquire/release and frozen identity checks on `ExecutionSession`/`ExecutionTransport`.
2. **Do not replace Wave 10 GPM composition.** Wrap or adapt `GpmExecutionSession`/coordinator ownership into the Wave 13 transport/session seam; preserve its exact cleanup and profile binding.
3. **Keep Wave 11 UI additive.** Cherry-pick `eed9893` after runtime integration if dashboard delivery is required; it has no source overlap with transport/worker files.
4. **Retain existing LinkedIn certification.** Injected transport must be the sole candidate; certified submit still requires the existing explicit contract and runtime evidence. No ORCA fallback after injection.
5. **Worker integration order:** construct/validate `ExecutionSession`; acquire selected transport; inject `{ session, transport, browserSurface }` into the adapter; run adapter lifecycle; invoke transport detach; release Wave 10 coordinator handle in one `finally`; preserve UNKNOWN quarantine and durable intent freeze.

### Recommended exact merge/reimplementation order

1. Start at `2e4d72f`.
2. Keep/cherry-pick Wave 10 runtime commits already present.
3. Retain Wave 13 `7b170b6` as the provider-neutral contract layer.
4. Complete and verify the unstaged LinkedIn adapter injection seam, then add worker/server wiring as a new selective reimplementation of Wave 12.
5. Add end-to-end worker/adapter/lifecycle/restart/UNKNOWN tests before any certification package.
6. Cherry-pick Wave 11 `eed9893` independently if UI capability display is part of the release.
7. Run focused gates, full suite, syntax/diff/UI checks; only then prepare the harmless certification package.

## UNKNOWN

- Actual provider protocol shape, host/runtime attestation source, and whether the injected protocol client can expose the browser surface required by LinkedIn readiness/verification.
- `src/server.mjs` still registers `LinkedInAdapter(orcaBrowser, ...)` and `JevExecutionWorker({ service, adapterRegistry, ... })` without a session resolver. No production path reaches `b260f8f` injection.
- `GpmExecutionTransport` exposes protocol methods but not the ORCA-shaped browser surface (`listTabs`, `showTab`, `waitForUrl`, `evaluate`, `fill`) required by `LinkedInAdapter`; the adapter builder explicitly fails closed until a compatibility facade exists.
- Whether the final worker should release transport via `detach`, adapter cleanup, or the Wave 10 coordinator, and how to guarantee exactly-once ownership across all failure paths.
- Whether existing server startup can construct the required GPM session provider without introducing live side effects.
- Full test totals after final Wave 13 worker/server integration.

## Acceptance linkage

- **C1:** Base remains `2e4d72f`; Wave 11/12 were reviewed selectively and no blind merge is recommended.
- **C7:** Current branch contains `7b170b6`, `b260f8f`, builder changes, and an unstaged adapter/test delta; independent verification must run only after final edits and a clean final diff. This report records the current boundary without altering it.
- **V4:** Independent inspection confirms immutable/fail-closed session/transport contracts, JEV identity fencing, and current adapter no-fallback injection. Server wiring and full injected worker/adapter consumption remain unproven; GPM browser-surface compatibility is explicitly missing.

Status: DONE_WITH_CONCERNS
Summary: Wave 10 contracts remain compatible; Wave 11 is additive; Wave 12's bridge is selectively represented by Wave 13's typed session plus `b260f8f` worker resolver. Focused gates pass, but server wiring and GPM browser-surface integration remain unproven.
Concerns/Blockers: `src/server.mjs` does not inject an execution-session resolver; `GpmExecutionTransport` lacks the ORCA-shaped browser surface required by LinkedIn; transport detach ownership and provider attestation freshness remain unspecified.

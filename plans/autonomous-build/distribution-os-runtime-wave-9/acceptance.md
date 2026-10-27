# Distribution OS Runtime Wave 9 — GPM attach seam and session readiness projection

## Requirements

- **A1** Add a provider-neutral GPM browser session attach seam behind an injected client/attach function. The seam must expose bounded runtime identity and required browser primitives without starting profiles, logging in, navigating, clicking, or submitting during construction.
- **A2** Bind an attached session to the exact platform/account/profile selection and fail closed on missing, mismatched, challenge, or unknown identity. Never infer identity from profile names, tags, versions, or endpoint metadata.
- **A3** Add a read-only session readiness projection for Mission Control from existing execution-account metadata and optional observed session state. It must not create leases, mutate authority, or call GPM lifecycle endpoints.
- **A4** Preserve the irreversible-submit fence: transport identity/certification must be selected before durable submit intent; no silent transport/account fallback after intent; UNKNOWN remains quarantined.
- **A5** Add focused tests and release evidence. No live GPM, ORCA, browser, LinkedIn, social, canonical deployment, merge, or publish operation.

## Constraints

- **C1** Workers use isolated worktrees and disjoint paths; workers do not merge to `main`, deploy, publish, or mutate canonical runtime state.
- **C2** No raw cookies, passwords, tokens, storage, proxy material, profile IDs, or session secrets in outputs, UI, reports, or returned handles.
- **C3** Attach and readiness tests use injected fakes only. No CDP/WebSocket connection, profile start/stop, login, navigation, click, or social action.
- **C4** Existing UNKNOWN executions, active ORCA/GPM processes, main/integration refs, and Wave 8 RC remain untouched.

## Verification

- **V1** Independent verifier reads each lane against this pin and checks exact path scope, secret safety, and no-op side effects.
- **V2** Wave 9 RC runs focused gates, syntax, diff checks, and the full Node suite if integration completes.
- **V3** Release report distinguishes fake attach/readiness proof from live provider identity, browser execution, publication, metrics, and 24/7 evidence.

## Dispatch trace

- Run: `distribution-os-runtime-wave-9-20261023`
- Baseline: Wave 8 RC `f46a3db`
- Controller: `/root`
- Independent verifier: release verifier lane, read-only after final integration

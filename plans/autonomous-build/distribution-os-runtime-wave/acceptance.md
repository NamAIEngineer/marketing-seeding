# Distribution OS Runtime Wave — Acceptance

This wave extends the existing bounded foundation with provider-neutral runtime
selection, isolated browser capability probes, bounded product capture planning,
and read-only account/runtime projections. It does not publish, deploy, merge to
`main`, alter the active ORCA session, or introduce a live social mutation.

## Requirements

- **A1** Provide a provider-neutral Browser Runtime Router that selects a
  transport from workload policy before any irreversible intent and exposes only
  bounded interaction capabilities and runtime identity.
- **A2** Provide concrete GPM Chrome and Camoufox transport seams plus explicit
  ORCA transport registration. Missing executables, endpoints, profiles, or
  sessions must produce a typed unavailable/unknown result; no synthetic READY
  state may be emitted.
- **A3** Provide a bounded Product Factory browser capture plan/execution seam
  that records source commit, run identity, artifact hash, capture time, and
  runtime identity, while keeping arbitrary repository execution and media
  generation fail-closed unless a real backend is supplied.
- **A4** Provide bounded account/session registry and deterministic selector
  projections that expose references and eligibility without secrets, and a
  read-only Mission Control projection for route/account/capture state.
- **A5** Preserve existing command/activation/acceptance/publication evidence
  distinctions and transport failover fencing; no new path may silently retry an
  irreversible submission.
- **A6** Add focused tests for the new seams and run the requested safe gates in
  the release candidate after integration.

## Constraints

- **C1** Workers use isolated worktrees with disjoint ownership; builders do not
  merge to `main`, deploy, publish, or modify canonical runtime state.
- **C2** No raw cookies, passwords, tokens, active profile data, or secrets may
  enter source, reports, fixtures, or model-facing output.
- **C3** GPM, Camoufox, and arbitrary Product Factory execution are not called
  production-ready without runtime evidence; capability probes must fail closed.
- **C4** Keep the current ORCA history, UNKNOWN executions, and dirty integration
  worktree intact.
- **C5** Changes must be reversible and local; no migrations or irreversible
  external actions are in scope.

## Verification criteria

- **V1** An independent verifier reads each worker diff against its pin and
  acceptance IDs, checks for foreign changes/secrets/no-op output, and reruns the
  focused gates after the final edits.
- **V2** The integration owner runs the full Node suite, syntax checks, UI
  typecheck/build, and `git diff --check` without external side effects.
- **V3** The final report states what remains unverified, separates local-real
  capability from synthetic/fixture behavior, and does not claim live
  publication or 24/7 readiness.

## Dispatch trace

- Run: `distribution-os-runtime-wave-20261023`
- Baseline pin: integration commit `689967903aea51a4935659c33c2fcc8513ef8565`
- Builder attempts: assigned in per-lane task packets and marker files.
- Independent verifier: assigned after builders complete; builder reports are
  treated as claims until direct re-check.

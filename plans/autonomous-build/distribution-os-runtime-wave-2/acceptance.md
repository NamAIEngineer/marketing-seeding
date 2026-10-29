# Distribution OS Runtime Wave 2 — Acceptance

This wave integrates the bounded runtime seams into capability probes and the
read-only Mission Control boundary. It does not start profiles, browse external
sites, publish, mutate canonical state, deploy, or merge `main`.

## Requirements

- **A1** Provide a read-only GPM Local API/profile capability probe that
  discovers a configured endpoint dynamically, returns typed `READY`/
  `UNKNOWN`/`UNAVAILABLE`, and exposes only bounded profile/session metadata.
- **A2** Provide a Camoufox public observer adapter that uses an explicitly
  supplied isolated transport, validates public destinations, and fails closed
  when the runtime or transport is unavailable. It must not attach to
  authenticated profiles or claim publication proof.
- **A3** Integrate the provider-neutral runtime router into the service
  projection boundary so Mission Control can show workload route, runtime
  identity, and health without business logic selecting browser implementations.
- **A4** Preserve durable submit-intent transport fencing, UNKNOWN quarantine,
  and existing account/authority semantics. No new submit or retry path is
  allowed.
- **A5** Add focused tests and fresh regression evidence; clearly separate
  fixture/local-real capability from installed runtime proof.

## Constraints

- **C1** Workers use isolated worktrees and disjoint ownership; no merge,
  deploy, publish, canonical state mutation, ORCA restart, or external account
  action.
- **C2** No raw cookies, passwords, tokens, profile secrets, or private session
  data may be persisted or returned.
- **C3** GPM/Camoufox probes must not create/delete/start profiles; endpoint
  discovery is read-only and injected in tests.
- **C4** Public observer must reject localhost/private/reserved destinations and
  must not use authenticated execution profiles.
- **C5** Existing integration worktree dirty changes and six UNKNOWN executions
  remain untouched.

## Verification criteria

- **V1** Independent direct inspection reruns every focused test after final
  edits and checks untouched paths against each worker pin.
- **V2** RC full Node suite, syntax, diff-check and applicable UI gates run after
  integration.
- **V3** Report lists runtime components still unavailable and does not claim
  live publication, arbitrary factory execution, or 24/7 readiness.

## Dispatch trace

- Run: `distribution-os-runtime-wave-2-20261023`
- Baseline: `wave/distribution-os-runtime-rc` commit `95bca86dd35259bb16c4e9247210b52403159f8d`
- Independent verifier: controller-side direct review after worker reports.

# Distribution OS Runtime Wave 10 — Acceptance

## Identity

- Run: `distribution-os-runtime-wave-20261023`
- RC branch: `wave/distribution-os-runtime-wave-10-rc`
- Baseline: Wave 9 RC `037609e`
- Scope: bounded GPM session composition and read-only capability projection

## Requirements

- **A1** Compose deterministic account selection, GPM coordinator acquire,
  exact profile binding, browser attach, and owned release into one bounded
  session seam.
- **A2** Attach failure performs one coordinator cleanup; foreign and duplicate
  release attempts fail closed without a second cleanup.
- **A3** Project observed GPM provider/runtime/session capability as read-only;
  exact provider/runtime identity, healthy state, and challenge-free evidence
  are required for `AVAILABLE`.
- **A4** Preserve secret-free bounded handles and projections; no raw profile
  identifiers, credentials, cookies, tokens, or browser clients are exposed.
- **A5** Keep all construction and tests inert: no profile start, browser/CDP
  attach, ORCA mutation, social action, authority creation, or canonical state
  write.

## Constraints

- **C1** Do not modify `main`, merge, deploy, or mutate canonical runtime state.
- **C2** No live GPM, ORCA, browser, network, login, or social operation.
- **C3** Reuse existing account selector, coordinator, and browser-session seam;
  no second store, router, or publisher.
- **C4** Worker reports are claims until independent verification reruns checks
  after the final RC change.

## Verification

- **V1** RC contains only the two declared worker commits plus this acceptance
  record and has no foreign source changes.
- **V2** Focused Wave 10 tests pass with zero failures or skips; syntax and diff
  checks pass.
- **V3** Independent verifier confirms exact cleanup/release ownership,
  fail-closed projection, secret exclusion, and no side effects.
- **V4** Existing Wave 9 gates remain preserved; live provider/publication and
  24/7 readiness remain unproven.

## Pin

- Baseline commit: `037609e`
- Worker commits: `6708079`, `f58fc8b`
- RC commits: `0ca1218`, `3f8ef37`

## Status

Status: IN_PROGRESS

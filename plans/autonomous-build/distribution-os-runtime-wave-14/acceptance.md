# Wave 14 — bounded GPM CDP protocol seam

## Requirements

- A1. Add a provider-specific GPM CDP protocol client behind an injected,
  secret-free endpoint/session authority; construction performs no I/O.
- A2. Keep the client provider-neutral at the transport boundary and expose only
  bounded browser operations required by `GpmExecutionTransport`/LinkedIn.
- A3. Require explicit endpoint/profile/session binding and fail closed on
  malformed endpoints, missing authority, unsupported protocol responses,
  identity mismatch, timeout, or disconnect.
- A4. Never extract or persist cookies, passwords, tokens, storage state, or
  raw session secrets; sanitize all returned metadata and errors.
- A5. Add deterministic fake-WebSocket tests for attach, target selection,
  navigation/evaluation, browser surface, timeout/disconnect, and detach.
- A6. Preserve Wave 13 behavior and historical UNKNOWN immutability.

## Constraints

- C1. No live GPM profile start/stop, CDP attach, browser navigation, login,
  social mutation, Post click, publication, merge, deploy, migration, or restart.
- C2. Do not modify Wave 13 files while the builder owns the new client lane.
- C3. No hard-coded GPM port; endpoint must be injected and sanitized.
- C4. No credentials, cookies, access tokens, or session secrets in contracts,
  logs, reports, or tests.

## Verification

- V1. Builder tests pass with zero failures and no live provider calls.
- V2. Independent review checks protocol framing, secret boundaries, timeout,
  disconnect, and no-I/O construction.
- V3. Wave 13 focused tests and full suite remain green after integration.
- V4. Diff/status show no canonical state or UNKNOWN mutation.

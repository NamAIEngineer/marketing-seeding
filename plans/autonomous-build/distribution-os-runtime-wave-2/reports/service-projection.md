# Service / Mission Control Runtime Projection

## Acceptance IDs addressed

A3, A4, A5.

## Summary

Integrated a pure browser-runtime route/health projection into `SeedingService`
and server construction. Mission Control now receives workload route, transport
identity, health and reason fields. The UI displays these as read-only context;
it does not expose transport selection, login, profile start, Post, or approval
controls.

## Evidence

- `src/runtime-projection.mjs`
- `src/service.mjs`, `src/server.mjs`
- `ui/src/App.tsx`
- Projection/server/service/UI-focused tests pass.

## Confidence

Confident that the projection is read-only and the server wires the router
without changing submit contracts. GPM/Camoufox runtime health remains
`UNAVAILABLE`/`UNKNOWN` until the host supplies real endpoints/executables.

## Out-of-scope noticed

No service restart, live browser action, account mutation, deployment, or
canonical runtime state change.

Status: DONE_WITH_CONCERNS
Summary: Mission Control now observes runtime routing and health; operational runtime integration remains bounded.
Concerns/Blockers: UI build/typecheck cannot run in this checkout because UI dependencies are absent.

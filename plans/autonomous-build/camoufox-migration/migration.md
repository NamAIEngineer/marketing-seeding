# Camoufox execution migration

## Scope completed in this slice

The active authenticated workload policy now selects `camoufox`. GPM remains
available only to read historical/provider-neutral code and cannot be selected
by the default authenticated route.

The new `CamoufoxExecutionTransport` and
`CamoufoxExecutionSessionResolver` reuse the existing `ExecutionSession`,
`ExecutionTransport`, binding, readiness, worker, durable submit, freeze, and
quarantine contracts. They accept an injected protocol client and profile
coordinator only. Construction does not start a browser, create a profile,
authenticate, read a credential store, or perform page input.

## Binding contract

Every attached session must match:

`platform + accountId + provider=camoufox + providerProfileId + verified identity`

The observed protocol identity must match the same values. Provider selection
never uses UUID shape. Secret-like fields and values are rejected before attach.
Challenge, stale, unknown, unavailable, profile, account, or identity drift
fail closed. Detach is idempotent. The worker rejects provider-aware Camoufox
live execution when no exact resolver is present; it cannot fall back to ORCA.

## Before / after

| Boundary | Before | After |
| --- | --- | --- |
| Authenticated workload route | GPM | Camoufox |
| Live session source | GPM resolver when configured, otherwise unsafe compatibility risk | Explicit Camoufox resolver only |
| Transport selection | Provider-neutral safety already present | Same safety, injected Camoufox transport |
| Browser runtime | ORCA host surface in server wiring | No automatic fallback; runtime attach still external |
| Historical UNKNOWN rows | Immutable | Immutable |
| Canonical state | Revision 54861 | Unchanged |

## Invalidation rules

Invalidate a Camoufox session when host attestation expires, profile identity
changes, observed social identity changes, provider/profile differs, the
protocol reports a challenge/stale/unknown state, or the transport detaches.
Invalidate readiness and execution controls when the normal provider-neutral
binding or freshness checks fail.

## Rollback

Rollback is source-only: revert the Camoufox migration commit and restore the
previous router policy. Do not mutate canonical execution rows, grants,
windows, receipts, publication attempts, or UNKNOWN quarantine. Do not revive
GPM live execution without a separately reviewed authority and runtime proof.

## Not included

The host currently has no confirmed Camoufox executable, supported protocol
client, authenticated profile mapping, restart proof, or LinkedIn live proof.
No launcher, profile creation, login, authority, execution control, durable
submit intent, or publication was added in this slice.

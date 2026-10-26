# Provider-aware account and target binding migration plan

## Scope

This is a planning artifact only. It does not edit canonical state, create
authority or execution controls, acquire leases, or touch historical UNKNOWN
records.

## Before

Legacy execution rows identify a destination with:

```text
platform + accountId + profileId + targetId
```

The historical compatibility lane is ORCA. Its provider is explicit in the
adapter contract even when old persisted rows omit the provider field. The
canonical account ID remains `linkedin_primary`; the legacy ORCA profile and
the GPM profile are separate provider bindings.

## After

New provider-aware rows carry one complete immutable binding:

```text
platform
accountId
provider
providerProfileId
verified identityReference
targetId
exact targetUrl
```

The binding is propagated through account registry, target, campaign
authorization, readiness digest, execution request, one-time window, live
grant, lease/profile key, session resolver, worker, submit-intent fence, and
receipt. `profileId` remains a storage compatibility alias; it never selects a
provider. A provider is never inferred from UUID shape.

## Expand and isolated migration

1. Create an isolated copy of the candidate state in a temporary store. Keep
   the original canonical file read-only.
2. Read legacy account/target/authorization rows. For each row, derive the
   explicit compatibility provider `orca` only when the row has no provider
   fields and is already in the legacy ORCA lane.
3. For a non-ORCA row, require an issuer-supplied `provider`, exact
   `providerProfileId`, verified identity URL, and exact target URL. Never
   derive these from a profile name, UUID shape, or browser metadata.
4. Add fields atomically to the isolated copy. Recompute readiness,
   authorization, window, grant, request, lease, and receipt fingerprints from
   the complete binding.
5. Run the binding audit before any control can become eligible. The audit
   must report zero provider/profile/account/identity/target drift and zero
   same-provider profile collisions. It must retain the canonical account ID
   and all six historical UNKNOWN identities byte-for-byte.

## Verification gates

- Correct GPM binding passes isolated governance.
- Legacy ORCA binding remains accepted through the explicit compatibility lane.
- Same profile ID under another provider is rejected.
- Account, provider, profile, identity, target, target URL, stale readiness,
  stale authority, wrong candidate head, quota, cadence, concurrency,
  duplicate, lease, and UNKNOWN fences fail closed.
- A transport change after durable submit intent is rejected.
- No isolated test writes to the canonical state path.

## Invalidation rules

Invalidate the affected authorization/window/grant/request package when any of
these changes:

- provider or provider profile ID;
- canonical account ID;
- verified social identity URL;
- target ID or exact target URL;
- content identity or payload hash;
- authority validity, issuer, signature, or candidate head;
- host attestation or transport certification freshness;
- readiness binding, expiry, or evidence digest;
- lease owner or execution binding.

Invalidation is terminal for that package. It must create a fresh package under
a new identity; it must not edit a consumed control or revive an UNKNOWN.

## Rollback

Rollback is a deployment operation, not part of this change. Before applying a
future migration, take a canonical state backup and record its SHA-256, schema,
revision, and protected UNKNOWN IDs. If the isolated verification fails,
discard the isolated copy. If a deployed migration fails, stop dispatch,
restore the reviewed backup, verify the recorded SHA/revision/UNKNOWN set,
then resume only after a new review. Never roll back by mutating an individual
historical UNKNOWN or by reusing its execution/window/grant/publication ID.

## External authority prerequisite

The issuer/verifier must issue a fresh authority package after the final
candidate commit is known. The package must bind the exact candidate HEAD,
provider, GPM profile, account, verified identity, target, content policy,
visibility, validity bounds, quota, cadence, and concurrency. Do not edit the
old package's candidate head, TTL, or signature. Refresh short-lived host
attestation immediately before the next preflight.

## Application status

Not applied. No canonical mutation, live authorization/window/grant/lease/
execution, durable submit intent, or social action is permitted by this plan.

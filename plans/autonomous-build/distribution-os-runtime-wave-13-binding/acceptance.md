# Wave 13 binding repair — provider-aware account/target governance

## Requirements

- A1. Preserve the canonical account ID `linkedin_primary` and existing legacy
  ORCA records while allowing an explicitly declared GPM account binding.
- A2. Represent one execution binding as platform, canonical account ID,
  provider, provider profile ID, verified social identity URL, and exact target.
- A3. Propagate and verify that binding through account registration, target,
  authorization, readiness, execution request, window, grant, session resolver,
  governance, worker, and receipt/evidence paths.
- A4. Reject provider/profile/account/identity/target drift and same-profile-ID
  collisions across providers; never select a provider from UUID shape.
- A5. Preserve transport freeze after durable submit intent, quota/cadence,
  duplicate protection, and historical UNKNOWN quarantine.

## Constraints

- C1. Use isolated state only. Do not mutate canonical state, six historical
  UNKNOWN executions, live controls, leases, grants, windows, or executions.
- C2. Keep legacy ORCA behavior compatible through an explicit legacy adapter;
  generic business logic must not branch on GPM or ORCA.
- C3. No final Post click, durable submit intent, retry, reconciliation,
  deployment, merge, or publication.
- C4. No provider inference from UUID shape and no credential/session secret
  persistence.

## Verification

- V1. Isolated GPM binding passes governance with exact provider/profile/
  identity/target fields.
- V2. Legacy ORCA binding remains accepted; same UUID with another provider and
  every account/profile/identity/target mismatch fail closed.
- V3. Stale authority, candidate head, readiness, transport-switch-after-intent,
  quota, duplicate, and UNKNOWN fences remain enforced.
- V4. Focused binding/governance/session/worker/receipt tests and full `npm test`
  pass with zero failures.
- V5. Migration plan records expand, isolated migration, verification,
  invalidation, rollback, and the external issuer/verifier blocker without
  applying canonical state changes.

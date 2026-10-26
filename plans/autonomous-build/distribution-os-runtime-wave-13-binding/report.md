# Wave 13 provider-aware binding repair report

## Outcome

The rejection was a binding-contract failure, not a UUID-format failure. In the
previous authorization normalization, destinations retained platform,
account, and profile but discarded provider identity details, including the
exact target URL. Provider-aware matching requires both sides to contain the
same provider, provider profile, verified identity, target ID, and target URL;
the normalized authority therefore could not authorize the GPM target. The
execution layer also had legacy paths that compared `profileId` alone or
constructed a provider profile alias without declaring a provider.

The repair carries provider, provider profile, verified LinkedIn identity, and
exact target through execution while preserving canonical account ID
`linkedin_primary`. `profileId` remains a compatibility alias. UUID shape does
not select a provider. Legacy records without provider fields continue on the
ORCA compatibility lane; explicit GPM requests must carry their own provider
and provider profile at the final send fence.

## Trace and changes

The checked path is:

`execution account + target` → `destination normalization and authorization`
→ `provider-aware readiness digest` → `execution request, window, grant,
lease/profile key` → `GPM session resolver` → `worker injected session`
→ `LinkedInAdapter` → `durable submit fence` → `receipt and publication
evidence`.

The resolver and worker reject provider/account/profile/identity drift before
input. Governance and the send fence compare exact target ID and URL. The
durable submit fence rejects incomplete or changed GPM binding; transport
selection stays frozen after submit intent. Existing account-based quota,
cadence, concurrency, duplicate checks, and UNKNOWN quarantine retain their
canonical `platform + accountId` scope.

Changed source:

- `src/execution-binding.mjs`
- account registry, authorization, readiness, execution contracts, session and
  GPM session/transport modules
- worker, service, live grant, one-time window, standing delegation

Regression coverage:

- `test/execution-binding-governance.test.mjs`
- provider-aware fields and provider mismatch checks in
  `test/wave13-session-worker-e2e.test.mjs`
- GPM and legacy ORCA send-fence cases, including missing provider fields, in
  `test/service.test.mjs`
- existing transport-freeze, quota, duplicate, stale authority/readiness, and
  UNKNOWN quarantine suites

## Verification evidence

- Focused binding/GPM/session/worker/authorization/readiness/control suites:
  **95 pass, 0 fail**.
- Full `npm test`: **709 total, 707 pass, 0 fail, 2 skip**.
- `node --check` on changed modules: pass.
- `git diff --check`: pass.
- Canonical state read-only: schema `8`, revision `54861`, SHA-256
  `2ed58f8972072c9f5a0921830c0af6a1502b443017c0db2c2f82856f388eb1d7`;
  historical UNKNOWN `6`; execution leases `0`.
- Canonical state before and after this task has the same SHA and revision.
  No authorization, window, grant, lease, execution, durable submit intent,
  publication attempt, or Post click was created.

The two skips are existing environment/ACL skips. The fixture error printed by
one negative test is expected assertion output; the test passes.

## Migration status

See [migration.md](./migration.md). The migration is isolated and unapplied.
Canonical state and all historical UNKNOWN records remain unchanged.

## Remaining blocker

The repository has no external package issuer/signature verifier; the existing
`external-input.json` binds an older candidate HEAD. It must be replaced by a
new package from the authorized issuer/verifier bound to the committed
candidate HEAD. Do not edit the old candidate head, TTL, or signature. Refresh
short-lived host attestation immediately before the next preflight. Tests do
not authorize a controlled one-shot.

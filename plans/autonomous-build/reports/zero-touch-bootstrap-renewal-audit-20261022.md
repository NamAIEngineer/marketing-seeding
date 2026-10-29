# Zero Touch Bootstrap Renewal Audit — 2026-10-22

## Scope

Read-only source/test audit of `integration/autonomous-build` at the current HEAD. No canonical state mutation, credentials, browser/ORCA action, provider request, or external side effect.

## Finding

`bootstrapAutonomousCampaign(input)` can renew an expired persisted campaign schedule and derive fresh authorization/window/grant/request when called with a high-level brief. It does **not** currently auto-renew from persisted policy when the scheduler runs.

The queue path is:

```text
queueDueCampaignJobs
  -> expireLiveExecutionGrants
  -> expireOneTimeExecutionWindows
  -> expireCampaignAuthorizations
  -> materialize candidates
  -> queueAuthorizedCampaignJobs
```

It never calls `bootstrapAutonomousCampaign` (or an equivalent persisted-policy renewal helper). Once `expireCampaignAuthorizations` marks the standing authorization expired, queued posts are marked `blocked`; the subsequent queue path only evaluates existing post/authorization controls. No fresh authorization/window/grant is derived from `campaign.autonomousBootstrap` automatically.

## Persisted inputs available

`campaign.autonomousBootstrap` already persists enough high-level policy to derive a bounded renewal request without low-level runtime fields:

- canonical campaign/product identity through campaign fields (`productRepo`, `name`, `objective`, `audience`);
- platform, authorization reference, exact target/account/profile binding and visibility;
- schedule (`validFrom`, `validUntil`, quota, concurrency, cadence, timezone);
- product intelligence and latest story policy are persisted separately and can provide the bounded content policy (CTA, disclosure, language, audience serialization).

The bootstrap implementation already derives payload bytes, content identity/hash, target binding, schedule, authorization, window, grant and execution request. It also preserves terminal historical controls and refuses renewal when an exact candidate crossed dispatch or has immutable UNKNOWN history.

## Existing proof

`node --test test/campaign-bootstrap.test.mjs` passed **16/16**. Tests prove:

- explicit high-level bootstrap idempotence;
- expired schedule renewal with fresh authority;
- terminal authorization renewal before dispatch history;
- refusal when durable request/publication history exists;
- UNKNOWN content identity quarantine;
- stale window/grant renewal;
- queue repair for missing grant and stale pending window.

These tests invoke bootstrap directly. None proves a scheduler tick can renew solely from persisted campaign policy after authorization expiry.

## Minimal safe seam

Add a provider-independent helper that constructs a sanitized high-level bootstrap brief from a persisted campaign's `autonomousBootstrap`, campaign fields and latest bounded story policy. Invoke it from the campaign queue only when all of the following hold:

1. campaign is active and has `autonomousBootstrap.schemaVersion` supported;
2. no immutable UNKNOWN or durable submission/publication history blocks the exact candidate;
3. no active authorization exists for the campaign, or its schedule/controls are expired;
4. exact target/account/profile binding remains unchanged and eligible;
5. account/session readiness is fresh; otherwise return a blocked readiness result without creating authority;
6. campaign quota/cadence/concurrency policy remains bounded.

The helper must call the existing `bootstrapAutonomousCampaign` path, never reconstruct low-level hashes/bytes, and must preserve historical authorization/window/grant/request rows. Add synthetic tests for scheduler-driven renewal and for fail-closed behavior on UNKNOWN, ambiguous target, stale readiness and durable submission history.

## Why no patch was made

Calling the existing bootstrap from the queue creates authority and execution controls, so it is a safety-sensitive scheduler behavior change. The current queue intentionally has no such side effect and there is no existing persisted-policy brief builder or renewal-specific gate. Implementing this safely requires a shared contract decision about when a campaign's standing authority is allowed to self-renew. This audit therefore records the gap and seam without changing runtime behavior.

## Stop condition

Stopped after source/test audit; no external side effect or canonical runtime mutation occurred.

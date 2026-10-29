import test from "node:test";
import assert from "node:assert/strict";
import { createAccountRuntimeRegistry, selectAccountRuntimeCandidate } from "../src/account-runtime-registry.mjs";
import { bindingMatches, executionProfileKey, normalizeExecutionBinding } from "../src/execution-binding.mjs";
import { evaluateCampaignAuthorization, campaignContentHash, campaignAuthorizationFingerprint, campaignScopeFingerprint } from "../src/campaign-authorization.mjs";
import { isReadinessFresh, readinessBinding } from "../src/readiness.mjs";

const GPM_PROFILE = "82614dc6-2b75-4515-896c-32f73cb5ec51";
const IDENTITY = "https://www.linkedin.com/in/nam-ph%E1%BA%A1m-ph%C6%B0%C6%A1ng-b48897278";
const TARGET_URL = "https://www.linkedin.com/feed/";

function binding(overrides = {}) {
  return {
    platform: "linkedin", accountId: "linkedin_primary", provider: "gpm",
    providerProfileId: GPM_PROFILE, profileId: GPM_PROFILE,
    identityReference: IDENTITY, targetId: "target-fresh", targetUrl: TARGET_URL,
    ...overrides
  };
}

function governedState(overrides = {}) {
  const now = new Date();
  const target = {
    id: "target-fresh", channel: "linkedin", accountId: "linkedin_primary",
    profileId: GPM_PROFILE, provider: "gpm", providerProfileId: GPM_PROFILE,
    identityReference: IDENTITY, url: TARGET_URL, status: "active",
    readiness: {
      state: "READY", checkedAt: new Date(now.getTime() - 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      binding: readinessBinding(binding()), platform: "linkedin", accountId: "linkedin_primary",
      profileId: GPM_PROFILE, provider: "gpm", providerProfileId: GPM_PROFILE,
      identityReference: IDENTITY, targetId: "target-fresh", targetUrl: TARGET_URL
    }
  };
  const account = {
    id: "linkedin:linkedin_primary", platform: "linkedin", accountId: "linkedin_primary",
    profileId: GPM_PROFILE, provider: "gpm", providerProfileId: GPM_PROFILE,
    identityReference: IDENTITY, expectedIdentityUrl: IDENTITY, status: "enabled", health: "healthy"
  };
  const campaign = { id: "campaign-binding", status: "active", productRepo: "/tmp/product", objective: "binding", audience: [] };
  const content = "Fresh bounded certification copy.";
  const authorization = {
    id: "authorization-binding", campaignId: campaign.id, status: "active",
    validFrom: new Date(now.getTime() - 60_000).toISOString(),
    validUntil: new Date(now.getTime() + 60_000).toISOString(),
    destinations: [{ platform: "linkedin", accountId: "linkedin_primary", profileId: GPM_PROFILE,
      provider: "gpm", providerProfileId: GPM_PROFILE, identityReference: IDENTITY,
      targetId: target.id, targetUrl: target.url }],
    approvedAssets: [], contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash(content)] },
    audienceRules: { allowedAudiences: ["public"] },
    publicationVisibilityRules: { allowedVisibilities: ["PUBLIC"] },
    schedule: { timezone: "UTC", weekdays: [now.getUTCDay()], startLocal: "00:00", endLocal: "23:59" },
    rateLimits: { maxJobsPerAccountPerDay: 10, maxJobsPerCampaignPerDay: 10, maxConcurrency: 1, minIntervalMinutes: 0 },
    allowLiveExecution: true
  };
  authorization.campaignBinding = campaignScopeFingerprint(campaign);
  authorization.binding = campaignAuthorizationFingerprint(authorization);
  const post = {
    id: "job-binding", campaignId: campaign.id, targetId: target.id, content,
    contentId: "content-binding", audience: "public", publicationVisibility: "PUBLIC",
    campaignAuthorizationId: authorization.id, campaignAuthorizationBinding: authorization.binding,
    idempotencyKey: "idempotency-binding", status: "queued"
  };
  return { now, target, account, campaign, authorization, post, ...overrides };
}

test("provider-aware binding requires exact provider/profile/identity/target", () => {
  const expected = binding();
  assert.equal(bindingMatches(expected, { ...expected }), true);
  for (const [field, value] of [
    ["provider", "orca"], ["providerProfileId", "other-profile"], ["accountId", "other-account"],
    ["identityReference", "https://www.linkedin.com/in/other"], ["targetId", "other-target"], ["targetUrl", "https://www.linkedin.com/company/other"]
  ]) assert.equal(bindingMatches(expected, { ...expected, [field]: value }), false, field);
  assert.equal(executionProfileKey(expected), `linkedin:gpm:${GPM_PROFILE}`);
  assert.throws(() => normalizeExecutionBinding({ ...expected, profileReference: "other-profile" }), /profileReference must match providerProfileId/);
  assert.throws(() => normalizeExecutionBinding({ ...expected, profileRef: "other-profile" }), /profileRef must match providerProfileId/);
  assert.throws(() => normalizeExecutionBinding({ ...expected, profileId: "other-profile" }), /profileId must match providerProfileId/);
  assert.throws(() => normalizeExecutionBinding({ platform: "linkedin", accountId: "linkedin_primary", providerProfileId: GPM_PROFILE }), /provider is required/);
});

test("legacy ORCA binding remains explicit and same UUID does not imply ORCA", () => {
  const legacy = normalizeExecutionBinding({ platform: "linkedin", accountId: "linkedin_primary", profileId: GPM_PROFILE, identityReference: IDENTITY, targetId: "target-fresh", targetUrl: TARGET_URL });
  assert.equal(legacy.provider, "orca");
  assert.equal(executionProfileKey(legacy), `linkedin:${GPM_PROFILE}`);
  assert.equal(bindingMatches(legacy, { ...legacy, provider: "gpm" }), false);
});

test("runtime selection keeps provider/profile/identity binding and rejects drift", () => {
  const registry = createAccountRuntimeRegistry([{ platform: "linkedin", accountId: "linkedin_primary", provider: "gpm", profileRef: GPM_PROFILE, identityReference: IDENTITY, sessionHealth: "healthy" }]);
  const selected = selectAccountRuntimeCandidate(registry, { platform: "linkedin", provider: "gpm", providerProfileId: GPM_PROFILE, identityReference: IDENTITY });
  assert.equal(selected.status, "SELECTED");
  assert.equal(selected.selected.provider, "gpm");
  assert.equal(selected.selected.providerProfileId, GPM_PROFILE);
  assert.equal(selected.selected.identityReference, IDENTITY);
  assert.equal(selectAccountRuntimeCandidate(registry, { platform: "linkedin", provider: "orca", providerProfileId: GPM_PROFILE, identityReference: IDENTITY }).status, "NO_ELIGIBLE_ACCOUNT");
  const collision = createAccountRuntimeRegistry([
    { platform: "linkedin", accountId: "linkedin_primary", provider: "gpm", profileRef: GPM_PROFILE, identityReference: IDENTITY, sessionHealth: "healthy" },
    { platform: "linkedin", accountId: "linkedin_primary", provider: "orca", profileRef: GPM_PROFILE, identityReference: IDENTITY, sessionHealth: "healthy" }
  ]);
  assert.equal(collision.length, 2);
  assert.equal(selectAccountRuntimeCandidate(collision, { platform: "linkedin", provider: "gpm", providerProfileId: GPM_PROFILE, identityReference: IDENTITY }).selected.provider, "gpm");
  assert.equal(selectAccountRuntimeCandidate(collision, { platform: "linkedin", provider: "orca", providerProfileId: GPM_PROFILE, identityReference: IDENTITY }).selected.provider, "orca");
});

test("GPM binding passes campaign governance and every binding drift blocks", () => {
  const state = governedState();
  assert.deepEqual(evaluateCampaignAuthorization(state.post, {
    campaigns: [state.campaign], targets: [state.target], executionAccounts: [state.account],
    campaignAuthorizations: [state.authorization], posts: []
  }, state.now).reasons, []);
  for (const mutate of [
    (s) => { s.target.provider = "orca"; },
    (s) => { s.target.providerProfileId = "other-profile"; },
    (s) => { s.target.identityReference = "https://www.linkedin.com/in/other"; },
    (s) => { s.target.id = "other-target"; },
    (s) => { s.target.url = "https://www.linkedin.com/company/other"; },
    (s) => { s.authorization.destinations[0].provider = "orca"; }
  ]) {
    const changed = governedState(); mutate(changed);
    const result = evaluateCampaignAuthorization(changed.post, {
      campaigns: [changed.campaign], targets: [changed.target], executionAccounts: [changed.account],
      campaignAuthorizations: [changed.authorization], posts: []
    }, changed.now);
    assert.equal(result.allowed, false);
    assert.ok(result.reasons.some((reason) => ["execution_profile_mismatch", "destination_not_authorized", "target_missing"].includes(reason)), result.reasons.join(","));
  }
});

test("provider-aware readiness binds exact identity and target URL", () => {
  const expected = binding();
  const readiness = {
    state: "READY", checkedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(), binding: readinessBinding(expected),
    platform: expected.platform, accountId: expected.accountId, profileId: expected.profileId,
    provider: expected.provider, providerProfileId: expected.providerProfileId,
    identityReference: expected.identityReference, targetId: expected.targetId, targetUrl: expected.targetUrl
  };
  assert.equal(isReadinessFresh(readiness, expected), true);
  assert.equal(isReadinessFresh(readiness, { ...expected, identityReference: "https://www.linkedin.com/in/other" }), false);
  assert.equal(isReadinessFresh(readiness, { ...expected, targetUrl: "https://www.linkedin.com/company/other" }), false);
});


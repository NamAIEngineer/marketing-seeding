import test from "node:test";
import assert from "node:assert/strict";
import { deriveStandingExecutionControlPlan } from "../src/standing-campaign-delegation.mjs";
import { campaignAuthorizationFingerprint, campaignContentHash, campaignScopeFingerprint } from "../src/campaign-authorization.mjs";
import { normalizeOneTimeExecutionWindow } from "../src/one-time-execution-window.mjs";
import { createLiveExecutionGrantV1 } from "../src/live-execution-grant.mjs";
import { contentSha256 } from "../src/execution-contracts.mjs";
import { executionAccountKey, readinessBinding } from "../src/readiness.mjs";

function fixture() {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const campaign = { id: "campaign-1", productRepo: "/tmp/product", objective: "test", audience: ["public"], landingUrl: null, status: "active" };
  const target = { id: "target-1", channel: "linkedin", accountId: "acct-1", profileId: "profile-1", url: "https://www.linkedin.com/company/example", status: "active", readiness: { state: "READY", checkedAt: now.toISOString(), expiresAt: new Date(now.getTime()+4*60*1000).toISOString(), binding: readinessBinding({ platform: "linkedin", accountId: "acct-1", profileId: "profile-1", targetId: "target-1" }), platform: "linkedin", accountId: "acct-1", profileId: "profile-1", targetId: "target-1", checks: { sessionValid: true, composerCapable: true, platformAvailable: true } } };
  const account = { id: executionAccountKey("linkedin", "acct-1"), platform: "linkedin", accountId: "acct-1", profileId: "profile-1", status: "enabled", health: "healthy" };
  const content = "Approved bounded copy.";
  const authorization = { id: "auth-1", campaignId: campaign.id, status: "active", destinations: [{ platform: "linkedin", accountId: "acct-1", profileId: "profile-1", targetId: target.id, targetUrl: target.url }], approvedAssets: [], contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash(content)], allowRepeatSameContent: false }, audienceRules: { allowedAudiences: ["public"] }, publicationVisibilityRules: { allowedVisibilities: ["PUBLIC"] }, schedule: { timezone: "UTC", weekdays: [6], startLocal: "00:00", endLocal: "23:59" }, rateLimits: { maxJobsPerAccountPerDay: 5, maxJobsPerCampaignPerDay: 5, maxConcurrency: 1, minIntervalMinutes: 0 }, allowLiveExecution: true, validFrom: "2026-10-17T00:00:00.000Z", validUntil: "2026-10-18T00:00:00.000Z", campaignBinding: campaignScopeFingerprint(campaign) };
  authorization.binding = campaignAuthorizationFingerprint(authorization);
  const post = { id: "post-1", campaignId: campaign.id, targetId: target.id, campaignAuthorizationId: authorization.id, campaignAuthorizationBinding: authorization.binding, contentId: "content-1", content, audience: "public", publicationVisibility: "PUBLIC", idempotencyKey: "idem-1", status: "queued", readinessState: "READY" };
  const window = normalizeOneTimeExecutionWindow({ windowId: "window-1", campaignId: campaign.id, campaignAuthorizationId: authorization.id, jobId: post.id, validFrom: "2026-10-17T11:00:00.000Z", validUntil: "2026-10-17T13:00:00.000Z", timezone: "UTC", reason: "test" }, { post, authorization, authorizationFingerprint: authorization.binding, now, createdBy: "test" });
  window.status = "RESERVED"; window.reservedExecutionId = "exec-1";
  const grant = createLiveExecutionGrantV1({ post, target, account, authorization, validFrom: "2026-10-17T11:00:00.000Z", validUntil: "2026-10-17T13:00:00.000Z", createdBy: "test", operatorAuthorizationReference: "standing-test", now: new Date("2026-10-17T10:00:00.000Z") });
  grant.boundExecutionId = "exec-1";
  const state = { campaigns: [campaign], targets: [target], executionAccounts: [account], campaignAuthorizations: [authorization], posts: [post], executionRequests: [], submissionUncertainties: [], oneTimeExecutionWindows: [window], liveExecutionGrants: [grant] };
  return { now, campaign, target, account, authorization, post, window, grant, state };
}

test("derives exact bounded control from standing authority", () => {
  const f = fixture(); const result = deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "exec-1" });
  assert.equal(result.allowed, true); assert.equal(result.control.targetId, f.target.id); assert.equal(result.control.liveGrantId, f.grant.grantId); assert.equal(result.control.oneTimeWindowId, f.window.windowId);
});

test("rejects scope drift, revoked authority, duplicate and unknown", () => {
  for (const mutate of [
    f => { f.post.content = "outside"; },
    f => { f.post.publicationVisibility = "CONNECTIONS"; },
    f => { f.target.id = "other-target"; },
    f => { f.authorization.status = "paused"; },
    f => { f.state.executionRequests.push({ executionId: "other", request: { idempotencyKey: f.post.idempotencyKey }, state: "CONFIRMED" }); },
    f => { f.state.submissionUncertainties.push({ status: "UNKNOWN", jobId: f.post.id, idempotencyKeys: [f.post.idempotencyKey] }); }
  ]) { const f = fixture(); mutate(f); const result = deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "exec-1" }); assert.equal(result.allowed, false); }
});

test("rejects missing or mismatched one-time window and grant", () => {
  const f = fixture(); assert.ok(!deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: null, liveGrant: f.grant, executionId: "exec-1" }).allowed); assert.ok(!deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "other" }).allowed); f.grant.status = "REVOKED"; assert.ok(!deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "exec-1" }).allowed);
});

test("standing delegation fails closed while the global kill switch is active or epoch advanced", () => {
  for (const control of [
    { active: true, epoch: 0 },
    { active: false, epoch: 1 }
  ]) {
    const f = fixture();
    f.post.queuedKillEpoch = 0;
    f.state.control = { killSwitch: control };
    const result = deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "exec-1" });
    assert.equal(result.allowed, false);
    assert.ok(result.reasons.some((reason) => reason.startsWith("kill_switch_")));
  }
});

test("standing delegation fails closed when the bound account is unhealthy", () => {
  const f = fixture();
  f.account.health = "degraded";
  const result = deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "exec-1" });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes("account_profile_binding_mismatch"));
});

test("standing delegation permits the exact execution after its grant and post cross the durable intent boundary", () => {
  const f = fixture();
  f.window.status = "CONSUMED";
  f.window.consumedExecutionId = "exec-1";
  f.window.consumedAt = f.now.toISOString();
  f.grant.status = "CONSUMED";
  f.grant.consumedExecutionId = "exec-1";
  f.grant.consumedAt = f.now.toISOString();
  f.post.status = "publishing";
  f.post.executionState = "SUBMIT_SENT_INTENT";
  f.post.jobLifecycle = [{ state: "EXECUTING", executionId: "exec-1" }];
  assert.equal(deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "exec-1" }).allowed, true);

  f.grant.consumedExecutionId = "other-execution";
  assert.equal(deriveStandingExecutionControlPlan({ ...f, oneTimeWindow: f.window, liveGrant: f.grant, executionId: "exec-1" }).allowed, false);
});

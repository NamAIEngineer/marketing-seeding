import { campaignAuthorizationFingerprint, campaignContentHash, campaignScopeFingerprint, evaluateCampaignAuthorization } from "./campaign-authorization.mjs";
import { oneTimeExecutionWindowFingerprint, oneTimeExecutionWindowInBounds, oneTimeExecutionWindowStatus } from "./one-time-execution-window.mjs";
import { assertLiveGrantMatchesExecution, liveGrantEffectiveStatus } from "./live-execution-grant.mjs";
import { contentSha256 } from "./execution-contracts.mjs";
import { isReadinessFresh, readinessContextForTarget } from "./readiness.mjs";
import { killSwitchReasons } from "./guards.mjs";
import { bindingMatches, canonicalIdentityUrl, canonicalProvider } from "./execution-binding.mjs";

const TERMINAL_OR_UNCERTAIN = new Set(["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"]);
const ACTIVE_POSTS = new Set(["publishing", "processing", "submit_result_unknown", "published"]);

function fail(reasons) { return { allowed: false, reasons: [...new Set(reasons)], control: null }; }

/**
 * Derive a provider-neutral, exact execution control plan from already-issued
 * campaign authority. This function is pure: it never creates authority,
 * windows, grants, leases, or execution requests.
 */
export function deriveStandingExecutionControlPlan({ authorization, state, post, target, account, executionId, oneTimeWindow, liveGrant, now = new Date() } = {}) {
  const reasons = [];
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) reasons.push("invalid_now");
  if (!authorization || !state || !post || !target || !account || !executionId) return fail(["delegation_input_missing"]);
  if (authorization.status !== "active") reasons.push("campaign_authorization_not_active");
  if (authorization.allowLiveExecution !== true) reasons.push("live_execution_not_authorized");
  if (authorization.binding !== campaignAuthorizationFingerprint(authorization)) reasons.push("campaign_authorization_binding_stale");
  if (post.campaignId !== authorization.campaignId || post.campaignAuthorizationId !== authorization.id || post.campaignAuthorizationBinding !== authorization.binding) reasons.push("campaign_binding_mismatch");
  if (target.id !== post.targetId) reasons.push("target_binding_mismatch");
  if (target.status && target.status !== "active") reasons.push("target_not_active");
  const provider = canonicalProvider(account.provider, { allowLegacy: true });
  const accountBinding = { platform: account.platform, accountId: account.accountId, provider, providerProfileId: account.providerProfileId || account.profileId, profileId: account.profileId, identityReference: canonicalIdentityUrl(account.identityReference || account.expectedIdentityUrl), targetId: target.id, targetUrl: target.url };
  const targetBinding = { platform: target.channel, accountId: target.accountId, provider, ...(account.provider || account.providerProfileId || target.provider || target.providerProfileId ? { providerProfileId: target.providerProfileId || account.providerProfileId || target.profileId } : {}), profileId: target.profileId, identityReference: canonicalIdentityUrl(target.identityReference || target.expectedIdentityUrl || account.identityReference || account.expectedIdentityUrl), targetId: target.id, targetUrl: target.url };
  if (account.status !== "enabled" || account.health !== "healthy" || account.platform !== target.channel || account.accountId !== target.accountId || !bindingMatches(accountBinding, targetBinding, { requireIdentity: true, requireTarget: true })) reasons.push("account_profile_binding_mismatch");
  if (!isReadinessFresh(target.readiness, readinessContextForTarget(target, account), at)) reasons.push("readiness_not_fresh");
  const campaign = (state.campaigns || []).find((item) => item.id === post.campaignId);
  if (!campaign || campaign.status !== "active") reasons.push("campaign_not_active");
  if (campaign && authorization.campaignBinding !== campaignScopeFingerprint(campaign)) reasons.push("campaign_scope_changed");
  const eligibility = evaluateCampaignAuthorization(post, { ...state, campaigns: campaign ? [campaign] : state.campaigns, targets: [target], executionAccounts: [account], campaignAuthorizations: [authorization] }, at, { mode: "live", executionId });
  reasons.push(...eligibility.reasons);
  if (!oneTimeWindow) reasons.push("one_time_execution_window_missing");
  else {
    if (oneTimeWindow.jobId !== post.id || oneTimeWindow.campaignId !== post.campaignId || oneTimeWindow.campaignAuthorizationId !== authorization.id) reasons.push("one_time_execution_window_binding_mismatch");
    if (oneTimeWindow.authorizationFingerprint !== authorization.binding || oneTimeWindow.binding !== oneTimeExecutionWindowFingerprint(oneTimeWindow)) reasons.push("one_time_execution_window_binding_stale");
    const windowStatus = oneTimeExecutionWindowStatus(oneTimeWindow, at);
    if (!oneTimeExecutionWindowInBounds(oneTimeWindow, at) || !["ACTIVE", "RESERVED", "CONSUMED"].includes(windowStatus)) reasons.push("one_time_execution_window_unavailable");
    if (oneTimeWindow.status === "RESERVED" && oneTimeWindow.reservedExecutionId !== executionId) reasons.push("one_time_execution_window_reserved_elsewhere");
    if (oneTimeWindow.status === "CONSUMED" && oneTimeWindow.consumedExecutionId !== executionId) reasons.push("one_time_execution_window_consumed_elsewhere");
    if (oneTimeWindow.maxExecutions !== 1) reasons.push("one_time_execution_window_not_exactly_once");
  }
  if (!liveGrant) reasons.push("live_execution_grant_missing");
  else {
    if (liveGrantEffectiveStatus(liveGrant, at) !== "ACTIVE" || liveGrant.status !== "ACTIVE" || liveGrant.consumedAt || liveGrant.revokedAt) reasons.push("live_execution_grant_unavailable");
    if (liveGrant.boundExecutionId !== executionId) reasons.push("live_execution_grant_execution_mismatch");
    if (liveGrant.campaignAuthorizationId !== authorization.id || liveGrant.campaignAuthorizationBinding !== authorization.binding || liveGrant.campaignId !== post.campaignId || liveGrant.jobId !== post.id || liveGrant.platform !== target.channel || liveGrant.provider !== provider || liveGrant.providerProfileId !== accountBinding.providerProfileId || liveGrant.identityReference !== accountBinding.identityReference || liveGrant.accountId !== target.accountId || liveGrant.profileId !== target.profileId || liveGrant.targetId !== target.id || liveGrant.targetUrl !== target.url) reasons.push("live_execution_grant_scope_mismatch");
    if (liveGrant.idempotencyKey !== post.idempotencyKey || liveGrant.content?.contentId !== post.contentId || liveGrant.content?.canonicalSha256 !== campaignContentHash(post.content) || liveGrant.content?.rawSha256 !== contentSha256(post.content) || (liveGrant.publicationVisibility || "PUBLIC") !== String(post.publicationVisibility || "PUBLIC").toUpperCase()) reasons.push("live_execution_grant_content_mismatch");
    try {
      assertLiveGrantMatchesExecution(liveGrant, {
        executionId, dryRun: false, campaignId: post.campaignId, jobId: post.id,
        platform: target.channel, provider, providerProfileId: accountBinding.providerProfileId,
        accountId: target.accountId, profileId: target.profileId,
        identityReference: accountBinding.identityReference,
        target: { targetId: target.id, url: target.url, identityReference: targetBinding.identityReference }, audience: post.audience,
        publicationVisibility: String(post.publicationVisibility || "PUBLIC").toUpperCase(),
        idempotencyKey: post.idempotencyKey,
        authorization: { authorizationId: authorization.id, binding: authorization.binding },
        content: { contentId: post.contentId, sha256: contentSha256(post.content) }, media: liveGrant.media || [],
        liveGrant: { grantId: liveGrant.grantId }
      }, authorization, at);
    } catch { reasons.push("live_execution_grant_exact_binding_invalid"); }
  }
  reasons.push(...killSwitchReasons(post, state));
  const requests = state.executionRequests || [];
  const existing = requests.filter((item) => item.executionId !== executionId && item.request?.idempotencyKey === post.idempotencyKey && TERMINAL_OR_UNCERTAIN.has(item.state));
  if (existing.length) reasons.push("idempotency_blocked");
  if ((state.submissionUncertainties || []).some((item) => item.status === "UNKNOWN" && (item.jobId === post.id || item.idempotencyKeys?.includes(post.idempotencyKey)))) reasons.push("submission_uncertain");
  if (ACTIVE_POSTS.has(post.status) && post.status !== "queued") reasons.push("post_already_active_or_published");
  if (reasons.length) return fail(reasons);
  return { allowed: true, reasons: [], control: Object.freeze({ executionId, campaignId: post.campaignId, campaignAuthorizationId: authorization.id, campaignAuthorizationBinding: authorization.binding, postId: post.id, platform: target.channel, targetId: target.id, accountId: target.accountId, profileId: target.profileId, contentId: post.contentId, contentHash: campaignContentHash(post.content), rawContentHash: contentSha256(post.content), idempotencyKey: post.idempotencyKey, publicationVisibility: String(post.publicationVisibility || "PUBLIC").toUpperCase(), oneTimeWindowId: oneTimeWindow.windowId, liveGrantId: liveGrant.grantId }) };
}

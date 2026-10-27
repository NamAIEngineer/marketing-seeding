import { CHANNELS, TRANSITIONS } from "./constants.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import { evaluateCampaignAuthorization } from "./campaign-authorization.mjs";
import { DEFAULT_READINESS_TTL_MS, isReadinessFresh, readinessBinding, readinessContextForTarget } from "./readiness.mjs";

const ACTIVE_PUBLICATION_STATUSES = new Set(["queued", "publishing", "processing", "submit_result_unknown", "published"]);
export const CAMPAIGN_READINESS_MAX_AGE_MS = DEFAULT_READINESS_TTL_MS;
export const COMMUNITY_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sameProductRepository(left, right) {
  if (!left || !right) return false;
  try {
    const canonical = (value) => {
      const resolved = path.resolve(String(value));
      return resolved.startsWith("/private/") ? resolved.slice("/private".length) : resolved;
    };
    return canonical(left) === canonical(right);
  } catch { return String(left) === String(right); }
}

export function normalizeContent(value = "") {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function assertTransition(from, to) {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid post transition: ${from} -> ${to}`);
  }
}

export function approvalFingerprint(post, target) {
  return createHash("sha256").update(JSON.stringify({
    postId: post.id,
    content: post.content,
    assetPath: post.assetPath || null,
    targetId: target.id,
    channel: target.channel,
    url: target.url,
    rulesStatus: target.rulesStatus,
    consentBasis: target.consentBasis || null,
    audienceSource: target.audienceSource || null,
    unsubscribeMechanism: target.unsubscribeMechanism || null,
    readiness: target.readiness || null
  })).digest("hex");
}

/**
 * Global live-execution fence. A kill epoch is monotonic: queue entries are
 * stamped with the epoch they were admitted under, and an epoch advance
 * invalidates every older queued entry until an operator explicitly rebases
 * that entry after the normal governance checks.
 */
export function killSwitchReasons(post, state, { mode = "live" } = {}) {
  if (mode === "dry_run") return [];
  const killSwitch = state?.control?.killSwitch || {};
  const epoch = Number.isSafeInteger(killSwitch.epoch) && killSwitch.epoch >= 0 ? killSwitch.epoch : 0;
  const reasons = [];
  if (killSwitch.active === true) reasons.push("kill_switch_active");
  if (epoch > 0 && !Number.isSafeInteger(post?.queuedKillEpoch)) reasons.push("kill_switch_epoch_unbound");
  if (Number.isSafeInteger(post?.queuedKillEpoch) && epoch > post.queuedKillEpoch) reasons.push("kill_switch_epoch_advanced");
  return reasons;
}

export function evaluateQueue(post, state, now = new Date(), { mode = "live", executionId = null } = {}) {
  const dryRun = mode === "dry_run";
  const target = state.targets.find((item) => item.id === post.targetId);
  if (!target) return { allowed: false, reasons: ["target_missing"] };
  const policy = CHANNELS[target.channel];
  if (!policy) return { allowed: false, reasons: ["channel_policy_missing"] };

  const reasons = [];
  reasons.push(...killSwitchReasons(post, state, { mode }));
  const memberships = (state.communityMemberships || []).filter((membership) => {
    if (!membership || !sameProductRepository(membership.productRepo, state.campaigns?.find((campaign) => campaign.id === post.campaignId)?.productRepo)) return false;
    if (String(membership.platform || "").toLowerCase() !== String(target.channel || "").toLowerCase()) return false;
    if (membership.accountId && String(membership.accountId) !== String(target.accountId)) return false;
    const nameMatches = membership.communityName && target.name && String(membership.communityName).trim().toLowerCase() === String(target.name).trim().toLowerCase();
    const urlMatches = membership.communityUrl && target.url && (() => {
      try {
        const left = new URL(membership.communityUrl); const right = new URL(target.url);
        return left.origin === right.origin && left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "");
      } catch { return false; }
    })();
    return Boolean(nameMatches || urlMatches);
  });
  if (memberships.length) {
    const membership = memberships.sort((left, right) => String(right.checkedAt || "").localeCompare(String(left.checkedAt || "")))[0];
    const checkedAt = Date.parse(membership.checkedAt || "");
    const expiresAt = Date.parse(membership.expiresAt || "");
    const fresh = Number.isFinite(checkedAt) && checkedAt <= now.getTime() + 30_000 &&
      (Number.isFinite(expiresAt) ? expiresAt > now.getTime() : now.getTime() - checkedAt <= COMMUNITY_EVIDENCE_MAX_AGE_MS);
    if (!fresh) {
      reasons.push("community_membership_evidence_stale");
      reasons.push("community_post_evidence_stale");
    }
    const membershipStatus = String(membership.membershipStatus || "unknown").toLowerCase();
    const postStatus = String(membership.postStatus || "unknown").toLowerCase();
    if (!["joined", "not_applicable"].includes(membershipStatus)) reasons.push(`community_membership_${membershipStatus}`);
    if (postStatus !== "allowed" && postStatus !== "not_applicable") reasons.push(`community_post_${postStatus}`);
  }
  if (post.assetPath) {
    const artifact = (state.artifacts || []).find((item) => item.id === post.artifactId);
    if (!artifact || !post.assetSha256 || artifact.sha256 !== post.assetSha256) reasons.push("asset_evidence_missing_or_stale");
  }
  const hasCampaignAuthorization = (state.campaignAuthorizations || []).some((item) => item.campaignId === post.campaignId);
  const campaignAuthorization = post.campaignAuthorizationId
    ? evaluateCampaignAuthorization(post, state, now, { mode, executionId })
    : null;
  if (campaignAuthorization) reasons.push(...campaignAuthorization.reasons);
  if (!dryRun && campaignAuthorization && campaignAuthorization.authorization?.allowLiveExecution !== true) reasons.push("live_execution_not_authorized");
  if (campaignAuthorization) {
    const account = (state.executionAccounts || []).find((item) => item.id === `${target.channel}:${target.accountId}`);
    const expectedReadiness = readinessContextForTarget(target, account);
    if (!target.profileId) reasons.push("execution_profile_missing");
    if (target.readiness?.capabilities?.sessionAuthenticated !== true && target.readiness?.checks?.sessionValid !== true) reasons.push("session_not_verified");
    if (target.readiness?.capabilities?.composerAvailable !== true && target.readiness?.checks?.composerCapable !== true) reasons.push("composer_capability_not_verified");
    if (target.readiness?.capabilities?.feedReachable !== true && target.readiness?.checks?.platformAvailable !== true) reasons.push("platform_availability_not_verified");
    const readinessCheckedAt = Date.parse(target.readiness?.checkedAt || "");
    if (!Number.isFinite(readinessCheckedAt)) reasons.push("readiness_timestamp_missing");
    else if (readinessCheckedAt > now.getTime() + 30_000) reasons.push("readiness_timestamp_in_future");
    else if (!isReadinessFresh(target.readiness, expectedReadiness, now, CAMPAIGN_READINESS_MAX_AGE_MS)) {
      if (Date.parse(target.readiness?.expiresAt || "") <= now.getTime()) reasons.push("readiness_expired");
      else if (target.profileId && target.readiness?.binding !== readinessBinding(expectedReadiness)) reasons.push("readiness_binding_mismatch");
      else if (now.getTime() - readinessCheckedAt > CAMPAIGN_READINESS_MAX_AGE_MS) reasons.push("readiness_evidence_stale");
      else reasons.push("readiness_not_ready");
    }
  }
  if (!campaignAuthorization && hasCampaignAuthorization) reasons.push("campaign_authorization_missing");
  if (!campaignAuthorization && !hasCampaignAuthorization && !post.approvedAt) reasons.push("human_approval_required");
  if (!campaignAuthorization && !hasCampaignAuthorization && post.approvedAt && post.approvalBinding !== approvalFingerprint(post, target)) reasons.push("approval_binding_stale");
  if (!post.content?.trim()) reasons.push("content_missing");
  if ((state.submissionUncertainties || []).some((item) => item.status === "UNKNOWN" && (item.jobId === post.id || (post.idempotencyKey && item.idempotencyKeys?.includes(post.idempotencyKey))))) reasons.push("submission_uncertain");
  if (policy.maxContentChars && post.content?.length > policy.maxContentChars) reasons.push("content_too_long");
  if (policy.requiresRulesReview && target.rulesStatus !== "reviewed") {
    reasons.push("target_rules_not_reviewed");
  }
  if (policy.requiresConsent && (!target.consentBasis || !target.audienceSource || !target.unsubscribeMechanism)) {
    reasons.push("consent_metadata_required");
  }
  if (!dryRun && target.status !== "active") reasons.push("target_not_active");
  if (target.readiness && target.readiness.state !== "ready") reasons.push("target_not_ready");

  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const accountPosts = state.posts.filter((item) => {
    if (item.id === post.id || !ACTIVE_PUBLICATION_STATUSES.has(item.status)) return false;
    const itemTarget = state.targets.find((targetItem) => targetItem.id === item.targetId);
    if (!itemTarget || itemTarget.channel !== target.channel || itemTarget.accountId !== target.accountId) return false;
    const timestamp = item.publishedAt || item.processingAt || item.publishingAt || item.queuedAt;
    return timestamp && new Date(timestamp) >= dayStart;
  });
  if (!dryRun && accountPosts.length >= policy.dailyLimitPerAccount) reasons.push("daily_limit_reached");

  const recent = state.posts
    .filter((item) => item.id !== post.id && ACTIVE_PUBLICATION_STATUSES.has(item.status))
    .map((item) => ({
      item,
      target: state.targets.find((targetItem) => targetItem.id === item.targetId),
      at: item.publishedAt || item.processingAt || item.publishingAt || item.queuedAt
    }))
    .filter((entry) => entry.target?.channel === target.channel && entry.target?.accountId === target.accountId && entry.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  if (!dryRun && recent) {
    const elapsedMinutes = (now - new Date(recent.at)) / 60000;
    if (elapsedMinutes < policy.minimumIntervalMinutes) reasons.push("minimum_interval_not_met");
  }

  const normalized = normalizeContent(post.content);
  const duplicate = state.posts.some((item) => {
    if (item.id === post.id || item.status !== "published") return false;
    const ageDays = (now - new Date(item.publishedAt)) / 86400000;
    const itemTarget = state.targets.find((targetItem) => targetItem.id === item.targetId);
    return itemTarget?.channel === target.channel && itemTarget?.accountId === target.accountId && ageDays <= 7 && normalizeContent(item.content) === normalized;
  });
  const repeatContentAllowed = campaignAuthorization?.authorization?.contentBoundary?.allowRepeatSameContent === true;
  if (duplicate && !repeatContentAllowed) reasons.push("duplicate_content_within_7_days");

  return { allowed: reasons.length === 0, reasons, policy, target, oneTimeWindow: campaignAuthorization?.oneTimeWindow || null };
}

export function assertReplyCanSend(reply, state) {
  const interaction = state.interactions.find((item) => item.id === reply.interactionId);
  if (!interaction) throw new Error("Reply interaction is missing");
  const post = state.posts.find((item) => item.id === interaction.postId);
  const target = state.targets.find((item) => item.id === post?.targetId);
  const policy = CHANNELS[target?.channel];
  if (reply.status !== "approved") {
    throw new Error(`Reply cannot be sent from ${reply.status}`);
  }
  if (!reply.approvedAt && policy?.replyRequiresApproval !== false) {
    throw new Error("Reply requires human approval");
  }
}

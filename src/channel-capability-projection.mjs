/**
 * Deterministic, read-only channel capability/readiness projection.
 *
 * This is operator evidence only. It never selects an account, derives
 * authority, invokes a provider, or mutates campaign state.
 */
const MAX_CHANNELS = 64;
const STATUS = new Set(["READY", "NEEDS_TARGET", "RULES_REVIEW_REQUIRED", "AUTH_REQUIRED", "BLOCKED"]);

function text(value, max = 120) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }

function targetReady(target, nowMs) {
  if (!target || target.status !== "active") return false;
  if (!["reviewed", "not_required"].includes(String(target.rulesStatus || ""))) return false;
  const readiness = target.readiness;
  if (!readiness || String(readiness.state || "").toUpperCase() !== "READY") return false;
  // A readiness row with an explicit check time must be current at the
  // observation boundary. Older rows may omit checkedAt in legacy fixtures;
  // those remain compatible, while malformed/future timestamps fail closed.
  if (readiness.checkedAt !== undefined) {
    const checkedAt = Date.parse(readiness.checkedAt || "");
    if (!Number.isFinite(checkedAt) || checkedAt > nowMs) return false;
  }
  const expiresAt = Date.parse(readiness.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  // When a normalized readiness binding is present, require the target's
  // exact identity to match it. This prevents a capability projection from
  // advertising a session for a different account/profile/target.
  const hasBindingFields = ["platform", "accountId", "profileId", "targetId", "binding"]
    .every((field) => readiness[field] !== undefined && readiness[field] !== null);
  if (hasBindingFields && (readiness.platform !== target.channel || readiness.accountId !== target.accountId ||
      readiness.profileId !== target.profileId || readiness.targetId !== target.id)) return false;
  return true;
}

function projectOne(channel, policy, targets, posts, nowMs) {
  const channelTargets = targets.filter((target) => target?.channel === channel);
  const activeTargets = channelTargets.filter((target) => target?.status === "active");
  const rulesPending = activeTargets.some((target) => policy?.requiresRulesReview && target.rulesStatus !== "reviewed");
  const readyTargets = channelTargets.filter((target) => targetReady(target, nowMs));
  let status = "READY";
  let reason = "at least one active target has fresh READY readiness";
  if (!channelTargets.length) { status = "NEEDS_TARGET"; reason = "no configured target"; }
  else if (!activeTargets.length) { status = "BLOCKED"; reason = "no active target"; }
  else if (rulesPending) { status = "RULES_REVIEW_REQUIRED"; reason = "active target requires community rules review"; }
  else if (!readyTargets.length) { status = "AUTH_REQUIRED"; reason = "no active target has fresh READY session readiness"; }
  if (!STATUS.has(status)) status = "BLOCKED";
  const publishMode = ["AUTONOMOUS_WHEN_AUTHORIZED", "HUMAN_APPROVAL_REQUIRED"].includes(String(policy?.publishMode || ""))
    ? String(policy.publishMode)
    : policy?.requiresHumanApproval === true ? "HUMAN_APPROVAL_REQUIRED" : "AUTONOMOUS_WHEN_AUTHORIZED";
  return {
    channel,
    label: text(policy?.label || channel),
    status,
    reason,
    publishMode,
    requiresHumanApproval: policy?.requiresHumanApproval === true,
    requiresRulesReview: policy?.requiresRulesReview === true,
    targetCount: channelTargets.length,
    activeTargetCount: activeTargets.length,
    freshReadyTargetCount: readyTargets.length,
    postCount: posts.filter((post) => channelTargets.some((target) => target.id === post?.targetId)).length,
    advisory: true,
    authoritySideEffects: false,
    externalSideEffects: false
  };
}

export function projectChannelCapabilities({ channels = {}, targets = [], posts = [], now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const observedAt = Number.isFinite(nowMs) ? nowMs : Date.now();
  const entries = channels && typeof channels === "object" && !Array.isArray(channels) ? Object.entries(channels) : [];
  return entries.slice(0, MAX_CHANNELS).map(([channel, policy]) => projectOne(channel, policy || {}, Array.isArray(targets) ? targets : [], Array.isArray(posts) ? posts : [], observedAt));
}

export { MAX_CHANNELS };

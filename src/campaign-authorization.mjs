import { createHash } from "node:crypto";
import path from "node:path";
import { executionAccountKey } from "./readiness.mjs";
import { matchingOneTimeExecutionWindow } from "./one-time-execution-window.mjs";
import { normalizePublicationVisibility } from "./publication-visibility.mjs";
import { accountTargetBindingMatches, canonicalIdentityUrl, canonicalProvider, canonicalTargetUrl, destinationBindingMatches } from "./execution-binding.mjs";

const SUPPORTED_AUTH_STATUSES = new Set(["active", "paused", "expired", "revoked"]);
const sha256Pattern = /^[a-f0-9]{64}$/i;
const STORY_POLICY_SECRET = /(?:password|passphrase|secret|token|cookie|authorization|credential|api[_-]?key|session(?:[_ -]?token)?)\s*[:=]/i;
const STORY_POLICY_SECRET_VALUE = /(?:bearer\s+[a-z0-9._-]{6,}|sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,})/i;

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeDuplicateContent(value) {
  return String(value || "").toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A terminal pre-submit cancellation proves that no platform input was
 * emitted. It must not poison a later, independently authorized publication
 * with the same copy. Any submitted, uncertain, or published history remains
 * a duplicate fence and fails closed.
 */
function hasPossibleExternalSubmission(item, state) {
  if (!item) return true;
  if (item.publicationUrl || ["published", "publishing", "processing", "submit_result_unknown"].includes(String(item.status || "").toLowerCase())) return true;
  const requests = (state.executionRequests || []).filter((request) => request.jobId === item.id);
  if (requests.some((request) => ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(request.state) || ["SUBMIT_SENT", "UNKNOWN", "CONFIRMED"].includes(request.submitState))) return true;
  if ((state.submissionUncertainties || []).some((uncertainty) => uncertainty.status === "UNKNOWN" && (uncertainty.jobId === item.id || uncertainty.idempotencyKeys?.includes(item.idempotencyKey)))) return true;
  // A draft/blocked/approved item with no request, receipt, or uncertainty has
  // never crossed the dispatch boundary. It is safe to leave it out of the
  // account duplicate fence; queued/request-ready work remains fenced below.
  if (["draft", "blocked", "needs_review", "approved"].includes(String(item.status || "").toLowerCase()) && requests.length === 0 && item.executionState !== "CANCELLED_PRE_SUBMIT") return false;
  if (item.executionState === "CANCELLED_PRE_SUBMIT") return false;
  return true;
}

function normalizeStoryPolicy(input, mode) {
  if (input === undefined || input === null) return null;
  if (mode !== "approved_template_set") throw new Error("storyPolicy requires approved_template_set authorization");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("storyPolicy must be an object");
  const callToAction = required(input.callToAction, "storyPolicy.callToAction").replace(/\s+/g, " ");
  const disclosure = input.disclosure === undefined ? null : required(input.disclosure, "storyPolicy.disclosure").replace(/\s+/g, " ");
  const language = input.language === undefined ? null : required(input.language, "storyPolicy.language").replace(/\s+/g, " ");
  const values = { callToAction, disclosure, language };
  for (const [field, value] of Object.entries(values)) {
    if (value !== null && (value.length < 1 || value.length > (field === "callToAction" ? 300 : field === "disclosure" ? 500 : 32))) {
      throw new Error(`storyPolicy.${field} exceeds its bounded length`);
    }
    if (value !== null && (STORY_POLICY_SECRET.test(value) || STORY_POLICY_SECRET_VALUE.test(value))) {
      throw new Error(`storyPolicy.${field} contains credential/session material`);
    }
  }
  return values;
}

export function campaignScopeFingerprint(campaign) {
  return digest({
    id: campaign.id,
    productRepo: campaign.productRepo,
    track: campaign.track || null,
    objective: campaign.objective,
    audience: campaign.audience || [],
    landingUrl: campaign.landingUrl || null
  });
}

export function campaignContentHash(content) {
  return digest(String(content || ""));
}

export function publicationIdentityKey({ campaignId, contentId, platform, accountId, targetId }) {
  return digest({ campaignId, contentId, platform, accountId, targetId });
}

export function publicationIdentityKeysForPost(post, state) {
  const target = state.targets?.find((item) => item.id === post.targetId);
  if (!target || !post.campaignId) return [];
  const contentIds = new Set([
    post.contentId,
    post.storyId,
    post.content ? createHash("sha256").update(String(post.content)).digest("hex") : null
  ].map((value) => String(value || "").trim()).filter(Boolean));
  return [...contentIds].map((contentId) => publicationIdentityKey({
    campaignId: post.campaignId,
    contentId,
    platform: target.channel,
    accountId: target.accountId,
    targetId: target.id
  }));
}

export function normalizeCampaignAuthorization(input, campaign, now = new Date()) {
  const validFrom = required(input.validFrom, "validFrom");
  const validUntil = required(input.validUntil, "validUntil");
  const fromMs = Date.parse(validFrom);
  const untilMs = Date.parse(validUntil);
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) {
    throw new Error("Campaign authorization requires a valid, increasing validity window");
  }
  if (untilMs - fromMs > 90 * 24 * 60 * 60 * 1000) throw new Error("Campaign authorization validity cannot exceed 90 days");

  const destinations = Array.isArray(input.destinations) ? input.destinations.map((item) => ({
    platform: required(item.platform, "destination platform"),
    accountId: required(item.accountId, "destination accountId"),
    targetId: required(item.targetId, "destination targetId"),
    provider: canonicalProvider(item.provider, { allowLegacy: true }),
    providerProfileId: String(item.providerProfileId || item.profileReference || item.profileId || "").trim() || null,
    profileId: String(item.profileId || item.providerProfileId || "").trim() || null,
    identityReference: canonicalIdentityUrl(item.identityReference || item.expectedIdentityUrl),
    targetUrl: canonicalTargetUrl(item.targetUrl || item.url)
  })) : [];
  if (destinations.length === 0) throw new Error("Campaign authorization requires at least one approved destination");
  if (new Set(destinations.map((item) => `${item.platform}\0${item.accountId}\0${item.targetId}`)).size !== destinations.length) {
    throw new Error("Campaign authorization destinations must be unique");
  }
  const accountSelectionPolicy = input.accountSelectionPolicy == null ? null : input.accountSelectionPolicy;
  if (accountSelectionPolicy !== null) {
    if (accountSelectionPolicy.mode !== "ordered" || !Array.isArray(accountSelectionPolicy.order) || accountSelectionPolicy.order.length === 0) {
      throw new Error("accountSelectionPolicy requires ordered mode and a non-empty order");
    }
    const orderKeys = accountSelectionPolicy.order.map((item) => {
      const platform = required(item.platform, "selection platform");
      const accountId = required(item.accountId, "selection accountId");
      const targetId = required(item.targetId, "selection targetId");
      const profileId = required(item.profileId || item.providerProfileId, "selection profileId");
      const destination = destinations.find((candidate) => candidate.platform === platform && candidate.accountId === accountId && candidate.targetId === targetId);
      if (!destination || destination.profileId !== profileId || (item.provider && canonicalProvider(item.provider) !== destination.provider) || (item.providerProfileId && item.providerProfileId !== destination.providerProfileId)) throw new Error("accountSelectionPolicy order must contain exact authorized account/profile destinations");
      return `${platform}\0${accountId}\0${targetId}\0${destination.provider}\0${destination.providerProfileId}`;
    });
    if (new Set(orderKeys).size !== orderKeys.length) throw new Error("accountSelectionPolicy order must contain unique authorized destinations");
  }

  const approvedAssets = Array.isArray(input.approvedAssets) ? input.approvedAssets.map((item) => ({
    artifactId: required(item.artifactId, "approved asset artifactId"),
    sha256: required(item.sha256, "approved asset sha256").toLowerCase()
  })) : [];
  if (approvedAssets.some((item) => !sha256Pattern.test(item.sha256))) throw new Error("Approved asset hashes must be SHA-256 hex digests");
  if (new Set(approvedAssets.map((item) => item.artifactId)).size !== approvedAssets.length) throw new Error("Approved assets must be unique");

  const contentBoundary = input.contentBoundary || {};
  const mode = String(contentBoundary.mode || "approved_copy_set");
  if (!new Set(["approved_copy_set", "approved_template_set"]).has(mode)) throw new Error("Unsupported campaign contentBoundary mode");
  const contentHashes = Array.isArray(contentBoundary.contentHashes) ? [...new Set(contentBoundary.contentHashes.map((item) => String(item).toLowerCase()))] : [];
  const approvedClaims = Array.isArray(contentBoundary.approvedClaims) ? contentBoundary.approvedClaims.map((item) => ({
    id: required(item.id, "approved claim id"),
    text: required(item.text, "approved claim text"),
    sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.map((ref) => ({
      relativePath: required(ref.relativePath, "approved claim source relativePath"),
      sha256: required(ref.sha256, "approved claim source sha256").toLowerCase()
    })) : []
  })) : [];
  if (new Set(approvedClaims.map((claim) => claim.id)).size !== approvedClaims.length) throw new Error("Approved claim IDs must be unique");
  if (mode === "approved_copy_set" && (contentHashes.length === 0 || contentHashes.some((item) => !sha256Pattern.test(item)))) {
    throw new Error("approved_copy_set requires one or more SHA-256 contentHashes");
  }
  const templates = Array.isArray(contentBoundary.templates) ? contentBoundary.templates.map((item) => ({
    id: required(item.id, "approved template id"),
    platform: required(item.platform, "approved template platform"),
    template: required(item.template, "approved template text")
  })) : [];
  if (new Set(templates.map((item) => `${item.platform}\0${item.id}`)).size !== templates.length) throw new Error("Campaign templates must be unique per platform and ID");
  const authorizedPlatforms = new Set(destinations.map((item) => item.platform));
  if (templates.some((item) => !authorizedPlatforms.has(item.platform))) throw new Error("Campaign templates cannot exceed the authorized platform scope");
  if (mode === "approved_template_set") {
    if (approvedClaims.length === 0 || approvedClaims.some((claim) => claim.sourceRefs.length === 0) || templates.length === 0) {
      throw new Error("approved_template_set requires source-bound claims and at least one exact template");
    }
    if (approvedClaims.some((claim) => claim.sourceRefs.some((ref) => !sha256Pattern.test(ref.sha256)))) throw new Error("Approved claim source refs require SHA-256 hashes");
    const approvedIds = new Set(approvedClaims.map((claim) => claim.id));
    const validToken = /^\{\{(?:claim:[a-zA-Z0-9_.-]+|disclosure)\}\}$/;
    for (const template of templates) {
      const tokens = template.template.match(/\{\{[^}]+\}\}/g) || [];
      if (!tokens.some((token) => token.startsWith("{{claim:"))) throw new Error(`Template ${template.id} must include at least one claim placeholder`);
      if (tokens.some((token) => !validToken.test(token))) throw new Error(`Unsupported placeholder in campaign template ${template.id}`);
      for (const token of tokens.filter((value) => value.startsWith("{{claim:"))) {
        if (!approvedIds.has(token.slice(8, -2))) throw new Error(`Template references an unapproved claim: ${token}`);
      }
      if (contentBoundary.requiredDisclosures?.length && !tokens.includes("{{disclosure}}")) {
        throw new Error(`Template ${template.id} must include the required disclosure placeholder`);
      }
    }
  }
  const contentBoundaryNormalized = {
    mode,
    contentHashes,
    approvedClaims,
    templates,
    storyPolicy: normalizeStoryPolicy(contentBoundary.storyPolicy, mode),
    requiredDisclosures: [...new Set((contentBoundary.requiredDisclosures || []).map((item) => required(item, "required disclosure")))],
    forbiddenTerms: [...new Set((contentBoundary.forbiddenTerms || []).map((item) => required(item, "forbidden term").toLocaleLowerCase("en-US")))],
    maxCharactersByPlatform: { ...(contentBoundary.maxCharactersByPlatform || {}) },
    allowRepeatSameContent: contentBoundary.allowRepeatSameContent === true
  };
  if (Object.entries(contentBoundaryNormalized.maxCharactersByPlatform).some(([platform, value]) => !platform || !Number.isInteger(Number(value)) || Number(value) < 1)) {
    throw new Error("maxCharactersByPlatform must contain positive integer limits");
  }

  const audienceRules = input.audienceRules || {};
  const allowedAudiences = Array.isArray(audienceRules.allowedAudiences)
    ? [...new Set(audienceRules.allowedAudiences.map((item) => required(item, "allowed audience")))] : [];
  if (allowedAudiences.length === 0) throw new Error("Campaign authorization requires explicit allowedAudiences");
  const allowedVisibilities = Array.isArray(input.publicationVisibilityRules?.allowedVisibilities)
    ? [...new Set(input.publicationVisibilityRules.allowedVisibilities.map((item) => normalizePublicationVisibility(item)))] : ["PUBLIC"];
  const executionMode = String(input.executionMode || "manual_exact").trim();
  if (!["manual_exact", "standing_autonomous"].includes(executionMode)) {
    throw new Error("Unsupported campaign executionMode");
  }
  const standingAuthorizationReference = executionMode === "standing_autonomous"
    ? required(input.standingAuthorizationReference, "standingAuthorizationReference")
    : null;

  const schedule = input.schedule || {};
  const timezone = required(schedule.timezone, "schedule timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(now); } catch { throw new Error("schedule timezone is invalid"); }
  const weekdays = Array.isArray(schedule.weekdays) ? [...new Set(schedule.weekdays.map(Number))].sort() : [];
  if (weekdays.length === 0 || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("schedule weekdays must use 0-6");
  const startLocal = required(schedule.startLocal, "schedule startLocal");
  const endLocal = required(schedule.endLocal, "schedule endLocal");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startLocal) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endLocal) || startLocal >= endLocal) {
    throw new Error("schedule requires a valid same-day startLocal/endLocal window");
  }

  const limits = input.rateLimits || {};
  const rateLimits = {
    maxJobsPerAccountPerDay: Number(limits.maxJobsPerAccountPerDay),
    maxJobsPerCampaignPerDay: Number(limits.maxJobsPerCampaignPerDay),
    maxConcurrency: Number(limits.maxConcurrency),
    minIntervalMinutes: Number(limits.minIntervalMinutes || 0)
  };
  if (Object.values(rateLimits).some((value) => !Number.isInteger(value) || value < 0) ||
      rateLimits.maxJobsPerAccountPerDay < 1 || rateLimits.maxJobsPerCampaignPerDay < 1 || rateLimits.maxConcurrency < 1) {
    throw new Error("rateLimits must define positive daily job limits and maxConcurrency");
  }

  return {
    id: required(input.id || `campaign-auth-${Date.now()}`, "authorization id"),
    campaignId: campaign.id,
    status: "active",
    platforms: [...new Set(destinations.map((item) => item.platform))],
    destinations,
    accountSelectionPolicy: accountSelectionPolicy ? { mode: "ordered", order: accountSelectionPolicy.order.map((item) => ({ platform: String(item.platform), accountId: String(item.accountId), targetId: String(item.targetId), provider: canonicalProvider(item.provider, { allowLegacy: true }), providerProfileId: required(item.providerProfileId || item.profileId, "selection providerProfileId"), profileId: required(item.profileId || item.providerProfileId, "selection profileId") })) } : null,
    approvedAssets,
    contentBoundary: contentBoundaryNormalized,
    audienceRules: { allowedAudiences },
    publicationVisibilityRules: { allowedVisibilities },
    executionMode,
    standingAuthorizationReference,
    schedule: { timezone, weekdays, startLocal, endLocal },
    rateLimits,
    allowLiveExecution: input.allowLiveExecution === true,
    validFrom: new Date(fromMs).toISOString(),
    validUntil: new Date(untilMs).toISOString(),
    approvedAt: now.toISOString(),
    campaignBinding: campaignScopeFingerprint(campaign)
  };
}

export function campaignAuthorizationFingerprint(authorization) {
  const { approvedAt, approvedBy, activatedAt, updatedAt, binding, status, ...scope } = authorization;
  return digest(scope);
}

function localClock(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value);
  const result = {
    weekday: weekdayIndex,
    date: `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`,
    time: `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`
  };
  if (result.weekday < 0 || !result.date || !result.time) throw new Error("Campaign schedule clock could not be resolved");
  return result;
}

export function evaluateCampaignAuthorization(post, state, now = new Date(), { mode = "live", executionId = null } = {}) {
  const dryRun = mode === "dry_run";
  const authorization = (state.campaignAuthorizations || []).find((item) => item.id === post.campaignAuthorizationId);
  if (!authorization || authorization.campaignId !== post.campaignId) return { allowed: false, reasons: ["campaign_authorization_missing"] };
  const campaign = (state.campaigns || []).find((item) => item.id === post.campaignId);
  const target = (state.targets || []).find((item) => item.id === post.targetId);
  const account = target ? (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId)) : null;
  const reasons = [];
  if (!campaign || campaign.status !== "active") reasons.push("campaign_not_active");
  if (!SUPPORTED_AUTH_STATUSES.has(authorization.status) || authorization.status !== "active") reasons.push("campaign_authorization_not_active");
  if (authorization.binding !== campaignAuthorizationFingerprint(authorization)) reasons.push("campaign_authorization_binding_stale");
  if (post.campaignAuthorizationBinding !== authorization.binding) reasons.push("job_authorization_binding_stale");
  if (!Number.isFinite(Date.parse(authorization.validFrom)) || now < new Date(authorization.validFrom)) reasons.push("campaign_authorization_not_yet_valid");
  if (!Number.isFinite(Date.parse(authorization.validUntil)) || now > new Date(authorization.validUntil)) reasons.push("campaign_authorization_expired");
  if (!campaign || authorization.campaignBinding !== campaignScopeFingerprint(campaign)) reasons.push("campaign_scope_changed");
  if (!target) reasons.push("target_missing");
  if (!account || account.status !== "enabled") reasons.push("execution_account_unavailable");
  if (account && !accountTargetBindingMatches(target, account, { requireTarget: true })) reasons.push("execution_profile_mismatch");
  // Legacy destinations store only `profileId`; provider-aware destinations
  // store `providerProfileId`. Compare the effective profile in both lanes.
  // Missing provider fields never infer a provider from UUID shape: the
  // explicit compatibility lane is ORCA only.
  const destination = authorization.destinations?.find((item) => destinationBindingMatches(item, target, account, { requireTarget: true }));
  if (!destination) reasons.push("destination_not_authorized");
  if (post.assetPath) {
    const asset = authorization.approvedAssets?.find((item) => item.artifactId === post.artifactId && item.sha256 === post.assetSha256);
    if (!asset) reasons.push("asset_not_authorized");
    const artifact = (state.artifacts || []).find((item) => item.id === post.artifactId);
    let pathsMatch = false;
    try { pathsMatch = Boolean(artifact?.path && post.assetPath && path.resolve(artifact.path) === path.resolve(post.assetPath)); } catch {}
    if (!artifact || artifact.campaignId !== post.campaignId || artifact.status !== "verified" || artifact.sha256 !== post.assetSha256 || !pathsMatch) reasons.push("asset_evidence_missing_or_stale");
  } else if (post.artifactId || post.assetSha256) {
    reasons.push("asset_path_missing");
  }
  const content = String(post.content || "");
  const boundary = authorization.contentBoundary || {};
  if (boundary.mode === "approved_copy_set") {
    if (!boundary.contentHashes?.includes(campaignContentHash(content))) reasons.push("content_not_in_approved_copy_set");
  } else if (boundary.mode === "approved_template_set") {
    const approved = new Set((boundary.approvedClaims || []).map((claim) => claim.id));
    const claimIds = Array.isArray(post.claimIds) ? post.claimIds : [];
    const template = boundary.templates?.find((item) => item.id === post.templateId && item.platform === target?.channel);
    if (!template || claimIds.length === 0 || claimIds.some((id) => !approved.has(id))) reasons.push("content_template_scope_invalid");
    if (template) {
      const claims = new Map((boundary.approvedClaims || []).map((claim) => [claim.id, claim]));
      const templateClaimIds = [...template.template.matchAll(/\{\{claim:([a-zA-Z0-9_.-]+)\}\}/g)].map((match) => match[1]);
      const expectedIds = [...new Set(templateClaimIds)].sort();
      if (JSON.stringify([...new Set(claimIds)].sort()) !== JSON.stringify(expectedIds)) reasons.push("content_template_claim_binding_mismatch");
      let expectedContent = template.template.replace(/\{\{claim:([a-zA-Z0-9_.-]+)\}\}/g, (_, id) => claims.get(id)?.text || "");
      expectedContent = expectedContent.replace(/\{\{disclosure\}\}/g, (boundary.requiredDisclosures || []).join("\n"));
      if (content !== expectedContent) reasons.push("content_outside_approved_template");
    }
    const suppliedSources = new Set((Array.isArray(post.contentSourceRefs) ? post.contentSourceRefs : []).map((reference) => typeof reference === "string" ? reference : `${reference.relativePath}#${reference.sha256}`));
    for (const claim of (boundary.approvedClaims || []).filter((item) => claimIds.includes(item.id))) {
      if (claim.sourceRefs.some((reference) => !suppliedSources.has(`${reference.relativePath}#${reference.sha256}`))) reasons.push("content_source_binding_missing");
    }
  } else reasons.push("content_boundary_invalid");

  if ((boundary.forbiddenTerms || []).some((term) => content.toLocaleLowerCase("en-US").includes(term))) reasons.push("forbidden_content_term");
  if ((boundary.requiredDisclosures || []).some((disclosure) => !content.includes(disclosure))) reasons.push("required_disclosure_missing");
  const maxChars = Number(boundary.maxCharactersByPlatform?.[target?.channel]);
  if (Number.isFinite(maxChars) && maxChars > 0 && content.length > maxChars) reasons.push("content_too_long_for_campaign");

  if (!authorization.audienceRules?.allowedAudiences?.includes(post.audience)) reasons.push("audience_not_authorized");
  const visibility = String(post.publicationVisibility || "PUBLIC").toUpperCase();
  const allowedVisibilities = authorization.publicationVisibilityRules?.allowedVisibilities || ["PUBLIC"];
  if (!allowedVisibilities.includes(visibility)) reasons.push("publication_visibility_not_authorized");
  // Dry runs validate the current authorization window and all content/destination
  // scope, but do not consume a publication slot or pretend to publish at the
  // campaign's scheduled time.
  const oneTimeWindow = !dryRun ? matchingOneTimeExecutionWindow(state, post, authorization, campaignAuthorizationFingerprint(authorization), now, executionId) : null;
  const requestedScheduledAt = dryRun || oneTimeWindow ? now : post.scheduledAt ? new Date(post.scheduledAt) : now;
  const scheduledAtValid = Number.isFinite(requestedScheduledAt.getTime());
  if (!scheduledAtValid) reasons.push("schedule_timestamp_invalid");
  const scheduledAt = scheduledAtValid ? requestedScheduledAt : now;
  if (scheduledAt < new Date(authorization.validFrom) || scheduledAt > new Date(authorization.validUntil)) reasons.push("schedule_outside_authorization_window");
  if (!dryRun && !oneTimeWindow && scheduledAt > now) reasons.push("schedule_not_due");
  let local;
  try {
    local = localClock(scheduledAt, authorization.schedule?.timezone);
    if (!dryRun && !oneTimeWindow && (!authorization.schedule.weekdays.includes(local.weekday) || local.time < authorization.schedule.startLocal || local.time > authorization.schedule.endLocal)) reasons.push("schedule_outside_allowed_window");
  } catch {
    reasons.push("campaign_schedule_invalid");
    local = { date: "", weekday: -1, time: "" };
  }

  // Campaign daily volume, concurrency, and idempotency stay campaign-scoped.
  // Account frequency uses every campaign targeting the same platform/account.
  const campaignPosts = (state.posts || []).filter((item) => item.id !== post.id && item.campaignId === authorization.campaignId);
  const accountPosts = (state.posts || []).filter((item) => {
    if (item.id === post.id) return false;
    const itemTarget = state.targets?.find((targetItem) => targetItem.id === item.targetId);
    return itemTarget?.channel === target?.channel && itemTarget?.accountId === target?.accountId;
  });
  const dayKey = local;
  const countedStatuses = new Set(["queued", "publishing", "processing", "submit_result_unknown", "published"]);
  const activityTime = (item) => {
    const submittedRequest = (state.executionRequests || [])
      .filter((request) => request.jobId === item.id && ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(request.state))
      .sort((left, right) => (right.attempt || 0) - (left.attempt || 0))[0];
    return item.publishedAt || submittedRequest?.dispatchedAt || submittedRequest?.submitIntentAt ||
      item.queuedAt || item.scheduledAt || item.createdAt || item.processingAt || item.publishingAt || null;
  };
  const isDryRunOnly = (item) => {
    const requests = (state.executionRequests || []).filter((request) => request.jobId === item.id).sort((left, right) => (right.attempt || 0) - (left.attempt || 0));
    return requests[0]?.dryRun === true && ["DRY_RUN_COMPLETE", "DRY_RUN_FAILED"].includes(requests[0].state);
  };
  const sameLocalDay = (item) => {
    if (!countedStatuses.has(item.status)) return false;
    const time = activityTime(item);
    if (!time) return false;
    let at;
    try { at = localClock(new Date(time), authorization.schedule.timezone); } catch { return false; }
    return at.date === dayKey.date;
  };
  const sameCampaignToday = campaignPosts.filter(sameLocalDay);
  if (!dryRun && sameCampaignToday.length >= authorization.rateLimits.maxJobsPerCampaignPerDay) reasons.push("campaign_daily_limit_reached");
  const sameAccountToday = accountPosts.filter((item) => !isDryRunOnly(item) && sameLocalDay(item));
  if (!dryRun && sameAccountToday.length >= authorization.rateLimits.maxJobsPerAccountPerDay) reasons.push("account_daily_limit_reached");
  const lastAccountPublication = accountPosts
    .filter((item) => !isDryRunOnly(item) && countedStatuses.has(item.status))
    .map(activityTime)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((left, right) => right - left)[0];
  if (!dryRun && lastAccountPublication && (scheduledAt - lastAccountPublication) / 60_000 < authorization.rateLimits.minIntervalMinutes) reasons.push("campaign_minimum_interval_not_met");
  const inFlight = campaignPosts.filter((item) => ["publishing", "processing"].includes(item.status) ||
    (item.status === "submit_result_unknown" && ((state.executionLeases || []).some((lease) => lease.jobId === item.id && Date.parse(lease.expiresAt) > now.getTime()) ||
      (state.executionRequests || []).some((request) => request.jobId === item.id && request.state === "EXECUTING"))));
  if (!dryRun && inFlight.length >= authorization.rateLimits.maxConcurrency) reasons.push("campaign_concurrency_limit_reached");

  const duplicateIdentity = post.idempotencyKey && campaignPosts.some((item) => !["failed", "rejected", "removed"].includes(item.status) && (
    item.idempotencyKey === post.idempotencyKey || publicationIdentityKeysForPost(item, state).includes(post.idempotencyKey)
  ));
  if (duplicateIdentity) reasons.push("publication_identity_exists");
  if ((state.submissionUncertainties || []).some((item) => item.status === "UNKNOWN" && (item.jobId === post.id || item.idempotencyKeys?.includes(post.idempotencyKey)))) reasons.push("submission_uncertain");
  const normalizedContent = normalizeDuplicateContent(post.content);
  const repeatedContent = normalizedContent && authorization.contentBoundary?.allowRepeatSameContent !== true && (state.posts || []).some((item) => {
    if (item.id === post.id || ["failed", "rejected", "removed"].includes(item.status) || normalizeDuplicateContent(item.content) !== normalizedContent) return false;
    if (!hasPossibleExternalSubmission(item, state)) return false;
    const itemTarget = state.targets?.find((targetItem) => targetItem.id === item.targetId);
    return itemTarget?.channel === target?.channel && itemTarget?.accountId === target?.accountId;
  });
  if (repeatedContent) reasons.push("duplicate_content_for_account");
  return { allowed: reasons.length === 0, reasons, authorization, target, oneTimeWindow };
}

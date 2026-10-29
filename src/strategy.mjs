import { createHash } from "node:crypto";
import { evaluateQueue } from "./guards.mjs";
import { publicationIdentityKeysForPost } from "./campaign-authorization.mjs";
import { isNormalizedPostAttributionContext, normalizePostAttributionContext } from "./learning.mjs";
import { projectEngagementContext } from "./engagement-context.mjs";
import { retrieveBoundedMemory } from "./oi-browser-integration.mjs";

const ACTIONS = new Set(["publish", "engage", "research", "wait", "do_nothing"]);
const MAX_DECISIONS = 24;
const MAX_REASONS = 8;
const MAX_EVIDENCE = 12;
const MAX_TEXT = 180;
const LEARNING_REASONS = new Set([
  "outcome_summary_missing",
  "submission_unknown_quarantined",
  "metrics_not_collected",
  "measured_response_present",
  "measured_outcome_without_response",
  "metrics_unknown_or_unsupported"
]);

const MARKET_SOURCES = new Set(["auto-gtm", "social", "linkedin", "reddit", "facebook", "threads", "product-hunt", "indie-hackers"]);

function text(value, max = MAX_TEXT) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) { return createHash("sha256").update(stable(value)).digest("hex"); }

function evidence(refs = []) {
  return [...new Set(refs.map((item) => text(item, 120)).filter(Boolean))].sort().slice(0, MAX_EVIDENCE);
}

function reasons(values = []) {
  return [...new Set(values.map((item) => text(item, MAX_TEXT)).filter(Boolean))].sort().slice(0, MAX_REASONS);
}

function productReady(campaign) {
  const intelligence = campaign?.productIntelligence;
  const handoff = intelligence?.handoff;
  const document = intelligence?.document;
  const required = ["WHAT_IS_IT", "WHAT_PROBLEM_DOES_IT_SOLVE", "WHY_IS_IT_BETTER", "WHO_NEEDS_IT"];
  return handoff?.readinessStatus === "READY" && required.every((field) => document?.[field]?.text && document[field].evidenceRefs?.length);
}

const ATTRIBUTION_STATUSES = new Set(["UNKNOWN", "VERIFIED", "PARTIAL", "UNOBSERVED"]);

function boundedIdentity(value, max = 160) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max || /(?:password|secret|token|cookie|session|credential|bearer)/i.test(text)) return null;
  return text;
}

function identityFingerprint(value) {
  const text = boundedIdentity(value);
  return text ? createHash("sha256").update(text).digest("hex").slice(0, 16) : null;
}

function attributionRowsMatchCampaign(state, campaign, summary) {
  const rows = Array.isArray(summary?.postAttributions) ? summary.postAttributions : [];
  const posts = (state.posts || []).filter((post) => post.campaignId === campaign.id);
  const postById = new Map(posts.map((post) => [post.id, post]));
  const targets = state.targets || [];
  return rows.every((row) => {
    if (!row || typeof row !== "object" || !ATTRIBUTION_STATUSES.has(String(row.status || "").toUpperCase())) return false;
    const post = postById.get(row.postId);
    if (!post) return false;
    const target = targets.find((item) => item.id === post.targetId);
    if (!target || !row.target || typeof row.target !== "object") return false;
    const expected = {
      targetId: boundedIdentity(target.id),
      channel: boundedIdentity(target.channel, 80),
      accountFingerprint: identityFingerprint(target.accountId),
      profileFingerprint: identityFingerprint(target.profileId)
    };
    const accountMatches = boundedIdentity(row.target.accountId) === boundedIdentity(target.accountId)
      || boundedIdentity(row.target.accountFingerprint, 16) === expected.accountFingerprint;
    const profileMatches = boundedIdentity(row.target.profileId) === boundedIdentity(target.profileId)
      || boundedIdentity(row.target.profileFingerprint, 16) === expected.profileFingerprint;
    return boundedIdentity(row.target.targetId) === expected.targetId
      && boundedIdentity(row.target.channel, 80) === expected.channel
      && accountMatches
      && profileMatches;
  });
}

function currentLearningContext(state, campaign) {
  const feedback = campaign?.latestLearningFeedback;
  if (!feedback || feedback.advisory !== true || feedback.authoritySideEffects !== false || feedback.campaignId !== campaign.id) return null;
  if (!/^learning-[a-f0-9]{24}$/.test(String(feedback.feedbackId || ""))) return null;
  if (!ACTIONS.has(feedback.action) || !Array.isArray(feedback.reasons) || feedback.reasons.length === 0) return null;
  if (feedback.reasons.some((reason) => !LEARNING_REASONS.has(reason))) return null;

  const summary = campaign.outcomeSummary || null;
  const summaryId = summary?.summaryId || null;
  if (summaryId && !/^outcome-[a-f0-9]{24}$/.test(summaryId)) return null;
  if ((feedback.outcomeSummaryId || null) !== summaryId) return null;
  if (summary?.campaignId && summary.campaignId !== campaign.id) return null;

  let postAttributionContext = null;
  if (feedback.postAttributionContext !== undefined) {
    if (!isNormalizedPostAttributionContext(feedback.postAttributionContext)) return null;
    if (!attributionRowsMatchCampaign(state, campaign, summary)) return null;
    const currentContext = normalizePostAttributionContext(summary);
    if (JSON.stringify(currentContext) !== JSON.stringify(feedback.postAttributionContext)) return null;
    postAttributionContext = feedback.postAttributionContext;
  }

  return {
    feedbackId: feedback.feedbackId,
    outcomeSummaryId: summaryId,
    observedAction: feedback.action,
    reasonCodes: [...new Set(feedback.reasons)].sort().slice(0, MAX_REASONS),
    ...(postAttributionContext ? { postAttributionContext } : {})
  };
}

function unknownForCampaign(state, campaignId, posts = []) {
  const postIds = new Set(posts.map((post) => post.id).filter(Boolean));
  const publicationAttemptIds = new Set(posts.map((post) => post.publicationAttemptId).filter(Boolean));
  const executionIds = new Set();
  for (const request of state.executionRequests || []) {
    if (postIds.has(request.jobId) && request.executionId) executionIds.add(request.executionId);
  }
  for (const receipt of state.executionReceipts || []) {
    if (postIds.has(receipt.jobId) && receipt.executionId) executionIds.add(receipt.executionId);
  }
  for (const lease of state.executionLeases || []) {
    if (postIds.has(lease.jobId) && lease.executionId) executionIds.add(lease.executionId);
  }
  for (const attempt of state.publicationAttempts || []) {
    if (postIds.has(attempt.postId) && attempt.executionId) executionIds.add(attempt.executionId);
  }
  const publicationKeys = new Set(posts.flatMap((post) => [
    post.idempotencyKey,
    ...publicationIdentityKeysForPost(post, state)
  ]).filter(Boolean));
  return (state.submissionUncertainties || []).some((item) => item.status === "UNKNOWN" && (
    item.campaignId === campaignId ||
    postIds.has(item.jobId) ||
    postIds.has(item.postId) ||
    publicationAttemptIds.has(item.publicationAttemptId) ||
    executionIds.has(item.executionId) ||
    (Array.isArray(item.idempotencyKeys) && item.idempotencyKeys.some((key) => publicationKeys.has(key)))
  ));
}

function relevantDiscoveries(campaign) {
  return (campaign?.discovery?.observations || [])
    .filter((item) => item.status === "ELIGIBLE" && item.classification?.label === "RELEVANT")
    // Newer observations carry explicit audience/channel/locale fit evidence.
    // A known mismatch or unknown fit must not become an actionable advisory
    // candidate. Legacy records without fit remain compatible and continue to
    // use the prior policy/relevance gate.
    .filter((item) => !item.fit || item.fit.eligible === true)
    .sort((a, b) => (b.score?.score || 0) - (a.score?.score || 0) || String(a.discoveryId).localeCompare(String(b.discoveryId)));
}

function marketOpportunityIdentity(value) {
  const candidate = text(value, 180);
  return /^[A-Za-z0-9._:-]{1,180}$/.test(candidate) ? candidate : null;
}

function relevantMarketOpportunities(campaign, opportunities = []) {
  if (!Array.isArray(opportunities)) return [];
  const campaignProductId = boundedIdentity(campaign?.productId, 200) || boundedIdentity(campaign?.id, 200);
  return opportunities
    .filter((item) => {
      if (!item || typeof item !== "object" || item.advisory !== true || item.authoritySideEffects !== false || item.externalSideEffects !== false) return false;
      const opportunityId = marketOpportunityIdentity(item.opportunityId);
      const source = text(item.source, 80).toLowerCase();
      const evidenceRefs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs.filter((ref) => boundedIdentity(ref, 500)) : [];
      const freshnessState = String(item.freshness?.state || "").toUpperCase();
      const campaignMatch = item.campaignId != null && String(item.campaignId) === String(campaign.id);
      const productMatch = item.campaignId == null && boundedIdentity(item.productId, 200) === campaignProductId;
      return Boolean(opportunityId && MARKET_SOURCES.has(source) && evidenceRefs.length && freshnessState === "FRESH" && (campaignMatch || productMatch));
    })
    .map((item) => ({
      opportunityId: marketOpportunityIdentity(item.opportunityId),
      source: text(item.source, 80).toLowerCase(),
      productId: boundedIdentity(item.productId, 200),
      campaignId: boundedIdentity(item.campaignId, 200),
      segment: text(item.segment, 180),
      audience: text(item.audience, 180),
      painPoint: text(item.painPoint, 240),
      fitScore: Number.isFinite(item.fitScore) ? item.fitScore : null,
      whyNowScore: Number.isFinite(item.whyNowScore) ? item.whyNowScore : null,
      reachScore: Number.isFinite(item.reachScore) ? item.reachScore : null,
      evidenceRefs: [...new Set(item.evidenceRefs.filter((ref) => boundedIdentity(ref, 500)))].slice(0, MAX_EVIDENCE),
      discoveredAt: text(item.discoveredAt, 80),
      freshness: { state: "FRESH", ageMs: Number.isFinite(item.freshness?.ageMs) ? item.freshness.ageMs : null },
      provenance: item.provenance && typeof item.provenance === "object" ? {
        source: text(item.provenance.source, 80),
        feedGeneratedAt: text(item.provenance.feedGeneratedAt, 80),
        leadId: marketOpportunityIdentity(item.provenance.leadId),
        signalId: marketOpportunityIdentity(item.provenance.signalId)
      } : null
    }))
    .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || (b.whyNowScore ?? -1) - (a.whyNowScore ?? -1) || a.opportunityId.localeCompare(b.opportunityId));
}

function campaignReplies(state, campaignId) {
  const postIds = new Set((state.posts || []).filter((post) => post.campaignId === campaignId).map((post) => post.id));
  const interactions = new Map((state.interactions || []).filter((item) => postIds.has(item.postId)).map((item) => [item.id, item]));
  return (state.replies || []).filter((reply) => {
    const interaction = interactions.get(reply.interactionId);
    return interaction && ["draft", "approved"].includes(reply.status) && reply.groundingSources?.length && reply.groundingSummary;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function engagementContextSummary(state, campaignId, now) {
  const context = projectEngagementContext(state, { campaignId, now });
  const quarantined = context.conversations.filter((conversation) => conversation.status === "QUARANTINED").length;
  const actionable = context.conversations.filter((conversation) => conversation.status === "ACTIONABLE").length;
  return {
    schemaVersion: context.schemaVersion,
    campaignRef: context.campaignRef,
    total: context.total,
    candidateTotal: context.candidateTotal,
    actionable,
    quarantined,
    truncated: context.truncated,
    candidateTruncated: context.candidateTruncated,
    authoritySideEffects: context.authoritySideEffects,
    externalSideEffects: context.externalSideEffects
  };
}

function dynamicWaitReasons(posts, schedules, now) {
  const reasonsFound = [];
  if (schedules.some((schedule) => schedule.status === "active" && schedule.campaignId === posts[0]?.campaignId)) reasonsFound.push("active_schedule");
  for (const post of posts) {
    const scheduled = Date.parse(post.scheduledAt || "");
    if (Number.isFinite(scheduled) && scheduled > now.getTime()) reasonsFound.push("scheduled_time_not_due");
    for (const reason of post.authorizationDecision?.reasons || []) {
      if (["minimum_interval_not_met", "campaign_minimum_interval_not_met", "daily_limit_reached", "campaign_daily_limit_reached", "account_daily_limit_reached", "campaign_concurrency_limit_reached"].includes(reason)) reasonsFound.push(reason);
    }
  }
  return [...new Set(reasonsFound)].sort();
}

function memoryTargetPreference(memoryItems = [], campaign = null) {
  return memoryItems.find((item) => item.kind === "LEARNING" && (item.evidenceStatus !== "FIXTURE_VERIFIED" || campaign?.testJob === true) && ["FIXTURE_VERIFIED", "RUNTIME_VERIFIED", "VERIFIED", "MEASURED"].includes(item.evidenceStatus) && Number(item.supportCount) >= 2 && /^prefer_target:[^\s]+$/.test(String(item.decisionHint || ""))) || null;
}

/** Deterministic advisory strategy. It reads state and never creates execution authority. */
export function deriveStrategyDecision(state, campaignId, { now = new Date(), providerDecision = null, marketOpportunities = [] } = {}) {
  const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
  const posts = (state.posts || []).filter((post) => post.campaignId === campaignId).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const discoveries = relevantDiscoveries(campaign);
  const market = relevantMarketOpportunities(campaign, marketOpportunities);
  const base = { campaignId, timestampBucket: Math.floor(now.getTime() / (15 * 60 * 1000)) };
  let action = "do_nothing";
  let score = 0;
  let eligible = false;
  let candidateId = null;
  let reasonList = [];
  let refs = [];
  let learning = null;
  let memoryContext = null;
  let providerContext = null;
  let engagementContext = null;
  if (!productReady(campaign)) {
    reasonList = ["product_intelligence_incomplete"];
  } else if (unknownForCampaign(state, campaignId, posts)) {
    reasonList = ["submission_unknown_quarantined"];
  } else {
    if (providerDecision && typeof providerDecision === "object") {
      providerContext = {
        decisionId: providerDecision.decisionId || null,
        providerId: providerDecision.providerId || null,
        status: providerDecision.status || "FAILED",
        failure: providerDecision.failure || null
      };
    }
    const remembered = retrieveBoundedMemory(state, { scope: { campaignId }, limit: 8, now });
    if (remembered.length) {
      memoryContext = remembered.map((item) => ({ id: item.id, kind: item.kind, confidence: item.confidence, supportCount: item.supportCount, evidenceRefs: item.evidenceRefs, decisionHint: item.decisionHint }));
    }
    learning = currentLearningContext(state, campaign);
    const publishable = [];
    for (const post of posts) {
      if (!["draft", "approved", "queued", "blocked"].includes(post.status) || !post.content?.trim()) continue;
      const target = (state.targets || []).find((item) => item.id === post.targetId);
      if (!target || target.status !== "active") continue;
      const decision = evaluateQueue(post, state, now, { mode: "dry_run" });
      if (decision.allowed) publishable.push({ post, decision });
    }
    if (publishable.length) {
      const preference = memoryTargetPreference(remembered, campaign);
      const selected = preference
        ? publishable.find(({ post }) => `prefer_target:${post.targetId}` === preference.decisionHint) || publishable[0]
        : publishable[0];
      action = "publish"; score = 100; eligible = true; candidateId = selected.post.id;
      reasonList = ["product_intelligence_ready", "target_policy_and_queue_checks_pass"];
      refs = [`post:${selected.post.id}`, `target:${selected.post.targetId}`];
      if (preference && `prefer_target:${selected.post.targetId}` === preference.decisionHint) {
        reasonList.push("oi_memory_strategy_applied");
        refs.push(`memory:${preference.id}`);
      }
    } else if (market.length) {
      const opportunity = market[0];
      action = "research"; score = 50; eligible = true; candidateId = opportunity.opportunityId;
      reasonList = ["market_opportunity", "evidence_backed_market_signal"];
      refs = [`market-opportunity:${opportunity.opportunityId}`, ...opportunity.evidenceRefs];
    } else if (discoveries.length) {
      engagementContext = engagementContextSummary(state, campaignId, now);
      const reply = campaignReplies(state, campaignId);
      const discovery = discoveries[0];
      if (reply.length) {
        action = "engage"; score = 75; eligible = true; candidateId = reply[0].id;
        reasonList = ["relevant_discovery", "grounded_reply_opportunity"];
        refs = [`discovery:${discovery.discoveryId}`, `reply:${reply[0].id}`];
      } else {
        action = "research"; score = 50; eligible = true; candidateId = discovery.discoveryId;
        reasonList = ["relevant_discovery", "no_grounded_action_draft"];
        refs = [`discovery:${discovery.discoveryId}`];
      }
      if (engagementContext.total > 0) reasonList.push("engagement_context_observed");
      if (engagementContext.candidateTotal > 0) reasonList.push("engagement_context_actionable_candidate");
      if (engagementContext.total > 0) refs.push(`engagement-context:${campaignId}`);
    } else {
      const waiting = dynamicWaitReasons(posts, state.schedules || [], now);
      if (waiting.length) { action = "wait"; score = 20; eligible = false; reasonList = waiting; }
      else reasonList = ["no_safe_action_candidate"];
    }
    if (learning) {
      reasonList.push("current_learning_feedback_observed");
      refs.push(`learning:${learning.feedbackId}`);
      if (learning.outcomeSummaryId) refs.push(`outcome:${learning.outcomeSummaryId}`);
    }
    if (memoryContext) {
      reasonList.push("oi_memory_observed");
      refs.push(...memoryContext.slice(0, 4).map((item) => `memory:${item.id}`));
    }
    if (providerContext) {
      reasonList.push(providerContext.status === "SUCCEEDED" ? "provider_route_observed" : "provider_route_failed");
      if (providerContext.decisionId) refs.push(`provider:${providerContext.decisionId}`);
    }
  }
  const core = { ...base, action, score, eligible, candidateId, reasons: reasons(reasonList), evidence: evidence(refs) };
  if (market.length && action === "research" && candidateId === market[0].opportunityId) core.marketOpportunity = market[0];
  if (learning) core.learningContext = learning;
  if (memoryContext) core.memoryContext = memoryContext;
  if (providerContext) core.providerContext = providerContext;
  if (engagementContext) core.engagementContext = engagementContext;
  return { ...core, decisionId: `strategy-${digest(core).slice(0, 24)}`, createdAt: now.toISOString(), advisory: true, authoritySideEffects: false };
}

export function appendStrategyDecision(campaign, decision) {
  const prior = Array.isArray(campaign.strategyDecisions) ? campaign.strategyDecisions : [];
  const withoutDuplicate = prior.filter((item) => item.decisionId !== decision.decisionId);
  campaign.strategyDecisions = [...withoutDuplicate, decision].slice(-MAX_DECISIONS);
  campaign.strategyUpdatedAt = decision.createdAt;
  return decision;
}

export { MAX_DECISIONS };

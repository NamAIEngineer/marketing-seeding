import { createHash } from "node:crypto";
import { canonicalIdentityUrl, canonicalProvider, canonicalTargetUrl } from "./execution-binding.mjs";

const METRIC_FIELDS = Object.freeze(["impressions", "reactions", "comments", "shares", "clicks", "leads"]);
const MAX_HISTORY = 24;
const MAX_ITEMS = 100;
const ATTRIBUTION_STATUSES = Object.freeze(["VERIFIED", "UNKNOWN", "PARTIAL", "UNOBSERVED"]);

function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function bounded(items) { return (Array.isArray(items) ? items : []).slice(-MAX_ITEMS); }
function boundedSortedIds(items) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => String(item ?? "").trim()).filter((item) => item && item.length <= 160 && !/(?:password|secret|token|cookie|session|credential|bearer)/i.test(item)))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .slice(0, MAX_ITEMS);
}
function timestampOf(item) {
  const value = item?.capturedAt || item?.verifiedAt || item?.createdAt || item?.occurredAt || item?.preparedAt || item?.detectedAt || "";
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : -Infinity;
}
function latestBy(items, key) {
  const map = new Map();
  const ordered = (Array.isArray(items) ? items : [])
    .slice()
    .sort((left, right) => {
      const timeDelta = timestampOf(left) - timestampOf(right);
      if (timeDelta) return timeDelta;
      const leftId = String(left?.id || "");
      const rightId = String(right?.id || "");
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    })
    .slice(-MAX_ITEMS);
  for (const item of ordered) {
    const id = item?.[key]; if (!id) continue;
    const prior = map.get(id);
    const itemKey = JSON.stringify(item);
    const priorKey = JSON.stringify(prior);
    if (!prior || timestampOf(item) > timestampOf(prior)
      || (timestampOf(item) === timestampOf(prior) && itemKey > priorKey)) map.set(id, item);
  }
  return new Map([...map.entries()].sort(([left], [right]) => String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0));
}

function safeReference(value, max = 500) {
  const text = String(value || "").trim();
  if (!text || /(?:password|secret|token|cookie|session|credential|bearer)/i.test(text)) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  } catch {
    // Non-URL evidence references are allowed, but remain bounded.
  }
  return text.slice(0, max);
}

function safeIdentifier(value, max = 160) {
  const text = String(value || "").trim();
  return text && text.length <= max ? safeReference(text, max) : null;
}

function postLinked(row, postId, requestByExecution = new Map()) {
  const receipt = row?.receipt || row || {};
  if ([row?.postId, row?.jobId, receipt.postId, receipt.jobId].some((value) => value === postId)) return true;
  const executionId = row?.executionId || receipt.executionId;
  return Boolean(executionId && requestByExecution.get(executionId)?.jobId === postId);
}

function publicationEvidenceFor(row) {
  const receipt = row?.receipt || row || {};
  return receipt.publicationEvidence || receipt.publicationVerification || null;
}

function isStrongPublicationEvidence({ post, target, account, row }) {
  const receipt = row?.receipt || row || {};
  const evidence = publicationEvidenceFor(row);
  if (!evidence || receipt.submitState !== "CONFIRMED" || post.status !== "published" || !post.publicationUrl) return false;
  if (evidence.accountMatched !== true || evidence.targetMatched !== true || evidence.contentHashMatched !== true) return false;
  if (!target?.id || !target.channel || !target.accountId || !target.profileId) return false;
  if (evidence.targetId !== target.id || evidence.accountId !== target.accountId || evidence.profileId !== target.profileId) return false;
  const provider = canonicalProvider(target.provider || account?.provider, { allowLegacy: true });
  const providerProfileId = target.providerProfileId || account?.providerProfileId || target.profileId;
  const identityReference = canonicalIdentityUrl(target.identityReference || target.expectedIdentityUrl || account?.identityReference || account?.expectedIdentityUrl);
  const observedProvider = receipt.provider || evidence.provider;
  const observedProfile = receipt.providerProfileId || evidence.providerProfileId;
  const observedIdentity = receipt.identityReference || evidence.identityReference;
  const observedTargetUrl = receipt.targetUrl || evidence.targetUrl;
  if (observedProvider && canonicalProvider(observedProvider, { allowLegacy: true }) !== provider) return false;
  if (provider !== "orca" && (canonicalProvider(observedProvider, { allowLegacy: true }) !== provider || observedProfile !== providerProfileId || canonicalIdentityUrl(observedIdentity) !== identityReference || canonicalTargetUrl(observedTargetUrl) !== canonicalTargetUrl(target.url))) return false;
  if (observedProfile && observedProfile !== providerProfileId) return false;
  if (observedIdentity && canonicalIdentityUrl(observedIdentity) !== identityReference) return false;
  if (observedTargetUrl && canonicalTargetUrl(observedTargetUrl) !== canonicalTargetUrl(target.url)) return false;
  const contentHash = createHash("sha256").update(String(post.content || "")).digest("hex");
  if (evidence.contentHash !== contentHash || receipt.publicationUrl !== post.publicationUrl) return false;
  return Number.isFinite(Date.parse(String(evidence.verifiedAt || "")));
}

function isStrongPostVerification({ post, target, account }) {
  const evidence = post.publicationVerification || post.verificationEvidence || null;
  if (!evidence || !post.publicationUrl || post.status !== "published") return false;
  const state = String(evidence.state || evidence.verificationState || "").toUpperCase();
  if (!["VERIFIED", "CONFIRMED"].includes(state)) return false;
  if (evidence.accountMatched !== true || evidence.targetMatched !== true || evidence.contentHashMatched !== true) return false;
  if (!target?.id || !target.channel || !target.accountId || !target.profileId) return false;
  if (evidence.targetId !== target.id || evidence.accountId !== target.accountId || evidence.profileId !== target.profileId) return false;
  const provider = canonicalProvider(target.provider || account?.provider, { allowLegacy: true });
  const providerProfileId = target.providerProfileId || account?.providerProfileId || target.profileId;
  const identityReference = canonicalIdentityUrl(target.identityReference || target.expectedIdentityUrl || account?.identityReference || account?.expectedIdentityUrl);
  const observedProvider = evidence.provider;
  const observedProfile = evidence.providerProfileId;
  const observedIdentity = evidence.identityReference;
  const observedTargetUrl = evidence.targetUrl;
  if (observedProvider && canonicalProvider(observedProvider, { allowLegacy: true }) !== provider) return false;
  if (provider !== "orca" && (canonicalProvider(observedProvider, { allowLegacy: true }) !== provider || observedProfile !== providerProfileId || canonicalIdentityUrl(observedIdentity) !== identityReference || canonicalTargetUrl(observedTargetUrl) !== canonicalTargetUrl(target.url))) return false;
  if (observedProfile && observedProfile !== providerProfileId) return false;
  if (observedIdentity && canonicalIdentityUrl(observedIdentity) !== identityReference) return false;
  if (observedTargetUrl && canonicalTargetUrl(observedTargetUrl) !== canonicalTargetUrl(target.url)) return false;
  const contentHash = createHash("sha256").update(String(post.content || "")).digest("hex");
  if (evidence.contentHash !== contentHash) return false;
  if (evidence.publicationUrl && evidence.publicationUrl !== post.publicationUrl) return false;
  return Number.isFinite(Date.parse(String(evidence.verifiedAt || post.publishedAt || "")));
}

function metricProjection(snapshot) {
  if (!snapshot) return null;
  return {
    snapshotId: String(snapshot.id || "").trim() || null,
    capturedAt: snapshot.capturedAt || null,
    values: Object.fromEntries(METRIC_FIELDS.map((field) => [field, Number.isSafeInteger(snapshot[field]) ? snapshot[field] : null])),
    coverage: Object.fromEntries(METRIC_FIELDS.map((field) => [field, String(snapshot.coverage?.[field] || (Number.isSafeInteger(snapshot[field]) ? "measured" : "unknown"))]))
  };
}

/**
 * Derive bounded, explicit-link-only outcome evidence for each campaign post.
 * This is an advisory projection. It does not mutate state or grant execution
 * authority. UNKNOWN always dominates any positive or partial observation.
 */
export function derivePostOutcomeAttributions(state, campaignId, { posts, targets, receipts, uncertainties, requests, attempts, metricSnapshots, interactions, replies, conversions } = {}) {
  const campaignPosts = (posts || (state?.posts || []).filter((post) => post.campaignId === campaignId))
    .filter((post) => post?.campaignId === campaignId)
    .sort((left, right) => String(left.id || "") < String(right.id || "") ? -1 : String(left.id || "") > String(right.id || "") ? 1 : 0)
    .slice(0, MAX_ITEMS);
  const requestByExecution = new Map((requests || state?.executionRequests || []).map((request) => [String(request.executionId || ""), request]).filter(([id]) => id));
  const targetRows = targets || state?.targets || [];
  const accountRows = state?.executionAccounts || [];
  const receiptRows = receipts || state?.executionReceipts || [];
  const uncertaintyRows = uncertainties || state?.submissionUncertainties || [];
  const attemptRows = attempts || state?.publicationAttempts || [];
  const metricRows = metricSnapshots || state?.metricSnapshots || [];
  const interactionRows = interactions || state?.interactions || [];
  const replyRows = replies || state?.replies || [];
  const conversionRows = conversions || state?.conversions || [];

  return campaignPosts.map((post) => {
    const target = targetRows.find((item) => item?.id === post.targetId) || null;
    const account = target && accountRows.find((item) => item?.id === `${target.channel}:${target.accountId}`) || null;
    const targetIdentity = {
      targetId: safeIdentifier(post.targetId),
      channel: safeIdentifier(target?.channel, 80),
      accountId: safeIdentifier(target?.accountId),
      profileId: safeIdentifier(target?.profileId)
    };
    const identityComplete = Boolean(targetIdentity.targetId && targetIdentity.channel && targetIdentity.accountId && targetIdentity.profileId);
    const postReceipts = receiptRows.filter((row) => postLinked(row, post.id, requestByExecution));
    const postUncertainties = uncertaintyRows.filter((item) => item?.postId === post.id || item?.jobId === post.id || attemptRows.some((attempt) => attempt?.id === item?.publicationAttemptId && attempt.postId === post.id));
    const postAttempts = attemptRows.filter((item) => item?.postId === post.id);
    const postMetrics = metricRows.filter((item) => item?.postId === post.id);
    const latestMetric = latestBy(postMetrics, "postId").get(post.id) || null;
    const postInteractions = interactionRows.filter((item) => item?.postId === post.id);
    const interactionIds = new Set(postInteractions.map((item) => item?.id).filter(Boolean));
    const postReplies = replyRows.filter((item) => interactionIds.has(item?.interactionId));
    const postConversions = conversionRows.filter((item) => item?.postId === post.id && (!item.campaignId || item.campaignId === campaignId));
    const activeUnknown = postUncertainties.some((item) => String(item?.status || "").toUpperCase() === "UNKNOWN");
    const orphanUnknownReceipt = postReceipts.some((row) => {
      const receipt = row?.receipt || row || {};
      if (String(receipt.submitState || "").toUpperCase() !== "UNKNOWN") return false;
      const executionId = row?.executionId || receipt.executionId;
      const linkedUncertainties = postUncertainties.filter((item) => item?.executionId === executionId);
      return linkedUncertainties.length === 0 || linkedUncertainties.some((item) => String(item?.status || "").toUpperCase() === "UNKNOWN");
    });
    const unknown = post.status === "submit_result_unknown" || activeUnknown || orphanUnknownReceipt;
    const verifiedRow = identityComplete && postReceipts.find((row) => isStrongPublicationEvidence({ post, target, account, row }));
    const verifiedPost = identityComplete && isStrongPostVerification({ post, target, account });
    const accepted = postReceipts.some((row) => {
      const receipt = row?.receipt || row || {};
      return Boolean(receipt.acceptanceEvidence || receipt.submitAcceptanceEvidence || receipt.submissionAccepted === true);
    });
    const hasObservation = Boolean(postAttempts.length || postReceipts.length || postMetrics.length || postInteractions.length || postReplies.length || postConversions.length || post.publicationUrl || post.status === "published");
    const status = unknown ? "UNKNOWN" : (verifiedRow || verifiedPost) ? "VERIFIED" : hasObservation ? "PARTIAL" : "UNOBSERVED";
    const verifiedEvidence = verifiedRow ? publicationEvidenceFor(verifiedRow) : (verifiedPost ? (post.publicationVerification || post.verificationEvidence) : null);
    const reasons = [];
    if (!identityComplete) reasons.push("target_identity_incomplete");
    if (unknown) reasons.push("submission_unknown");
    else if (status === "VERIFIED") reasons.push("canonical_publication_evidence");
    else if (accepted) reasons.push("platform_acceptance_observed");
    if (postMetrics.length) reasons.push("metric_snapshot_observed");
    if (postInteractions.length || postReplies.length) reasons.push("engagement_observed");
    if (postConversions.length) reasons.push("post_linked_conversion_observed");
    return {
      postId: safeIdentifier(post.id),
      status: ATTRIBUTION_STATUSES.includes(status) ? status : "UNOBSERVED",
      target: targetIdentity,
      publication: {
        accepted,
        publicationUrl: safeReference(post.publicationUrl || verifiedEvidence?.publicationUrl),
        publicationReference: safeReference((verifiedRow?.receipt || verifiedRow)?.publicationReference || verifiedEvidence?.publicationReference, 240),
        verifiedAt: safeReference(verifiedEvidence?.verifiedAt, 40)
      },
      metrics: metricProjection(latestMetric),
      engagement: {
        interactions: postInteractions.length,
        openInteractions: postInteractions.filter((item) => item.status === "open").length,
        replies: postReplies.length,
        sentReplies: postReplies.filter((item) => item.status === "sent").length
      },
      conversions: { count: postConversions.length, ids: boundedSortedIds(postConversions.map((item) => item.id)) },
      evidence: {
        receiptIds: boundedSortedIds(postReceipts.map((item) => item.id)),
        executionIds: boundedSortedIds(postReceipts.map((item) => item.executionId || item.receipt?.executionId)),
        uncertaintyIds: boundedSortedIds(postUncertainties.map((item) => item.id)),
        attemptIds: boundedSortedIds(postAttempts.map((item) => item.id)),
        metricSnapshotIds: boundedSortedIds(postMetrics.map((item) => item.id)),
        interactionIds: boundedSortedIds(postInteractions.map((item) => item.id)),
        replyIds: boundedSortedIds(postReplies.map((item) => item.id))
      },
      reasons: boundedSortedIds(reasons)
    };
  });
}

export function deriveOutcomeSummary(state, campaignId, { now = new Date() } = {}) {
  const campaign = (state?.campaigns || []).find((item) => item.id === campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
  const posts = (state.posts || []).filter((post) => post.campaignId === campaignId);
  const postIds = new Set(posts.map((post) => post.id));
  const receipts = (state.executionReceipts || []).filter((receipt) => postIds.has(receipt.postId || receipt.jobId));
  const uncertainties = (state.submissionUncertainties || []).filter((item) => postIds.has(item.jobId || item.postId));
  const statuses = {};
  for (const post of posts) statuses[post.status || "unknown"] = (statuses[post.status || "unknown"] || 0) + 1;
  const verifiedPosts = posts.filter((post) => post.status === "published" && post.publicationUrl && (post.publicationVerification || post.verificationEvidence || receipts.some((row) => { const receipt = row.receipt || row; const evidence = receipt.publicationEvidence || receipt.publicationVerification || {}; return (row.postId || row.jobId || receipt.jobId) === post.id && (receipt.submitState === "CONFIRMED" || evidence.state === "VERIFIED" || evidence.verificationState === "VERIFIED" || receipt.verificationState === "VERIFIED"); })));
  const accepted = receipts.filter((row) => {
    const receipt = row.receipt || row;
    return receipt.acceptanceEvidence || receipt.submitAcceptanceEvidence || receipt.submissionAccepted === true;
  }).length;
  const unknown = uncertainties.filter((item) => String(item.status).toUpperCase() === "UNKNOWN").length;
  const publication = {
    totalPosts: posts.length,
    statusCounts: statuses,
    verified: verifiedPosts.length,
    accepted,
    unknown,
    unverified: Math.max(0, posts.length - verifiedPosts.length),
    verifiedPostIds: verifiedPosts.map((post) => post.id).slice(-MAX_ITEMS),
    unknownExecutionIds: uncertainties.filter((item) => String(item.status).toUpperCase() === "UNKNOWN").map((item) => item.executionId || item.id).filter(Boolean).slice(-MAX_ITEMS)
  };
  const metrics = (state.metricSnapshots || []).filter((item) => postIds.has(item.postId));
  const latestMetrics = latestBy(metrics, "postId");
  const coverage = Object.fromEntries(METRIC_FIELDS.map((field) => [field, { measured: 0, unknown: 0, unsupported: 0 }]));
  const totals = {};
  for (const field of METRIC_FIELDS) totals[field] = null;
  for (const snapshot of latestMetrics.values()) for (const field of METRIC_FIELDS) {
    const status = snapshot.coverage?.[field] || (Number.isSafeInteger(snapshot[field]) ? "measured" : "unknown");
    coverage[field][status] = (coverage[field][status] || 0) + 1;
    if (status === "measured" && Number.isSafeInteger(snapshot[field])) totals[field] = (totals[field] || 0) + snapshot[field];
  }
  const interactions = (state.interactions || []).filter((item) => postIds.has(item.postId));
  const replies = (state.replies || []).filter((item) => interactions.some((interaction) => interaction.id === item.interactionId));
  const conversions = (state.conversions || []).filter((item) => item.campaignId === campaignId || postIds.has(item.postId));
  const unassignedConversionIds = boundedSortedIds(conversions.filter((item) => !item.postId || !postIds.has(item.postId)).map((item) => item.id));
  const keywords = (state.keywordSnapshots || []).filter((item) => item.campaignId === campaignId).slice(-MAX_ITEMS).map((item) => ({ keyword: item.keyword || null, capturedAt: item.capturedAt || null, coverage: item.coverage || null, values: Object.fromEntries(METRIC_FIELDS.map((field) => [field, Number.isSafeInteger(item[field]) ? item[field] : null])) }));
  const postAttributions = derivePostOutcomeAttributions(state, campaignId, { posts, receipts: state.executionReceipts, uncertainties, requests: state.executionRequests, attempts: state.publicationAttempts, metricSnapshots: state.metricSnapshots, interactions: state.interactions, replies: state.replies, conversions, targets: state.targets });
  const summary = {
    schemaVersion: 1, campaignId, generatedAt: new Date(now).toISOString(),
    publication, metrics: { snapshots: latestMetrics.size, totals, coverage },
    engagement: { interactions: interactions.length, openInteractions: interactions.filter((item) => item.status === "open").length, replies: replies.length, sentReplies: replies.filter((item) => item.status === "sent").length, conversions: conversions.length },
    postAttributions,
    unassignedConversionIds,
    keywords,
    evidence: { postIds: posts.map((post) => post.id).slice(-MAX_ITEMS), receiptIds: receipts.map((r) => r.id).filter(Boolean).slice(-MAX_ITEMS), metricSnapshotIds: [...latestMetrics.values()].map((m) => m.id).filter(Boolean).slice(-MAX_ITEMS) }
  };
  summary.summaryId = `outcome-${digest({ ...summary, generatedAt: new Date(now).toISOString().slice(0, 13) }).slice(0, 24)}`;
  return summary;
}

export function appendOutcomeSummary(campaign, summary) {
  const prior = Array.isArray(campaign.outcomeSummaries) ? campaign.outcomeSummaries : [];
  campaign.outcomeSummaries = [...prior.filter((item) => item.summaryId !== summary.summaryId), summary].slice(-MAX_HISTORY);
  campaign.outcomeSummary = summary;
  campaign.outcomeUpdatedAt = summary.generatedAt;
  return summary;
}

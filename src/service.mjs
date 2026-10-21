import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { CHANNELS, nowIso } from "./constants.mjs";
import { approvalFingerprint, assertReplyCanSend, assertTransition, evaluateQueue, killSwitchReasons } from "./guards.mjs";
import { collectOfficialMetrics, integrationReadiness } from "./integrations.mjs";
import { buildMarketingFlowGraph } from "./flow-graph.mjs";
import { campaignAuthorizationFingerprint, campaignContentHash, campaignScopeFingerprint, evaluateCampaignAuthorization, normalizeCampaignAuthorization, publicationIdentityKey, publicationIdentityKeysForPost } from "./campaign-authorization.mjs";
import { classifyReadinessError, configuredReadinessTtlMs, executionAccountIdentityReference, executionAccountKey, isCanonicalOrcaProfileId, isReadinessFresh, normalizeExecutionAccount, normalizeReadinessResult, readinessBinding, MAX_READINESS_ATTEMPTS } from "./readiness.mjs";
import { contentSha256, createExecutionRequestV1, isPreSubmitMediaIntegrityProven, PUBLICATION_CANDIDATE_MAX_AGE_MS, validateExecutionReceiptV1, validateSubmitAcceptanceEvidence } from "./execution-contracts.mjs";
import { assertWindowExecutionBinding, normalizeOneTimeExecutionWindow, oneTimeExecutionWindowFingerprint, oneTimeExecutionWindowInBounds, oneTimeExecutionWindowStatus } from "./one-time-execution-window.mjs";
import { assertLiveGrantMatchesExecution, createLiveExecutionGrantV1, liveGrantEffectiveStatus } from "./live-execution-grant.mjs";
import { defaultPlatformPolicies } from "./platform-policies.mjs";
import { ReadinessProviderRegistry } from "./platform-registries.mjs";
import { activeExecutionForPost, recordSubmissionUnknown, unresolvedSubmission, UNKNOWN_POST_STATUS } from "./submission-uncertainty.mjs";
import { deriveStandingExecutionControlPlan } from "./standing-campaign-delegation.mjs";
import { buildProductIntelligence, normalizeEvidenceRecords, productIntelligenceHash, serializeProductIntelligence } from "./product-intelligence.mjs";
import { createProductIntelligenceHandoff, validateProductIntelligenceHandoff } from "./product-intelligence-runtime.mjs";
import { processDiscoveries } from "./discovery.mjs";
import { observePublicUrls } from "./discovery-observer.mjs";
import { classifyRepository, createFactoryPlan, collectArtifactEvidence, discoverArtifactCandidates, executeStagedFactoryProbe, probeFactorySandboxCapability, probeSystemAgenticSeatbeltCapability, projectFactoryRunEvidence } from "./product-factory.mjs";
import { inspectRepositoryEvidence, summarizeRepositoryInspection } from "./product-repository-inspection.mjs";
import { appendStrategyDecision, deriveStrategyDecision } from "./strategy.mjs";
import { canonicalTemplateSourceRefs, contentCandidateIdentity, deriveContentCandidates, deriveProductIntelligenceStory, deriveTemplateContentCandidates, renderApprovedTemplate, templateCandidateBinding, templateClaimIds, TEMPLATE_CANDIDATE_CONTRACT_VERSION } from "./content-foundation.mjs";
import { appendLearningFeedback, deriveLearningFeedback } from "./learning.mjs";
import { appendOutcomeSummary, deriveOutcomeSummary } from "./outcome.mjs";
import { legacyHandoffIdentity, validateDistributionHandoff } from "./distribution-handoff.mjs";
import { projectEngagementContext } from "./engagement-context.mjs";
import { projectConversationContinuity } from "./conversation-continuity.mjs";
import { projectDiscoveryOpportunities } from "./opportunity-projection.mjs";
import { projectChannelCapabilities } from "./channel-capability-projection.mjs";
import { projectProductIntelligence } from "./product-intelligence-projection.mjs";
import { appRoot } from "./paths.mjs";
import { canonicalAudienceSerialization, deriveBootstrapAuthorizationId, deriveBootstrapIdentity, deriveBootstrapSchedule, normalizeBootstrapAudience, normalizeBootstrapProductKeys } from "./campaign-bootstrap.mjs";

export async function pollConfiguredDiscoveries(service, { actor = "scheduled-discovery-observer", shuttingDown = false } = {}) {
  const state = await service.snapshot();
  const results = [];
  for (const campaign of state.campaigns || []) {
    if (shuttingDown) break;
    const urls = Array.isArray(campaign.discoverySources) ? campaign.discoverySources : [];
    if (!urls.length) continue;
    try {
      const input = { urls };
      if (campaign.discoveryFit) input.fit = campaign.discoveryFit;
      const result = await service.observeDiscoveries(campaign.id, input, actor);
      results.push({ campaignId: campaign.id, requested: result.requested, accepted: result.persisted?.accepted || 0, unknown: (result.observations || []).filter((item) => item.observationStatus === "UNKNOWN").length });
    } catch (error) {
      results.push({ campaignId: campaign.id, ok: false, reason: String(error?.code || error?.message || "discovery_error").slice(0, 160) });
    }
  }
  return { campaigns: results.length, succeeded: results.filter((item) => item.ok !== false).length, failed: results.filter((item) => item.ok === false).length, results };
}

const READINESS_IGNORED_EXECUTION_REASONS = new Set([
  "schedule_timestamp_invalid",
  "schedule_outside_authorization_window",
  "schedule_not_due",
  "schedule_outside_allowed_window",
  "campaign_daily_limit_reached",
  "account_daily_limit_reached",
  "campaign_minimum_interval_not_met",
  "campaign_concurrency_limit_reached",
  "publication_identity_exists",
  "duplicate_content_for_account"
]);
const DYNAMIC_EXECUTION_REASONS = new Set([
  "schedule_not_due",
  "schedule_outside_allowed_window",
  "campaign_daily_limit_reached",
  "account_daily_limit_reached",
  "campaign_minimum_interval_not_met",
  "campaign_concurrency_limit_reached"
]);

const BOOTSTRAP_AUTHORIZATION_BLOCKER_MESSAGES = Object.freeze({
  campaign_daily_limit_reached: "The campaign daily post quota has been reached for the current policy day",
  account_daily_limit_reached: "The authorized LinkedIn account daily post quota has been reached for the current policy day",
  campaign_minimum_interval_not_met: "The campaign minimum interval has not elapsed since the last account activity",
  campaign_concurrency_limit_reached: "The campaign concurrency limit is currently exhausted",
  schedule_not_due: "The campaign schedule is not due yet",
  schedule_outside_allowed_window: "The campaign schedule is outside its allowed local window",
  schedule_outside_authorization_window: "The execution is outside the standing authorization validity window",
  campaign_authorization_expired: "The standing campaign authorization has expired",
  campaign_authorization_not_active: "The standing campaign authorization is not active",
  live_execution_not_authorized: "Live execution is not authorized by the standing campaign policy"
});

function bootstrapAuthorizationBlockers(post) {
  const readinessReason = String(post?.readinessReasonCode || "").trim();
  const reasons = [...new Set(post?.authorizationDecision?.reasons || [])]
    .map((reason) => String(reason || "").trim())
    .filter((reason) => reason && reason !== readinessReason);
  return reasons.map((reason) => ({
    code: reason,
    classification: "AUTHORIZATION_BLOCKER",
    message: BOOTSTRAP_AUTHORIZATION_BLOCKER_MESSAGES[reason] || `Execution authorization blocked: ${reason}`
  }));
}


const METRIC_FIELDS = Object.freeze(["impressions", "reactions", "comments", "shares", "clicks", "leads"]);
const METRIC_COVERAGE = new Set(["measured", "unknown", "unsupported"]);
const METRIC_CHECKPOINTS = Object.freeze([
  { key: "1h", offsetMs: 60 * 60 * 1000 },
  { key: "24h", offsetMs: 24 * 60 * 60 * 1000 },
  { key: "72h", offsetMs: 72 * 60 * 60 * 1000 }
]);

function normalizeSubmitTransportIdentity(value) {
  if (!value || typeof value !== "object") return null;
  const transport = String(value.transport || "").trim().slice(0, 80);
  const provider = String(value.provider || "").trim().slice(0, 80);
  const providerVersion = String(value.providerVersion || "").trim().slice(0, 80);
  if (!transport || !provider || !providerVersion) return null;
  return { transport, provider, providerVersion };
}

function isExecutionRequestReadinessFresh(readiness, expected, now, ttlMs) {
  if (!readiness || typeof readiness !== "object") return false;
  const checkedAt = Date.parse(readiness.checkedAt || "");
  const expiresAt = Date.parse(readiness.expiresAt || "");
  const current = now instanceof Date ? now.getTime() : Number(now);
  if (String(readiness.state || "").toUpperCase() !== "READY" ||
      !Number.isFinite(checkedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(current) ||
      checkedAt > current + 30_000 || current - checkedAt > ttlMs || expiresAt <= current || expiresAt - checkedAt > ttlMs) return false;
  return readiness.binding === readinessBinding(expected);
}

function normalizeTransportCertification(value) {
  if (!value || typeof value !== "object") return null;
  const scope = String(value.certificationScope || "").trim();
  const evidenceReference = String(value.evidenceReference || "").trim();
  const expiresAt = String(value.expiresAt || "").trim();
  if (!scope || !evidenceReference || !Number.isFinite(Date.parse(expiresAt))) return null;
  return { certificationScope: scope.slice(0, 80), evidenceReference: evidenceReference.slice(0, 240), expiresAt, executionBinding: value.executionBinding && typeof value.executionBinding === "object" ? { ...value.executionBinding } : null };
}

function normalizeSubmitIntentEvidence(value) {
  if (!value || typeof value !== "object") return null;
  const boundingBox = value.boundingBox && typeof value.boundingBox === "object" ? {
    x: Number.isFinite(Number(value.boundingBox.x)) ? Number(value.boundingBox.x) : null,
    y: Number.isFinite(Number(value.boundingBox.y)) ? Number(value.boundingBox.y) : null,
    width: Number.isFinite(Number(value.boundingBox.width)) ? Number(value.boundingBox.width) : null,
    height: Number.isFinite(Number(value.boundingBox.height)) ? Number(value.boundingBox.height) : null
  } : null;
  const ownership = value.ownershipProof && typeof value.ownershipProof === "object" ? {
    composerId: value.ownershipProof.composerId ? String(value.ownershipProof.composerId).slice(0, 160) : null,
    composerCount: Number(value.ownershipProof.composerCount) || 0,
    editorCount: Number(value.ownershipProof.editorCount) || 0,
    editorPayloadHash: value.ownershipProof.editorPayloadHash ? String(value.ownershipProof.editorPayloadHash).toLowerCase().slice(0, 64) : null,
    expectedPayloadHash: value.ownershipProof.expectedPayloadHash ? String(value.ownershipProof.expectedPayloadHash).toLowerCase().slice(0, 64) : null,
    payloadMatched: value.ownershipProof.payloadMatched === true,
    visibility: value.ownershipProof.visibility ? String(value.ownershipProof.visibility).slice(0, 40) : null,
    visibilityMatched: value.ownershipProof.visibilityMatched === true,
    ownedControlCount: Number(value.ownershipProof.ownedControlCount) || 0,
    globalControlCount: Number(value.ownershipProof.globalControlCount) || 0,
    controlBelongsToComposer: value.ownershipProof.controlBelongsToComposer === true,
    structuralEvidenceVersion: Number(value.ownershipProof.structuralEvidenceVersion) || 0
  } : null;
  return {
    capturedAt: Number.isFinite(Date.parse(String(value.capturedAt || ""))) ? String(value.capturedAt) : nowIso(),
    url: value.url ? String(value.url).slice(0, 500) : null,
    controlRef: value.controlRef ? String(value.controlRef).slice(0, 100) : null,
    controlIdentity: value.controlIdentity ? String(value.controlIdentity).toLowerCase().slice(0, 128) : null,
    role: value.role ? String(value.role).slice(0, 40) : null,
    accessibleName: value.accessibleName ? String(value.accessibleName).slice(0, 120) : null,
    visible: value.visible === true,
    connected: value.connected === true,
    enabled: value.enabled === true,
    busy: value.busy === true,
    actionable: value.actionable === true,
    hitTargetMatched: value.hitTargetMatched === true,
    composerState: value.composerState ? String(value.composerState).slice(0, 40) : null,
    composerMatched: value.composerMatched === true,
    boundingBox,
    ownershipProof: ownership
  };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isPositiveBoundingBox(value) {
  return Boolean(value &&
    Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Number.isFinite(value.width) && Number.isFinite(value.height) &&
    value.width > 0 && value.height > 0);
}

function hasSubmitControlEvidence(value) {
  const ownership = value?.ownershipProof;
  return Boolean(value &&
    isSha256(value.controlIdentity) &&
    value.connected === true && value.visible === true && value.enabled === true &&
    value.busy !== true && value.hitTargetMatched === true && value.actionable === true &&
    value.composerState === "OPEN" && value.composerMatched === true &&
    isPositiveBoundingBox(value.boundingBox) && ownership &&
    ownership.composerCount === 1 && ownership.editorCount === 1 &&
    ownership.ownedControlCount === 1 && ownership.controlBelongsToComposer === true &&
    ownership.payloadMatched === true && ownership.visibilityMatched === true &&
    isSha256(ownership.editorPayloadHash) && isSha256(ownership.expectedPayloadHash) &&
    ownership.structuralEvidenceVersion >= 1);
}

// A failed request may be renewed only when durable state proves the browser
// never crossed the submit boundary. This is intentionally narrower than a
// generic recoverable failure: no submit intent, click evidence, publication
// attempt, or uncertainty may exist for the historical execution.
function isSafePreSubmitFailureForRenewal(state, postId, request) {
  if (!request || request.state !== "FAILED" || request.submitState !== "FAILED" ||
      request.submitIntentAt || request.dispatchedAt || request.clickEmittedAt) return false;
  if ((state.publicationAttempts || []).some((item) => item.executionId === request.executionId)) return false;
  if ((state.submissionUncertainties || []).some((item) => item.executionId === request.executionId)) return false;
  const receipts = (state.executionReceipts || [])
    .filter((item) => item.executionId === request.executionId && item.attempt === request.attempt && item.receipt?.dryRun !== true)
    .sort((left, right) => Date.parse(right.receivedAt || "") - Date.parse(left.receivedAt || ""));
  const receipt = receipts[0]?.receipt;
  const failure = receipt?.preSubmitFailure;
  return request.jobId === postId && receipt?.submitState === "FAILED" &&
    failure && ["readiness_refresh", "submit_boundary"].includes(String(failure.stage || "")) &&
    receipt.submitAcceptanceEvidence == null;
}

const EXECUTION_RUNTIME_MAX_RECENT = 12;
const EXECUTION_RUNTIME_MAX_BLOCKERS = 8;
const EXECUTION_RUNTIME_MAX_TIMELINE = 32;
const EXECUTION_RUNTIME_STATES = new Set([
  "REQUEST_READY", "EXECUTING", "DRY_RUN_COMPLETE", "DRY_RUN_FAILED",
  "CANCELLED_PRE_SUBMIT", "SUBMIT_SENT_INTENT", "SUBMIT_SENT",
  "SUBMIT_RESULT_UNKNOWN", "CONFIRMED", "FAILED", "PROVEN_FAILED"
]);
const EXECUTION_RUNTIME_PHASES = new Set([
  "REQUEST_READY", "EXECUTING", "DRY_RUN_COMPLETE", "DRY_RUN_FAILED",
  "CANCELLED_PRE_SUBMIT", "SUBMIT_SENT_INTENT", "SUBMIT_SENT",
  "SUBMIT_RESULT_UNKNOWN", "VERIFIED", "FAILED", "PROVEN_FAILED"
]);
const EXECUTION_RUNTIME_SUBMIT_STATES = new Set(["NOT_STARTED", "SUBMIT_SENT", "CONFIRMED", "UNKNOWN", "FAILED"]);

function executionRuntimeFingerprint(value) {
  const text = String(value || "").trim();
  return text ? createHash("sha256").update(text).digest("hex").slice(0, 16) : null;
}

function executionRuntimeBucket(value, allowed, fallback = "UNKNOWN") {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function executionRuntimeTimestamp(...values) {
  const candidates = values
    .map((value) => String(value || "").trim())
    .filter((value) => Number.isFinite(Date.parse(value)))
    .map((value) => ({ value, at: Date.parse(value) }))
    .sort((left, right) => right.at - left.at);
  return candidates[0]?.value || null;
}

function executionRuntimeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.toString().length > 2048) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function executionRuntimeVerifiedPublication(receipt) {
  const row = receipt?.receipt || receipt || {};
  if (row.dryRun === true) return false;
  const evidence = row.publicationEvidence;
  const details = evidence?.verificationDetails;
  const candidate = details?.candidate;
  return row.submitState === "CONFIRMED" && Boolean(executionRuntimeHttpUrl(row.publicationUrl)) &&
    Number.isFinite(Date.parse(evidence?.verifiedAt || "")) && Boolean(evidence?.verificationMethod) &&
    evidence?.accountMatched === true && evidence?.targetMatched === true &&
    evidence?.contentHashMatched === true && details?.authorIdentity?.matched === true &&
    details?.contentMatch?.matched === true && candidate?.timestampMatched === true &&
    Boolean(candidate?.postId || candidate?.activityUrn) && Number.isFinite(Date.parse(candidate?.timestamp || "")) &&
    executionRuntimeHttpUrl(candidate?.permalink) === executionRuntimeHttpUrl(row.publicationUrl);
}

function executionRuntimeMode(row) {
  const top = row?.dryRun === true;
  const nested = row?.request?.dryRun === true;
  if (top && nested) return "DRY_RUN";
  if (row?.dryRun === false && row?.request?.dryRun === false) return "LIVE";
  return "UNKNOWN";
}

function incrementBucket(buckets, key) {
  buckets[key] = (buckets[key] || 0) + 1;
}

function executionRuntimeBlockerCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9_.-]{0,79}$/.test(code) ? code : null;
}

/**
 * Project bounded execution evidence for read-only Mission Control views.
 * This never infers publication from a command or dry-run receipt and never
 * mutates state. Raw execution payloads, content, profile material and IDs
 * are intentionally excluded.
 */
export function projectExecutionRuntime(state = {}) {
  const source = state && typeof state === "object" ? state : {};
  const requests = Array.isArray(source.executionRequests) ? source.executionRequests : [];
  const receipts = Array.isArray(source.executionReceipts) ? source.executionReceipts : [];
  const uncertainties = Array.isArray(source.submissionUncertainties) ? source.submissionUncertainties : [];
  const campaigns = Array.isArray(source.campaigns) ? source.campaigns : [];
  const posts = Array.isArray(source.posts) ? source.posts : [];
  const receiptsByExecution = new Map();
  for (const row of receipts) {
    if (!row || typeof row !== "object") continue;
    const executionId = String(row.executionId || "");
    if (!executionId) continue;
    const prior = receiptsByExecution.get(executionId);
    if (!prior || executionRuntimeTimestamp(row.receivedAt, row.receipt?.finishedAt) > executionRuntimeTimestamp(prior.receivedAt, prior.receipt?.finishedAt)) receiptsByExecution.set(executionId, row);
  }
  const rehearsalCandidateCount = campaigns.reduce((count, campaign) => count + (Array.isArray(campaign?.contentCandidates)
    ? campaign.contentCandidates.filter((candidate) => {
      const metadata = candidate?.rehearsalMetadata || candidate?.rehearsal;
      return metadata && typeof metadata === "object" && (metadata.enabled === true || metadata.dryRun === true || metadata.mode === "DRY_RUN");
    }).length
    : 0), 0);
  const rehearsalPostCount = posts.filter((post) => post?.rehearsalHandoff === true).length;
  const counts = {
    total: 0,
    byMode: { DRY_RUN: 0, LIVE: 0, UNKNOWN: 0 },
    byState: {},
    byPhase: {},
    bySubmitState: {},
    handoff: rehearsalPostCount,
    handoffCandidates: rehearsalCandidateCount,
    requestReady: 0,
    completed: 0,
    failed: 0,
    unknown: 0,
    verified: 0,
    publicationUnverified: 0
  };
  const blockerCounts = new Map();
  const unknownUncertaintyRows = uncertainties.filter((item) => item?.status === "UNKNOWN");
  const unknownExecutionIds = new Set(unknownUncertaintyRows.map((item) => String(item.executionId || "")).filter(Boolean));
  const projectionRows = [];
  const timeline = [];
  for (const row of requests) {
    if (!row || typeof row !== "object") continue;
    const executionId = String(row.executionId || "");
    if (!executionId) continue;
    counts.total += 1;
    const mode = executionRuntimeMode(row);
    const stateName = executionRuntimeBucket(row.state, EXECUTION_RUNTIME_STATES);
    const phase = executionRuntimeBucket(row.executionPhase || row.state, EXECUTION_RUNTIME_PHASES);
    const receipt = receiptsByExecution.get(executionId);
    const submitState = executionRuntimeBucket(row.submitState || receipt?.receipt?.submitState, EXECUTION_RUNTIME_SUBMIT_STATES);
    const quarantined = unknownExecutionIds.has(executionId) || stateName === "SUBMIT_RESULT_UNKNOWN" || submitState === "UNKNOWN";
    const verified = mode === "LIVE" && !quarantined && executionRuntimeVerifiedPublication(receipt);
    if (mode === "DRY_RUN") counts.byMode.DRY_RUN += 1;
    else if (mode === "LIVE") counts.byMode.LIVE += 1;
    else counts.byMode.UNKNOWN += 1;
    incrementBucket(counts.byState, stateName);
    incrementBucket(counts.byPhase, phase);
    incrementBucket(counts.bySubmitState, submitState);
    if (stateName === "REQUEST_READY") counts.requestReady += 1;
    if (stateName === "DRY_RUN_COMPLETE" || stateName === "CONFIRMED" || phase === "VERIFIED") counts.completed += 1;
    if (stateName === "FAILED" || stateName === "DRY_RUN_FAILED" || stateName === "PROVEN_FAILED") counts.failed += 1;
    if (quarantined) {
      counts.unknown += 1;
      unknownExecutionIds.add(executionId);
    }
    if (verified) counts.verified += 1;
    else if (mode === "LIVE") counts.publicationUnverified += 1;
    const reasonCodes = [row.reasonCode, row.request?.reasonCode, row.preSubmitFailure?.reasonCode, receipt?.receipt?.reasonCode, receipt?.receipt?.preSubmitFailure?.reasonCode]
      .map(executionRuntimeBlockerCode).filter(Boolean);
    for (const code of reasonCodes) blockerCounts.set(code, (blockerCounts.get(code) || 0) + 1);
    const actionAt = executionRuntimeTimestamp(row.dryRunCompletedAt, row.lastReceiptAt, row.dispatchedAt, row.submitIntentAt, row.executionStartedAt, row.cancelledAt, row.createdAt);
    const publicationStatus = quarantined ? "UNKNOWN" : verified ? "VERIFIED" : mode === "DRY_RUN" ? "DRY_RUN_ONLY" : "NOT_VERIFIED";
    const projection = {
      executionRef: executionRuntimeFingerprint(executionId),
      postRef: executionRuntimeFingerprint(row.jobId),
      mode,
      state: stateName,
      phase,
      submitState,
      attempt: Number.isSafeInteger(row.attempt) ? row.attempt : null,
      actionAt,
      publicationStatus,
      permalink: verified ? executionRuntimeHttpUrl(receipt.receipt.publicationUrl) : null,
      reasonCode: reasonCodes[0] || null
    };
    projectionRows.push(projection);
    let executionTimelineEventCount = 0;
    const addTimelineEvent = (at, event, eventState = stateName, eventPhase = phase, eventSubmitState = submitState, publicationStatus = quarantined ? "UNKNOWN" : "NOT_VERIFIED", permalink = null) => {
      if (!Number.isFinite(Date.parse(String(at || "")))) return;
      executionTimelineEventCount += 1;
      timeline.push({
        at: new Date(at).toISOString(),
        event,
        executionRef: executionRuntimeFingerprint(executionId),
        mode,
        state: executionRuntimeBucket(eventState, EXECUTION_RUNTIME_STATES),
        phase: executionRuntimeBucket(eventPhase, EXECUTION_RUNTIME_PHASES),
        submitState: executionRuntimeBucket(eventSubmitState, EXECUTION_RUNTIME_SUBMIT_STATES),
        publicationStatus,
        permalink: publicationStatus === "VERIFIED" ? executionRuntimeHttpUrl(permalink) : null
      });
    };
    addTimelineEvent(row.createdAt, "execution_request_created", "REQUEST_READY", "REQUEST_READY", "NOT_STARTED", mode === "DRY_RUN" ? "DRY_RUN_ONLY" : "NOT_VERIFIED");
    addTimelineEvent(row.executionStartedAt, "execution_started", "EXECUTING", "EXECUTING", "NOT_STARTED", mode === "DRY_RUN" ? "DRY_RUN_ONLY" : "NOT_VERIFIED");
    addTimelineEvent(row.submitIntentAt, "durable_submit_intent", "SUBMIT_SENT_INTENT", "SUBMIT_SENT_INTENT", "NOT_STARTED", mode === "DRY_RUN" ? "DRY_RUN_ONLY" : "NOT_VERIFIED");
    addTimelineEvent(row.dispatchedAt, "submit_sent", "SUBMIT_SENT", "SUBMIT_SENT", "SUBMIT_SENT", "NOT_VERIFIED");
    for (const receiptRow of receipts.filter((item) => item?.executionId === executionId)) {
      const receiptState = executionRuntimeBucket(receiptRow.receipt?.submitState, EXECUTION_RUNTIME_SUBMIT_STATES);
      const eventState = receiptState === "UNKNOWN" ? "SUBMIT_RESULT_UNKNOWN"
        : receiptState === "CONFIRMED" ? "CONFIRMED"
          : receiptState === "FAILED" ? "FAILED"
            : receiptState === "SUBMIT_SENT" ? "SUBMIT_SENT" : "REQUEST_READY";
      const event = receiptState === "UNKNOWN" ? "submit_result_unknown"
        : receiptState === "SUBMIT_SENT" ? "transport_receipt_recorded"
          : receiptState === "CONFIRMED" ? "submission_receipt_recorded"
            : receiptState === "FAILED" ? "pre_submit_failure_recorded" : "execution_receipt_recorded";
      addTimelineEvent(receiptRow.receivedAt || receiptRow.receipt?.finishedAt, event, eventState, eventState, receiptState,
        receiptState === "UNKNOWN" || quarantined ? "UNKNOWN" : mode === "DRY_RUN" ? "DRY_RUN_ONLY" : "NOT_VERIFIED");
    }
    if (stateName === "DRY_RUN_COMPLETE") {
      addTimelineEvent(row.dryRunCompletedAt || actionAt, "dry_run_completed", stateName, phase, submitState, "DRY_RUN_ONLY");
    } else if (stateName === "DRY_RUN_FAILED") {
      addTimelineEvent(row.dryRunFailedAt || actionAt, "dry_run_failed", stateName, phase, submitState, "DRY_RUN_ONLY");
    }
    if (verified) {
      addTimelineEvent(receipt?.receipt?.publicationEvidence?.verifiedAt, "publication_verified", "CONFIRMED", "VERIFIED", "CONFIRMED", "VERIFIED", receipt?.receipt?.publicationUrl);
    } else if (executionTimelineEventCount === 0) {
      addTimelineEvent(actionAt, "execution_state_observed", stateName, phase, submitState, publicationStatus);
    }
  }
  const quarantineRows = new Map();
  for (const item of unknownUncertaintyRows) {
    const executionId = String(item.executionId || "").trim();
    const postId = String(item.jobId || item.postId || "").trim();
    const key = executionId ? `execution:${executionId}` : postId ? `post:${postId}` : `uncertainty:${String(item.id || "unknown")}`;
    quarantineRows.set(key, {
      executionRef: executionId ? executionRuntimeFingerprint(executionId) : null,
      postRef: postId ? executionRuntimeFingerprint(postId) : null,
      immutable: true
    });
  }
  for (const executionId of unknownExecutionIds) {
    const key = `execution:${executionId}`;
    if (!quarantineRows.has(key)) quarantineRows.set(key, { executionRef: executionRuntimeFingerprint(executionId), postRef: null, immutable: true });
  }
  const quarantined = [...quarantineRows.values()];
  const blockers = [...blockerCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, EXECUTION_RUNTIME_MAX_BLOCKERS)
    .map(([code, count]) => ({ code, count }));
  const recent = projectionRows
    .sort((left, right) => String(right.actionAt || "").localeCompare(String(left.actionAt || "")) || String(left.executionRef).localeCompare(String(right.executionRef)))
    .slice(0, EXECUTION_RUNTIME_MAX_RECENT);
  timeline.sort((left, right) => String(right.at).localeCompare(String(left.at)) || String(left.executionRef).localeCompare(String(right.executionRef)) || String(left.event).localeCompare(String(right.event)));
  const latest = timeline[0];
  return {
    schemaVersion: 1,
    readOnly: true,
    publicationRule: "Only independent VERIFIED evidence exposes a permalink; COMMAND_COMPLETED and DRY_RUN_COMPLETE are not publication proof.",
    counts,
    latestAction: latest ? {
      at: latest.at,
      event: latest.event,
      executionRef: latest.executionRef,
      mode: latest.mode,
      state: latest.state,
      phase: latest.phase,
      submitState: latest.submitState,
      publicationStatus: latest.publicationStatus,
      permalink: latest.publicationStatus === "VERIFIED" ? latest.permalink : null
    } : null,
    blockers,
    quarantine: { count: quarantined.length, immutable: true, executions: quarantined.slice(0, EXECUTION_RUNTIME_MAX_RECENT) },
    recent,
    timeline: timeline.slice(0, EXECUTION_RUNTIME_MAX_TIMELINE),
    timelineCount: timeline.length,
    timelineTruncated: timeline.length > EXECUTION_RUNTIME_MAX_TIMELINE
  };
}

function boundedQueueFailureReason(error) {
  const code = String(error?.code || "").trim();
  return /^[A-Z][A-Z0-9_.-]{0,79}$/.test(code) ? code : "campaign_queue_failed";
}

const MAX_DISCOVERY_SOURCES = 20;
function normalizeDiscoverySources(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("discoverySources must be an array");
  if (value.length > MAX_DISCOVERY_SOURCES) throw new Error(`At most ${MAX_DISCOVERY_SOURCES} discovery sources are allowed`);
  const seen = new Set();
  return value.map((raw) => {
    const text = String(raw || "").trim();
    let parsed;
    try { parsed = new URL(text); } catch { throw new Error("Discovery source must be a valid HTTP(S) URL"); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Discovery source must be an HTTP(S) URL without credentials");
    parsed.hash = "";
    const normalized = parsed.toString();
    if (normalized.length > 2048) throw new Error("Discovery source URL is too long");
    if (seen.has(normalized)) throw new Error("Duplicate discovery source");
    seen.add(normalized);
    return normalized;
  });
}

const MAX_DISCOVERY_FIT_TERMS = 20;
const MAX_DISCOVERY_FIT_TERM_LENGTH = 64;
const MAX_DISCOVERY_FIT_CHANNEL_LENGTH = 80;
const MAX_DISCOVERY_FIT_LOCALE_LENGTH = 32;
const DISCOVERY_FIT_SECRET_ASSIGNMENT = /(?:password|passphrase|secret|token|cookie|authorization|credential|api[_-]?key|session(?:[_ -]?token)?)\s*[:=]/i;
const DISCOVERY_FIT_SECRET_VALUE = /(?:bearer\s+[a-z0-9._-]{6,}|sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,})/i;

function assertSafeDiscoveryFitText(value, label) {
  if (DISCOVERY_FIT_SECRET_ASSIGNMENT.test(value) || DISCOVERY_FIT_SECRET_VALUE.test(value)) {
    throw new Error(`${label} contains credential/session material`);
  }
}

/** Normalize optional campaign-owned advisory discovery fit without changing execution scope. */
export function normalizeDiscoveryFit(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("discoveryFit must be an object");
  const rawTerms = value.audienceKeywords ?? value.audience ?? value.audienceTerms;
  const terms = Array.isArray(rawTerms) ? rawTerms : (rawTerms == null ? [] : [rawTerms]);
  const audienceKeywords = [...new Set(terms.map((term) => {
    const normalized = String(term ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    assertSafeDiscoveryFitText(normalized, "discoveryFit.audienceKeywords");
    return normalized.slice(0, MAX_DISCOVERY_FIT_TERM_LENGTH);
  }).filter(Boolean))].slice(0, MAX_DISCOVERY_FIT_TERMS);
  const normalizeField = (raw, label, max) => {
    const normalized = String(raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    assertSafeDiscoveryFitText(normalized, label);
    return normalized.slice(0, max);
  };
  const targetChannel = normalizeField(value.targetChannel ?? value.channelTarget, "discoveryFit.targetChannel", MAX_DISCOVERY_FIT_CHANNEL_LENGTH);
  const targetLocale = normalizeField(value.targetLocale ?? value.locale, "discoveryFit.targetLocale", MAX_DISCOVERY_FIT_LOCALE_LENGTH);
  if (!audienceKeywords.length && !targetChannel && !targetLocale) return null;
  return { audienceKeywords, targetChannel, targetLocale };
}

const MAX_GROUNDING_BYTES = 2_000_000;
const MAX_SCREENSHOT_BYTES = 25_000_000;
const MAX_PRODUCT_INTELLIGENCE_BYTES = 750_000;
const TARGET_READINESS_STATES = new Set(["ready", "checking", "warming_up", "blocked"]);
const PRODUCT_TRACKS = new Set(["3d", "vibe-code", "svg-animation"]);
const COMMUNITY_MEMBERSHIP_STATES = new Set(["joined", "pending", "rejected", "blocked", "not_applicable", "unknown"]);
const COMMUNITY_POST_STATES = new Set(["allowed", "manual_review", "blocked", "unknown", "not_applicable"]);
const MAX_PRODUCT_FACTORY_RUNS = 24;
const PRODUCT_REPOS = Object.freeze({
  "design-os-3d-blender": "3d",
  "design-os-code2flow": "vibe-code",
  "design-os-svg-animation": "svg-animation"
});
const R19_CONTENT = `Final R19 - AI-assisted Blender automotive animation

I've finished this 4-second Full-HD test for a GT race-car education concept.

Blender rendered 96 native 3D states at 1920x1080 and 24 fps: assembled hero state, staggered shell/wheel/V12 separation, exploded-view hold, and controlled reassembly.

Pipeline: Brief -> scene planning -> Blender execution -> render -> validation -> final MP4.

I'm turning this workflow into practical learning material. Which part would you most want to learn: agent setup, procedural animation, render automation, or validation?

Honest note: this is a visual prototype, not a manufacturing-qualified model.

#Blender3D #BlenderAnimation #AutomotiveDesign #AIAgent #ProceduralWorkflow #3DWorkflow`;

const R19_CHANNEL_CONTENT = Object.freeze({
  facebook_group: R19_CONTENT,
  threads: `I turned one Blender brief into 96 validated Full-HD 3D states, then assembled them into a four-second GT exploded-view animation.

The useful part was not one render. It was the repeatable loop: brief -> scene plan -> Blender automation -> frame validation -> final MP4.

I'm shaping this into practical learning material. What would help you most: agent setup, procedural animation, render automation, or validation?

Visual prototype; not a manufacturing-qualified model.

#Blender3D #AIAgent #3DWorkflow`,
  reddit: `I built a small experiment around an AI-assisted Blender workflow and would value technical feedback.

The output is a four-second, 1920x1080 GT exploded-view animation made from 96 native 3D states: assembled hero pose, staggered shell/wheel/V12 separation, hold, and controlled reassembly.

The workflow was brief -> scene planning -> Blender execution -> render -> validation -> final MP4. I am considering turning the reproducible parts into learning material, especially the validation loop rather than presenting the first render as finished.

Which part would be most useful to unpack in detail: agent setup, procedural animation, render automation, or frame validation?

Disclosure: this is a visual prototype, not a manufacturing-qualified model.`,
  product_hunt: `R19 Workflow Lab turns a creative brief into a traceable Blender execution loop: plan the scene, automate repeatable steps, validate rendered evidence, and package the result.

The current proof artifact is a four-second Full-HD GT exploded-view animation built from 96 native 3D states. We are validating which part makers most want as a practical course: agent setup, procedural animation, render automation, or visual QA.

This is an early learning-product validation, not a manufacturing-ready vehicle model.`,
  indie_hackers: `Build log: validating an agentic Blender course with a real artifact.

Instead of writing the course first, I used a GT exploded-view animation to test the whole loop: brief -> scene plan -> Blender automation -> 96 rendered states -> validation -> final Full-HD MP4.

The next decision comes from evidence. I want to learn whether makers care most about agent setup, procedural animation, render automation, or visual QA before committing to the first module.

The current vehicle is an honest visual prototype, not a manufacturing-qualified model.`,
  linkedin: `I used one real Blender artifact to validate a repeatable agentic workflow: brief -> scene plan -> native execution -> 96 rendered states -> evidence review -> final Full-HD video.

The lesson is not “AI made a car”. The useful part is a traceable production loop where every claim is bound to repository evidence and the result stays explicitly labeled as a visual prototype.

I am now testing which learning module is most valuable: agent setup, procedural animation, render automation, or visual QA. Which one would you use first?

#Blender3D #AgenticAI #3DWorkflow`,
  email: `Subject: Which part of an evidence-first Blender workflow would help you most?

I am validating a practical learning series from a real Blender artifact: brief, scene planning, native execution, 96 rendered states, validation, and a final Full-HD video.

This message is only for people who explicitly opted in to product updates. If that is you, which module would be most useful: agent setup, procedural animation, render automation, or visual QA?

The current artifact is a visual prototype, not a manufacturing-qualified model. Every email run must retain consent and unsubscribe evidence.`
});

function upsertById(collection, value) {
  const index = collection.findIndex((item) => item.id === value.id);
  if (index === -1) collection.push(value);
  else collection[index] = { ...collection[index], ...value };
}

function addSeedDefaults(collection, value) {
  const index = collection.findIndex((item) => item.id === value.id);
  if (index === -1) {
    collection.push(value);
    return collection.at(-1);
  }
  collection[index] = { ...value, ...collection[index] };
  return collection[index];
}

function requireItem(collection, id, label) {
  const item = collection.find((entry) => entry.id === id);
  if (!item) throw new Error(`${label} not found: ${id}`);
  return item;
}

function bootstrapEvidenceClaims(productId) {
  if (String(productId || "").toLowerCase() !== "design-os-studio") return null;
  const evidenceRefs = ["repo:README.md"];
  return [
    {
      id: "design-os-what-is-it",
      field: "WHAT_IS_IT",
      text: "DESIGN:OS Studio is a native Rust GPU interface design studio with Figma .fig v106 binary read/write, an Agentic PTY Chat UI, and an 11-stage Spec Reader.",
      evidenceRefs
    },
    {
      id: "design-os-problem",
      field: "WHAT_PROBLEM_DOES_IT_SOLVE",
      text: "Browser-wrapped Electron design tools can choke on large enterprise files and force AI coding agents to scrape noisy REST JSON without direct canvas write-back or local spec verification.",
      evidenceRefs
    },
    {
      id: "design-os-better",
      field: "WHY_IS_IT_BETTER",
      text: "DESIGN:OS Studio keeps the workflow local-first and uses native Rust GPU rendering with fig-kiwi v106 binary read/write.",
      evidenceRefs
    },
    {
      id: "design-os-who",
      field: "WHO_NEEDS_IT",
      text: "AI coding agents and interface design practitioners can use the embedded Agentic PTY Chat UI, Dev Mode code generation, and local repository workflow.",
      evidenceRefs
    }
  ];
}

function optionalProductTrack(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const track = String(value).trim();
  if (!PRODUCT_TRACKS.has(track)) throw new Error(`Unsupported product track: ${track}`);
  return track;
}

async function requireProductRepo(value) {
  const requested = String(value || "").trim();
  if (!requested) throw new Error("Campaign productRepo is required");
  let resolved;
  try {
    resolved = await realpath(path.resolve(requested));
  } catch {
    throw new Error(`Campaign productRepo does not exist: ${requested}`);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`Campaign productRepo is not a directory: ${requested}`);
  return resolved;
}

function bootstrapProductReference(input = {}) {
  const product = input.product && typeof input.product === "object" && !Array.isArray(input.product) ? input.product : {};
  const productValue = typeof input.product === "string" ? input.product : null;
  return {
    productId: input.productId || productValue || product.productId || product.id,
    productName: input.productName || product.productName || product.name,
    productRepo: input.productRepo || input.productRepository || product.productRepo || product.repository || product.repo || product.path
  };
}

function productRepositoryKey(value) {
  return String(value || "").trim().replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.toLowerCase() || "";
}

async function maybeProductRepo(value) {
  if (!value || typeof value !== "string") return null;
  try { return await requireProductRepo(value); } catch { return null; }
}

async function readProductRegistryFile(filePath, keys) {
  if (!filePath || !keys.length) return [];
  let parsed;
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > 256 * 1024) return [];
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch { return []; }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.products) ? parsed.products : Object.entries(parsed?.products || {}).map(([id, value]) => ({ id, repository: value }));
  const candidates = [];
  for (const row of rows) {
    const item = typeof row === "string" ? { repository: row } : row;
    if (!item || typeof item !== "object") continue;
    const id = String(item.productId || item.id || item.name || "");
    const repository = item.repository || item.repo || item.productRepo || item.path || item.clone_path || item.sourceRepository;
    const matches = keys.includes(id.toLowerCase()) || keys.includes(productRepositoryKey(repository));
    if (!repository || !matches) continue;
    const resolved = await maybeProductRepo(String(repository));
    if (resolved) candidates.push(resolved);
  }
  return candidates;
}

async function readCampaignStateRepositories(plansRoot, keys) {
  const candidates = [];
  let entries;
  try { entries = await readdir(plansRoot, { withFileTypes: true }); } catch { return candidates; }
  const workspaceRoot = path.resolve(plansRoot, "..");
  for (const entry of entries.slice(0, 128)) {
    if (!entry.isDirectory()) continue;
    const file = path.join(plansRoot, entry.name, "campaign-state.json");
    let parsed;
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > 256 * 1024) continue;
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch { continue; }
    const productId = String(parsed?.product_id || parsed?.productId || parsed?.campaign_id || "").toLowerCase();
    const repository = parsed?.repository || {};
    const raw = repository.clone_path || repository.local_path || repository.path;
    const matches = keys.includes(productId) || keys.includes(productRepositoryKey(raw));
    if (!raw || !matches) continue;
    const candidate = path.isAbsolute(String(raw)) ? String(raw) : path.resolve(workspaceRoot, String(raw));
    const resolved = await maybeProductRepo(candidate);
    if (resolved) candidates.push(resolved);
  }
  return candidates;
}

/**
 * Resolve a product repository from a high-level product reference.  The
 * resolver has a deliberately small, deterministic search boundary and
 * returns no result on ambiguity; it never guesses from fuzzy text.
 */
async function resolveBootstrapProductRepo(input, { state, roots = [], registryFile = null, plansRoot = null } = {}) {
  const reference = bootstrapProductReference(input);
  if (reference.productRepo) return { productRepo: await requireProductRepo(reference.productRepo), source: "explicit" };
  const keys = normalizeBootstrapProductKeys({ ...reference, name: input.name });
  if (!keys.length) return { blocker: { code: "PRODUCT_REFERENCE_REQUIRED", classification: "INPUT_BLOCKER", message: "A product ID/name is required when productRepo is omitted" } };
  const candidates = new Map();
  const add = (value, source) => { if (value) candidates.set(path.resolve(value), source); };
  for (const campaign of state?.campaigns || []) {
    const known = [campaign.productIntelligence?.document?.productId, campaign.productId, campaign.name, campaign.productRepo].filter(Boolean).map((value) => String(value).toLowerCase());
    if (known.some((value) => keys.includes(productRepositoryKey(value)) || keys.includes(value))) add(await maybeProductRepo(campaign.productRepo), "campaign_state");
  }
  for (const value of await readProductRegistryFile(registryFile, keys)) add(value, "product_registry");
  for (const root of roots) {
    const resolvedRoot = await maybeProductRepo(root);
    if (resolvedRoot && keys.includes(productRepositoryKey(resolvedRoot))) add(resolvedRoot, "repository_root");
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.slice(0, 256)) {
      if (!entry.isDirectory() || !keys.includes(entry.name.toLowerCase())) continue;
      add(await maybeProductRepo(path.join(root, entry.name)), "repository_root");
    }
  }
  if (plansRoot) {
    for (const value of await readCampaignStateRepositories(plansRoot, keys)) add(value, "campaign_reference");
  }
  const unique = [...candidates.keys()].sort();
  if (unique.length !== 1) {
    return {
      blocker: {
        code: unique.length === 0 ? "PRODUCT_REPOSITORY_NOT_FOUND" : "PRODUCT_REPOSITORY_AMBIGUOUS",
        classification: unique.length === 0 ? "EXTERNAL_HARD_BLOCKER" : "RUNTIME_BLOCKER",
        message: unique.length === 0
          ? `No local product repository matched the exact product reference: ${keys.join(", ")}`
          : `More than one local product repository matched the exact product reference: ${unique.length}`
      },
      productKeys: keys,
      candidates: unique
    };
  }
  return { productRepo: unique[0], source: candidates.get(unique[0]), productKeys: keys };
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readGroundingSource(productRepo, source) {
  const requested = String(source || "").trim();
  if (!requested) throw new Error("Grounding source path is required");
  const candidate = path.isAbsolute(requested) ? requested : path.resolve(productRepo, requested);
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new Error(`Grounding source does not exist: ${requested}`);
  }
  if (!isInside(productRepo, resolved)) {
    throw new Error(`Grounding source must be inside productRepo: ${requested}`);
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Grounding source is not a file: ${requested}`);
  if (info.size > MAX_GROUNDING_BYTES) {
    throw new Error(`Grounding source exceeds ${MAX_GROUNDING_BYTES} bytes: ${requested}`);
  }
  const content = await readFile(resolved);
  return {
    path: resolved,
    relativePath: path.relative(productRepo, resolved),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.length
  };
}

async function readArtifactSource(productRepo, source) {
  const requested = String(source || "").trim();
  if (!requested) throw new Error("Artifact source path is required");
  const candidate = path.isAbsolute(requested) ? requested : path.resolve(productRepo, requested);
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new Error(`Artifact source does not exist: ${requested}`);
  }
  if (!isInside(productRepo, resolved)) throw new Error(`Artifact source must be inside productRepo: ${requested}`);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Artifact source is not a file: ${requested}`);
  const sha256 = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(resolved);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
  return { path: resolved, relativePath: path.relative(productRepo, resolved), sha256, bytes: info.size };
}

async function assertPostArtifactCurrent(post, state) {
  if (!post.assetPath) return;
  if (!post.artifactId || !post.assetSha256) throw new Error("Publication guard blocked: asset_evidence_missing_or_stale");
  const artifact = requireItem(state.artifacts || [], post.artifactId, "Artifact");
  const campaign = requireItem(state.campaigns, post.campaignId, "Campaign");
  if (artifact.campaignId !== campaign.id || artifact.sha256 !== post.assetSha256 || path.resolve(post.assetPath) !== path.resolve(artifact.path)) {
    throw new Error("Publication guard blocked: asset_evidence_missing_or_stale");
  }
  const productRepo = await requireProductRepo(campaign.productRepo);
  const current = await readArtifactSource(productRepo, artifact.relativePath);
  if (current.sha256 !== artifact.sha256) throw new Error("Publication guard blocked: asset_source_changed_since_registration");
}

async function readBrowserScreenshot(stateFilePath, source, expectedSha256) {
  const requested = String(source || "").trim();
  if (!requested) throw new Error("Browser observation screenshotPath is required");
  const expected = String(expectedSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("screenshotSha256 must be a SHA-256 hex digest");
  const evidenceRoot = path.join(path.dirname(stateFilePath), "evidence");
  await mkdir(evidenceRoot, { recursive: true });
  const resolvedRoot = await realpath(evidenceRoot);
  let resolved;
  try {
    resolved = await realpath(path.isAbsolute(requested) ? requested : path.resolve(resolvedRoot, requested));
  } catch {
    throw new Error(`Browser observation screenshot does not exist: ${requested}`);
  }
  if (!isInside(resolvedRoot, resolved)) throw new Error("Browser observation screenshot must be inside the runtime evidence directory");
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("Browser observation screenshot must be a file");
  if (info.size <= 0 || info.size > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Browser observation screenshot must be between 1 and ${MAX_SCREENSHOT_BYTES} bytes`);
  }
  const sha256 = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(resolved);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
  if (sha256 !== expected) throw new Error("screenshotSha256 does not match the runtime evidence file");
  return { path: resolved, sha256, bytes: info.size };
}

function canonicalPublicationUrl(value) {
  const requested = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(requested);
  } catch {
    throw new Error("Published transition requires a valid publication URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Published transition requires an HTTP(S) publication URL without credentials");
  }
  parsed.hash = "";
  return parsed;
}

function channelUrl(channel, value, label = "Target URL", platformPolicies = defaultPlatformPolicies) {
  const parsed = canonicalPublicationUrl(value);
  if (platformPolicies.has(channel) && !platformPolicies.allowsTargetUrl(channel, parsed.toString())) {
    throw new Error(platformPolicies.targetUrlError(channel, parsed.toString()) || `${label} must use an allowlisted ${channel} hostname`);
  }
  return parsed.toString();
}

function canonicalExecutionTargetUrl(value) {
  const parsed = canonicalPublicationUrl(value);
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${parsed.origin.toLowerCase()}${parsed.pathname}${parsed.search}`;
}

function requirePublicationEvidence(input, target, platformPolicies = defaultPlatformPolicies) {
  const evidence = String(input.evidence || "").trim();
  if (!evidence) throw new Error("Published transition requires verification evidence");
  const publication = new URL(channelUrl(target.channel, input.publicationUrl, "Publication URL", platformPolicies));
  const targetUrl = canonicalPublicationUrl(target.url);
  const canonicalPath = (url) => `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`.toLowerCase();
  if (publication.pathname === "/" || canonicalPath(publication) === canonicalPath(targetUrl)) {
    throw new Error("Published transition requires a specific post URL, not the target landing URL");
  }
  return { publicationUrl: publication.toString(), evidence };
}

function metricValue(input, field) {
  const value = input[field] ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a finite nonnegative integer`);
  }
  return value;
}

function metricReading(input, field) {
  const explicitCoverage = input && input.coverage && Object.prototype.hasOwnProperty.call(input.coverage, field)
    ? String(input.coverage[field] || "").toLowerCase()
    : null;
  if (explicitCoverage !== null && !METRIC_COVERAGE.has(explicitCoverage)) {
    throw new Error(`${field} coverage must be measured, unknown, or unsupported`);
  }
  const hasValue = Object.prototype.hasOwnProperty.call(input, field) && input[field] !== null && input[field] !== undefined;
  if (explicitCoverage === "measured" && !hasValue) {
    throw new Error(`${field} measured coverage requires a value`);
  }
  if ((explicitCoverage === "unknown" || explicitCoverage === "unsupported") && hasValue) {
    throw new Error(`${field} ${explicitCoverage} coverage cannot include a value`);
  }
  if (!hasValue) {
    return { value: null, status: explicitCoverage || "unknown" };
  }
  return { value: metricValue(input, field), status: explicitCoverage || "measured" };
}

function metricCoverageStatus(snapshot, field) {
  const explicit = String(snapshot?.coverage?.[field] || "").toLowerCase();
  if (explicit) return METRIC_COVERAGE.has(explicit) ? explicit : "unknown";
  return Number.isSafeInteger(snapshot?.[field]) ? "measured" : "unknown";
}

function compareMetricSnapshots(left, right) {
  const leftCapturedAt = String(left?.capturedAt || "");
  const rightCapturedAt = String(right?.capturedAt || "");
  if (leftCapturedAt < rightCapturedAt) return -1;
  if (leftCapturedAt > rightCapturedAt) return 1;
  const leftId = String(left?.id || "");
  const rightId = String(right?.id || "");
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareMetricEvidence(left, right) {
  if (left.at < right.at) return -1;
  if (left.at > right.at) return 1;
  if (left.kind < right.kind) return -1;
  if (left.kind > right.kind) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Project bounded post-relative metric checkpoints from existing observations.
 * This is read-only observability: it does not schedule or collect metrics.
 */
export function buildMetricCheckpoints(post, snapshots = [], collectorRuns = [], now = new Date()) {
  const requestedNowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  const nowMs = Number.isFinite(requestedNowMs) ? requestedNowMs : Date.now();
  const publishedMs = Date.parse(post?.publishedAt || "");
  if (!Number.isFinite(publishedMs)) {
    return METRIC_CHECKPOINTS.map(({ key }) => ({
      key,
      dueAt: null,
      status: "unknown",
      observedAt: null,
      snapshotId: null,
      collectorRunId: null,
      reason: "published_at_invalid"
    }));
  }

  const postSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .filter((snapshot) => snapshot?.postId === post?.id)
    .map((snapshot) => ({
      kind: "snapshot",
      id: String(snapshot.id || ""),
      atMs: Date.parse(snapshot.capturedAt || ""),
      snapshot
    }))
    .filter((event) => event.id && Number.isFinite(event.atMs) && event.atMs <= nowMs);
  const postRuns = (Array.isArray(collectorRuns) ? collectorRuns : [])
    .filter((run) => run?.postId === post?.id)
    .map((run) => {
      const status = String(run.status || "").toLowerCase();
      const projectedStatus = status === "unsupported" || status === "not_applicable"
        ? "unsupported"
        : status === "unknown" || status === "failed"
          ? "unknown"
          : null;
      return {
        kind: "collector_run",
        id: String(run.id || ""),
        atMs: Date.parse(run.at || ""),
        projectedStatus,
        run
      };
    })
    .filter((event) => event.id && event.projectedStatus && Number.isFinite(event.atMs) && event.atMs <= nowMs);

  return METRIC_CHECKPOINTS.map(({ key, offsetMs }, checkpointIndex) => {
    const dueMs = publishedMs + offsetMs;
    if (!Number.isFinite(dueMs)) {
      return {
        key,
        dueAt: null,
        status: "unknown",
        observedAt: null,
        snapshotId: null,
        collectorRunId: null,
        reason: "checkpoint_due_at_invalid"
      };
    }
    const dueAt = new Date(dueMs).toISOString();
    const nextDueMs = METRIC_CHECKPOINTS[checkpointIndex + 1]
      ? publishedMs + METRIC_CHECKPOINTS[checkpointIndex + 1].offsetMs
      : Number.POSITIVE_INFINITY;
    const evidence = [
      ...postSnapshots
        .filter((event) => event.atMs >= dueMs && event.atMs < nextDueMs)
        .map((event) => ({ ...event, at: event.atMs, status: "observed" })),
      ...postRuns
        .filter((event) => event.atMs >= dueMs && event.atMs < nextDueMs)
        .map((event) => ({ ...event, at: event.atMs, status: event.projectedStatus }))
    ].sort(compareMetricEvidence);
    const latest = evidence.at(-1);
    if (latest) {
      return {
        key,
        dueAt,
        status: latest.status,
        observedAt: new Date(latest.at).toISOString(),
        snapshotId: latest.kind === "snapshot" ? latest.id : null,
        collectorRunId: latest.kind === "collector_run" ? latest.id : null,
        reason: latest.kind === "collector_run" ? String(latest.run.reason || latest.run.status || latest.status) : null
      };
    }
    const status = nowMs < dueMs ? "pending" : nowMs === dueMs ? "due" : "missing";
    return {
      key,
      dueAt,
      status,
      observedAt: null,
      snapshotId: null,
      collectorRunId: null,
      reason: status === "pending" ? "checkpoint_not_due" : "no_post_due_evidence"
    };
  });
}

/**
 * Build a deterministic, read-only collection plan from persisted posts and observations.
 * With dueOnly enabled, only posts whose current checkpoint is due or overdue are selected.
 * Invalid publication timestamps fail closed and are never sent to a provider.
 */
export function buildMetricCollectionPlan(state = {}, { now = new Date(), dueOnly = false } = {}) {
  const posts = Array.isArray(state?.posts) ? state.posts : [];
  const snapshots = Array.isArray(state?.metricSnapshots) ? state.metricSnapshots : [];
  const collectorRuns = Array.isArray(state?.collectorRuns) ? state.collectorRuns : [];
  const at = now instanceof Date ? now : new Date(now);
  return posts
    .filter((post) => post?.status === "published")
    .map((post) => {
      const checkpoints = buildMetricCheckpoints(post, snapshots, collectorRuns, at);
      const invalidPublication = checkpoints.every((checkpoint) => checkpoint.status === "unknown" && checkpoint.reason === "published_at_invalid");
      const due = checkpoints.filter((checkpoint) => checkpoint.status === "due" || checkpoint.status === "missing");
      // A due checkpoint with unknown evidence may represent a transient
      // provider/configuration failure. Keep the visible checkpoint status
      // unknown, but let the due-only scheduler try it again on a later tick.
      // Invalid publication timestamps remain fail-closed above, and
      // unsupported/manual-only evidence is intentionally terminal.
      const retryableUnknown = checkpoints.filter((checkpoint) => checkpoint.status === "unknown" && checkpoint.reason !== "published_at_invalid");
      const selected = dueOnly ? [...due, ...retryableUnknown] : due;
      const shouldCollect = !invalidPublication && (!dueOnly || selected.length > 0);
      return {
        postId: post.id,
        shouldCollect,
        reason: invalidPublication ? "published_at_invalid" : shouldCollect ? null : "checkpoint_not_due",
        dueCheckpoints: selected.map((checkpoint) => checkpoint.key),
        checkpoints
      };
    });
}

/**
 * Build a bounded Mission Control projection of post-relative metric
 * checkpoints. This is deliberately read-only: it does not schedule a
 * collector, create authority, or mutate canonical state.
 */
export function projectMetricCheckpointSummary(posts = [], snapshots = [], collectorRuns = [], now = new Date()) {
  const publishedPosts = (Array.isArray(posts) ? posts : []).filter((post) => post?.status === "published");
  const requestedNow = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  const observedNow = Number.isFinite(requestedNow) ? new Date(requestedNow) : new Date();
  const summary = {
    generatedAt: observedNow.toISOString(),
    totalPublishedPosts: publishedPosts.length,
    checkpoints: Object.fromEntries(METRIC_CHECKPOINTS.map(({ key }) => [key, {
      counts: { pending: 0, due: 0, missing: 0, observed: 0, unknown: 0, unsupported: 0 },
      postIds: { pending: [], due: [], missing: [], observed: [], unknown: [], unsupported: [] }
    }]))
  };
  for (const post of publishedPosts) {
    for (const checkpoint of buildMetricCheckpoints(post, snapshots, collectorRuns, observedNow)) {
      const bucket = summary.checkpoints[checkpoint.key];
      if (!bucket || !Object.prototype.hasOwnProperty.call(bucket.counts, checkpoint.status)) continue;
      bucket.counts[checkpoint.status] += 1;
      if (bucket.postIds[checkpoint.status].length < 100) bucket.postIds[checkpoint.status].push(String(post.id));
    }
  }
  return summary;
}

function metricReadingsMatchSnapshot(snapshot, readings) {
  if (!snapshot) return false;
  return METRIC_FIELDS.every((field) => {
    const priorStatus = snapshot.coverage?.[field] || (Number.isSafeInteger(snapshot[field]) ? "measured" : "unknown");
    return snapshot[field] === readings[field].value && priorStatus === readings[field].status;
  });
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

const ARTIFACT_METADATA_SECRET = /(?:password|passphrase|secret|token|cookie|authorization|credential|api[_-]?key|session(?:[_ -]?token)?)\s*[:=]\s*\S+|(?:bearer\s+[a-z0-9._-]{6,}|sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,})/i;

function requiredSafeArtifactMetadata(value, label, maxLength) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const text = requiredText(value, label);
  if (text.length > maxLength) throw new Error(`${label} must contain at most ${maxLength} characters`);
  if (ARTIFACT_METADATA_SECRET.test(text)) throw new Error(`${label} contains credential/session material`);
  return text;
}

function normalizedRelativeArtifactPath(value, label = "artifact path") {
  const raw = requiredText(value, label).replaceAll("\\", "/");
  if (path.isAbsolute(raw)) throw new Error(`${label} must be relative`);
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.includes("\u0000")) {
    throw new Error(`${label} must stay inside productRepo`);
  }
  return normalized;
}

function safeFactoryCommandRef(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error("Product Factory command reference must be an array");
  const values = value;
  if (values.length > 8) throw new Error("Product Factory command reference is too large");
  const normalized = values.map((item) => requiredSafeArtifactMetadata(item, "Product Factory command reference", 240));
  return Array.isArray(value) ? normalized : normalized[0];
}

export function normalizeTargetReadiness(value, fallbackStatus = "needs_review", bindingContext = null, ttlMs = configuredReadinessTtlMs()) {
  const input = value && typeof value === "object" ? value : {};
  const state = String(input.state || (fallbackStatus === "active" ? "ready" : "checking")).trim();
  if (!TARGET_READINESS_STATES.has(state)) throw new Error(`Unsupported target readiness state: ${state}`);
  const reasonCode = String(input.reasonCode || (state === "ready" ? "eligible" : "eligibility_check_required")).trim();
  if (!/^[a-z0-9_]{2,64}$/.test(reasonCode)) throw new Error("Target readiness reasonCode must be a lowercase slug");
  const summary = String(input.summary || (state === "ready" ? "Kênh đã đủ điều kiện để chuẩn bị đăng" : "Chưa xác minh đủ điều kiện đăng")).trim();
  if (!summary || summary.length > 500) throw new Error("Target readiness summary must contain 1-500 characters");
  const nextSteps = Array.isArray(input.nextSteps) ? input.nextSteps.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (nextSteps.length > 6 || nextSteps.some((item) => item.length > 240)) {
    throw new Error("Target readiness supports at most 6 next steps of 240 characters each");
  }
  const evidence = input.evidence == null ? null : String(input.evidence).trim() || null;
  if (evidence && evidence.length > 1000) throw new Error("Target readiness evidence must contain at most 1000 characters");
  const checkedAt = input.checkedAt == null ? null : String(input.checkedAt).trim() || null;
  if (checkedAt && !Number.isFinite(Date.parse(checkedAt))) throw new Error("Target readiness checkedAt must be an ISO timestamp");
  const checks = {};
  for (const field of ["sessionValid", "composerCapable", "platformAvailable"]) {
    if (input.checks && typeof input.checks[field] === "boolean") checks[field] = input.checks[field];
  }
  const capabilities = input.capabilities && typeof input.capabilities === "object" ? { ...input.capabilities } : {};
  if (checks.sessionValid === true) capabilities.sessionAuthenticated = true;
  if (checks.composerCapable === true) capabilities.composerAvailable = true;
  if (checks.platformAvailable === true) capabilities.feedReachable = true;
  const expiresAt = input.expiresAt && Number.isFinite(Date.parse(input.expiresAt))
    ? new Date(input.expiresAt).toISOString()
    : checkedAt ? new Date(Date.parse(checkedAt) + ttlMs).toISOString() : null;
  const binding = input.binding || (bindingContext?.profileId && checkedAt ? readinessBinding(bindingContext) : null);
  return {
    state, reasonCode, summary, nextSteps, evidence, checkedAt, expiresAt, checks, capabilities,
    binding,
    platform: bindingContext?.platform || input.platform || null,
    accountId: bindingContext?.accountId || input.accountId || null,
    profileId: bindingContext?.profileId || input.profileId || null,
    targetId: bindingContext?.targetId || input.targetId || null,
    outcome: String(input.outcome || (state === "ready" ? "READY" : state === "blocked" ? "BLOCKED" : "UNKNOWN")).toUpperCase(),
    retryable: input.retryable === true,
    recoveryClassification: input.recoveryClassification || "NONE"
  };
}

function currencyCode(value) {
  const currency = requiredText(value, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a three-letter ISO code");
  return currency;
}

export function normalizeKeywords(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const keywords = [];
  for (const item of values) {
    const structured = Boolean(item && typeof item === "object");
    const phrase = String(structured ? item.phrase : item).trim().replace(/\s+/g, " ");
    if (!phrase) continue;
    if (phrase.length > 100) throw new Error("Keyword must contain at most 100 characters");
    const key = phrase.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push({
      phrase,
      intent: structured && item.intent ? String(item.intent) : "discovery",
      locale: structured && item.locale ? String(item.locale) : "global",
      status: structured && item.status ? String(item.status) : "active"
    });
  }
  if (keywords.length > 50) throw new Error("Campaign supports at most 50 keywords");
  return keywords;
}

function optionalHttpUrl(value, label) {
  const requested = String(value || "").trim();
  if (!requested) return null;
  let parsed;
  try { parsed = new URL(requested); } catch { throw new Error(`${label} must be a valid URL`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTP(S) URL without credentials`);
  }
  return parsed.toString();
}

function normalizeScheduleMode(value) {
  const requested = String(value || "draft_only");
  // Legacy callers may still send this value. Owner standing approval now
  // replaces the Telegram product-review gate, so normalize it permanently.
  if (requested === "publish_with_product_review") return "publish_with_standing_approval";
  if (!new Set(["draft_only", "publish_with_standing_approval"]).has(requested)) {
    throw new Error("Invalid schedule mode");
  }
  return requested;
}

function normalizeCommunityMembership(input, platformPolicies = defaultPlatformPolicies) {
  const productRepo = requiredText(input.productRepo, "productRepo");
  if (!PRODUCT_REPOS[productRepo]) throw new Error(`Unsupported productRepo: ${productRepo}`);
  const track = input.track === undefined ? PRODUCT_REPOS[productRepo] : String(input.track || "").trim();
  if (!PRODUCT_TRACKS.has(track) || PRODUCT_REPOS[productRepo] !== track) throw new Error("Community track must match productRepo");
  const platform = requiredText(input.platform, "platform").toLowerCase();
  if (!platformPolicies.has(platform)) throw new Error(`Unsupported community platform: ${platform}`);
  const communityName = requiredText(input.communityName, "communityName");
  const communityUrl = optionalHttpUrl(input.communityUrl || input.url, "communityUrl");
  if (communityUrl && !platformPolicies.allowsCommunityUrl(platform, communityUrl)) throw new Error("communityUrl host does not match platform");
  const membershipStatus = String(input.membershipStatus || "unknown").trim();
  if (!COMMUNITY_MEMBERSHIP_STATES.has(membershipStatus)) throw new Error(`Unsupported membershipStatus: ${membershipStatus}`);
  const postStatus = String(input.postStatus || "unknown").trim();
  if (!COMMUNITY_POST_STATES.has(postStatus)) throw new Error(`Unsupported postStatus: ${postStatus}`);
  const notes = String(input.notes || "").trim();
  const evidence = String(input.evidence || "").trim();
  if (notes.length > 1000 || evidence.length > 2000) throw new Error("Community notes/evidence are too long");
  const checkedAt = input.checkedAt == null ? nowIso() : String(input.checkedAt).trim();
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("checkedAt must be an ISO timestamp");
  return { productRepo, track, platform, communityName, communityUrl, membershipStatus, postStatus, accountId: String(input.accountId || "").trim() || null, notes, evidence, checkedAt };
}

function newest(items, timestampField, limit = 20) {
  return [...items]
    .sort((left, right) => String(right[timestampField] || "").localeCompare(String(left[timestampField] || "")))
    .slice(0, limit);
}

function accountProfileFingerprint(profileId) {
  return createHash("sha256").update(String(profileId || "")).digest("hex");
}

const ACCOUNT_RUNTIME_READINESS_STATES = new Set(["READY", "BLOCKED", "HUMAN_REQUIRED", "UNKNOWN"]);
const ACCOUNT_RUNTIME_RECOVERY_STATES = new Set(["RECOVERABLE", "HUMAN_REQUIRED", "UNKNOWN", "NONE"]);
const PRODUCT_FACTORY_SANDBOX_CHECKS = Object.freeze([
  "backendInvocation", "profileIntegrity", "networkDenied", "filesystemScope",
  "childProcessPolicy", "timeoutCleanup", "resourceLimits"
]);
const PRODUCT_FACTORY_SANDBOX_LIMITS = Object.freeze([
  "network", "filesystem", "childProcesses", "timeoutCleanup", "resourceLimits"
]);
const PRODUCT_FACTORY_SANDBOX_STATUSES = new Set(["PASS", "FAIL", "UNSUPPORTED", "UNAVAILABLE", "AVAILABLE"]);

function safeProductFactorySandboxToken(value, fallback) {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(token) ? token : fallback;
}

function safeProductFactorySandboxStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return PRODUCT_FACTORY_SANDBOX_STATUSES.has(status) ? status : "UNSUPPORTED";
}

function safeAccountRuntimeReason(value) {
  const reason = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_]{2,64}$/.test(reason) ? reason : "unknown";
}

function safeAccountRuntimeState(value) {
  const state = String(value || "UNKNOWN").trim().toUpperCase();
  return ACCOUNT_RUNTIME_READINESS_STATES.has(state) ? state : "UNKNOWN";
}

function safeAccountRuntimeRecovery(value) {
  const recovery = String(value || "UNKNOWN").trim().toUpperCase();
  return ACCOUNT_RUNTIME_RECOVERY_STATES.has(recovery) ? recovery : "UNKNOWN";
}

function accountRuntimeEligibility({ status, health, boundTargetCount, latest, readinessState, readinessExpiryInvalid, readinessExpired }) {
  const reasons = [];
  if (status !== "enabled") reasons.push(`status:${status}`);
  if (health !== "healthy") reasons.push(`health:${health}`);
  if (!boundTargetCount) reasons.push("target_binding:missing");
  if (!latest) reasons.push("readiness:missing");
  else if (readinessExpiryInvalid) reasons.push("readiness:expiry_invalid");
  else if (readinessExpired) reasons.push("readiness:expired");
  else if (readinessState !== "READY") reasons.push(`readiness:${safeAccountRuntimeReason(latest.reasonCode || readinessState || "unknown")}`);
  return { eligibleForExecution: reasons.length === 0, ineligibilityReasons: reasons };
}

function projectExecutionAccountRuntime(state, { now = new Date() } = {}) {
  const observedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("Account runtime projection time must be valid");
  const targets = Array.isArray(state.targets) ? state.targets : [];
  const accounts = Array.isArray(state.executionAccounts) ? state.executionAccounts : [];
  return accounts.map((account) => {
    const boundReadiness = targets
      .filter((target) => target && target.channel === account.platform && target.accountId === account.accountId && target.profileId === account.profileId)
      .map((target) => target.readiness)
      .filter((readiness) => readiness && typeof readiness === "object")
      .sort((left, right) => String(right.checkedAt || "").localeCompare(String(left.checkedAt || "")));
    const latest = boundReadiness[0] || null;
    const readinessState = latest ? safeAccountRuntimeState(latest.state) : null;
    const health = String(account.health || "unknown");
    const status = String(account.status || "unknown");
    const readinessExpiresAt = Date.parse(latest?.expiresAt || "");
    const readinessExpiryInvalid = Boolean(latest) && !Number.isFinite(readinessExpiresAt);
    const readinessExpired = Number.isFinite(readinessExpiresAt) && readinessExpiresAt <= observedAt.getTime();
    const boundTargetCount = targets.filter((target) => target && target.channel === account.platform && target.accountId === account.accountId && target.profileId === account.profileId).length;
    const eligibleTargetIds = targets
      .filter((target) => target && target.channel === account.platform && target.accountId === account.accountId && target.profileId === account.profileId)
      .filter((target) => String(target.readiness?.state || "").toUpperCase() === "READY" && Number.isFinite(Date.parse(target.readiness?.expiresAt || "")) && Date.parse(target.readiness.expiresAt) > observedAt.getTime())
      .map((target) => String(target.id))
      .sort();
    const eligibility = accountRuntimeEligibility({ status, health, boundTargetCount, latest, readinessState, readinessExpiryInvalid, readinessExpired });
    const currentBlocker = status !== "enabled"
      ? `status:${status}`
      : health !== "healthy"
      ? `health:${health}`
      : !latest
        ? "readiness:missing"
        : readinessExpiryInvalid
          ? "readiness:expiry_invalid"
        : readinessExpired
          ? "readiness:expired"
          : readinessState !== "READY"
            ? `readiness:${safeAccountRuntimeReason(latest.reasonCode || readinessState || "unknown")}`
        : null;
    return {
      id: String(account.id || `${account.platform}:${account.accountId}`),
      platform: String(account.platform || ""),
      accountId: String(account.accountId || ""),
      profileFingerprint: accountProfileFingerprint(account.profileId),
      sessionMode: "SESSION_REUSE",
      authMode: "MANUAL_AUTH",
      status,
      health,
      lastReadinessAt: account.lastReadinessAt || latest?.checkedAt || null,
      readiness: latest ? {
        state: readinessState,
        checkedAt: latest.checkedAt || null,
        expiresAt: latest.expiresAt || null,
        reasonCode: latest ? safeAccountRuntimeReason(latest.reasonCode) : null,
        recoveryClassification: safeAccountRuntimeRecovery(latest.recoveryClassification)
      } : null,
      boundTargetCount,
      eligibleTargetCount: eligibleTargetIds.length,
      eligibleTargetRefs: eligibleTargetIds.map((id) => accountProfileFingerprint(id)),
      currentBlocker,
      ...eligibility
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

const AUTHORIZED_ACCOUNT_CANDIDATE_MAX = 128;

function authorizedAccountCandidateKey({ campaignId, authorizationId, platform, accountId, profileId, targetId }) {
  return createHash("sha256").update(JSON.stringify({
    campaignId: String(campaignId || ""),
    authorizationId: String(authorizationId || ""),
    platform: String(platform || ""),
    accountId: String(accountId || ""),
    profileId: String(profileId || ""),
    targetId: String(targetId || "")
  })).digest("hex").slice(0, 24);
}

function candidateReadinessReasons(target, now, readinessTtlMs) {
  if (!target?.readiness || typeof target.readiness !== "object") return ["readiness:missing"];
  const readiness = target.readiness;
  const state = safeAccountRuntimeState(readiness.state);
  if (state !== "READY") return [`readiness:${safeAccountRuntimeReason(readiness.reasonCode || state)}`];
  const expected = {
    platform: target.channel,
    accountId: target.accountId,
    profileId: target.profileId,
    targetId: target.id
  };
  if (!expected.platform || !expected.accountId || !expected.profileId || !expected.targetId) return ["readiness:binding_incomplete"];
  if (readiness.binding !== readinessBinding(expected)) return ["readiness:binding_mismatch"];
  const expiresAt = Date.parse(readiness.expiresAt || "");
  if (!Number.isFinite(expiresAt)) return ["readiness:expiry_invalid"];
  if (expiresAt <= now.getTime()) return ["readiness:expired"];
  if (!isReadinessFresh(readiness, expected, now, readinessTtlMs)) return ["readiness:stale"];
  return [];
}

/**
 * Project exact campaign-authorized account/session candidates without
 * creating authority or execution state. This is advisory pre-dispatch data:
 * the queue and worker still revalidate the full execution contract before any
 * browser input. Raw profile and identity material are intentionally omitted.
 */
export function projectAuthorizedAccountCandidates(state = {}, { campaignId = null, now = new Date(), readinessTtlMs = configuredReadinessTtlMs() } = {}) {
  const observedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("Candidate projection time must be valid");
  const requestedCampaignId = campaignId == null ? null : String(campaignId);
  const campaigns = Array.isArray(state.campaigns) ? state.campaigns : [];
  const targets = Array.isArray(state.targets) ? state.targets : [];
  const accounts = Array.isArray(state.executionAccounts) ? state.executionAccounts : [];
  const authorizations = Array.isArray(state.campaignAuthorizations) ? state.campaignAuthorizations : [];
  const candidates = [];
  for (const authorization of [...authorizations].sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")))) {
    if (!authorization || (requestedCampaignId && String(authorization.campaignId || "") !== requestedCampaignId)) continue;
    const campaign = campaigns.find((item) => item?.id === authorization.campaignId) || null;
    const destinations = Array.isArray(authorization.destinations) ? authorization.destinations : [];
    for (const destination of [...destinations].sort((left, right) => {
      const a = `${String(left?.platform || "")}\u0000${String(left?.targetId || "")}\u0000${String(left?.accountId || "")}`;
      const b = `${String(right?.platform || "")}\u0000${String(right?.targetId || "")}\u0000${String(right?.accountId || "")}`;
      return a.localeCompare(b);
    })) {
      const target = targets.find((item) => item?.id === destination?.targetId) || null;
      let account = null;
      try {
        if (target?.channel && target?.accountId) account = accounts.find((item) => item?.id === executionAccountKey(target.channel, target.accountId)) || null;
      } catch {
        account = null;
      }
      const reasons = [];
      if (!campaign) reasons.push("campaign:missing");
      else if (campaign.status !== "active") reasons.push("campaign:not_active");
      if (authorization.status !== "active") reasons.push(`authorization:${String(authorization.status || "unknown").toLowerCase()}`);
      if (authorization.executionMode !== "standing_autonomous") reasons.push("authorization:execution_mode_not_standing_autonomous");
      if (authorization.allowLiveExecution !== true) reasons.push("authorization:live_execution_disabled");
      if (!authorization.binding || authorization.binding !== campaignAuthorizationFingerprint(authorization)) reasons.push("authorization:binding_stale");
      if (!campaign || authorization.campaignBinding !== campaignScopeFingerprint(campaign)) reasons.push("authorization:campaign_scope_stale");
      const validFrom = Date.parse(authorization.validFrom || "");
      const validUntil = Date.parse(authorization.validUntil || "");
      if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validUntil <= validFrom) reasons.push("authorization:validity_invalid");
      else if (observedAt.getTime() < validFrom) reasons.push("authorization:not_yet_valid");
      else if (observedAt.getTime() > validUntil) reasons.push("authorization:expired");
      if (!target) reasons.push("target:missing");
      else {
        if (target.channel !== destination.platform) reasons.push("target:platform_mismatch");
        if (target.accountId !== destination.accountId) reasons.push("target:account_mismatch");
        if (target.profileId !== destination.profileId) reasons.push("target:profile_mismatch");
        if (target.url !== destination.targetUrl) reasons.push("target:url_mismatch");
        if (target.status !== "active") reasons.push(`target:${String(target.status || "unknown").toLowerCase()}`);
        reasons.push(...candidateReadinessReasons(target, observedAt, readinessTtlMs));
      }
      if (!account) reasons.push("account:missing");
      else {
        if (account.status !== "enabled") reasons.push(`account:status_${String(account.status || "unknown").toLowerCase()}`);
        if (account.health !== "healthy") reasons.push(`account:health_${String(account.health || "unknown").toLowerCase()}`);
        if (target && account.profileId !== target.profileId) reasons.push("account:profile_mismatch");
      }
      const profileId = target?.profileId || destination?.profileId || account?.profileId || null;
      const platform = String(destination?.platform || target?.channel || "");
      const accountId = String(destination?.accountId || target?.accountId || account?.accountId || "");
      const targetId = String(destination?.targetId || target?.id || "");
      const candidate = {
        candidateKey: authorizedAccountCandidateKey({ campaignId: authorization.campaignId, authorizationId: authorization.id, platform, accountId, profileId, targetId }),
        campaignId: String(authorization.campaignId || ""),
        authorizationId: String(authorization.id || ""),
        authorizationStatus: String(authorization.status || "unknown"),
        executionMode: String(authorization.executionMode || "unknown"),
        platform,
        accountId,
        profileFingerprint: profileId ? accountProfileFingerprint(profileId) : null,
        targetId,
        targetUrl: target?.url || destination?.targetUrl || null,
        sessionMode: account ? "SESSION_REUSE" : null,
        authMode: account ? "MANUAL_AUTH" : null,
        accountSelectionPolicy: authorization.accountSelectionPolicy || null,
        readiness: target?.readiness ? {
          state: safeAccountRuntimeState(target.readiness.state),
          checkedAt: target.readiness.checkedAt || null,
          expiresAt: target.readiness.expiresAt || null,
          reasonCode: safeAccountRuntimeReason(target.readiness.reasonCode || target.readiness.state),
          recoveryClassification: safeAccountRuntimeRecovery(target.readiness.recoveryClassification)
        } : null,
        eligibleForAutonomousExecution: reasons.length === 0,
        ineligibilityReasons: [...new Set(reasons)]
      };
      candidates.push(candidate);
    }
  }
  return candidates
    .sort((left, right) => `${left.eligibleForAutonomousExecution ? "0" : "1"}\u0000${left.platform}\u0000${left.targetId}\u0000${left.candidateKey}`.localeCompare(`${right.eligibleForAutonomousExecution ? "0" : "1"}\u0000${right.platform}\u0000${right.targetId}\u0000${right.candidateKey}`))
    .slice(0, AUTHORIZED_ACCOUNT_CANDIDATE_MAX)
    .map((candidate, index) => ({ ...candidate, selectionOrder: index + 1 }));
}

/**
 * Read-only account-pool advisory for Mission Control. Candidates are grouped
 * by exact target and never rebound or promoted into execution authority. A
 * target with more than one eligible account is intentionally left unselected
 * until an explicit account policy resolves the ambiguity.
 */
export function projectAuthorizedAccountPool(state = {}, options = {}) {
  const candidates = projectAuthorizedAccountCandidates(state, options);
  const byTarget = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.campaignId}\u0000${candidate.targetId}`;
    const rows = byTarget.get(key) || new Map();
    const prior = rows.get(candidate.candidateKey);
    // Repeated exact destination rows are representation duplicates, not
    // independent accounts. Keep the first deterministic candidate only.
    if (!prior) rows.set(candidate.candidateKey, candidate);
    byTarget.set(key, rows);
  }
  return [...byTarget.values()]
    .map((rows) => [...rows.values()])
    .sort((left, right) => `${left[0]?.campaignId || ""}\u0000${left[0]?.targetId || ""}`.localeCompare(`${right[0]?.campaignId || ""}\u0000${right[0]?.targetId || ""}`))
    .map((rows) => {
      const eligible = rows.filter((candidate) => candidate.eligibleForAutonomousExecution)
        .sort((left, right) => String(left.candidateKey).localeCompare(String(right.candidateKey)));
      const eligibleAuthorizationIds = [...new Set(eligible.map((candidate) => candidate.authorizationId))].sort();
      const ambiguousAuthorization = eligibleAuthorizationIds.length > 1;
      const policy = !ambiguousAuthorization ? eligible.map((candidate) => candidate.accountSelectionPolicy).find(Boolean) || null : null;
      const ordered = policy?.mode === "ordered" ? policy.order : [];
      const selected = ambiguousAuthorization ? null : ordered.length ? ordered.map((entry) => eligible.find((candidate) => candidate.platform === entry.platform && candidate.accountId === entry.accountId && candidate.targetId === entry.targetId && candidate.profileFingerprint === accountProfileFingerprint(entry.profileId))).find(Boolean) || null : eligible.length === 1 ? eligible[0] : null;
      const selectionStatus = ambiguousAuthorization
        ? "AMBIGUOUS_AUTHORIZATION"
        : selected && ordered.length ? "POLICY_SELECTED"
          : selected ? "UNIQUE_ELIGIBLE"
            : eligible.length > 1 ? "AMBIGUOUS_POOL" : "NO_ELIGIBLE_CANDIDATE";
      return {
        campaignId: rows[0].campaignId,
        targetId: rows[0].targetId,
        candidateCount: rows.length,
        eligibleCandidateCount: eligible.length,
        selectionStatus,
        selectionReason: ambiguousAuthorization ? "multiple_active_authorizations" : selected ? null : eligible.length > 1 ? "multiple_eligible_accounts" : "no_eligible_account",
        selectionPolicy: ambiguousAuthorization
          ? { status: "AMBIGUOUS_AUTHORIZATION", reason: "multiple_active_authorizations" }
          : ordered.length ? { status: selected ? "ORDERED" : "ORDERED_NO_ELIGIBLE", reason: selected ? null : "ordered_destinations_not_eligible" }
            : { status: "UNSPECIFIED", reason: "no_explicit_account_preference_policy" },
        selectedCandidateKey: selected?.candidateKey || null,
        selectedAccountId: selected?.accountId || null,
        selectedProfileFingerprint: selected?.profileFingerprint || null,
        candidateKeys: rows.map((candidate) => candidate.candidateKey).sort(),
        eligibleAccounts: eligible.map((candidate) => ({
          accountId: candidate.accountId,
          profileFingerprint: candidate.profileFingerprint,
          sessionMode: candidate.sessionMode,
          authMode: candidate.authMode
        })).sort((left, right) => `${left.accountId}\u0000${left.profileFingerprint || ""}`.localeCompare(`${right.accountId}\u0000${right.profileFingerprint || ""}`))
      };
    });
}

/**
 * Select one already-authorized account candidate from the read-only pool
 * projection. This is intentionally a pure planning helper: it never
 * rebinds a target, creates authority, or writes execution state. Ambiguous
 * pools fail closed so callers must obtain an exact policy-selected or unique
 * eligible destination before preparing an execution request.
 */
export function selectAuthorizedAccountCandidate(pool = [], { campaignId = null, targetId = null, candidateKey = null } = {}) {
  if (!Array.isArray(pool)) throw new Error("Authorized account pool must be an array");
  const matching = pool.filter((row) => row &&
    (campaignId == null || String(row.campaignId) === String(campaignId)) &&
    (targetId == null || String(row.targetId) === String(targetId)));
  if (matching.length !== 1) {
    throw new Error(matching.length === 0
      ? "No exact authorized account pool destination"
      : "Authorized account pool selection is ambiguous");
  }
  const row = matching[0];
  if (!new Set(["UNIQUE_ELIGIBLE", "POLICY_SELECTED"]).has(row.selectionStatus)) {
    throw new Error(`Authorized account pool is not selectable: ${String(row.selectionStatus || "UNKNOWN")}`);
  }
  if (!row.selectedCandidateKey || !Array.isArray(row.candidateKeys) || !row.candidateKeys.includes(row.selectedCandidateKey)) {
    throw new Error("Authorized account pool selection is missing an exact candidate key");
  }
  if (candidateKey != null && String(candidateKey) !== String(row.selectedCandidateKey)) {
    throw new Error("Authorized account pool candidate key mismatch");
  }
  if (!String(row.selectedAccountId || "").trim() || !/^[a-f0-9]{64}$/i.test(String(row.selectedProfileFingerprint || ""))) {
    throw new Error("Authorized account pool selection is missing exact account/profile identity");
  }
  const selected = row.selectedCandidateKey;
  return Object.freeze({
    campaignId: String(row.campaignId || ""),
    targetId: String(row.targetId || ""),
    candidateKey: String(selected),
    selectionStatus: String(row.selectionStatus),
    accountId: row.selectedAccountId || null,
    profileFingerprint: row.selectedProfileFingerprint || null
  });
}

/**
 * Summarize the advisory authorized-account candidate projection by exact
 * campaign destination. This is read-only Mission Control context: it never
 * chooses a live account, rebinds a target, or creates execution authority.
 */
export function projectAuthorizedAccountPoolSummary(candidates = []) {
  const groups = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const key = [candidate.campaignId, candidate.authorizationId, candidate.platform, candidate.targetId].map((value) => String(value || "")).join("\u0000");
    const current = groups.get(key) || {
      campaignId: String(candidate.campaignId || ""),
      authorizationId: String(candidate.authorizationId || ""),
      platform: String(candidate.platform || ""),
      targetId: String(candidate.targetId || ""),
      targetUrl: candidate.targetUrl || null,
      candidateCount: 0,
      eligibleCount: 0,
      eligibleCandidateKeys: [],
      blockedReasonCounts: {}
    };
    current.candidateCount += 1;
    if (candidate.eligibleForAutonomousExecution === true) {
      current.eligibleCount += 1;
      if (candidate.candidateKey) current.eligibleCandidateKeys.push(String(candidate.candidateKey));
    } else {
      for (const reason of Array.isArray(candidate.ineligibilityReasons) ? candidate.ineligibilityReasons : []) {
        const normalized = String(reason || "");
        if (normalized) current.blockedReasonCounts[normalized] = (current.blockedReasonCounts[normalized] || 0) + 1;
      }
    }
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((summary) => ({
      ...summary,
      eligibleCandidateKeys: [...new Set(summary.eligibleCandidateKeys)].sort(),
      blockedReasonCounts: Object.fromEntries(Object.entries(summary.blockedReasonCounts).sort(([a], [b]) => a.localeCompare(b))),
      autonomousPath: summary.eligibleCount > 0 ? "AVAILABLE_ADVISORY" : "BLOCKED"
    }))
    .sort((left, right) => `${left.campaignId}\u0000${left.platform}\u0000${left.targetId}\u0000${left.authorizationId}`.localeCompare(`${right.campaignId}\u0000${right.platform}\u0000${right.targetId}\u0000${right.authorizationId}`));
}

/**
 * Read-only campaign authority/runtime summary for Mission Control. This
 * projection reports the currently persisted standing authority and any
 * derived execution artifacts; it never creates, renews, selects, or mutates
 * authorization, window, grant, or lease records.
 */
export function projectCampaignAuthorityRuntime(state = {}, { now = new Date(), readinessTtlMs = configuredReadinessTtlMs() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const observedAt = Number.isFinite(nowMs) ? nowMs : Date.now();
  const campaigns = Array.isArray(state.campaigns) ? state.campaigns : [];
  const authorizations = Array.isArray(state.campaignAuthorizations) ? state.campaignAuthorizations : [];
  const windows = Array.isArray(state.oneTimeExecutionWindows) ? state.oneTimeExecutionWindows : [];
  const grants = Array.isArray(state.liveExecutionGrants) ? state.liveExecutionGrants : [];
  const posts = Array.isArray(state.posts) ? state.posts : [];
  const leases = Array.isArray(state.executionLeases) ? state.executionLeases : [];
  const candidates = projectAuthorizedAccountCandidates(state, { now: new Date(observedAt), readinessTtlMs });
  return campaigns.map((campaign) => {
    const campaignAuthorizations = authorizations.filter((item) => item?.campaignId === campaign.id);
    const activeAuthorizations = campaignAuthorizations.filter((item) => item?.status === "active" && Date.parse(item.validFrom || "") <= observedAt && Date.parse(item.validUntil || "") >= observedAt);
    const standingAuthorizations = activeAuthorizations.filter((item) => item.executionMode === "standing_autonomous" && item.allowLiveExecution === true);
    const activeWindows = windows.filter((item) => item?.campaignId === campaign.id && ["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(item, new Date(observedAt))) && oneTimeExecutionWindowInBounds(item, new Date(observedAt)));
    const activeGrants = grants.filter((item) => item?.campaignId === campaign.id && liveGrantEffectiveStatus(item, new Date(observedAt)) === "ACTIVE");
    const campaignPostIds = new Set(posts.filter((post) => post?.campaignId === campaign.id).map((post) => post.id));
    const activeLeases = leases.filter((item) => campaignPostIds.has(item?.jobId) && Date.parse(item?.expiresAt || "") > observedAt);
    const campaignCandidates = candidates.filter((item) => item?.campaignId === campaign.id);
    const eligibleCandidates = campaignCandidates.filter((item) => item?.eligibleForAutonomousExecution === true);
    const reasons = [];
    if (campaign.status !== "active") reasons.push("campaign_inactive");
    if (!standingAuthorizations.length) reasons.push("no_active_standing_authorization");
    if (standingAuthorizations.length && !eligibleCandidates.length) reasons.push("no_fresh_eligible_account_candidate");
    return {
      campaignId: String(campaign.id || ""),
      campaignStatus: String(campaign.status || "UNKNOWN"),
      activeAuthorizationCount: activeAuthorizations.length,
      standingAuthorizationCount: standingAuthorizations.length,
      activeWindowCount: activeWindows.length,
      activeGrantCount: activeGrants.length,
      activeLeaseCount: activeLeases.length,
      accountCandidateCount: campaignCandidates.length,
      eligibleAccountCandidateCount: eligibleCandidates.length,
      status: reasons.length ? "BLOCKED" : "READY_FOR_BOUNDED_DELEGATION",
      reasons,
      advisory: true,
      authoritySideEffects: false,
      externalSideEffects: false,
      observedAt: new Date(observedAt).toISOString()
    };
  }).sort((left, right) => left.campaignId.localeCompare(right.campaignId));
}

function metricTotals(metric = {}) {
  const snapshot = metric || {};
  return Object.fromEntries(METRIC_FIELDS.map((field) => [field, Number.isSafeInteger(snapshot[field]) ? snapshot[field] : null]));
}

export function buildTrafficPulse(post, snapshots = [], interactions = [], now = new Date(), collectorRuns = []) {
  const metrics = snapshots
    .filter((snapshot) => snapshot.postId === post.id)
    .sort((left, right) => compareMetricSnapshots(right, left));
  const latest = metrics[0] || null;
  const previous = metrics[1] || null;
  const latestTotals = metricTotals(latest);
  const previousTotals = metricTotals(previous);
  const delta = Object.fromEntries(METRIC_FIELDS.map((field) => [field,
    Number.isSafeInteger(latestTotals[field]) && Number.isSafeInteger(previousTotals[field])
      ? latestTotals[field] - previousTotals[field]
      : null
  ]));
  const openInteractions = interactions.filter((interaction) => interaction.postId === post.id && interaction.status === "open").length;
  const nowMs = now.getTime();
  const publishedMs = Date.parse(post.publishedAt || post.updatedAt || "");
  const latestMs = latest ? Date.parse(latest.capturedAt) : Number.NaN;
  const hour = 60 * 60 * 1000;
  let nextReviewAt = Number.isFinite(publishedMs) ? publishedMs + hour : nowMs;
  if (latest) {
    const elapsedSincePublished = Number.isFinite(publishedMs) ? latestMs - publishedMs : 0;
    nextReviewAt = latestMs + (elapsedSincePublished < 23 * hour ? 23 * hour : 24 * hour);
    if (elapsedSincePublished >= 23 * hour && elapsedSincePublished < 71 * hour) nextReviewAt = publishedMs + 72 * hour;
  }
  let recommendation = "Ghi snapshot traffic đầu tiên";
  let priority = "due";
  if (openInteractions > 0) {
    recommendation = `Ưu tiên xử lý ${openInteractions} tương tác đang mở`;
    priority = "engage";
  } else if (!latest) {
    recommendation = nowMs >= nextReviewAt ? "Đến hạn snapshot traffic 1 giờ" : "Chờ mốc snapshot traffic 1 giờ";
    priority = nowMs >= nextReviewAt ? "due" : "watch";
  } else if (nowMs >= nextReviewAt) {
    recommendation = "Snapshot traffic đã đến hạn cập nhật";
    priority = "due";
  } else if (delta.leads > 0 || delta.clicks > 0) {
    recommendation = "Traffic có tín hiệu chuyển đổi; kiểm tra CTA và nguồn tốt nhất";
    priority = "scale";
  } else if (delta.comments > 0 || delta.reactions > 0 || delta.shares > 0) {
    recommendation = "Tương tác đang tăng; theo dõi bình luận và phản hồi có căn cứ";
    priority = "engage";
  } else {
    recommendation = "Tiếp tục theo dõi đến checkpoint kế tiếp";
    priority = "watch";
  }
  return {
    postId: post.id,
    publicationUrl: post.publicationUrl || null,
    latest,
    previous,
    delta,
    checkpoints: buildMetricCheckpoints(post, snapshots, collectorRuns, now),
    openInteractions,
    nextReviewAt: new Date(nextReviewAt).toISOString(),
    recommendation,
    priority
  };
}

export class SeedingService {
  constructor(store, options = {}) {
    this.store = store;
    this.platformPolicies = options.platformPolicies || defaultPlatformPolicies;
    this.readinessTtlMs = options.readinessTtlMs ?? configuredReadinessTtlMs();
    this.maxReadinessAttempts = options.maxReadinessAttempts ?? MAX_READINESS_ATTEMPTS;
    this.readinessProviders = options.readinessProviderRegistry instanceof ReadinessProviderRegistry
      ? options.readinessProviderRegistry
      : new ReadinessProviderRegistry(options.readinessProviders || {});
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 20_000;
    this.readinessInFlight = new Set();
    this.productFactorySandboxProbe = typeof options.productFactorySandboxProbe === "function"
      ? options.productFactorySandboxProbe
      : (typeof options.systemAgenticSandboxProbe === "function"
        ? options.systemAgenticSandboxProbe
        : probeSystemAgenticSeatbeltCapability);
    this.productFactorySandboxProbeTtlMs = Math.min(60_000, Math.max(1_000, Number(options.productFactorySandboxProbeTtlMs) || 15_000));
    this.productFactorySandboxProbeCache = null;
    this.productFactoryUseSeatbelt = options.productFactoryUseSeatbelt === true;
    const explicitProductRoots = options.productRepoRoots !== undefined || Boolean(String(process.env.SEEDING_PRODUCT_REPO_ROOTS || "").trim());
    this.productRepoRoots = (options.productRepoRoots || String(process.env.SEEDING_PRODUCT_REPO_ROOTS || "").split(path.delimiter))
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => path.resolve(value));
    if (!this.productRepoRoots.length) {
      this.productRepoRoots = [path.resolve(appRoot, "..", "System-Agentic_AI", "references")];
    }
    this.productRegistryFile = options.productRegistryFile || process.env.SEEDING_PRODUCT_REGISTRY_FILE || null;
    this.productReferencePlansRoot = options.productReferencePlansRoot === undefined
      ? explicitProductRoots ? null : path.resolve(appRoot, "..", "System-Agentic_AI", "plans")
      : options.productReferencePlansRoot;
  }

  async init() {
    return this.store.init();
  }

  /** Validate and persist a provider-neutral, DRY_RUN distribution handoff. */
  async attachDistributionHandoff(campaignId, input = {}, actor = "system-agentic") {
    const state = await this.store.read();
    const validation = validateDistributionHandoff(input, { state, campaignId });
    if (!validation.ok) {
      const error = new Error(`Invalid distribution handoff: ${validation.errors.join(", ")}`);
      error.code = "INVALID_DISTRIBUTION_HANDOFF";
      error.errors = validation.errors;
      throw error;
    }
    const result = await this.store.mutate(actor, "distribution_handoff_attached", (nextState) => {
      const campaign = requireItem(nextState.campaigns, campaignId, "Campaign");
      campaign.distributionHandoffs ||= [];
      const legacyHash = legacyHandoffIdentity(validation.handoff);
      const existing = campaign.distributionHandoffs.find((item) => item.handoffHash === validation.handoff.handoffHash || item.handoffHash === legacyHash);
      if (existing) return existing;
      const row = { ...validation.handoff, attachedAt: nowIso(), attachedBy: String(actor || "system-agentic") };
      campaign.distributionHandoffs = [...campaign.distributionHandoffs, row].slice(-24);
      campaign.updatedAt = nowIso();
      return row;
    });
    return {
      handoff: result.result,
      result: { ...validation.result, canonicalStateTouched: true, canonicalMetadataPersisted: true, liveDispatch: false, publicationAttempts: 0 }
    };
  }

  async snapshot() {
    return this.store.read();
  }

  /** Read-only, short-lived Product Factory sandbox capability projection. */
  async productFactorySandboxCapability({ force = false } = {}) {
    const now = Date.now();
    if (!force && this.productFactorySandboxProbeCache && now - this.productFactorySandboxProbeCache.checkedAt < this.productFactorySandboxProbeTtlMs) {
      return this.productFactorySandboxProbeCache.value;
    }
    let value;
    try {
      value = await this.productFactorySandboxProbe();
    } catch {
      value = null;
    }
    if (!value || typeof value !== "object") {
      value = {
        version: 1,
        backend: "unknown",
        profile: { id: "factory-sandbox-v1", version: 1, status: "UNAVAILABLE" },
        status: "UNAVAILABLE",
        checks: {},
        limits: {},
        executionEligible: false,
        unsafeCommandDisposition: "NOT_EXECUTED_UNSAFE"
      };
    }
    const safeChecks = Object.fromEntries(PRODUCT_FACTORY_SANDBOX_CHECKS.map((key) => [key, safeProductFactorySandboxStatus(value.checks?.[key])]))
    const safeLimits = Object.fromEntries(PRODUCT_FACTORY_SANDBOX_LIMITS.map((key) => [key, safeProductFactorySandboxStatus(value.limits?.[key])]))
    const safeStatus = safeProductFactorySandboxStatus(value.status)
    const safeEligible = safeStatus === "AVAILABLE"
      && PRODUCT_FACTORY_SANDBOX_CHECKS.every((key) => safeChecks[key] === "PASS")
      && PRODUCT_FACTORY_SANDBOX_LIMITS.every((key) => safeLimits[key] === "PASS")
    const projection = {
      version: Number(value.version) === 1 ? 1 : 1,
      backend: safeProductFactorySandboxToken(value.backend, "unknown"),
      profile: {
        id: safeProductFactorySandboxToken(value.profile?.id, "factory-sandbox-v1"),
        version: Number(value.profile?.version) === 1 ? 1 : 1,
        status: safeProductFactorySandboxStatus(value.profile?.status)
      },
      status: safeStatus,
      checks: safeChecks,
      limits: safeLimits,
      executionEligible: safeEligible,
      unsafeCommandDisposition: "NOT_EXECUTED_UNSAFE"
    };
    this.productFactorySandboxProbeCache = { checkedAt: now, value: projection };
    return projection;
  }

  /** Run a bounded, local-only product factory against the campaign repository. */
  async runProductFactory(campaignId, input = {}, actor = "automation") {
    const state = await this.store.read();
    const campaign = requireItem(state.campaigns, campaignId, "Campaign");
    const productRepo = await requireProductRepo(campaign.productRepo);
    const runId = randomUUID();
    const startedAt = nowIso();
    let run;
    try {
      const classification = await classifyRepository(productRepo);
      const plan = createFactoryPlan(classification);
      const explicitArtifactPaths = Array.isArray(input.artifactPaths) ? input.artifactPaths.slice(0, 32) : null;
      const discovery = explicitArtifactPaths === null ? await discoverArtifactCandidates(productRepo, { maxFiles: 32, maxBytes: 16 * 1024 * 1024 }) : null;
      const artifactPaths = explicitArtifactPaths === null ? (discovery?.candidates || []).map((item) => item.path) : explicitArtifactPaths;
      const probe = await executeStagedFactoryProbe(productRepo, {
        timeoutMs: Math.min(120_000, Math.max(100, Number(input.timeoutMs) || 30_000)),
        maxOutput: 32_000,
        artifactPaths,
        ...(this.productFactoryUseSeatbelt ? { seatbeltCapability: await this.productFactorySandboxCapability() } : {})
      });
      const execution = probe.execution;
      const artifacts = probe.plan.status === "ELIGIBLE"
        ? probe.artifacts
        : await collectArtifactEvidence(productRepo, artifactPaths, []);
      run = {
        id: runId,
        campaignId,
        actor: String(actor || "automation"),
        repositoryPath: productRepo,
        classification,
        plan: { ...plan, projectEvidence: probe.plan },
        execution,
        artifactDiscovery: discovery,
        artifacts,
        status: execution.status,
        externalSideEffects: false,
        startedAt,
        completedAt: nowIso()
      };
    } catch (error) {
      run = {
        id: runId,
        campaignId,
        actor: String(actor || "automation"),
        repositoryPath: productRepo,
        status: "FAILED",
        error: String(error?.message || error).slice(0, 500),
        externalSideEffects: false,
        startedAt,
        completedAt: nowIso()
      };
      await this.store.mutate(actor, "product_factory_run_recorded", (nextState) => {
        const current = requireItem(nextState.campaigns, campaignId, "Campaign");
        current.productFactoryRuns = [...(current.productFactoryRuns || []), run].slice(-MAX_PRODUCT_FACTORY_RUNS);
        current.updatedAt = nowIso();
        return run;
      });
      throw error;
    }
    const result = await this.store.mutate(actor, "product_factory_run_recorded", (nextState) => {
      const current = requireItem(nextState.campaigns, campaignId, "Campaign");
      current.productFactoryRuns = [...(current.productFactoryRuns || []), run].slice(-MAX_PRODUCT_FACTORY_RUNS);
      current.updatedAt = nowIso();
      return run;
    });
    return { ...result.result, persisted: true };
  }

  /** Inspect the registered repository, build grounded understanding, and persist its handoff. */
  async inspectProductIntelligence(campaignId, input = {}, actor = "product-intelligence") {
    const initialState = await this.store.read();
    const campaign = requireItem(initialState.campaigns, campaignId, "Campaign");
    const productRepo = await requireProductRepo(campaign.productRepo);
    const inspection = await inspectRepositoryEvidence(productRepo, input);
    const document = buildProductIntelligence({
      productId: String(input.productId || campaign.id),
      generatedAt: nowIso(),
      evidence: inspection.records.map(({ id, sourceType, locator, content }) => ({ id, sourceType, locator, content })),
      claims: Array.isArray(input.claims) ? input.claims : []
    });
    const requiredFields = ["WHAT_IS_IT", "WHAT_PROBLEM_DOES_IT_SOLVE", "WHY_IS_IT_BETTER", "WHO_NEEDS_IT"];
    const complete = requiredFields.every((field) => document[field]) && document.CLAIMS_WE_CANNOT_MAKE.length === 0;
    const attached = await this.attachProductIntelligence(campaignId, {
      document,
      sourceRepository: productRepo,
      readinessStatus: input.readinessStatus || (complete ? "READY" : "INCOMPLETE"),
      repositoryInspection: {
        schemaVersion: inspection.schemaVersion,
        inspectionHash: inspection.inspectionHash,
        repository: inspection.repository,
        allowlist: inspection.allowlist,
        limits: inspection.limits,
        records: inspection.records.map(({ id, locator, sha256, bytes }) => ({ id, locator, sha256, bytes })),
        skipped: inspection.skipped,
        totalBytes: inspection.totalBytes
      }
    }, actor);
    return { campaignId, inspection, productIntelligence: attached, persisted: true, externalSideEffects: false };
  }

  /** Persist one bounded deterministic outcome summary from existing read-only state. */
  async deriveOutcomeSummary(campaignId, input = {}, actor = "outcome-observer") {
    const state = await this.store.read();
    requireItem(state.campaigns, campaignId, "Campaign");
    const now = input.now ? new Date(input.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("Outcome summary time must be valid");
    const summary = deriveOutcomeSummary(state, campaignId, { now });
    const result = await this.store.mutate(actor, "campaign_outcome_summary_recorded", (nextState) => {
      const campaign = requireItem(nextState.campaigns, campaignId, "Campaign");
      appendOutcomeSummary(campaign, summary);
      return summary;
    });
    return result.result;
  }

  /** Persist one bounded deterministic advisory learning feedback record. */
  async deriveLearningFeedback(campaignId, input = {}, actor = "learning-observer") {
    const state = await this.store.read();
    requireItem(state.campaigns, campaignId, "Campaign");
    const now = input.now ? new Date(input.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("Learning feedback time must be valid");
    const feedback = deriveLearningFeedback(state, campaignId, { now });
    const result = await this.store.mutate(actor, "campaign_learning_feedback_recorded", (nextState) => {
      const campaign = requireItem(nextState.campaigns, campaignId, "Campaign");
      appendLearningFeedback(campaign, feedback);
      return feedback;
    });
    return result.result;
  }

  /** Persist one bounded, deterministic advisory strategy decision. No execution authority is changed. */
  async deriveStrategy(campaignId, input = {}, actor = "strategy-planner") {
    const state = await this.store.read();
    requireItem(state.campaigns, campaignId, "Campaign");
    const now = input.now ? new Date(input.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("Strategy decision time must be valid");
    const decision = deriveStrategyDecision(state, campaignId, { now });
    const result = await this.store.mutate(actor, "strategy_decision_recorded", (nextState) => {
      const campaign = requireItem(nextState.campaigns, campaignId, "Campaign");
      appendStrategyDecision(campaign, decision);
      return decision;
    });
    return result.result;
  }

  /**
   * Run one bounded advisory control cycle from persisted campaign state.
   *
   * This deliberately composes the existing outcome, learning, and strategy
   * projections. It never evaluates or creates execution authority, leases,
   * grants, windows, browser actions, or provider/social side effects.
   */
  async runCampaignControlCycle(campaignId, input = {}, actor = "automation") {
    const now = input.now ? new Date(input.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("Control cycle time must be valid");
    const current = await this.store.read();
    const campaign = requireItem(current.campaigns, campaignId, "Campaign");
    const cycleAt = now.toISOString();
    if (campaign.outcomeSummary?.generatedAt === cycleAt
      && campaign.latestLearningFeedback?.generatedAt === cycleAt
      && campaign.strategyDecisions?.at(-1)?.createdAt === cycleAt) {
      return {
        campaignId, cycleAt,
        outcome: campaign.outcomeSummary,
        learning: campaign.latestLearningFeedback,
        strategy: campaign.strategyDecisions.at(-1),
        advisory: true, authoritySideEffects: false, externalSideEffects: false
      };
    }
    const cycleInput = { now: cycleAt };
    const outcome = await this.deriveOutcomeSummary(campaignId, cycleInput, `${actor}:control-cycle`);
    const learning = await this.deriveLearningFeedback(campaignId, cycleInput, `${actor}:control-cycle`);
    const strategy = await this.deriveStrategy(campaignId, cycleInput, `${actor}:control-cycle`);
    return {
      campaignId,
      cycleAt: now.toISOString(),
      outcome,
      learning,
      strategy,
      advisory: true,
      authoritySideEffects: false,
      externalSideEffects: false
    };
  }

  #assertOperatorControlActor(actor) {
    if (!['operator', 'local-human-operator'].includes(actor)) throw new Error('Only an operator may change the global execution kill switch');
  }

  async activateKillSwitch(reason, actor = 'operator') {
    this.#assertOperatorControlActor(actor);
    const text = String(reason || '').trim();
    if (!text || text.length > 500) throw new Error('Kill switch reason of 1 to 500 characters is required');
    const result = await this.store.mutate(actor, 'kill_switch_activated', (state) => {
      state.control ||= {};
      state.control.killSwitch ||= { active: false, epoch: 0, changedAt: null, changedBy: null, reason: null };
      const killSwitch = state.control.killSwitch;
      killSwitch.active = true;
      killSwitch.epoch = (Number.isSafeInteger(killSwitch.epoch) && killSwitch.epoch >= 0 ? killSwitch.epoch : 0) + 1;
      killSwitch.changedAt = nowIso();
      killSwitch.changedBy = actor;
      killSwitch.reason = text;
      return killSwitch;
    });
    return result.result;
  }

  async deactivateKillSwitch(actor = 'operator') {
    this.#assertOperatorControlActor(actor);
    const result = await this.store.mutate(actor, 'kill_switch_deactivated', (state) => {
      state.control ||= {};
      state.control.killSwitch ||= { active: false, epoch: 0, changedAt: null, changedBy: null, reason: null };
      const killSwitch = state.control.killSwitch;
      killSwitch.active = false;
      killSwitch.epoch = (Number.isSafeInteger(killSwitch.epoch) && killSwitch.epoch >= 0 ? killSwitch.epoch : 0) + 1;
      killSwitch.changedAt = nowIso();
      killSwitch.changedBy = actor;
      killSwitch.reason = null;
      return killSwitch;
    });
    return result.result;
  }

  async rebasePostKillEpoch(postId, actor = 'operator') {
    this.#assertOperatorControlActor(actor);
    const result = await this.store.mutate(actor, 'post_kill_epoch_rebased', (state) => {
      const post = requireItem(state.posts, postId, 'Post');
      const killSwitch = state.control?.killSwitch || { active: false, epoch: 0 };
      if (killSwitch.active === true) throw new Error('Cannot rebase a post while the kill switch is active');
      if (!['queued', 'blocked'].includes(post.status)) throw new Error('Only a queued or blocked post can be rebased after a kill switch epoch change');
      if (unresolvedSubmission(state, post)) throw new Error('SUBMISSION_UNCERTAIN: post cannot be rebased');
      if ((state.executionRequests || []).some((item) => item.jobId === post.id && ['REQUEST_READY', 'EXECUTING', 'SUBMIT_SENT_INTENT', 'SUBMIT_SENT', 'SUBMIT_RESULT_UNKNOWN', 'CONFIRMED'].includes(item.state))) {
        throw new Error('Post has an execution request; cancel or reconcile it before kill epoch rebase');
      }
      const currentEpoch = Number.isSafeInteger(killSwitch.epoch) && killSwitch.epoch >= 0 ? killSwitch.epoch : 0;
      const candidate = { ...post, queuedKillEpoch: currentEpoch };
      const decision = evaluateQueue(candidate, state, new Date(), { mode: 'live' });
      if (!decision.allowed) throw new Error(`Post remains blocked after kill epoch rebase: ${decision.reasons.join(', ')}`);
      post.queuedKillEpoch = currentEpoch;
      post.status = 'queued';
      post.queuedAt = nowIso();
      delete post.blockedAt;
      post.authorizationDecision = { evaluatedAt: post.queuedAt, allowed: true, reasons: [] };
      post.jobLifecycle ||= [{ state: 'CREATED', at: post.createdAt || post.queuedAt }];
      post.jobLifecycle.push({ state: 'QUEUED', at: post.queuedAt, reason: 'kill_switch_epoch_rebased' });
      return post;
    });
    return result.result;
  }

  async assertExecutionSendable(executionId, lease) {
    const snapshot = await this.executionContext(executionId);
    const { requestRow, request, post, target, account } = snapshot;
    const persistedLease = (snapshot.state.executionLeases || []).find((item) => item.id === lease?.id && item.token === lease?.token && Date.parse(item.expiresAt) > Date.now());
    if (!persistedLease) throw Object.assign(new Error('Execution lease is not active before browser input'), { code: 'LEASE_INVALID' });
    if (requestRow.state !== 'SUBMIT_SENT_INTENT' || requestRow.submitState !== 'NOT_STARTED') throw Object.assign(new Error('Execution is not at the durable submit-intent boundary'), { code: 'NOT_DISPATCHABLE' });
    const killReasons = killSwitchReasons(post, snapshot.state);
    if (killReasons.length) throw Object.assign(new Error(`Live browser input blocked by global control: ${killReasons.join(', ')}`), { code: killReasons[0].toUpperCase() });
    const authorization = snapshot.authorization;
    const requestTargetUrl = request?.target?.url;
    let targetUrlMatches = false;
    try {
      targetUrlMatches = canonicalExecutionTargetUrl(requestTargetUrl) === canonicalExecutionTargetUrl(target?.url);
    } catch {
      targetUrlMatches = false;
    }
    const exactBinding = request?.executionId === executionId &&
      request?.jobId === requestRow.jobId && request?.jobId === post.id &&
      request?.campaignId === post.campaignId &&
      request?.platform === target.channel &&
      request?.target?.targetId === post.targetId && request?.target?.targetId === target.id &&
      targetUrlMatches && target.status === 'active' &&
      request?.accountId === target.accountId && request?.profileId === target.profileId &&
      request?.authorization?.authorizationId === authorization?.id &&
      request?.authorization?.binding === authorization?.binding &&
      authorization?.status === 'active' && authorization?.allowLiveExecution === true;
    if (!exactBinding || !account || account.status !== 'enabled' || account.health !== 'healthy' || account.accountId !== request.accountId || account.profileId !== request.profileId || target.profileId !== request.profileId) {
      throw Object.assign(new Error('Execution account/profile health changed before browser input'), { code: 'IDENTITY_MISMATCH' });
    }
    if (!isReadinessFresh(target.readiness, { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id }, new Date(), this.readinessTtlMs)) {
      throw Object.assign(new Error('Execution readiness expired before browser input'), { code: 'READINESS_NOT_READY' });
    }
    return { executionId, controlEpoch: snapshot.state.control?.killSwitch?.epoch ?? 0, accountId: account.accountId, profileId: account.profileId };
  }

  #standingAutonomousAuthorization(authorization) {
    return authorization?.status === "active" && authorization?.executionMode === "standing_autonomous" && authorization.allowLiveExecution === true;
  }

  #assertStandingBinding(state, postId, expected = {}) {
    const post = requireItem(state.posts, postId, "Post");
    const campaign = requireItem(state.campaigns || [], post.campaignId, "Campaign");
    const authorization = requireItem(state.campaignAuthorizations || [], post.campaignAuthorizationId, "Campaign authorization");
    const target = requireItem(state.targets, post.targetId, "Target");
    const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
    const exact = campaign.status === "active" &&
      this.#standingAutonomousAuthorization(authorization) &&
      authorization.campaignId === campaign.id &&
      authorization.binding === campaignAuthorizationFingerprint(authorization) &&
      authorization.campaignBinding === campaignScopeFingerprint(campaign) &&
      post.campaignAuthorizationId === authorization.id &&
      post.campaignAuthorizationBinding === authorization.binding &&
      target.status === "active" &&
      account?.status === "enabled" &&
      account.profileId === target.profileId &&
      (expected.campaignId === undefined || post.campaignId === expected.campaignId) &&
      (expected.authorizationId === undefined || authorization.id === expected.authorizationId) &&
      (expected.authorizationBinding === undefined || authorization.binding === expected.authorizationBinding) &&
      (expected.campaignBinding === undefined || authorization.campaignBinding === expected.campaignBinding) &&
      (expected.postAuthorizationBinding === undefined || post.campaignAuthorizationBinding === expected.postAuthorizationBinding) &&
      (expected.targetId === undefined || target.id === expected.targetId) &&
      (expected.accountId === undefined || target.accountId === expected.accountId) &&
      (expected.profileId === undefined || target.profileId === expected.profileId) &&
      (expected.targetUrl === undefined || target.url === expected.targetUrl) &&
      (expected.postStatus === undefined || post.status === expected.postStatus) &&
      (expected.contentId === undefined || post.contentId === expected.contentId) &&
      (expected.contentHash === undefined || contentSha256(post.content) === expected.contentHash) &&
      (expected.audience === undefined || post.audience === expected.audience) &&
      (expected.publicationVisibility === undefined || String(post.publicationVisibility || "PUBLIC").toUpperCase() === expected.publicationVisibility) &&
      (expected.idempotencyKey === undefined || post.idempotencyKey === expected.idempotencyKey) &&
      (expected.artifactId === undefined || (post.artifactId || null) === expected.artifactId) &&
      (expected.assetPath === undefined || (post.assetPath || null) === expected.assetPath) &&
      (expected.assetSha256 === undefined || (post.assetSha256 || null) === expected.assetSha256);
    if (!exact) throw new Error("Standing delegation requires an exact current campaign authorization binding");
    return { post, campaign, authorization, target, account };
  }

  async ensureStandingExecutionWindow(postId, actor = "campaign-queue-scheduler") {
    const allowedActors = new Set(["scheduler", "campaign-queue-scheduler", "automation", "local-draft-automation", "execution-router"]);
    if (!allowedActors.has(actor)) throw new Error("Standing execution delegation is scheduler-only");
    const snapshot = await this.store.read();
    const post = requireItem(snapshot.posts, postId, "Post");
    const authorization = requireItem(snapshot.campaignAuthorizations || [], post.campaignAuthorizationId, "Campaign authorization");
    if (!this.#standingAutonomousAuthorization(authorization)) return null;
    const campaign = requireItem(snapshot.campaigns || [], post.campaignId, "Campaign");
    if (campaign.status !== "active" || authorization.campaignId !== campaign.id ||
        authorization.binding !== campaignAuthorizationFingerprint(authorization) ||
        authorization.campaignBinding !== campaignScopeFingerprint(campaign) ||
        post.campaignAuthorizationBinding !== authorization.binding) {
      throw new Error("Standing delegation requires an exact current campaign authorization binding");
    }
    if (unresolvedSubmission(snapshot, post)) throw new Error("SUBMISSION_UNCERTAIN: standing delegation cannot cross an unresolved submission");
    if (["publishing", "processing", UNKNOWN_POST_STATUS, "published", "removed", "rejected"].includes(post.status)) return null;
    const target = requireItem(snapshot.targets, post.targetId, "Target");
    const account = (snapshot.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
    if (!account || account.status !== "enabled" || account.profileId !== target.profileId) throw new Error("Standing delegation requires an exact enabled account/profile binding");
    const now = new Date();
    const existing = (snapshot.oneTimeExecutionWindows || []).filter((item) => item.jobId === post.id && item.campaignAuthorizationId === authorization.id && ["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(item, now)));
    if (existing.length > 1) throw new Error("Multiple active standing execution windows match this job");
    if (existing.length === 1) {
      const current = existing[0];
      if (current.campaignId !== post.campaignId || current.campaignAuthorizationId !== authorization.id ||
          current.jobId !== post.id || current.authorizationFingerprint !== authorization.binding ||
          current.binding !== oneTimeExecutionWindowFingerprint(current) || current.maxExecutions !== 1 ||
          !oneTimeExecutionWindowInBounds(current, now)) {
        throw new Error("Standing execution window binding is stale");
      }
      return current;
    }
    const fromMs = Math.max(now.getTime() - 5_000, Date.parse(authorization.validFrom));
    const untilMs = Math.min(Date.parse(authorization.validUntil), now.getTime() + 15 * 60_000);
    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= now.getTime()) throw new Error("Standing authorization has no current execution window");
    const window = normalizeOneTimeExecutionWindow({
      windowId: `standing-${post.id}-${now.getTime()}`,
      campaignId: post.campaignId,
      campaignAuthorizationId: authorization.id,
      jobId: post.id,
      validFrom: new Date(fromMs).toISOString(),
      validUntil: new Date(untilMs).toISOString(),
      timezone: authorization.schedule.timezone,
      reason: `standing campaign authorization ${authorization.id}`
    }, { post, authorization, authorizationFingerprint: authorization.binding, now, createdBy: actor });
    const result = await this.store.mutate(actor, "standing_execution_window_derived", (state) => {
      const currentBinding = this.#assertStandingBinding(state, postId, {
        campaignId: post.campaignId,
        authorizationId: authorization.id,
        authorizationBinding: authorization.binding,
        campaignBinding: campaignScopeFingerprint(campaign),
        postAuthorizationBinding: post.campaignAuthorizationBinding,
        targetId: target.id,
        accountId: target.accountId,
        profileId: target.profileId,
        targetUrl: target.url,
        postStatus: post.status,
        contentId: post.contentId,
        contentHash: contentSha256(post.content),
        audience: post.audience,
        publicationVisibility: String(post.publicationVisibility || "PUBLIC").toUpperCase(),
        idempotencyKey: post.idempotencyKey,
        artifactId: post.artifactId || null,
        assetPath: post.assetPath || null,
        assetSha256: post.assetSha256 || null
      });
      const current = currentBinding.post;
      if (unresolvedSubmission(state, current)) throw new Error("SUBMISSION_UNCERTAIN: standing delegation cannot cross an unresolved submission");
      const active = (state.oneTimeExecutionWindows || []).find((item) => item.jobId === postId && item.campaignAuthorizationId === currentBinding.authorization.id && ["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(item, new Date())));
      if (active) {
        if (active.campaignId !== current.campaignId || active.campaignAuthorizationId !== currentBinding.authorization.id ||
            active.authorizationFingerprint !== currentBinding.authorization.binding || active.binding !== oneTimeExecutionWindowFingerprint(active) ||
            active.maxExecutions !== 1) {
          throw new Error("Standing execution window binding is stale");
        }
        return active;
      }
      if (window.campaignId !== current.campaignId || window.campaignAuthorizationId !== currentBinding.authorization.id ||
          window.jobId !== current.id || window.authorizationFingerprint !== currentBinding.authorization.binding ||
          window.binding !== oneTimeExecutionWindowFingerprint(window) || window.maxExecutions !== 1) {
        throw new Error("Standing execution window binding is stale");
      }
      state.oneTimeExecutionWindows ||= [];
      state.oneTimeExecutionWindows.push(window);
      return window;
    });
    return result.result;
  }

  async ensureStandingExecutionGrant(postId, actor = "campaign-queue-scheduler") {
    const allowedActors = new Set(["scheduler", "campaign-queue-scheduler", "automation", "local-draft-automation", "execution-router"]);
    if (!allowedActors.has(actor)) throw new Error("Standing execution delegation is scheduler-only");
    const snapshot = await this.store.read();
    const post = requireItem(snapshot.posts, postId, "Post");
    const authorization = requireItem(snapshot.campaignAuthorizations || [], post.campaignAuthorizationId, "Campaign authorization");
    if (!this.#standingAutonomousAuthorization(authorization)) return null;
    const campaign = requireItem(snapshot.campaigns || [], post.campaignId, "Campaign");
    if (campaign.status !== "active" || authorization.campaignId !== campaign.id ||
        authorization.binding !== campaignAuthorizationFingerprint(authorization) ||
        authorization.campaignBinding !== campaignScopeFingerprint(campaign) ||
        post.campaignAuthorizationBinding !== authorization.binding) {
      throw new Error("Standing delegation requires an exact current campaign authorization binding");
    }
    const target = requireItem(snapshot.targets, post.targetId, "Target");
    const account = (snapshot.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
    const window = (snapshot.oneTimeExecutionWindows || []).find((item) => item.jobId === post.id && item.campaignAuthorizationId === authorization.id && ["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(item, new Date())));
    if (!window) throw new Error("Standing execution grant requires an active one-time window");
    if (window.campaignId !== post.campaignId || window.campaignAuthorizationId !== authorization.id ||
        window.jobId !== post.id || window.authorizationFingerprint !== authorization.binding ||
        window.binding !== oneTimeExecutionWindowFingerprint(window) || window.maxExecutions !== 1 ||
        !oneTimeExecutionWindowInBounds(window, new Date())) {
      throw new Error("Standing execution grant window binding is stale");
    }
    const now = new Date();
    const pending = (snapshot.executionRequests || []).filter((item) => {
      if (item.jobId !== post.id || item.request?.authorization?.authorizationId !== authorization.id ||
          item.state !== "REQUEST_READY" || item.submitState !== "NOT_STARTED" || item.request?.dryRun === true) return false;
      const request = item.request || {};
      const requestReadiness = request.readiness || {};
      const requestWindowId = request.oneTimeWindow?.windowId;
      const requestWindow = requestWindowId ? snapshot.oneTimeExecutionWindows?.find((candidate) => candidate.windowId === requestWindowId) : null;
      if (request.executionId !== item.executionId || requestWindowId !== window.windowId ||
          !isExecutionRequestReadinessFresh(requestReadiness, { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id }, now, this.readinessTtlMs) ||
          !requestWindow || requestWindow.status !== "RESERVED" || requestWindow.reservedExecutionId !== item.executionId ||
          requestWindow.binding !== oneTimeExecutionWindowFingerprint(requestWindow)) return false;
      return true;
    });
    if (pending.length > 1) throw new Error("Multiple live executions are pending for standing delegation");
    if (!account || account.status !== "enabled" || account.profileId !== target.profileId) throw new Error("Standing execution grant requires an exact enabled account/profile binding");
    if (account.health !== "healthy") throw new Error("Standing execution grant requires a healthy account");
    if (!isReadinessFresh(target.readiness, { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id }, now, this.readinessTtlMs)) throw new Error("Standing execution grant requires fresh readiness");
    const validFrom = new Date(Math.max(now.getTime() - 5_000, Date.parse(window.validFrom))).toISOString();
    const validUntil = new Date(Math.min(Date.parse(window.validUntil), Date.parse(authorization.validUntil))).toISOString();
    const grant = createLiveExecutionGrantV1({
      post, target, account, authorization, artifact: post.artifactId ? requireItem(snapshot.artifacts || [], post.artifactId, "Artifact") : null,
      validFrom, validUntil, createdBy: "standing-campaign-delegation",
      operatorAuthorizationReference: authorization.standingAuthorizationReference, now
    });
    const expectedRequest = pending[0] || null;
    const result = await this.store.mutate(actor, "standing_execution_grant_derived", (state) => {
      const currentBinding = this.#assertStandingBinding(state, postId, {
        campaignId: post.campaignId,
        authorizationId: authorization.id,
        authorizationBinding: authorization.binding,
        campaignBinding: campaignScopeFingerprint(campaign),
        postAuthorizationBinding: post.campaignAuthorizationBinding,
        targetId: target.id,
        accountId: target.accountId,
        profileId: target.profileId,
        targetUrl: target.url,
        postStatus: post.status,
        contentId: post.contentId,
        contentHash: contentSha256(post.content),
        audience: post.audience,
        publicationVisibility: String(post.publicationVisibility || "PUBLIC").toUpperCase(),
        idempotencyKey: post.idempotencyKey,
        artifactId: post.artifactId || null,
        assetPath: post.assetPath || null,
        assetSha256: post.assetSha256 || null
      });
      const currentPost = currentBinding.post;
      const currentAuthorization = currentBinding.authorization;
      if (currentBinding.account.health !== "healthy" || !isReadinessFresh(currentBinding.target.readiness, {
        platform: currentBinding.target.channel,
        accountId: currentBinding.target.accountId,
        profileId: currentBinding.target.profileId,
        targetId: currentBinding.target.id
      }, new Date(), this.readinessTtlMs)) {
        throw new Error("Standing execution grant requires a fresh healthy account/profile binding");
      }
      if (unresolvedSubmission(state, currentPost)) throw new Error("SUBMISSION_UNCERTAIN: standing delegation cannot cross an unresolved submission");
      const currentRequest = (state.executionRequests || []).find((item) => item.jobId === postId && item.request?.authorization?.authorizationId === currentAuthorization.id && item.state === "REQUEST_READY" && item.submitState === "NOT_STARTED" && item.request?.dryRun !== true && item.executionId === expectedRequest?.executionId && item.request?.oneTimeWindow?.windowId === window.windowId);
      if (!currentRequest) throw new Error("Standing execution grant requires a pending live execution request");
      const requestMatches = currentRequest.executionId === expectedRequest?.executionId &&
        currentRequest.jobId === currentPost.id && currentRequest.campaignId === currentPost.campaignId &&
        currentRequest.request?.executionId === currentRequest.executionId && currentRequest.request?.jobId === currentPost.id &&
        currentRequest.request?.campaignId === currentPost.campaignId && currentRequest.request?.platform === currentBinding.target.channel &&
        currentRequest.request?.accountId === currentBinding.target.accountId && currentRequest.request?.profileId === currentBinding.target.profileId &&
        currentRequest.request?.target?.targetId === currentBinding.target.id && currentRequest.request?.target?.url === currentBinding.target.url &&
        currentRequest.request?.authorization?.authorizationId === currentAuthorization.id && currentRequest.request?.authorization?.binding === currentAuthorization.binding &&
        currentRequest.request?.content?.contentId === currentPost.contentId && currentRequest.request?.content?.sha256 === contentSha256(currentPost.content) &&
        currentRequest.request?.audience === currentPost.audience &&
        currentRequest.request?.publicationVisibility === String(currentPost.publicationVisibility || "PUBLIC").toUpperCase() &&
        currentRequest.request?.idempotencyKey === currentPost.idempotencyKey && currentRequest.request?.oneTimeWindow?.windowId === window.windowId &&
        currentRequest.request?.media?.length === (currentPost.artifactId ? 1 : 0) &&
        (!currentPost.artifactId || (currentRequest.request.media[0]?.artifactId === currentPost.artifactId &&
          currentRequest.request.media[0]?.sha256 === currentPost.assetSha256 &&
          currentRequest.request.media[0]?.reference === currentPost.assetPath));
      if (!requestMatches) throw new Error("Standing execution grant request binding is stale");
      const currentWindow = (state.oneTimeExecutionWindows || []).find((item) => item.windowId === window.windowId);
      if (!currentWindow || currentWindow.campaignId !== currentPost.campaignId || currentWindow.campaignAuthorizationId !== currentAuthorization.id ||
          currentWindow.jobId !== currentPost.id || currentWindow.authorizationFingerprint !== currentAuthorization.binding ||
          currentWindow.binding !== oneTimeExecutionWindowFingerprint(currentWindow) || currentWindow.maxExecutions !== 1 ||
          !["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(currentWindow, new Date())) ||
          !oneTimeExecutionWindowInBounds(currentWindow, new Date()) ||
          (currentWindow.status === "RESERVED" && currentWindow.reservedExecutionId !== currentRequest.executionId)) {
        throw new Error("Standing execution grant window binding is stale");
      }
      const currentExisting = (state.liveExecutionGrants || []).find((item) => item.jobId === postId && item.campaignAuthorizationId === currentAuthorization.id && liveGrantEffectiveStatus(item) === "ACTIVE");
      if (currentExisting) {
        try {
          assertLiveGrantMatchesExecution(currentExisting, currentRequest.request, currentAuthorization, new Date(), { checkWindow: false });
        } catch {
          throw new Error("Standing execution grant binding is stale");
        }
        return currentExisting;
      }
      grant.boundExecutionId = currentRequest.executionId;
      currentRequest.request.liveGrant = { grantId: grant.grantId };
      assertLiveGrantMatchesExecution(grant, currentRequest.request, currentAuthorization, new Date(), { checkWindow: false });
      currentRequest.liveGrantId = grant.grantId;
      state.liveExecutionGrants ||= [];
      state.liveExecutionGrants.push(grant);
      return grant;
    });
    return result.result;
  }

  async createLiveExecutionGrant(input, actor = "operator") {
    if (!["operator", "local-human-operator"].includes(actor)) throw new Error("Only an operator may create live execution grants");
    const result = await this.store.mutate(actor, "live_execution_grant_created", (state) => {
      const post = requireItem(state.posts, String(input.jobId || ""), "Post");
      const campaign = requireItem(state.campaigns, post.campaignId, "Campaign");
      const target = requireItem(state.targets, post.targetId, "Target");
      const account = (state.executionAccounts || []).find((item) => item.platform === target.channel && item.accountId === target.accountId);
      const authorization = requireItem(state.campaignAuthorizations || [], post.campaignAuthorizationId, "Campaign authorization");
      if (campaign.status !== "active" || authorization.campaignBinding !== campaignScopeFingerprint(campaign)) throw new Error("Campaign scope is not active and unchanged");
      const artifact = post.artifactId ? requireItem(state.artifacts || [], post.artifactId, "Artifact") : null;
      if (unresolvedSubmission(state, post)) throw new Error("Job or publication identity has an unresolved submission uncertainty");
      if (["publishing", "processing", UNKNOWN_POST_STATUS, "published", "removed", "rejected"].includes(post.status)) throw new Error("Job cannot receive a live grant in its current state");
      if ((state.executionRequests || []).some((item) => item.jobId === post.id && ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state)) ||
          (state.executionReceipts || []).some((item) => item.jobId === post.id && (["SUBMIT_SENT", "CONFIRMED"].includes(item.receipt?.submitState) || (item.receipt?.submitState === "UNKNOWN" && !(state.submissionUncertainties || []).some((uncertainty) => uncertainty.jobId === post.id && uncertainty.executionId === item.executionId && uncertainty.status === "PROVEN_FAILED"))))) {
        throw new Error("Job has an existing or uncertain submission");
      }
      if ((state.liveExecutionGrants || []).some((item) => item.jobId === post.id && liveGrantEffectiveStatus(item) === "ACTIVE")) throw new Error("An active live grant already exists for this job");
      const grant = createLiveExecutionGrantV1({ post, target, account, authorization, artifact, validFrom: input.validFrom, validUntil: input.validUntil, createdBy: actor, operatorAuthorizationReference: input.operatorAuthorizationReference });
      const pending = (state.executionRequests || []).filter((item) => item.jobId === post.id && item.state === "REQUEST_READY" && item.submitState === "NOT_STARTED" && item.request?.dryRun !== true);
      if (pending.length > 1) throw new Error("Multiple live executions are pending for this job");
      if (pending.length === 1) {
        pending[0].request.liveGrant = { grantId: grant.grantId };
        grant.boundExecutionId = pending[0].executionId;
        assertLiveGrantMatchesExecution(grant, pending[0].request, authorization, new Date(), { checkWindow: false });
        pending[0].liveGrantId = grant.grantId;
      }
      state.liveExecutionGrants ||= [];
      state.liveExecutionGrants.push(grant);
      return grant;
    });
    return result.result;
  }

  async getLiveExecutionGrant(grantId) {
    const state = await this.store.read();
    const grant = (state.liveExecutionGrants || []).find((item) => item.grantId === grantId);
    if (!grant) throw new Error(`Live execution grant not found: ${grantId}`);
    return { ...grant, status: liveGrantEffectiveStatus(grant) };
  }

  async revokeLiveExecutionGrant(grantId, actor = "operator") {
    if (!["operator", "local-human-operator"].includes(actor)) throw new Error("Only an operator may revoke live execution grants");
    const result = await this.store.mutate(actor, "live_execution_grant_revoked", (state) => {
      const grant = (state.liveExecutionGrants || []).find((item) => item.grantId === grantId);
      if (!grant) throw new Error(`Live execution grant not found: ${grantId}`);
      if (grant.status === "CONSUMED") throw new Error("A consumed grant cannot be revoked or reused");
      if (grant.status === "REVOKED") return grant;
      grant.status = "REVOKED";
      grant.revokedAt = nowIso();
      return grant;
    });
    return result.result;
  }

  async expireLiveExecutionGrants(actor = "scheduler") {
    const snapshot = await this.store.read();
    if (!(snapshot.liveExecutionGrants || []).some((grant) => grant.status === "ACTIVE" && liveGrantEffectiveStatus(grant) === "EXPIRED")) return [];
    const result = await this.store.mutate(actor, "live_execution_grants_expired", (state) => {
      const expired = [];
      for (const grant of state.liveExecutionGrants || []) {
        if (grant.status !== "ACTIVE" || liveGrantEffectiveStatus(grant) !== "EXPIRED") continue;
        grant.status = "EXPIRED";
        grant.expiredAt = nowIso();
        expired.push(grant.grantId);
      }
      return expired;
    });
    return result.result;
  }

  async createOneTimeExecutionWindow(input, actor = "operator") {
    if (!["operator", "local-human-operator"].includes(actor)) throw new Error("Only an operator may create one-time execution windows");
    const result = await this.store.mutate(actor, "one_time_execution_window_created", (state) => {
      const post = requireItem(state.posts, String(input.jobId || ""), "Post");
      const campaign = requireItem(state.campaigns, post.campaignId, "Campaign");
      const authorization = requireItem(state.campaignAuthorizations || [], String(input.campaignAuthorizationId || ""), "Campaign authorization");
      const now = new Date();
      if (campaign.status !== "active" || authorization.status !== "active" || authorization.campaignId !== post.campaignId ||
          post.campaignAuthorizationId !== authorization.id || post.campaignAuthorizationBinding !== authorization.binding ||
          authorization.binding !== campaignAuthorizationFingerprint(authorization) || authorization.campaignBinding !== campaignScopeFingerprint(campaign) ||
          !Number.isFinite(Date.parse(authorization.validFrom)) || now < new Date(authorization.validFrom) || !Number.isFinite(Date.parse(authorization.validUntil)) || now > new Date(authorization.validUntil)) {
        throw new Error("One-time window requires the job's current, active campaign authorization");
      }
      if (unresolvedSubmission(state, post) || ["publishing", "processing", UNKNOWN_POST_STATUS, "published", "removed", "rejected"].includes(post.status)) {
        throw new Error("Job has an active, published, or uncertain submission and cannot receive a one-time window");
      }
      if ((state.executionRequests || []).some((item) => item.jobId === post.id && ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state)) ||
          (state.executionReceipts || []).some((item) => item.jobId === post.id && (["SUBMIT_SENT", "CONFIRMED"].includes(item.receipt?.submitState) ||
            (item.receipt?.submitState === "UNKNOWN" && !(state.submissionUncertainties || []).some((uncertainty) => uncertainty.jobId === post.id && uncertainty.executionId === item.executionId && uncertainty.status === "PROVEN_FAILED"))))) {
        throw new Error("Job has existing or uncertain submit history");
      }
      if ((state.oneTimeExecutionWindows || []).some((item) => item.jobId === post.id && ["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(item, now)))) {
        throw new Error("An active one-time execution window already exists for this job");
      }
      const window = normalizeOneTimeExecutionWindow(input, {
        post, authorization, authorizationFingerprint: campaignAuthorizationFingerprint(authorization), now, createdBy: actor
      });
      state.oneTimeExecutionWindows ||= [];
      if (state.oneTimeExecutionWindows.some((item) => item.windowId === window.windowId)) throw new Error(`One-time execution window already exists: ${window.windowId}`);
      state.oneTimeExecutionWindows.push(window);
      return window;
    });
    return result.result;
  }

  async getOneTimeExecutionWindow(windowId) {
    const state = await this.store.read();
    const window = (state.oneTimeExecutionWindows || []).find((item) => item.windowId === windowId);
    if (!window) throw new Error(`One-time execution window not found: ${windowId}`);
    return { ...window, effectiveStatus: oneTimeExecutionWindowStatus(window) };
  }

  async revokeOneTimeExecutionWindow(windowId, actor = "operator") {
    if (!["operator", "local-human-operator"].includes(actor)) throw new Error("Only an operator may revoke one-time execution windows");
    const result = await this.store.mutate(actor, "one_time_execution_window_revoked", (state) => {
      const window = (state.oneTimeExecutionWindows || []).find((item) => item.windowId === windowId);
      if (!window) throw new Error(`One-time execution window not found: ${windowId}`);
      if (["CONSUMED", "EXPIRED"].includes(window.status)) throw new Error(`A ${window.status.toLowerCase()} one-time window cannot be revoked or reused`);
      if (window.status === "REVOKED") return window;
      window.status = "REVOKED";
      window.revokedAt = nowIso();
      window.revokedBy = actor;
      return window;
    });
    return result.result;
  }

  async expireOneTimeExecutionWindows(actor = "scheduler", now = new Date()) {
    const snapshot = await this.store.read();
    const dueIds = new Set((snapshot.oneTimeExecutionWindows || [])
      .filter((item) => ["ACTIVE", "RESERVED"].includes(item.status) && oneTimeExecutionWindowStatus(item, now) === "EXPIRED")
      .map((item) => item.windowId));
    if (!dueIds.size) return [];
    const result = await this.store.mutate(actor, "one_time_execution_windows_expired", (state) => {
      const expired = [];
      for (const window of state.oneTimeExecutionWindows || []) {
        if (dueIds.has(window.windowId) && ["ACTIVE", "RESERVED"].includes(window.status) && oneTimeExecutionWindowStatus(window, now) === "EXPIRED") {
          window.status = "EXPIRED";
          window.expiredAt = now.toISOString();
          expired.push(window.windowId);
        }
      }
      return expired;
    });
    return result.result;
  }

  async flowGraph() {
    return buildMarketingFlowGraph(await this.store.read());
  }

  async bootstrapR19(actor = "operator") {
    const productRepo = await requireProductRepo(process.env.SEEDING_R19_PRODUCT_REPO || path.resolve(appRoot, "..", "design-os-3d-blender"));
    const assetPath = process.env.SEEDING_R19_MEDIA_PATH ? path.resolve(process.env.SEEDING_R19_MEDIA_PATH) : null;
    const result = await this.store.mutate(actor, "bootstrap_r19", (state) => {
      const createdAt = nowIso();
      addSeedDefaults(state.campaigns, {
        id: "campaign_r19_gt_course_validation",
        name: "R19 GT course market validation",
        objective: "Validate global demand for an agentic Blender workflow course using a real media artifact.",
        productRepo,
        assetPath,
        audience: ["Blender artists", "3D educators", "AI automation builders", "indie makers"],
        status: "active",
        createdAt
      });

      const targets = [
        {
          id: "target_fb_blender3d_malaysia",
          channel: "facebook_group",
          name: "Blender 3D Malaysia",
          url: "https://www.facebook.com/groups/77005549170",
          accountId: "facebook_61560390790557",
          status: "active",
          rulesStatus: "reviewed",
          locale: "en-MY",
          notes: "Public Blender workflow group; import a direct permalink and verification evidence before marking published."
        },
        {
          id: "target_threads_global",
          channel: "threads",
          name: "Threads global maker audience",
          url: "https://www.threads.net/",
          accountId: "threads_primary",
          status: "needs_review",
          rulesStatus: "not_required",
          locale: "en"
        },
        {
          id: "target_reddit_blender",
          channel: "reddit",
          name: "Relevant Blender/AI subreddit",
          url: "https://www.reddit.com/r/3Dmodeling/",
          accountId: "reddit_primary",
          status: "needs_review",
          rulesStatus: "pending",
          locale: "en"
        },
        {
          id: "target_product_hunt",
          channel: "product_hunt",
          name: "Product Hunt launch",
          url: "https://www.producthunt.com/",
          accountId: "product_hunt_primary",
          status: "needs_review",
          rulesStatus: "pending",
          locale: "en"
        },
        {
          id: "target_indie_hackers",
          channel: "indie_hackers",
          name: "Indie Hackers build log",
          url: "https://www.indiehackers.com/",
          accountId: "indie_hackers_primary",
          status: "needs_review",
          rulesStatus: "pending",
          locale: "en"
        },
        {
          id: "target_email_opt_in",
          channel: "email",
          name: "Consent-based product updates",
          url: "https://localhost.invalid/consent-based-email",
          accountId: "email_opt_in_primary",
          status: "needs_review",
          rulesStatus: "pending",
          locale: "en",
          consentBasis: null,
          audienceSource: null,
          unsubscribeMechanism: null,
          notes: "Placeholder only. Keep inactive until consent source and unsubscribe evidence are reviewed."
        }
      ];
      const allTargets = [...targets, ...this.platformPolicies.defaultTargets()];
      for (const target of allTargets) addSeedDefaults(state.targets, { createdAt, ...target });

      const posts = allTargets.map((target) => ({
        id: `post_r19_${target.channel}`,
        campaignId: "campaign_r19_gt_course_validation",
        targetId: target.id,
        content: R19_CHANNEL_CONTENT[target.channel],
        assetPath,
        language: "en",
        status: "needs_review",
        approvedAt: null,
        publishedAt: null,
        publicationUrl: null,
        evidence: null,
        createdAt,
        updatedAt: createdAt
      }));
      for (const post of posts) {
        const existing = state.posts.find((item) => item.id === post.id);
        if (!existing) {
          state.posts.push(post);
          continue;
        }
        if (["draft", "needs_review"].includes(existing.status) && !existing.approvedAt) {
          existing.content = post.content;
          existing.assetPath = post.assetPath;
          existing.language = post.language;
          existing.updatedAt = createdAt;
        }
      }
      return { campaignId: "campaign_r19_gt_course_validation", postCount: posts.length };
    });
    return result.result;
  }

  async createCampaign(input, actor = "operator") {
    const productRepo = await requireProductRepo(input.productRepo);
    const track = optionalProductTrack(input.track);
    const discoveryFit = normalizeDiscoveryFit(input.discoveryFit);
    const result = await this.store.mutate(actor, "campaign_created", (state) => {
      const campaign = {
        id: randomUUID(),
        name: String(input.name || "").trim(),
        objective: String(input.objective || "").trim(),
        productRepo,
        track,
        landingUrl: optionalHttpUrl(input.landingUrl, "Campaign landingUrl"),
        keywords: normalizeKeywords(input.keywords),
        audience: Array.isArray(input.audience) ? input.audience : [],
        discoverySources: normalizeDiscoverySources(input.discoverySources) || [],
        ...(discoveryFit ? { discoveryFit } : {}),
        status: "draft",
        createdAt: nowIso()
      };
      if (!campaign.name || !campaign.objective) throw new Error("Campaign name and objective are required");
      state.campaigns.push(campaign);
      return campaign;
    });
    return result.result;
  }

  /**
   * Bootstrap one bounded autonomous campaign from a high-level brief.
   *
   * This is the domain handoff from campaign intent to the existing
   * authorization and execution contracts. Every low-level identity is
   * resolved from the registered runtime; no account, target, payload hash,
   * window, grant, or lease is invented by the caller. The method is
   * idempotent for one deterministic campaign/authorization identity and is
   * deliberately fail-closed when the registry is missing or ambiguous.
   */
  async bootstrapAutonomousCampaign(input = {}, actor = "autonomous-campaign-bootstrap") {
    const platform = String(input.platform || "linkedin").trim().toLowerCase();
    if (platform !== "linkedin") throw new Error("Autonomous bootstrap currently supports LinkedIn only");
    const bootstrapState = await this.store.read();
    const resolvedProduct = await resolveBootstrapProductRepo(input, {
      state: bootstrapState,
      roots: this.productRepoRoots,
      registryFile: this.productRegistryFile,
      plansRoot: this.productReferencePlansRoot
    });
    if (!resolvedProduct.productRepo) {
      return {
        status: "BLOCKED",
        code: resolvedProduct.blocker.code,
        blockers: [resolvedProduct.blocker],
        productKeys: resolvedProduct.productKeys || [],
        candidates: resolvedProduct.candidates || [],
        externalSideEffects: false,
        authoritySideEffects: false
      };
    }
    const productRepo = resolvedProduct.productRepo;
    const identity = deriveBootstrapIdentity({
      productRepo,
      name: input.name,
      objective: input.objective,
      audience: input.audience,
      platform,
      authorizationReference: input.authorizationReference
    });
    const audience = normalizeBootstrapAudience(identity.audience);
    const audienceSerialization = canonicalAudienceSerialization(audience);
    let schedule = deriveBootstrapSchedule({
      now: input.now || new Date(),
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      validityHours: input.validityHours === undefined ? 24 : input.validityHours,
      timezone: input.timezone || "UTC",
      quota: input.quota === undefined ? 1 : input.quota,
      concurrency: input.concurrency === undefined ? 1 : input.concurrency
    });
    const visibility = String(input.visibility || "PUBLIC").trim().toUpperCase();
    const requestedTargetId = String(input.targetId || "").trim() || null;
    const requestedAccountId = String(input.accountId || "").trim() || null;
    const requestedProfileId = String(input.profileId || "").trim() || null;
    const snapshot = bootstrapState;
    const existingCampaign = snapshot.campaigns?.find((item) => item.id === identity.campaignId) || null;
    // Repeated calls within a valid bounded schedule are idempotent. Once that
    // schedule has ended, renew only the campaign bootstrap schedule; all
    // historical authorizations, windows, grants, and executions remain
    // untouched and a new exact authorization identity is derived below.
    const existingSchedule = existingCampaign?.autonomousBootstrap?.schedule;
    const scheduleExpired = existingSchedule?.identity && Number.isFinite(Date.parse(existingSchedule.validUntil)) &&
      Date.parse(existingSchedule.validUntil) <= new Date(input.now || new Date()).getTime();
    if (existingSchedule?.identity && !scheduleExpired) {
      schedule = structuredClone(existingSchedule);
    } else if (existingCampaign && scheduleExpired) {
      const renewed = await this.store.mutate(actor, "autonomous_campaign_schedule_renewed", (state) => {
        const campaign = requireItem(state.campaigns, identity.campaignId, "Campaign");
        const current = campaign.autonomousBootstrap?.schedule;
        if (!current?.identity || (Number.isFinite(Date.parse(current.validUntil)) && Date.parse(current.validUntil) > new Date(input.now || new Date()).getTime())) {
          return current || schedule;
        }
        campaign.autonomousBootstrap ||= {};
        campaign.autonomousBootstrap.schedule = structuredClone(schedule);
        campaign.updatedAt = nowIso();
        return campaign.autonomousBootstrap.schedule;
      });
      schedule = structuredClone(renewed.result || schedule);
    }
    const configuredAccounts = (snapshot.executionAccounts || []).filter((account) => account?.platform === platform && account.status === "enabled")
      .filter((account) => !requestedAccountId || account.accountId === requestedAccountId)
      .filter((account) => !requestedProfileId || account.profileId === requestedProfileId);
    const accounts = configuredAccounts;
    const matchingTargets = (snapshot.targets || [])
      .filter((target) => target?.channel === platform && target.status === "active")
      .filter((target) => !requestedTargetId || target.id === requestedTargetId);
    const candidates = matchingTargets
      .map((target) => ({ target, account: accounts.find((item) => item.id === executionAccountKey(platform, target.accountId)) }))
      .filter(({ target, account }) => Boolean(account && target.profileId && account.profileId === target.profileId))
      .sort((left, right) => String(left.target.id).localeCompare(String(right.target.id)));

    if (candidates.length !== 1) {
      const code = candidates.length === 0 ? "AUTHORIZED_LINKEDIN_TARGET_MISSING" : "AUTHORIZED_LINKEDIN_TARGET_AMBIGUOUS";
      const classification = candidates.length > 1
        ? "ACCOUNT_BLOCKER"
        : configuredAccounts.length === 0 || matchingTargets.length === 0
          ? "EXTERNAL_HARD_BLOCKER"
          : "RUNTIME_BLOCKER";
      return {
        status: "BLOCKED",
        code,
        campaignId: identity.campaignId,
        blockers: [{
          code,
          classification,
          message: candidates.length === 0
            ? configuredAccounts.length === 0
              ? "No enabled LinkedIn account is registered in the authorized account registry"
              : matchingTargets.length === 0
                ? "No active LinkedIn target is registered for the requested campaign destination"
                : "The registered LinkedIn account/profile is not healthy and exactly bound to one active target"
            : "More than one enabled LinkedIn account/profile/active target is registered"
        }],
        externalSideEffects: false,
        authoritySideEffects: false
      };
    }
    const { target, account } = candidates[0];
    const readinessContext = { platform, accountId: account.accountId, profileId: account.profileId, targetId: target.id };
    const readinessFresh = isReadinessFresh(target.readiness, readinessContext, new Date(), this.readinessTtlMs);
    if (account.health !== "healthy") {
      return {
        status: "BLOCKED",
        code: account.health === "human_required" ? "ACCOUNT_HUMAN_REQUIRED" : "ACCOUNT_NOT_HEALTHY",
        campaignId: identity.campaignId,
        targetId: target.id,
        accountId: account.accountId,
        profileId: account.profileId,
        blockers: [{
          code: account.health === "human_required" ? "ACCOUNT_HUMAN_REQUIRED" : "ACCOUNT_NOT_HEALTHY",
          classification: account.health === "human_required" ? "EXTERNAL_HARD_BLOCKER" : "RUNTIME_BLOCKER",
          message: "The exact registered LinkedIn account is not currently healthy for execution"
        }],
        externalSideEffects: false,
        authoritySideEffects: false
      };
    }

    if (existingCampaign && (path.resolve(existingCampaign.productRepo) !== path.resolve(productRepo) ||
      existingCampaign.name !== identity.campaignName || existingCampaign.objective !== identity.campaignObjective ||
      JSON.stringify(existingCampaign.audience || []) !== JSON.stringify(audience))) {
      throw new Error("Bootstrap campaign identity collides with a different campaign scope");
    }
    if (existingCampaign?.autonomousBootstrap) {
      const bound = existingCampaign.autonomousBootstrap;
      if (bound.targetId !== target.id || bound.targetUrl !== target.url || bound.accountId !== account.accountId ||
        bound.profileId !== account.profileId || bound.visibility !== visibility ||
        bound.audienceSerialization !== audienceSerialization) {
        throw new Error("Bootstrap campaign authority binding changed; create a new high-level campaign scope");
      }
    }
    let campaign = existingCampaign;
    if (!campaign) {
      const createdAt = nowIso();
      const created = await this.store.mutate(actor, "autonomous_campaign_bootstrapped", (state) => {
        const collision = state.campaigns.find((item) => item.id === identity.campaignId);
        if (collision) return collision;
        const row = {
          id: identity.campaignId,
          name: identity.campaignName,
          objective: identity.campaignObjective,
          productRepo,
          track: null,
          landingUrl: null,
          keywords: [],
          audience,
          discoverySources: [],
          status: "active",
          createdAt,
          updatedAt: createdAt,
          autonomousBootstrap: {
            schemaVersion: 1,
            identity: identity.identity,
            platform,
            audienceSerialization,
            authorizationReference: identity.authorizationReference,
            targetId: target.id,
            targetUrl: target.url,
            accountId: account.accountId,
            profileId: account.profileId,
            visibility,
            schedule
          }
        };
        state.campaigns.push(row);
        return row;
      });
      campaign = created.result;
    }

    let product = campaign.productIntelligence;
    if (!product?.handoff || !product?.document || product.handoff.readinessStatus !== "READY") {
      const inspected = await this.inspectProductIntelligence(identity.campaignId, {
        productId: identity.productId,
        readinessStatus: "READY",
        ...(bootstrapEvidenceClaims(identity.productId) ? { claims: bootstrapEvidenceClaims(identity.productId) } : {})
      }, actor);
      product = inspected.productIntelligence;
    }
    let state = await this.store.read();
    campaign = requireItem(state.campaigns, identity.campaignId, "Campaign");
    let story = (state.stories || []).filter((item) => item.campaignId === identity.campaignId)
      .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0] || null;
    // Keep repeated high-level briefs idempotent, but do not silently reuse a
    // prior story when the caller intentionally changes a bounded content
    // policy field. A new CTA/disclosure/language is a new content identity;
    // deriving it here lets the existing authorization and UNKNOWN fences
    // create a separately authorized candidate without accepting low-level
    // hashes or payload bytes from the caller.
    const requestedStoryPolicy = {
      callToAction: input.callToAction === undefined ? null : String(input.callToAction).replace(/\s+/g, " ").trim(),
      disclosure: input.disclosure === undefined ? null : String(input.disclosure).replace(/\s+/g, " ").trim(),
      language: input.language === undefined ? null : String(input.language).replace(/\s+/g, " ").trim(),
      distributionAudience: audienceSerialization
    };
    const storyMatchesRequestedPolicy = story &&
      (requestedStoryPolicy.callToAction === null || story.callToAction === requestedStoryPolicy.callToAction) &&
      (requestedStoryPolicy.disclosure === null || story.disclosure === requestedStoryPolicy.disclosure) &&
      (requestedStoryPolicy.language === null || story.language === requestedStoryPolicy.language) &&
      story.audience === requestedStoryPolicy.distributionAudience;
    if (!story || !storyMatchesRequestedPolicy) {
      story = await this.deriveProductIntelligenceStory(identity.campaignId, {
        callToAction: input.callToAction || `Explore ${identity.productId} and its repository evidence.`,
        disclosure: input.disclosure || "Evidence-grounded draft generated from the registered product repository.",
        language: input.language || "en",
        distributionAudience: audienceSerialization
      }, actor);
    }
    state = await this.store.read();
    campaign = requireItem(state.campaigns, identity.campaignId, "Campaign");
    const candidateTargets = [target];
    const candidatesForContent = deriveContentCandidates({ productIntelligence: campaign.productIntelligence, story, targets: candidateTargets });
    const contentCandidate = candidatesForContent[0];
    if (!contentCandidate) throw new Error("Autonomous bootstrap could not derive a LinkedIn content candidate");
    const contentHash = campaignContentHash(contentCandidate.content);
    let authorizationId = deriveBootstrapAuthorizationId({
      campaignId: identity.campaignId,
      contentIdentity: contentCandidate.contentIdentity,
      scheduleIdentity: schedule.identity,
      authorizationReference: identity.authorizationReference
    });
    let authorization = (state.campaignAuthorizations || []).find((item) => item.id === authorizationId) || null;
    if (authorization) {
      if (authorization.status !== "active") {
        // A terminal authorization is immutable.  A bounded bootstrap may
        // derive a new authorization only when the exact candidate post has
        // never crossed the dispatch/publication boundary.  This lets a
        // standing campaign recover after an operator or scheduler terminal
        // event without reviving the old authority or replaying an uncertain
        // submission.
        const candidatePosts = (state.posts || []).filter((item) =>
          item.campaignId === identity.campaignId &&
          item.contentIdentity === contentCandidate.contentIdentity &&
          item.targetId === target.id
        );
        const unsafeCandidate = candidatePosts.find((candidatePost) => {
          if (unresolvedSubmission(state, candidatePost)) return true;
          if (["publishing", "processing", UNKNOWN_POST_STATUS, "published"].includes(candidatePost.status)) return true;
          if ((state.executionRequests || []).some((item) => item.jobId === candidatePost.id && (
            ["REQUEST_READY", "EXECUTING", "SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state) ||
            ["SUBMIT_SENT", "UNKNOWN", "CONFIRMED"].includes(item.submitState)
          ))) return true;
          if ((state.executionReceipts || []).some((item) => item.jobId === candidatePost.id &&
            ["SUBMIT_SENT", "UNKNOWN", "CONFIRMED"].includes(item.receipt?.submitState))) return true;
          return (state.publicationAttempts || []).some((item) => item.postId === candidatePost.id);
        });
        if (unsafeCandidate) {
          return {
            status: "BLOCKED",
            code: "HISTORICAL_AUTHORIZATION_NOT_REUSED",
            campaignId: identity.campaignId,
            authorizationId,
            blockers: [{
              code: "HISTORICAL_AUTHORIZATION_NOT_REUSED",
              classification: "STATE_BLOCKER",
              message: "A prior authorization is terminal and the exact candidate has submission or publication history; derive a separately authorized content identity",
              postId: unsafeCandidate.id
            }],
            externalSideEffects: false,
            authoritySideEffects: false
          };
        }
        const renewalObservedAt = input.now || new Date();
        const renewedSchedule = deriveBootstrapSchedule({
          now: renewalObservedAt,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          validityHours: input.validityHours === undefined ? 24 : input.validityHours,
          timezone: input.timezone || "UTC",
          quota: input.quota === undefined ? 1 : input.quota,
          concurrency: input.concurrency === undefined ? 1 : input.concurrency
        });
        const scheduleResult = await this.store.mutate(actor, "autonomous_campaign_schedule_renewed", (nextState) => {
          const currentCampaign = requireItem(nextState.campaigns, identity.campaignId, "Campaign");
          const currentSchedule = currentCampaign.autonomousBootstrap?.schedule;
          // Preserve a concurrent renewal if another bootstrap committed it
          // first; never roll the campaign schedule backwards.
          if (currentSchedule?.identity && currentSchedule.identity !== schedule.identity) {
            const currentUntil = Date.parse(currentSchedule.validUntil || "");
            const requestedUntil = Date.parse(renewedSchedule.validUntil || "");
            if (Number.isFinite(currentUntil) && currentUntil >= requestedUntil) return currentSchedule;
          }
          currentCampaign.autonomousBootstrap ||= {};
          currentCampaign.autonomousBootstrap.schedule = structuredClone(renewedSchedule);
          currentCampaign.updatedAt = nowIso();
          return currentCampaign.autonomousBootstrap.schedule;
        });
        schedule = structuredClone(scheduleResult.result || renewedSchedule);
        state = await this.store.read();
        const activeReplacement = (state.campaignAuthorizations || []).find((item) =>
          item.status === "active" && item.campaignId === identity.campaignId &&
          item.standingAuthorizationReference === identity.authorizationReference &&
          item.validFrom === schedule.validFrom && item.validUntil === schedule.validUntil &&
          item.contentBoundary?.contentHashes?.length === 1 && item.contentBoundary.contentHashes[0] === contentHash &&
          item.destinations?.length === 1 && item.destinations[0].targetId === target.id &&
          item.destinations[0].accountId === account.accountId && item.destinations[0].profileId === account.profileId
        );
        if (activeReplacement) {
          authorizationId = activeReplacement.id;
          authorization = activeReplacement;
        } else {
          authorizationId = deriveBootstrapAuthorizationId({
            campaignId: identity.campaignId,
            contentIdentity: contentCandidate.contentIdentity,
            scheduleIdentity: schedule.identity,
            authorizationReference: identity.authorizationReference,
            renewalSequence: (state.campaignAuthorizations || []).filter((item) => item.campaignId === identity.campaignId).length
          });
          authorization = (state.campaignAuthorizations || []).find((item) => item.id === authorizationId) || null;
          if (authorization?.status !== "active") authorization = null;
        }
      }
      if (authorization && (authorization.binding !== campaignAuthorizationFingerprint(authorization) ||
        authorization.campaignBinding !== campaignScopeFingerprint(campaign) ||
        authorization.contentBoundary?.contentHashes?.length !== 1 || authorization.contentBoundary.contentHashes[0] !== contentHash ||
        authorization.destinations?.length !== 1 || authorization.destinations[0].targetId !== target.id ||
        authorization.destinations[0].accountId !== account.accountId || authorization.destinations[0].profileId !== account.profileId)) {
        throw new Error("Existing bootstrap authorization conflicts with the derived exact scope");
      }
    }
    if (!authorization) {
      authorization = await this.authorizeCampaign(identity.campaignId, {
        id: authorizationId,
        validFrom: schedule.validFrom,
        validUntil: schedule.validUntil,
        destinations: [{ platform, accountId: account.accountId, profileId: account.profileId, targetId: target.id }],
        approvedAssets: [],
        contentBoundary: { mode: "approved_copy_set", contentHashes: [contentHash] },
        audienceRules: { allowedAudiences: [audienceSerialization] },
        publicationVisibilityRules: { allowedVisibilities: [visibility] },
        schedule: { timezone: schedule.timezone, weekdays: schedule.weekdays, startLocal: schedule.startLocal, endLocal: schedule.endLocal },
        rateLimits: {
          maxJobsPerAccountPerDay: schedule.quota,
          maxJobsPerCampaignPerDay: schedule.quota,
          maxConcurrency: schedule.concurrency,
          minIntervalMinutes: 0
        },
        allowLiveExecution: true,
        executionMode: "standing_autonomous",
        standingAuthorizationReference: identity.authorizationReference
      }, actor);
    }

    state = await this.store.read();
    campaign = requireItem(state.campaigns, identity.campaignId, "Campaign");
    const persistedCandidate = (campaign.contentCandidates || []).find((item) => item.contentIdentity === contentCandidate.contentIdentity);
    if (!persistedCandidate) {
      const persisted = await this.store.mutate(actor, "autonomous_content_candidate_bootstrapped", (nextState) => {
        const current = requireItem(nextState.campaigns, identity.campaignId, "Campaign");
        current.contentCandidates ||= [];
        const existing = current.contentCandidates.find((item) => item.contentIdentity === contentCandidate.contentIdentity);
        if (existing) return existing;
        const row = { ...contentCandidate, contentHash, approvedMedia: [], media: [], status: "draft", createdAt: nowIso(), updatedAt: nowIso() };
        current.contentCandidates.push(row);
        current.updatedAt = row.updatedAt;
        return row;
      });
      state = await this.store.read();
    }
    const exactCandidate = (requireItem(state.campaigns, identity.campaignId, "Campaign").contentCandidates || [])
      .find((item) => item.contentId === contentCandidate.contentId && item.contentIdentity === contentCandidate.contentIdentity);
    if (!exactCandidate) throw new Error("Content candidate was not persisted with its exact identity");
    const post = await this.materializeContentCandidate(identity.campaignId, {
      contentId: exactCandidate.contentId,
      contentIdentity: exactCandidate.contentIdentity,
      requireStandingAuthorization: true
    }, actor);
    state = await this.store.read();
    let currentPost = state.posts.find((item) => item.id === post.id) || post;
    const currentTarget = state.targets.find((item) => item.id === target.id) || target;
    const currentBinding = {
      platform,
      accountId: account.accountId,
      profileId: account.profileId,
      targetId: currentTarget.id
    };
    let currentReadinessFresh = isReadinessFresh(currentTarget.readiness, currentBinding, new Date(), this.readinessTtlMs);
    // An unresolved historical submission is an immutable safety fence. Keep
    // bootstrap read-only for this content identity and report the precise
    // blocker instead of presenting a generic readiness/control failure.
    const historicalSubmissionUncertainty = unresolvedSubmission(state, currentPost);
    let request = null;
    const latestLiveRequest = () => state.executionRequests
      .filter((item) => {
        if (item.jobId !== currentPost.id || item.request?.dryRun === true ||
            item.request?.authorization?.authorizationId !== authorization.id ||
            item.state !== "REQUEST_READY" || item.submitState !== "NOT_STARTED") return false;
        const request = item.request || {};
        const requestTarget = request.target || {};
        const requestContent = request.content || {};
        const requestReadiness = request.readiness || {};
        if (request.executionId !== item.executionId || request.jobId !== currentPost.id ||
            request.campaignId !== currentPost.campaignId || request.platform !== platform ||
            request.accountId !== account.accountId || request.profileId !== account.profileId ||
            requestTarget.targetId !== currentTarget.id || requestTarget.url !== currentTarget.url ||
            request.authorization?.binding !== authorization.binding ||
            requestContent.sha256 !== contentSha256(currentPost.content) ||
            request.audience !== currentPost.audience ||
            String(request.publicationVisibility || "PUBLIC").toUpperCase() !== String(currentPost.publicationVisibility || "PUBLIC").toUpperCase() ||
            !isExecutionRequestReadinessFresh(requestReadiness, currentBinding, new Date(), this.readinessTtlMs)) return false;
        const requestWindowId = request.oneTimeWindow?.windowId;
        const window = requestWindowId ? state.oneTimeExecutionWindows.find((candidate) => candidate.windowId === requestWindowId) : null;
        if (!window || !["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(window, new Date())) ||
            !oneTimeExecutionWindowInBounds(window, new Date()) || window.campaignId !== currentPost.campaignId ||
            window.campaignAuthorizationId !== authorization.id || window.jobId !== currentPost.id ||
            window.authorizationFingerprint !== authorization.binding || window.binding !== oneTimeExecutionWindowFingerprint(window) ||
            (window.status === "RESERVED" && window.reservedExecutionId !== item.executionId)) return false;
        const grantId = request.liveGrant?.grantId;
        const grant = grantId ? state.liveExecutionGrants.find((candidate) => candidate.grantId === grantId) : null;
        if (!grant || liveGrantEffectiveStatus(grant) !== "ACTIVE" || grant.campaignAuthorizationId !== authorization.id ||
            grant.campaignId !== currentPost.campaignId || grant.jobId !== currentPost.id ||
            grant.boundExecutionId !== item.executionId) return false;
        try {
          assertLiveGrantMatchesExecution(grant, request, authorization, new Date(), { checkWindow: false });
        } catch {
          return false;
        }
        return true;
      })
      .sort((left, right) => (Number(right.attempt) || 0) - (Number(left.attempt) || 0) || String(right.createdAt || right.request?.createdAt || "").localeCompare(String(left.createdAt || left.request?.createdAt || "")))[0] || null;
    request = latestLiveRequest();
    // A cancelled, expired, or otherwise terminal bootstrap request cannot be
    // surfaced as READY and cannot be revived. Re-enter the existing standing
    // delegation path with a fresh provider readiness observation; it derives
    // a new window, grant, lease and execution request while preserving every
    // historical execution record.
    if (!request && !["published", "publishing", "processing", UNKNOWN_POST_STATUS, "removed", "rejected"].includes(currentPost.status)) {
      const refreshed = await this.refreshCampaignJobReadiness(currentPost.id, actor, { force: true });
      state = await this.store.read();
      currentPost = state.posts.find((item) => item.id === post.id) || currentPost;
      currentReadinessFresh = isReadinessFresh((state.targets || []).find((item) => item.id === target.id)?.readiness, currentBinding, new Date(), this.readinessTtlMs);
      if (refreshed.status === "queued") {
        await this.prepareExecutionRequest(currentPost.id, actor, { forceNewLiveExecution: true });
        await this.ensureStandingExecutionGrant(currentPost.id, "execution-router");
        state = await this.store.read();
        currentPost = state.posts.find((item) => item.id === post.id) || currentPost;
      }
      request = latestLiveRequest();
    }
    const window = request?.request?.oneTimeWindow?.windowId
      ? state.oneTimeExecutionWindows.find((item) => item.windowId === request.request.oneTimeWindow.windowId)
      : null;
    const grant = request?.request?.liveGrant?.grantId
      ? state.liveExecutionGrants.find((item) => item.grantId === request.request.liveGrant.grantId)
      : null;
    const windowActive = window && ["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(window, new Date())) &&
      window.authorizationFingerprint === authorization.binding && window.campaignAuthorizationId === authorization.id;
    const grantActive = grant && liveGrantEffectiveStatus(grant) === "ACTIVE" && grant.campaignAuthorizationId === authorization.id;
    return {
      status: request && grantActive && windowActive ? "READY_FOR_AUTONOMOUS_EXECUTION" : "BLOCKED",
      campaignId: identity.campaignId,
      authorizationId: authorization.id,
      targetId: target.id,
      targetUrl: target.url,
      accountId: account.accountId,
      profileId: account.profileId,
      readinessFresh: currentReadinessFresh,
      audience: audience,
      audienceSerialization,
      schedule,
      content: {
        contentId: exactCandidate.contentId,
        contentIdentity: exactCandidate.contentIdentity,
        contentHash: currentPost.contentHash || contentHash,
        payloadSha256: contentSha256(currentPost.content),
        media: []
      },
      postId: currentPost.id,
      executionId: request?.executionId || null,
      oneTimeWindowId: window?.windowId || null,
      liveGrantId: grant?.grantId || null,
      blockers: request && grantActive && windowActive ? [] : [historicalSubmissionUncertainty ? {
        code: "HISTORICAL_SUBMISSION_UNCERTAIN",
        classification: "STATE_BLOCKER",
        message: "This exact content/publication identity is quarantined by an immutable historical SUBMIT_RESULT_UNKNOWN execution; derive a separately authorized content identity before creating new execution controls",
        uncertaintyId: historicalSubmissionUncertainty.id,
        historicalExecutionId: historicalSubmissionUncertainty.executionId || null
      } : (bootstrapAuthorizationBlockers(currentPost)[0] || {
        code: currentPost.readinessReasonCode || "EXECUTION_CONTROLS_NOT_DERIVED",
        classification: "RUNTIME_BLOCKER",
        message: "Fresh readiness did not produce the complete execution controls"
      })],
      externalSideEffects: false,
      authoritySideEffects: true
    };
  }

  /**
   * Persist one sanitized, versioned product-understanding handoff on the
   * campaign. The campaign repository is the only accepted source boundary;
   * arbitrary caller fields and credential-like values never enter state.
   */
  async attachProductIntelligence(campaignId, input = {}, actor = "product-intelligence") {
    const initialState = await this.store.read();
    const campaign = requireItem(initialState.campaigns, campaignId, "Campaign");
    const productRepo = await requireProductRepo(campaign.productRepo);
    const requestedSource = input.sourceRepository === undefined ? productRepo : await requireProductRepo(input.sourceRepository);
    if (path.resolve(requestedSource) !== path.resolve(productRepo)) {
      throw new Error("Product intelligence sourceRepository must match the campaign productRepo");
    }
    const documentInput = input.document || input.productIntelligence;
    if (!documentInput || typeof documentInput !== "object" || Array.isArray(documentInput)) {
      throw new Error("Product intelligence document is required");
    }
    let document;
    try {
      const allowedDocumentKeys = new Set([
        "schemaVersion", "productId", "generatedAt", "evidence", "WHAT_IS_IT",
        "WHAT_PROBLEM_DOES_IT_SOLVE", "WHY_IS_IT_BETTER", "WHO_NEEDS_IT",
        "CLAIMS_WE_CAN_PROVE", "CLAIMS_WE_CANNOT_MAKE", "documentHash"
      ]);
      document = JSON.parse(serializeProductIntelligence(Object.fromEntries(
        Object.entries(documentInput).filter(([key]) => allowedDocumentKeys.has(key))
      )));
    } catch (error) {
      throw new Error(`Product intelligence document is not serializable: ${error.message}`);
    }
    if (document.documentHash !== undefined) {
      const declaredHash = String(document.documentHash || "").toLowerCase();
      const withoutHash = { ...document };
      delete withoutHash.documentHash;
      const expectedHash = productIntelligenceHash(JSON.parse(serializeProductIntelligence(withoutHash)));
      if (!/^[a-f0-9]{64}$/.test(declaredHash) || declaredHash !== expectedHash) {
        throw new Error("Product intelligence documentHash mismatch");
      }
      document.documentHash = declaredHash;
    }
    const serialized = serializeProductIntelligence(document);
    if (Buffer.byteLength(serialized, "utf8") > MAX_PRODUCT_INTELLIGENCE_BYTES) {
      throw new Error(`Product intelligence document exceeds ${MAX_PRODUCT_INTELLIGENCE_BYTES} bytes`);
    }
    const handoff = createProductIntelligenceHandoff({
      document,
      sourceRepository: productRepo,
      readinessStatus: input.readinessStatus
    });
    const validation = validateProductIntelligenceHandoff(handoff, document);
    if (!validation.ok) throw new Error(`Product intelligence handoff is invalid: ${validation.errors.join(", ")}`);
    const result = await this.store.mutate(actor, "product_intelligence_attached", (state) => {
      const current = requireItem(state.campaigns, campaignId, "Campaign");
      current.productIntelligence = {
        document,
        handoff,
        repositoryInspection: summarizeRepositoryInspection(input.repositoryInspection),
        attachedAt: nowIso(),
        attachedBy: String(actor || "product-intelligence")
      };
      current.updatedAt = nowIso();
      return current.productIntelligence;
    });
    return result.result;
  }

  /**
   * Derive and persist one deterministic, draft-only story from the campaign's
   * READY product-intelligence handoff. This path never creates authority or
   * execution artifacts and is intentionally not called by the queue.
   */
  async deriveProductIntelligenceStory(campaignId, input = {}, actor = "ai-drafter") {
    const initialState = await this.store.read();
    const campaign = requireItem(initialState.campaigns, campaignId, "Campaign");
    const productRepo = await requireProductRepo(campaign.productRepo);
    const productIntelligence = campaign.productIntelligence;
    const document = productIntelligence?.document;
    const inspection = productIntelligence?.repositoryInspection;
    if (!productIntelligence?.handoff || !document) {
      throw new Error("Product intelligence story derivation requires READY product intelligence");
    }
    if (productIntelligence.handoff.readinessStatus !== "READY") {
      throw new Error("Product intelligence story derivation requires READY product intelligence");
    }
    const handoffValidation = validateProductIntelligenceHandoff(productIntelligence.handoff, document);
    if (!handoffValidation.ok) {
      throw new Error(`Invalid product intelligence handoff: ${handoffValidation.errors.join(", ")}`);
    }
    if (path.resolve(String(productIntelligence.handoff.sourceRepository || "")) !== path.resolve(productRepo)) {
      throw new Error("Product intelligence handoff sourceRepository does not match campaign productRepo");
    }
    if (!inspection || !Array.isArray(inspection.records) || !inspection.records.length) {
      throw new Error("Product intelligence story derivation requires persisted repository inspection");
    }
    let freshInspection;
    try {
      freshInspection = await inspectRepositoryEvidence(productRepo, {
        allowlist: inspection.allowlist,
        ...(inspection.limits || {})
      });
    } catch (error) {
      throw new Error(`Product intelligence repository inspection is invalid: ${error.message}`);
    }
    if (path.resolve(freshInspection.repository) !== path.resolve(String(inspection.repository || productRepo)) ||
      freshInspection.inspectionHash !== inspection.inspectionHash) {
      throw new Error("Product intelligence repository inspection changed since handoff");
    }
    const freshRecordsByLocator = new Map(freshInspection.records.map((record) => [String(record.locator || ""), record]));
    if (inspection.records.length !== freshInspection.records.length || inspection.records.some((record) => {
      const current = freshRecordsByLocator.get(String(record?.locator || ""));
      return !current || String(record?.id || "") !== String(current.id || "") ||
        String(record?.sha256 || "").toLowerCase() !== String(current.sha256 || "").toLowerCase() ||
        Number(record?.bytes) !== Number(current.bytes);
    })) {
      throw new Error("Product intelligence repository inspection records changed since handoff");
    }
    const freshEvidence = normalizeEvidenceRecords(freshInspection.records.map(({ id, sourceType, locator, content }) => ({ id, sourceType, locator, content })));
    const freshEvidenceByHash = new Map(freshEvidence.records.map((record) => [record.hash, record]));
    const documentEvidence = Array.isArray(document.evidence) ? document.evidence : [];
    for (const evidence of documentEvidence) {
      const normalized = normalizeEvidenceRecords([evidence]).records[0];
      const current = freshEvidenceByHash.get(String(evidence?.hash || "").trim());
      if (!normalized || normalized.hash !== String(evidence?.hash || "").trim() || !current ||
        normalized.sourceType !== current.sourceType || normalized.locator !== current.locator ||
        normalized.content !== current.content || normalized.observedAt !== current.observedAt) {
        throw new Error("Product intelligence evidence is not derived from the current repository inspection");
      }
    }
    const evidenceByHash = new Map((Array.isArray(document.evidence) ? document.evidence : [])
      .filter((record) => record && typeof record === "object")
      .map((record) => [String(record.hash || "").trim(), record]));
    const inspectionByLocator = new Map(inspection.records.map((record) => [String(record?.locator || "").trim(), record]));
    const requiredFields = ["WHAT_IS_IT", "WHAT_PROBLEM_DOES_IT_SOLVE", "WHY_IS_IT_BETTER", "WHO_NEEDS_IT"];
    const selectedEvidence = new Map();
    for (const field of requiredFields) {
      const answer = document[field];
      const claimId = String(answer?.id || "").trim();
      const claim = (Array.isArray(document.CLAIMS_WE_CAN_PROVE) ? document.CLAIMS_WE_CAN_PROVE : [])
        .find((item) => String(item?.id || "").trim() === claimId);
      if (!claim || String(claim.field || "").trim() !== field) throw new Error(`Product intelligence field ${field} is not supported`);
      for (const evidenceRef of Array.isArray(claim.evidenceRefs) ? claim.evidenceRefs : []) {
        const evidence = evidenceByHash.get(String(evidenceRef || "").trim());
        const locator = String(evidence?.locator || "").trim();
        const recorded = inspectionByLocator.get(locator);
        if (!evidence || !recorded || !/^[a-f0-9]{64}$/i.test(String(recorded.sha256 || ""))) {
          throw new Error(`Product intelligence evidence is not bound to inspected repository source: ${field}`);
        }
        const source = await readGroundingSource(productRepo, locator);
        if (source.sha256 !== String(recorded.sha256).toLowerCase()) {
          throw new Error(`Product intelligence grounding source changed: ${locator}`);
        }
        const prior = selectedEvidence.get(locator);
        selectedEvidence.set(locator, {
          ...source,
          evidenceHash: prior?.evidenceHash || evidence.hash,
          evidenceHashes: [...new Set([...(prior?.evidenceHashes || []), evidence.hash])]
        });
      }
    }
    const disclosure = String(input.disclosure || "AI-assisted draft grounded in verified repository evidence.").replace(/\s+/g, " ").trim();
    const story = deriveProductIntelligenceStory({
      campaignId,
      productIntelligence,
      callToAction: input.callToAction,
      groundingSources: [...selectedEvidence.values()],
      language: input.language,
      disclosure,
      distributionAudience: input.distributionAudience
    });
    const result = await this.store.mutate(actor, "product_intelligence_story_drafted", (state) => {
      const currentCampaign = requireItem(state.campaigns, campaignId, "Campaign");
      state.stories ||= [];
      const existing = state.stories.find((item) => item.campaignId === campaignId && (item.storyIdentity === story.storyIdentity || item.id === story.id));
      if (existing) {
        if (existing.storyIdentity !== story.storyIdentity || existing.status !== "draft") throw new Error("Product intelligence story identity is already bound to another story");
        return existing;
      }
      const created = {
        ...story,
        disclosure: story.disclosure,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      state.stories.push(created);
      currentCampaign.updatedAt = nowIso();
      return created;
    });
    return result.result;
  }

  /** Normalize and persist caller-supplied public observations for one campaign.
   * This records opportunity intelligence only; it never derives permission to
   * publish or invokes a browser/provider.
   */
  async recordDiscoveries(campaignId, input = {}, actor = "discovery-collector") {
    const state = await this.store.read();
    const campaign = requireItem(state.campaigns, campaignId, "Campaign");
    const observations = Array.isArray(input.observations) ? input.observations : [];
    if (observations.length > 500) throw new Error("At most 500 discovery observations may be recorded at once");
    const options = {
      policies: input.policies && typeof input.policies === "object" && !Array.isArray(input.policies) ? input.policies : {},
      keywords: Array.isArray(input.keywords) ? input.keywords : campaign.keywords?.map((item) => item.phrase) || [],
      blockedKeywords: Array.isArray(input.blockedKeywords) ? input.blockedKeywords : [],
      fit: input.fit && typeof input.fit === "object" && !Array.isArray(input.fit) ? input.fit : {
        audienceKeywords: input.audienceKeywords,
        targetChannel: input.targetChannel,
        targetLocale: input.targetLocale
      }
    };
    const processed = processDiscoveries(observations, options);
    const result = await this.store.mutate(actor, "discoveries_recorded", (nextState) => {
      const current = requireItem(nextState.campaigns, campaignId, "Campaign");
      current.discovery ||= { schemaVersion: 1, observations: [], updatedAt: null };
      const byId = new Map(current.discovery.observations.map((item) => [item.discoveryId, item]));
      for (const item of processed) {
        const previous = byId.get(item.discoveryId);
        if (!previous || String(item.provenance?.observedAt || "") < String(previous.provenance?.observedAt || "")) byId.set(item.discoveryId, item);
      }
      current.discovery.observations = [...byId.values()].sort((left, right) => left.discoveryId.localeCompare(right.discoveryId)).slice(-2_000);
      current.discovery.updatedAt = nowIso();
      current.updatedAt = current.discovery.updatedAt;
      return { campaignId, accepted: processed.length, total: current.discovery.observations.length, observations: processed };
    });
    return result.result;
  }

  /** Observe explicit public URLs, then persist only normalized observations. */
  async observeDiscoveries(campaignId, input = {}, actor = "discovery-collector") {
    const result = await observePublicUrls(input.urls, input.options || {});
    const observations = result.observations.filter((item) => item.observationStatus !== "UNKNOWN");
    const persisted = observations.length ? await this.recordDiscoveries(campaignId, {
      observations,
      policies: input.policies,
      keywords: input.keywords,
      blockedKeywords: input.blockedKeywords,
      fit: input.fit,
      audienceKeywords: input.audienceKeywords,
      targetChannel: input.targetChannel,
      targetLocale: input.targetLocale
    }, actor) : { campaignId, accepted: 0, total: null, observations: [] };
    // Persist a bounded observer checkpoint through the existing campaign store.
    // The checkpoint is advisory/read-only runtime state: it contains no raw URLs,
    // credentials, or execution authority and makes restart/resume observability
    // explicit even when every fetched source is UNKNOWN.
    const sourceFingerprint = createHash("sha256")
      .update(JSON.stringify((Array.isArray(input.urls) ? input.urls : []).map((url) => String(url)).sort()))
      .digest("hex");
    const checkpointAt = nowIso();
    const checkpoint = {
      schemaVersion: 1,
      attemptedAt: checkpointAt,
      sourceFingerprint,
      requested: result.requested,
      accepted: persisted.accepted || 0,
      unknown: (result.observations || []).filter((item) => item.observationStatus === "UNKNOWN").length,
      truncated: result.truncated === true
    };
    const checkpointResult = await this.store.mutate(actor, "discovery_observer_checkpoint_recorded", (state) => {
      const campaign = requireItem(state.campaigns, campaignId, "Campaign");
      campaign.discovery ||= { schemaVersion: 1, observations: [], updatedAt: null };
      campaign.discovery.observerCheckpoint = checkpoint;
      campaign.discovery.updatedAt = checkpointAt;
      campaign.updatedAt = checkpointAt;
      return checkpoint;
    });
    return { ...result, persisted, checkpoint: checkpointResult.result };
  }

  async authorizeCampaign(campaignId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "campaign_authorization_activated", async (state) => {
      const campaign = requireItem(state.campaigns, campaignId, "Campaign");
      const authorization = normalizeCampaignAuthorization(input, campaign);
      const productRepo = await requireProductRepo(campaign.productRepo);
      if ((state.campaignAuthorizations || []).some((item) => item.id === authorization.id)) throw new Error("Campaign authorization id already exists");
      for (const destination of authorization.destinations) {
        const target = requireItem(state.targets, destination.targetId, "Target");
        if (target.channel !== destination.platform || target.accountId !== destination.accountId) {
          throw new Error(`Authorized destination identity does not match target ${destination.targetId}`);
        }
        const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(destination.platform, destination.accountId));
        if (!account || account.status !== "enabled") throw new Error(`Execution account must be registered and enabled: ${destination.accountId}`);
        const registeredProfile = String(target.profileId || "").trim() || null;
        if (!registeredProfile || registeredProfile !== account.profileId || destination.profileId !== account.profileId) {
          throw new Error(`Authorized profile identity does not match target ${destination.targetId}`);
        }
        destination.targetUrl = target.url;
      }
      for (const approvedAsset of authorization.approvedAssets) {
        const artifact = requireItem(state.artifacts || [], approvedAsset.artifactId, "Artifact");
        if (artifact.campaignId !== campaignId || artifact.sha256 !== approvedAsset.sha256 || artifact.status !== "verified") {
          throw new Error(`Approved asset identity is not verified for campaign: ${approvedAsset.artifactId}`);
        }
        const currentAsset = await readArtifactSource(productRepo, artifact.relativePath);
        if (currentAsset.sha256 !== artifact.sha256 || currentAsset.path !== artifact.path) {
          throw new Error(`Approved asset changed since registration: ${artifact.id}`);
        }
      }
      const verifiedSourceRefs = new Set((state.stories || [])
        .filter((story) => story.campaignId === campaignId)
        .flatMap((story) => story.groundingSources || [])
        .map((source) => `${source.relativePath}#${source.sha256}`));
      const inspectedSources = campaign.productIntelligence?.repositoryInspection?.records || [];
      for (const source of inspectedSources) {
        const relativePath = String(source?.locator || "").trim();
        const sha256 = String(source?.sha256 || "").trim().toLowerCase();
        if (relativePath && /^[a-f0-9]{64}$/.test(sha256)) verifiedSourceRefs.add(`${relativePath}#${sha256}`);
      }
      for (const claim of authorization.contentBoundary.approvedClaims) {
        for (const source of claim.sourceRefs) {
          const currentSource = await readGroundingSource(productRepo, source.relativePath);
          if (currentSource.relativePath !== source.relativePath || currentSource.sha256 !== source.sha256) {
            throw new Error(`Approved claim source changed since grounding: ${source.relativePath}`);
          }
          // A standing template policy may establish its exact source
          // lineage before the first autonomous queue tick. The queue then
          // performs the bounded inspection and persists the handoff. Other
          // authorization modes still require an already verified campaign
          // grounding record.
          const deferredStandingGrounding = authorization.executionMode === "standing_autonomous" &&
            authorization.contentBoundary.mode === "approved_template_set" &&
            authorization.contentBoundary.storyPolicy && inspectedSources.length === 0;
          if (!verifiedSourceRefs.has(`${source.relativePath}#${source.sha256}`) && !deferredStandingGrounding) {
            throw new Error(`Approved claim source is not bound to verified campaign grounding: ${source.relativePath}`);
          }
        }
      }
      state.campaignAuthorizations ||= [];
      for (const previous of state.campaignAuthorizations.filter((item) => item.campaignId === campaignId && item.status === "active")) {
        previous.status = "superseded";
        previous.supersededAt = nowIso();
        for (const post of state.posts.filter((item) => item.campaignAuthorizationId === previous.id && item.status === "queued")) {
          post.status = "blocked";
          post.blockedAt = previous.supersededAt;
          post.authorizationDecision = { evaluatedAt: previous.supersededAt, allowed: false, reasons: ["campaign_authorization_superseded"] };
        }
      }
      authorization.approvedBy = actor;
      authorization.activatedAt = authorization.approvedAt;
      authorization.binding = campaignAuthorizationFingerprint(authorization);
      state.campaignAuthorizations.push(authorization);
      campaign.status = "active";
      campaign.updatedAt = authorization.activatedAt;
      const inheritingPosts = state.posts.filter((item) => item.campaignId === campaignId && ["draft", "needs_review", "approved", "queued", "blocked"].includes(item.status));
      for (const post of inheritingPosts) post.status = "blocked";
      for (const post of inheritingPosts) {
        const target = state.targets.find((item) => item.id === post.targetId);
        post.campaignAuthorizationId = authorization.id;
        post.campaignAuthorizationBinding = authorization.binding;
        post.contentId ||= post.storyId || createHash("sha256").update(post.content || "").digest("hex");
        post.idempotencyKey ||= publicationIdentityKey({ campaignId, contentId: post.contentId, platform: target?.channel, accountId: target?.accountId, targetId: post.targetId });
        post.jobLifecycle ||= [{ state: "CREATED", at: post.createdAt || authorization.activatedAt }];
        post.jobLifecycle.push({ state: "AUTHORIZED", at: authorization.activatedAt, authorizationId: authorization.id });
        const eligibility = evaluateQueue(post, state);
        post.authorizationDecision = { evaluatedAt: authorization.activatedAt, allowed: eligibility.allowed, reasons: eligibility.reasons };
        if (eligibility.allowed) {
          post.status = "queued";
          post.queuedAt = authorization.activatedAt;
          post.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
          post.jobLifecycle.push({ state: "READY", at: authorization.activatedAt }, { state: "QUEUED", at: authorization.activatedAt });
        } else {
          post.status = "blocked";
          post.blockedAt = authorization.activatedAt;
          post.jobLifecycle.push({ state: "BLOCKED", at: authorization.activatedAt, reasons: eligibility.reasons });
        }
      }
      return authorization;
    });
    await this.queueAuthorizedCampaignJobs(campaignId, actor);
    return result.result;
  }

  async updateCampaignAuthorizationProfileBinding(campaignId, authorizationId, targetId, profileId, actor = "operator") {
    const nextProfileId = String(profileId || "").trim();
    if (!nextProfileId) throw new Error("Authorization profileId is required");
    const result = await this.store.mutate(actor, "campaign_authorization_profile_binding_updated", (state) => {
      const authorization = requireItem(state.campaignAuthorizations || [], authorizationId, "Campaign authorization");
      if (authorization.campaignId !== campaignId || authorization.status !== "active") {
        throw new Error("Only the matching active campaign authorization can update a destination profile binding");
      }
      const destinations = authorization.destinations.filter((item) => item.targetId === targetId);
      if (destinations.length !== 1) throw new Error("Authorization must contain exactly one destination for the target");
      const destination = destinations[0];
      const target = requireItem(state.targets, targetId, "Target");
      const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(destination.platform, destination.accountId));
      if (target.channel !== destination.platform || target.accountId !== destination.accountId ||
          target.profileId !== nextProfileId || account?.status !== "enabled" || account.profileId !== nextProfileId) {
        throw new Error("Authorization profile binding must match the enabled account and target");
      }

      destination.profileId = nextProfileId;
      authorization.binding = campaignAuthorizationFingerprint(authorization);
      authorization.updatedAt = nowIso();
      for (const post of state.posts.filter((item) => item.campaignAuthorizationId === authorization.id)) {
        post.campaignAuthorizationBinding = authorization.binding;
        const decision = evaluateQueue(post, state);
        post.authorizationDecision = { evaluatedAt: authorization.updatedAt, allowed: decision.allowed, reasons: decision.reasons };
      }
      return authorization;
    });
    return result.result;
  }

  async setCampaignAuthorizationStatus(campaignId, status, actor = "operator") {
    if (!new Set(["paused", "active", "revoked"]).has(status)) throw new Error("Unsupported campaign authorization status");
    const result = await this.store.mutate(actor, `campaign_authorization_${status}`, (state) => {
        const authorization = [...(state.campaignAuthorizations || [])].reverse().find((item) => item.campaignId === campaignId && item.status !== "superseded");
        if (!authorization) throw new Error("Campaign authorization not found");
        if (status === "active") {
          const campaign = requireItem(state.campaigns, campaignId, "Campaign");
          if (campaign.status !== "active") throw new Error("Paused or inactive campaign cannot resume authorization");
          if (authorization.status === "revoked" || authorization.status === "superseded") throw new Error("Revoked or superseded campaign authorization cannot be resumed");
          if (!Number.isFinite(Date.parse(authorization.validUntil)) || Date.parse(authorization.validUntil) <= Date.now()) throw new Error("Expired campaign authorization cannot be resumed");
          if (authorization.campaignBinding !== campaignScopeFingerprint(campaign)) throw new Error("Campaign scope changed; create a new authorization before resuming");
          if (authorization.binding !== campaignAuthorizationFingerprint(authorization)) throw new Error("Campaign authorization scope changed; create a new authorization before resuming");
        }
      authorization.status = status;
      authorization.updatedAt = nowIso();
      if (status !== "active") {
        for (const post of state.posts.filter((item) => item.campaignAuthorizationId === authorization.id && item.status === "queued")) {
          post.status = "blocked";
          post.blockedAt = authorization.updatedAt;
          post.authorizationDecision = { evaluatedAt: authorization.updatedAt, allowed: false, reasons: [`campaign_authorization_${status}`] };
        }
      } else {
        for (const post of state.posts.filter((item) => item.campaignAuthorizationId === authorization.id && ["blocked", "draft"].includes(item.status))) {
          const eligibility = evaluateQueue(post, state);
          post.authorizationDecision = { evaluatedAt: authorization.updatedAt, allowed: eligibility.allowed, reasons: eligibility.reasons };
          if (eligibility.allowed) {
            post.status = "queued";
            post.queuedAt = authorization.updatedAt;
            post.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
            post.jobLifecycle ||= [{ state: "CREATED", at: post.createdAt }];
            post.jobLifecycle.push({ state: "READY", at: authorization.updatedAt }, { state: "QUEUED", at: authorization.updatedAt });
            delete post.blockedAt;
          }
        }
      }
      return authorization;
    });
    return result.result;
  }

  async registerArtifact(campaignId, input, actor = "operator") {
    const state = await this.store.read();
    const campaign = requireItem(state.campaigns, campaignId, "Campaign");
    const productRepo = await requireProductRepo(campaign.productRepo);
    const source = await readArtifactSource(productRepo, input.path);
    const evidence = requiredText(input.evidence, "artifact evidence");
    const result = await this.store.mutate(actor, "artifact_registered", (nextState) => {
      requireItem(nextState.campaigns, campaignId, "Campaign");
      nextState.artifacts ||= [];
      const artifact = {
        id: randomUUID(),
        campaignId,
        name: requiredText(input.name, "artifact name"),
        mediaType: requiredText(input.mediaType || "application/octet-stream", "artifact mediaType"),
        ...source,
        evidence,
        status: "verified",
        createdAt: nowIso()
      };
      nextState.artifacts.push(artifact);
      return artifact;
    });
    return result.result;
  }

  /** Promote one exact Product Factory evidence candidate into the canonical artifact collection. */
  async promoteProductFactoryArtifact(campaignId, input = {}, actor = "operator") {
    const factoryRunId = requiredText(input.factoryRunId, "factoryRunId");
    const relativePath = normalizedRelativeArtifactPath(input.path || input.artifactPath);
    const expectedSha256 = requiredText(input.sha256 || input.artifactSha256, "artifact SHA-256").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("artifact SHA-256 must be 64 lowercase hexadecimal characters");
    const name = requiredSafeArtifactMetadata(input.name, "artifact name", 240);
    const mediaType = requiredSafeArtifactMetadata(input.mediaType || "application/octet-stream", "artifact mediaType", 160);
    const evidence = requiredSafeArtifactMetadata(input.evidence, "artifact evidence", 2000);
    const initialState = await this.store.read();
    const campaign = requireItem(initialState.campaigns, campaignId, "Campaign");
    const productRepo = await requireProductRepo(campaign.productRepo);
    const initialRun = (campaign.productFactoryRuns || []).find((item) => item.id === factoryRunId);
    if (!initialRun) throw new Error("Product Factory run not found");
    if (initialRun.status !== "SUCCEEDED" || initialRun.externalSideEffects !== false || initialRun.execution?.status !== "SUCCEEDED" || initialRun.execution?.externalSideEffects !== false || initialRun.artifacts?.externalSideEffects !== false) {
      throw new Error("Product Factory run is not successfully completed");
    }
    if (path.resolve(String(initialRun.repositoryPath || "")) !== path.resolve(productRepo) || path.resolve(String(initialRun.artifacts?.repositoryPath || "")) !== path.resolve(productRepo)) {
      throw new Error("Product Factory run repository does not match campaign productRepo");
    }
    const initialCandidate = (initialRun.artifacts?.artifacts || []).find((item) => {
      return String(item.path || "").replaceAll(path.sep, "/") === relativePath;
    });
    if (!initialCandidate) throw new Error("Product Factory artifact candidate not found");
    if (String(initialCandidate.sha256 || "").toLowerCase() !== expectedSha256) throw new Error("Product Factory artifact candidate hash mismatch");

    const result = await this.store.mutate(actor, "product_factory_artifact_promoted", async (nextState) => {
      const currentCampaign = requireItem(nextState.campaigns, campaignId, "Campaign");
      const run = (currentCampaign.productFactoryRuns || []).find((item) => item.id === factoryRunId);
      if (!run) throw new Error("Product Factory run not found");
      if (run.status !== "SUCCEEDED" || run.externalSideEffects !== false || run.execution?.status !== "SUCCEEDED" || run.execution?.externalSideEffects !== false || run.artifacts?.externalSideEffects !== false) throw new Error("Product Factory run is not successfully completed");
      const currentProductRepo = await requireProductRepo(currentCampaign.productRepo);
      if (path.resolve(String(run.repositoryPath || "")) !== path.resolve(currentProductRepo) || path.resolve(String(run.artifacts?.repositoryPath || "")) !== path.resolve(currentProductRepo)) {
        throw new Error("Product Factory run repository does not match campaign productRepo");
      }
      const candidate = (run.artifacts?.artifacts || []).find((item) => String(item.path || "").replaceAll(path.sep, "/") === relativePath);
      if (!candidate) throw new Error("Product Factory artifact candidate not found");
      if (String(candidate.sha256 || "").toLowerCase() !== expectedSha256) throw new Error("Product Factory artifact candidate hash mismatch");
      const source = await readArtifactSource(currentProductRepo, relativePath);
      if (source.relativePath.replaceAll(path.sep, "/") !== relativePath || source.sha256 !== expectedSha256) {
        throw new Error("Product Factory artifact source changed since evidence run");
      }
      const commandRef = safeFactoryCommandRef(candidate.commandRef);
      nextState.artifacts ||= [];
      const sameIdentity = nextState.artifacts.find((item) => item.campaignId === campaignId && item.relativePath === relativePath && item.sha256 === expectedSha256);
      if (sameIdentity) {
        const provenance = sameIdentity.provenance || {};
        if (provenance.factoryRunId !== factoryRunId || sameIdentity.name !== name || sameIdentity.mediaType !== mediaType || sameIdentity.evidence !== evidence) {
          throw new Error("Existing artifact conflicts with Product Factory promotion");
        }
        return sameIdentity;
      }
      const conflictingPath = nextState.artifacts.find((item) => item.campaignId === campaignId && item.relativePath === relativePath && item.sha256 !== expectedSha256);
      if (conflictingPath) throw new Error("Existing artifact has a conflicting hash for this path");
      const artifact = {
        id: randomUUID(),
        campaignId,
        name,
        mediaType,
        ...source,
        evidence,
        provenance: { factoryRunId, commandRef },
        status: "verified",
        createdAt: nowIso()
      };
      nextState.artifacts.push(artifact);
      return artifact;
    });
    return result.result;
  }

  async createStory(campaignId, input, actor = "ai-drafter") {
    const state = await this.store.read();
    const campaign = requireItem(state.campaigns, campaignId, "Campaign");
    const productRepo = await requireProductRepo(campaign.productRepo);
    const requestedSources = Array.isArray(input.groundingSources) ? input.groundingSources : [];
    const groundingSources = await Promise.all(requestedSources.map((source) => readGroundingSource(productRepo, source)));
    if (groundingSources.length === 0) throw new Error("Story requires product-repository grounding sources");
    if (input.artifactId) {
      const artifact = requireItem(state.artifacts || [], input.artifactId, "Artifact");
      if (artifact.campaignId !== campaignId) throw new Error("Story artifact must belong to the campaign");
    }
    const result = await this.store.mutate(actor, "story_created", (nextState) => {
      nextState.stories ||= [];
      const story = {
        id: randomUUID(),
        campaignId,
        artifactId: input.artifactId || null,
        title: requiredText(input.title, "story title"),
        angle: requiredText(input.angle, "story angle"),
        audience: requiredText(input.audience, "story audience"),
        callToAction: requiredText(input.callToAction, "story callToAction"),
        language: String(input.language || "en").trim(),
        groundingSources,
        disclosure: String(input.disclosure || "AI-assisted draft grounded in verified repository evidence.").trim(),
        status: "draft",
        createdAt: nowIso()
      };
      nextState.stories.push(story);
      return story;
    });
    return result.result;
  }

  async createChannelDrafts(storyId, input, actor = "ai-drafter") {
    const variants = Array.isArray(input.variants) ? input.variants : [];
    if (variants.length === 0) throw new Error("At least one channel variant is required");
    const initialState = await this.store.read();
    const initialStory = requireItem(initialState.stories || [], storyId, "Story");
    const initialCampaign = requireItem(initialState.campaigns, initialStory.campaignId, "Campaign");
    const productRepo = await requireProductRepo(initialCampaign.productRepo);
    const result = await this.store.mutate(actor, "channel_drafts_created", (state) => {
      const story = requireItem(state.stories || [], storyId, "Story");
      const seenTargets = new Set();
      const createdPostIds = new Set();
      const posts = variants.map((variant) => {
        const target = requireItem(state.targets, variant.targetId, "Target");
        if (seenTargets.has(target.id)) throw new Error(`Duplicate target variant: ${target.id}`);
        seenTargets.add(target.id);
        const content = requiredText(variant.content, "variant content");
        const policy = CHANNELS[target.channel];
        if (!policy) throw new Error(`Unsupported channel: ${target.channel}`);
        if (policy.maxContentChars && content.length > policy.maxContentChars) {
          throw new Error(`Content exceeds ${policy.maxContentChars} characters for ${target.channel}`);
        }
        const artifact = story.artifactId
          ? requireItem(state.artifacts || [], story.artifactId, "Artifact")
          : null;
        const assetPath = artifact ? artifact.path : null;
        if (variant.assetPath) {
          if (!artifact) throw new Error("A post asset must reference a registered artifact");
          const requestedAssetPath = path.isAbsolute(String(variant.assetPath))
            ? path.resolve(String(variant.assetPath))
            : path.resolve(productRepo, String(variant.assetPath));
          if (requestedAssetPath !== path.resolve(artifact.path)) {
            throw new Error("A post asset must match the story's registered artifact");
          }
        }
        const idempotencyKey = publicationIdentityKey({
          campaignId: story.campaignId,
          contentId: String(variant.contentId || story.id),
          platform: target.channel,
          accountId: target.accountId,
          targetId: target.id
        });
        const existing = state.posts.find((item) => item.idempotencyKey === idempotencyKey);
        if (existing) return existing;
        const created = {
          id: randomUUID(),
          campaignId: story.campaignId,
          storyId: story.id,
          contentId: String(variant.contentId || story.id),
          artifactId: story.artifactId,
          targetId: target.id,
          content,
          templateId: String(variant.templateId || "").trim() || null,
          audience: String(variant.audience || "").trim(),
          claimIds: Array.isArray(variant.claimIds) ? [...new Set(variant.claimIds.map(String))] : [],
          contentSourceRefs: Array.isArray(variant.contentSourceRefs) ? variant.contentSourceRefs.map((reference) => typeof reference === "string" ? reference : ({ relativePath: String(reference.relativePath || ""), sha256: String(reference.sha256 || "").toLowerCase() })) : [],
          assetPath,
          assetSha256: artifact?.sha256 || null,
          language: String(variant.language || story.language || "en"),
          status: "draft",
          approvedAt: null,
          idempotencyKey,
          scheduledAt: variant.scheduledAt ? new Date(variant.scheduledAt).toISOString() : null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        createdPostIds.add(created.id);
        return created;
      });
      state.posts.push(...posts.filter((post) => !state.posts.some((item) => item.id === post.id)));
      const campaignAuthorizations = (state.campaignAuthorizations || []).filter((item) => item.campaignId === story.campaignId);
      const authorization = [...campaignAuthorizations].reverse().find((item) => item.status === "active") || campaignAuthorizations.at(-1);
      if (authorization) {
        for (const post of posts) {
          if (!createdPostIds.has(post.id)) continue;
          if (post.campaignAuthorizationId) continue;
          post.campaignAuthorizationId = authorization.id;
          post.campaignAuthorizationBinding = authorization.binding;
          post.jobLifecycle = [{ state: "CREATED", at: post.createdAt }, { state: "AUTHORIZED", at: nowIso(), authorizationId: authorization.id }];
          const eligibility = evaluateQueue(post, state);
          post.authorizationDecision = { evaluatedAt: nowIso(), allowed: eligibility.allowed, reasons: eligibility.reasons };
          if (eligibility.allowed) {
            post.status = "queued";
            post.queuedAt = nowIso();
            post.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
            post.jobLifecycle.push({ state: "READY", at: post.queuedAt }, { state: "QUEUED", at: post.queuedAt });
          } else {
            post.status = "blocked";
            post.blockedAt = nowIso();
            post.jobLifecycle.push({ state: "BLOCKED", at: post.blockedAt, reasons: eligibility.reasons });
          }
        }
      }
      story.status = "adapted";
      story.updatedAt = nowIso();
      return posts;
    });
    for (const post of result.result.filter((item) => item.campaignAuthorizationId)) {
      const readinessResult = await this.refreshCampaignJobReadiness(post.id, actor);
      if (readinessResult.status === "queued") {
        await this.prepareExecutionRequest(post.id, actor);
        await this.ensureStandingExecutionGrant(post.id, "execution-router");
      }
    }
    const latestState = await this.store.read();
    return result.result.map((post) => latestState.posts.find((item) => item.id === post.id) || post);
  }

  async deriveContentCandidates(campaignId, input = {}, actor = "content-drafter") {
    const initial = await this.store.read();
    if (input.targetIds !== undefined && !Array.isArray(input.targetIds)) throw new Error("targetIds must be an array when supplied");
    const campaign = requireItem(initial.campaigns, campaignId, "Campaign");
    const story = requireItem(initial.stories || [], input.storyId, "Story");
    if (story.campaignId !== campaignId) throw new Error("Story must belong to the campaign");
    // Targets are provider-global records and do not carry campaignId. Scope
    // them through existing campaign-owned posts or authorization destinations;
    // explicit targetIds are accepted only when they are already bound there.
    const campaignPostTargetIds = new Set((initial.posts || [])
      .filter((post) => post.campaignId === campaignId)
      .map((post) => post.targetId));
    for (const authorization of (initial.campaignAuthorizations || []).filter((item) => item.campaignId === campaignId)) {
      for (const destination of authorization.destinations || []) campaignPostTargetIds.add(destination.targetId);
    }
    const requestedTargetIds = Array.isArray(input.targetIds) ? input.targetIds.map(String) : null;
    if (requestedTargetIds && requestedTargetIds.some((id) => !campaignPostTargetIds.has(id))) {
      throw new Error("Content target is not bound to the campaign");
    }
    const targets = (initial.targets || []).filter((target) => campaignPostTargetIds.has(target.id) && (!requestedTargetIds || requestedTargetIds.includes(target.id)));
    if (!targets.length) throw new Error("Content derivation requires campaign-bound targets");
    const candidates = deriveContentCandidates({ productIntelligence: campaign.productIntelligence, story, targets });
    const result = await this.store.mutate(actor, "content_candidates_derived", (state) => {
      const current = requireItem(state.campaigns, campaignId, "Campaign");
      current.contentCandidates ||= [];
      const byIdentity = new Map(current.contentCandidates.map((item) => [item.contentIdentity, item]));
      for (const candidate of candidates) byIdentity.set(candidate.contentIdentity, candidate);
      current.contentCandidates = [...byIdentity.values()].slice(-24);
      current.updatedAt = nowIso();
      return current.contentCandidates.filter((item) => candidates.some((candidate) => candidate.contentIdentity === item.contentIdentity));
    });
    return result.result;
  }

  async deriveTemplateContentCandidates(campaignId, input = {}, actor = "content-drafter") {
    const initial = await this.store.read();
    if (input.targetIds !== undefined && !Array.isArray(input.targetIds)) throw new Error("targetIds must be an array when supplied");
    const campaign = requireItem(initial.campaigns, campaignId, "Campaign");
    const story = requireItem(initial.stories || [], input.storyId, "Story");
    if (story.campaignId !== campaignId) throw new Error("Story must belong to the campaign");
    const activeAuthorizations = (initial.campaignAuthorizations || []).filter((item) => item.campaignId === campaignId && item.status === "active");
    if (activeAuthorizations.length !== 1) throw new Error("Template derivation requires exactly one active campaign authorization");
    const authorization = activeAuthorizations[0];
    if (authorization.binding !== campaignAuthorizationFingerprint(authorization) || authorization.campaignBinding !== campaignScopeFingerprint(campaign)) {
      throw new Error("Template derivation requires a current campaign authorization binding");
    }
    if (authorization.contentBoundary?.mode !== "approved_template_set") throw new Error("Template derivation requires approved_template_set authorization");
    const now = Date.now();
    if (!Number.isFinite(Date.parse(authorization.validFrom)) || now < Date.parse(authorization.validFrom) || !Number.isFinite(Date.parse(authorization.validUntil)) || now > Date.parse(authorization.validUntil)) {
      throw new Error("Template derivation requires a current campaign authorization window");
    }
    const campaignTargetIds = new Set((initial.posts || []).filter((post) => post.campaignId === campaignId).map((post) => post.targetId));
    for (const destination of authorization.destinations || []) campaignTargetIds.add(destination.targetId);
    const requestedTargetIds = Array.isArray(input.targetIds) ? input.targetIds.map(String) : null;
    if (requestedTargetIds && requestedTargetIds.some((id) => !campaignTargetIds.has(id))) throw new Error("Template target is not bound to the campaign");
    const targets = (initial.targets || []).filter((target) => campaignTargetIds.has(target.id) && (!requestedTargetIds || requestedTargetIds.includes(target.id)) && (authorization.destinations || []).some((destination) => destination.targetId === target.id && destination.platform === target.channel && destination.accountId === target.accountId && destination.profileId === target.profileId && destination.targetUrl === target.url));
    if (!targets.length) throw new Error("Template derivation requires an authorized campaign target");
    const candidates = deriveTemplateContentCandidates({ story, targets, authorization, templateId: input.templateId });
    const productRepo = await requireProductRepo(campaign.productRepo);
    for (const candidate of candidates) {
      const refs = canonicalTemplateSourceRefs(candidate.templateSourceRefs);
      const current = await Promise.all(refs.map((source) => readGroundingSource(productRepo, source.relativePath)));
      if (current.some((source, index) => source.relativePath !== refs[index].relativePath || source.sha256 !== refs[index].sha256)) throw new Error("Template claim source changed since authorization");
    }
    const result = await this.store.mutate(actor, "template_content_candidates_derived", (state) => {
      const current = requireItem(state.campaigns, campaignId, "Campaign");
      current.contentCandidates ||= [];
      const byIdentity = new Map(current.contentCandidates.map((item) => [item.contentIdentity, item]));
      // Candidate identity is immutable lineage. Never overwrite an existing
      // row during autonomous derivation: a tampered or stale row must remain
      // visible and fail closed at materialization instead of being silently
      // replaced by a newly derived candidate.
      for (const candidate of candidates) if (!byIdentity.has(candidate.contentIdentity)) byIdentity.set(candidate.contentIdentity, candidate);
      current.contentCandidates = [...byIdentity.values()].slice(-24);
      current.updatedAt = nowIso();
      return current.contentCandidates.filter((item) => candidates.some((candidate) => candidate.contentIdentity === item.contentIdentity));
    });
    return result.result;
  }

  async materializeContentCandidate(campaignId, input = {}, actor = "automation") {
    const candidateId = String(input.contentId || input.candidateId || "").trim();
    const candidateIdentity = String(input.contentIdentity || "").trim();
    const requireStandingAuthorization = input.requireStandingAuthorization === true;
    const rehearsalOnly = input.rehearsalOnly === true;
    if (!candidateId || !candidateIdentity) throw new Error("Exact content candidate identity is required");
    let shouldPrepareExecution = false;
    const result = await this.store.mutate(actor, "content_candidate_materialized", async (state) => {
      const campaign = requireItem(state.campaigns, campaignId, "Campaign");
      const candidate = (campaign.contentCandidates || []).find((item) => item.contentId === candidateId && item.contentIdentity === candidateIdentity);
      if (!candidate) throw new Error("Content candidate is not an exact campaign candidate");
      if (candidate.status !== "draft") throw new Error("Content candidate must be draft");
      const story = requireItem(state.stories || [], candidate.storyId, "Story");
      if (story.campaignId !== campaignId) throw new Error("Content candidate story is not owned by campaign");
      const groundingSources = (Array.isArray(story.groundingSources) ? story.groundingSources : [])
        .map((source) => ({ relativePath: String(source?.relativePath || "").trim(), sha256: String(source?.sha256 || "").trim().toLowerCase() }))
        .filter((source) => source.relativePath && /^[a-f0-9]{64}$/.test(source.sha256));
      if (!groundingSources.length) throw new Error("Content candidate story has no verified grounding sources");
      const productRepo = await requireProductRepo(campaign.productRepo);
      const currentGroundingSources = await Promise.all(groundingSources.map((source) => readGroundingSource(productRepo, source.relativePath)));
      if (currentGroundingSources.some((source, index) => source.relativePath !== groundingSources[index].relativePath || source.sha256 !== groundingSources[index].sha256)) {
        throw new Error("Content candidate grounding source changed since story creation");
      }
      const target = requireItem(state.targets, candidate.targetId, "Target");
      if (String(target.channel || "").toLowerCase() !== String(candidate.channel || "").toLowerCase()) throw new Error("Content candidate channel does not match target");
      if (!CHANNELS[target.channel]) throw new Error(`Unsupported channel: ${target.channel}`);
      const campaignTargetIds = new Set((state.posts || []).filter((post) => post.campaignId === campaignId).map((post) => post.targetId));
      for (const authorization of (state.campaignAuthorizations || []).filter((item) => item.campaignId === campaignId)) {
        for (const destination of authorization.destinations || []) campaignTargetIds.add(destination.targetId);
      }
      if (!campaignTargetIds.has(target.id)) throw new Error("Content candidate target is not bound to campaign");
      const content = String(candidate.content || "");
      const policy = CHANNELS[target.channel];
      if (policy.maxContentChars && content.length > policy.maxContentChars) throw new Error(`Content exceeds ${policy.maxContentChars} characters for ${target.channel}`);
      const contentHash = campaignContentHash(content);
      if (candidate.contentHash && candidate.contentHash !== contentHash) throw new Error("Content candidate content hash mismatch");
      const identityKey = publicationIdentityKey({ campaignId, contentId: candidate.contentId, platform: target.channel, accountId: target.accountId, targetId: target.id });
      const activeAuthorizations = (state.campaignAuthorizations || []).filter((item) => item.campaignId === campaignId && item.status === "active");
      if (activeAuthorizations.length > 1) throw new Error("Multiple active campaign authorizations prevent fail-closed materialization");
      const authorization = activeAuthorizations[0] || null;
      const now = new Date();
      const destination = authorization?.destinations?.find((item) => item.targetId === target.id && item.platform === target.channel && item.accountId === target.accountId && item.profileId === target.profileId && item.targetUrl === target.url);
      const boundary = authorization?.contentBoundary || {};
      const hasTemplateBinding = candidate.templateContractVersion !== undefined || candidate.templateId || candidate.templateFingerprint || candidate.templateClaimIds || candidate.templateSourceRefs;
      let templateScopeValid = false;
      let candidateSourceRefs = groundingSources;
      let templateBinding = null;
      if (hasTemplateBinding) {
        if (candidate.templateContractVersion !== TEMPLATE_CANDIDATE_CONTRACT_VERSION || boundary.mode !== "approved_template_set") throw new Error("Unsupported or unauthorized template candidate contract");
        const template = (boundary.templates || []).find((item) => item.id === candidate.templateId && item.platform === target.channel);
        if (!template) throw new Error("Template candidate is not bound to the authorized template");
        const expectedClaimIds = templateClaimIds(template.template);
        const suppliedClaimIds = [...new Set((candidate.templateClaimIds || []).map(String))].sort();
        if (JSON.stringify(suppliedClaimIds) !== JSON.stringify(expectedClaimIds) || JSON.stringify([...new Set((candidate.claimIds || []).map(String))].sort()) !== JSON.stringify(expectedClaimIds)) throw new Error("Template candidate claim binding mismatch");
        const claims = expectedClaimIds.map((id) => (boundary.approvedClaims || []).find((claim) => claim.id === id));
        if (claims.some((claim) => !claim)) throw new Error("Template candidate claim is not approved");
        const expectedSourceRefs = canonicalTemplateSourceRefs(claims.flatMap((claim) => claim.sourceRefs || []));
        const suppliedSourceRefs = canonicalTemplateSourceRefs(candidate.templateSourceRefs);
        if (JSON.stringify(suppliedSourceRefs) !== JSON.stringify(expectedSourceRefs)) throw new Error("Template candidate source binding mismatch");
        const storySourceKeys = new Set(groundingSources.map((source) => `${source.relativePath}\u0000${source.sha256}`));
        if (expectedSourceRefs.some((source) => !storySourceKeys.has(`${source.relativePath}\u0000${source.sha256}`))) throw new Error("Template candidate source is not bound to story grounding");
        const currentTemplateSources = await Promise.all(expectedSourceRefs.map((source) => readGroundingSource(productRepo, source.relativePath)));
        if (currentTemplateSources.some((source, index) => source.relativePath !== expectedSourceRefs[index].relativePath || source.sha256 !== expectedSourceRefs[index].sha256)) throw new Error("Template candidate source changed since authorization");
        const expectedBinding = templateCandidateBinding({ templateId: template.id, platform: target.channel, template: template.template, requiredDisclosures: boundary.requiredDisclosures || [], claimIds: expectedClaimIds, sourceRefs: expectedSourceRefs, authorizationBinding: authorization.binding });
        if (candidate.templateFingerprint !== expectedBinding.templateFingerprint || candidate.templatePlatform !== expectedBinding.templatePlatform || candidate.templateAuthorizationBinding !== expectedBinding.templateAuthorizationBinding) throw new Error("Template candidate fingerprint mismatch");
        const rendered = renderApprovedTemplate({ template: template.template, approvedClaims: claims, requiredDisclosures: boundary.requiredDisclosures || [] });
        if (content !== rendered) throw new Error("Content is outside the authorized template render");
        if (candidate.contentHash !== contentHash) throw new Error("Template candidate content hash is missing or stale");
        candidateSourceRefs = expectedSourceRefs;
        templateBinding = expectedBinding;
        templateScopeValid = true;
      }
      const recomputedIdentity = contentCandidateIdentity({ storyId: candidate.storyId, targetId: candidate.targetId, channel: candidate.channel, content, claimIds: candidate.claimIds || [], evidenceRefs: templateScopeValid ? candidateSourceRefs.map((source) => `${source.relativePath}#${source.sha256}`) : [...new Set(candidate.evidenceRefs || [])].sort(), templateBinding });
      if (candidate.contentIdentity !== recomputedIdentity) throw new Error("Content candidate identity mismatch");
      if (candidate.contentId !== `content-${candidate.contentIdentity.slice(0, 24)}`) throw new Error("Content candidate contentId mismatch");
      const candidateFitsStandingAuthorization = !rehearsalOnly && Boolean(
        campaign.status === "active" && authorization && authorization.executionMode === "standing_autonomous" && authorization.allowLiveExecution === true &&
        authorization.binding === campaignAuthorizationFingerprint(authorization) &&
        authorization.campaignBinding === campaignScopeFingerprint(campaign) &&
        Number.isFinite(Date.parse(authorization.validFrom)) && now >= new Date(authorization.validFrom) &&
        Number.isFinite(Date.parse(authorization.validUntil)) && now <= new Date(authorization.validUntil) &&
        destination && ((boundary.mode === "approved_copy_set" && !hasTemplateBinding && boundary.contentHashes?.includes(contentHash)) || (boundary.mode === "approved_template_set" && templateScopeValid)) &&
        authorization.audienceRules?.allowedAudiences?.includes(String(story.audience || "").trim()) &&
        (authorization.publicationVisibilityRules?.allowedVisibilities || ["PUBLIC"]).includes("PUBLIC")
      );
      if (requireStandingAuthorization && !candidateFitsStandingAuthorization) {
        throw new Error("Content candidate does not fit one exact active standing authorization");
      }
      const existing = state.posts.find((post) => post.idempotencyKey === identityKey || publicationIdentityKeysForPost(post, state).includes(identityKey));
      if (existing) {
        if (existing.campaignId !== campaignId || existing.targetId !== target.id || existing.contentId !== candidate.contentId || existing.contentIdentity !== candidate.contentIdentity ||
            existing.content !== content || existing.contentHash !== contentHash || existing.storyId !== candidate.storyId || existing.idempotencyKey !== identityKey ||
            existing.audience !== String(story.audience || "").trim() || existing.language !== (String(story.language || "en").trim() || "en") || existing.publicationVisibility !== "PUBLIC" ||
            JSON.stringify(existing.claimIds || []) !== JSON.stringify(candidate.claimIds || []) ||
            JSON.stringify(existing.contentEvidenceRefs || []) !== JSON.stringify([...new Set((candidate.evidenceRefs || []).map(String))].sort()) ||
            JSON.stringify(existing.contentSourceRefs || []) !== JSON.stringify(candidateSourceRefs) ||
            (templateScopeValid && (existing.templateContractVersion !== candidate.templateContractVersion || existing.templateId !== candidate.templateId || existing.templatePlatform !== candidate.templatePlatform || existing.templateFingerprint !== candidate.templateFingerprint || existing.templateAuthorizationBinding !== candidate.templateAuthorizationBinding || JSON.stringify(existing.templateClaimIds || []) !== JSON.stringify(candidate.templateClaimIds || []) || JSON.stringify(existing.templateSourceRefs || []) !== JSON.stringify(candidateSourceRefs)))) {
          throw new Error("Existing post conflicts with content candidate");
        }
        if (existing.status !== "draft") {
          if (rehearsalOnly && existing.contentId === candidate.contentId && existing.contentIdentity === candidate.contentIdentity) return existing;
          if (candidateFitsStandingAuthorization && ["queued", "blocked"].includes(existing.status) &&
              existing.campaignAuthorizationId === authorization.id && existing.campaignAuthorizationBinding === authorization.binding) {
            shouldPrepareExecution = true;
            return existing;
          }
          throw new Error("Existing post conflicts with content candidate");
        }
        if (candidateFitsStandingAuthorization) {
          if (existing.campaignAuthorizationId && existing.campaignAuthorizationId !== authorization.id) throw new Error("Existing post is bound to another campaign authorization");
          if (existing.campaignAuthorizationBinding && existing.campaignAuthorizationBinding !== authorization.binding) throw new Error("Existing post authorization binding is stale");
          existing.campaignAuthorizationId ||= authorization.id;
          existing.campaignAuthorizationBinding ||= authorization.binding;
          shouldPrepareExecution = true;
          if (!existing.jobLifecycle) existing.jobLifecycle = [{ state: "CREATED", at: existing.createdAt || nowIso() }];
          if (!existing.jobLifecycle.some((item) => item.state === "AUTHORIZED" && item.authorizationId === authorization.id)) {
            existing.jobLifecycle.push({ state: "AUTHORIZED", at: nowIso(), authorizationId: authorization.id });
          }
          const eligibility = evaluateQueue(existing, state);
          existing.authorizationDecision = { evaluatedAt: nowIso(), allowed: eligibility.allowed, reasons: eligibility.reasons };
          if (eligibility.allowed) {
            existing.status = "queued";
            existing.queuedAt ||= nowIso();
            existing.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
            if (!existing.jobLifecycle.some((item) => item.state === "QUEUED")) existing.jobLifecycle.push({ state: "READY", at: existing.queuedAt }, { state: "QUEUED", at: existing.queuedAt });
            delete existing.blockedAt;
          } else {
            existing.status = "blocked";
            existing.blockedAt ||= nowIso();
          }
        }
        return existing;
      }
      const at = nowIso();
      const post = {
        id: randomUUID(), campaignId, targetId: target.id, storyId: candidate.storyId || null,
        content, contentId: candidate.contentId, contentIdentity: candidate.contentIdentity, contentHash,
        contentEvidenceRefs: [...new Set((candidate.evidenceRefs || []).map(String))].sort(),
        claimIds: [...new Set((candidate.claimIds || []).map(String))],
        contentSourceRefs: candidateSourceRefs,
        idempotencyKey: identityKey, audience: String(story.audience || "").trim(),
        language: String(story.language || "en").trim() || "en", publicationVisibility: "PUBLIC", status: "draft",
        approvedAt: null, createdAt: at, updatedAt: at,
        ...(templateScopeValid ? {
          templateContractVersion: candidate.templateContractVersion,
          templateId: candidate.templateId,
          templatePlatform: candidate.templatePlatform,
          templateFingerprint: candidate.templateFingerprint,
          templateAuthorizationBinding: candidate.templateAuthorizationBinding,
          templateClaimIds: [...candidate.templateClaimIds],
          templateSourceRefs: candidateSourceRefs
        } : {})
      };
      if (candidateFitsStandingAuthorization) {
        post.campaignAuthorizationId = authorization.id;
        post.campaignAuthorizationBinding = authorization.binding;
        shouldPrepareExecution = true;
        post.jobLifecycle = [{ state: "CREATED", at }, { state: "AUTHORIZED", at, authorizationId: authorization.id }];
        const eligibility = evaluateQueue(post, state);
        post.authorizationDecision = { evaluatedAt: at, allowed: eligibility.allowed, reasons: eligibility.reasons };
        if (eligibility.allowed) {
          post.status = "queued";
          post.queuedAt = at;
          post.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
          post.jobLifecycle.push({ state: "READY", at }, { state: "QUEUED", at });
        } else {
          post.status = "blocked";
          post.blockedAt = at;
          post.jobLifecycle.push({ state: "BLOCKED", at, reasons: eligibility.reasons });
        }
      }
      state.posts.push(post);
      return post;
    });
    if (shouldPrepareExecution && result.result.campaignAuthorizationId) {
      const readinessResult = await this.refreshCampaignJobReadiness(result.result.id, actor);
      if (readinessResult.status === "queued") {
        await this.prepareExecutionRequest(result.result.id, actor);
        await this.ensureStandingExecutionGrant(result.result.id, "execution-router");
      }
      const latest = await this.store.read();
      return latest.posts.find((item) => item.id === result.result.id) || result.result;
    }
    return result.result;
  }

  /**
   * Materialize explicitly marked rehearsal candidates into the existing JEV
   * dry-run queue. Metadata is the authority for this lane; standing/live
   * authorization is never inferred and no live control is created.
   */
  async handoffRehearsalCandidates(actor = "dry-run-handoff-scheduler") {
    const snapshot = await this.store.read();
    const candidates = (snapshot.campaigns || []).flatMap((campaign) =>
      (campaign.contentCandidates || []).map((candidate) => ({ campaign, candidate }))
    );
    const results = [];
    for (const { campaign, candidate } of candidates) {
      const metadata = candidate?.rehearsalMetadata || candidate?.rehearsal;
      if (!metadata || typeof metadata !== "object" || (metadata.enabled !== true && metadata.dryRun !== true && metadata.mode !== "DRY_RUN")) continue;
      try {
        const campaignId = String(metadata.campaignId || "").trim();
        const storyId = String(metadata.storyId || "").trim();
        const templateId = String(metadata.templateId || "").trim();
        const targetId = String(metadata.targetId || "").trim();
        const contentId = String(metadata.contentId || metadata.candidateId || "").trim();
        const contentIdentity = String(metadata.contentIdentity || "").trim();
        const contentHash = String(metadata.contentHash || "").trim().toLowerCase();
        const authorizationId = String(metadata.authorizationId || "").trim();
        if (!campaignId || campaignId !== campaign.id || !storyId || !templateId || !targetId || !contentId || !contentIdentity || !contentHash || !authorizationId) {
          throw new Error("rehearsal metadata is incomplete");
        }
        if (candidate.contentId !== contentId || candidate.contentIdentity !== contentIdentity || candidate.storyId !== storyId || candidate.targetId !== targetId || candidate.templateId !== templateId || candidate.contentHash !== contentHash || campaignContentHash(candidate.content || "") !== contentHash) {
          throw new Error("rehearsal candidate lineage is stale or mismatched");
        }
        const story = (snapshot.stories || []).find((item) => item.id === storyId);
        if (!story || story.campaignId !== campaign.id) throw new Error("rehearsal story lineage is invalid");
        const target = (snapshot.targets || []).find((item) => item.id === targetId);
        if (!target || target.id !== candidate.targetId) throw new Error("rehearsal target lineage is invalid");
        const authorization = (snapshot.campaignAuthorizations || []).find((item) => item.id === authorizationId);
        if (!authorization || authorization.campaignId !== campaign.id || authorization.status !== "active") throw new Error("rehearsal authorization is missing or stale");
        if (authorization.binding !== campaignAuthorizationFingerprint(authorization) || authorization.campaignBinding !== campaignScopeFingerprint(campaign)) throw new Error("rehearsal authorization binding is stale");
        const destination = (authorization.destinations || []).find((item) => item.targetId === target.id && item.platform === target.channel && item.accountId === target.accountId && item.profileId === target.profileId && item.targetUrl === target.url);
        if (!destination) throw new Error("rehearsal target is not authorized");

        const existingPost = (snapshot.posts || []).find((item) => item.campaignId === campaign.id && item.targetId === target.id && item.contentId === contentId && item.contentIdentity === contentIdentity);
        const prior = existingPost ? (snapshot.executionRequests || []).filter((item) => item.jobId === existingPost.id).sort((left, right) => (right.attempt || 0) - (left.attempt || 0))[0] : null;
        if (prior && prior.dryRun === true && prior.request?.dryRun === true && ["DRY_RUN_COMPLETE", "DRY_RUN_FAILED"].includes(prior.state)) {
          results.push({ candidateId: contentId, postId: existingPost.id, executionId: prior.executionId, status: prior.state });
          continue;
        }

        const post = await this.materializeContentCandidate(campaign.id, { contentId, contentIdentity, rehearsalOnly: true }, actor);
        const updated = await this.store.mutate(actor, "rehearsal_post_bound", (state) => {
          const current = requireItem(state.posts, post.id, "Post");
          const currentAuthorization = requireItem(state.campaignAuthorizations || [], authorizationId, "Campaign authorization");
          if (current.rehearsalHandoff !== true && current.status !== "draft") throw new Error("existing post is not an explicit rehearsal row");
          if (!["draft", "blocked", "queued"].includes(current.status) || unresolvedSubmission(state, current)) throw new Error("existing post is not safe for rehearsal");
          const prior = (state.executionRequests || []).filter((item) => item.jobId === current.id);
          if (prior.some((item) => item.dryRun !== true || item.request?.dryRun !== true || ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state))) throw new Error("existing post has live or submitted execution history");
          const currentTarget = requireItem(state.targets, current.targetId, "Target");
          const binding = { platform: currentTarget.channel, accountId: currentTarget.accountId, profileId: currentTarget.profileId, targetId: currentTarget.id };
          if (!isReadinessFresh(currentTarget.readiness, binding, new Date(), this.readinessTtlMs)) throw new Error("rehearsal requires fresh bound READY readiness");
          current.campaignAuthorizationId = currentAuthorization.id;
          current.campaignAuthorizationBinding = currentAuthorization.binding;
          current.rehearsalHandoff = true;
          current.readinessState = "READY";
          current.status = "queued";
          current.queuedAt ||= nowIso();
          current.jobLifecycle ||= [{ state: "CREATED", at: current.createdAt || current.queuedAt }];
          if (!current.jobLifecycle.some((item) => item.state === "QUEUED")) current.jobLifecycle.push({ state: "READY", at: current.queuedAt }, { state: "QUEUED", at: current.queuedAt });
          return current;
        });
        const request = await this.prepareExecutionRequest(updated.result.id, actor, { dryRun: true });
        results.push({ candidateId: contentId, postId: updated.result.id, executionId: request.executionId, status: "REQUEST_READY" });
      } catch (error) {
        results.push({ candidateId: String(metadata.contentId || metadata.candidateId || candidate?.contentId || ""), status: "SKIPPED", reason: String(error?.message || "rehearsal_handoff_failed").slice(0, 160) });
      }
    }
    return { scanned: candidates.filter(({ candidate }) => {
      const metadata = candidate?.rehearsalMetadata || candidate?.rehearsal;
      return metadata && typeof metadata === "object" && (metadata.enabled === true || metadata.dryRun === true || metadata.mode === "DRY_RUN");
    }).length, results };
  }

  /**
   * Materialize only exact approved-copy candidates during the autonomous queue
   * pass. This is deliberately separate from the advisory control cycle: the
   * queue owns authority side effects and reuses the existing materialization,
   * readiness, request, window and grant contracts.
   */
  async materializeAuthorizedContentCandidates(campaignId, actor = "campaign-queue-scheduler") {
    let snapshot = await this.store.read();
    let campaign = requireItem(snapshot.campaigns, campaignId, "Campaign");
    const activeAuthorizations = (snapshot.campaignAuthorizations || [])
      .filter((item) => item.campaignId === campaignId && item.status === "active");
    const authorization = activeAuthorizations.length === 1 ? activeAuthorizations[0] : null;
    if (campaign.status !== "active" || !authorization || authorization.executionMode !== "standing_autonomous" || authorization.allowLiveExecution !== true ||
        authorization.binding !== campaignAuthorizationFingerprint(authorization) ||
        authorization.campaignBinding !== campaignScopeFingerprint(campaign) ||
        !["approved_copy_set", "approved_template_set"].includes(authorization.contentBoundary?.mode)) {
      return { campaignId, materialized: [], skipped: (campaign.contentCandidates || []).filter((item) => item.status === "draft").length, reason: "standing_content_authorization_not_uniquely_active" };
    }

    // A standing template authorization is also the bounded source of its
    // candidates. An explicit story policy may derive one deterministic,
    // draft-only story from the READY product-intelligence handoff. The policy
    // is part of the authorization fingerprint; no CTA is inferred from a
    // campaign objective, URL or other unapproved field.
    if (authorization.contentBoundary.mode === "approved_template_set" && authorization.contentBoundary.storyPolicy) {
      try {
        // If the campaign has no persisted intelligence yet, perform one
        // bounded deterministic inspection using only the source files named
        // by the standing authorization's approved claims. This keeps the
        // autonomous queue useful without introducing a second product
        // intelligence or authority path. An incomplete result remains
        // fail-closed in deriveProductIntelligenceStory below.
        const currentIntelligence = campaign.productIntelligence;
        if (!currentIntelligence?.handoff || !currentIntelligence?.document) {
          const approvedClaims = authorization.contentBoundary.approvedClaims || [];
          const claims = approvedClaims.map((claim) => ({
            id: claim.id,
            text: claim.text,
            field: claim.field,
            evidenceRefs: (claim.sourceRefs || []).map((ref) => `repo:${ref.relativePath}`)
          }));
          const allowlist = [...new Set(approvedClaims.flatMap((claim) =>
            (claim.sourceRefs || []).map((ref) => String(ref.relativePath || "").trim()).filter(Boolean)
          ))];
          if (!claims.length || !allowlist.length) throw new Error("standing story policy has no bounded product evidence");
          // Validate the authorization's exact source lineage before
          // persisting any inspection. A changed or missing approved file is
          // a fail-closed source-drift condition, not a new intelligence
          // record that can later be mistaken for an authorized handoff.
          const boundedInspection = await inspectRepositoryEvidence(campaign.productRepo, { allowlist });
          const recordsByLocator = new Map(boundedInspection.records.map((record) => [record.locator, record]));
          for (const claim of approvedClaims) {
            for (const source of claim.sourceRefs || []) {
              const record = recordsByLocator.get(String(source.relativePath || "").trim());
              if (!record || String(record.sha256 || "").toLowerCase() !== String(source.sha256 || "").toLowerCase()) {
                throw new Error("standing story policy source lineage changed");
              }
            }
          }
          await this.inspectProductIntelligence(campaignId, { allowlist, claims }, actor);
        }
        await this.deriveProductIntelligenceStory(campaignId, authorization.contentBoundary.storyPolicy, actor);
      } catch {
        // Missing/incomplete intelligence, stale source lineage or unsafe
        // policy input remains draft-only. Existing persisted stories are not
        // replaced and no execution authority is created by this branch.
      }
      snapshot = await this.store.read();
      campaign = requireItem(snapshot.campaigns, campaignId, "Campaign");
    }

    // Derive only from persisted stories and the exact approved templates,
    // then re-read before materialization so every candidate still passes the
    // same source/claim/target/authorization checks. This keeps the queue
    // autonomous without creating a second content or authority path.
    if (authorization.contentBoundary.mode === "approved_template_set") {
      const stories = (snapshot.stories || [])
        .filter((story) => story.campaignId === campaignId)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .slice(-24);
      const templates = (authorization.contentBoundary.templates || [])
        .map((template) => ({ ...template, id: String(template.id || "").trim(), platform: String(template.platform || "").trim().toLowerCase() }))
        .sort((left, right) => `${left.platform}\u0000${left.id}`.localeCompare(`${right.platform}\u0000${right.id}`));
      for (const story of stories) {
        for (const template of templates) {
          try {
            await this.deriveTemplateContentCandidates(campaignId, { storyId: story.id, templateId: template.id }, actor);
          } catch {
            // A stale, malformed or source-drifted story/template is kept
            // draft-only; another exact template or story may still proceed.
          }
        }
      }
      snapshot = await this.store.read();
      campaign = requireItem(snapshot.campaigns, campaignId, "Campaign");
    }
    const results = [];
    const draftCandidates = (campaign.contentCandidates || []).filter((item) => item.status === "draft");
    // Approved-copy authorizations are an exact content boundary. A campaign
    // can retain draft candidates from an earlier authorization (or from a
    // previous strategy pass); attempting to materialize those candidates only
    // creates noisy blocked posts and obscures the active queue. Keep stale
    // candidates as draft/read-only records and evaluate only candidates whose
    // canonical bytes are in the currently active approved copy set.
    const candidates = authorization.contentBoundary.mode === "approved_copy_set"
      ? draftCandidates.filter((candidate) => authorization.contentBoundary.contentHashes?.includes(campaignContentHash(candidate.content || "")))
      : draftCandidates;
    for (const candidate of candidates) {
      const existing = snapshot.posts.filter((post) => post.campaignId === campaignId && post.targetId === candidate.targetId && post.contentId === candidate.contentId);
      if (existing.length > 1) {
        results.push({ contentId: candidate.contentId, status: "blocked", reason: "duplicate_candidate_posts" });
        continue;
      }
      if (existing[0] && !["draft", "blocked", "queued"].includes(existing[0].status)) {
        // A terminal or uncertain post is never replayed from a still-draft
        // candidate. UNKNOWN remains quarantined and immutable.
        results.push({ contentId: candidate.contentId, status: "skipped", reason: "existing_post_terminal_or_uncertain" });
        continue;
      }
      try {
        const post = await this.materializeContentCandidate(campaignId, {
          contentId: candidate.contentId,
          contentIdentity: candidate.contentIdentity,
          requireStandingAuthorization: true
        }, actor);
        results.push({ contentId: candidate.contentId, postId: post.id, status: post.status });
      } catch (error) {
        // One malformed or stale candidate must not prevent other campaigns or
        // candidates from being evaluated on the next bounded queue tick.
        results.push({ contentId: candidate.contentId, status: "blocked", reason: String(error?.message || "candidate_materialization_failed").slice(0, 160) });
      }
    }
    return { campaignId, materialized: results.filter((item) => item.postId), results };
  }

  async queueAuthorizedCampaignJobs(campaignId, actor = "scheduler") {
    const snapshot = await this.store.read();
    // A REQUEST_READY row can survive a bootstrap/transport interruption
    // before ensureStandingExecutionGrant persists its grant reference. Keep
    // that exact pending row eligible for the next queue tick so recovery can
    // attach the grant in place instead of redispatching a second execution.
    const grantRecoveryPostIds = new Set();
    const forceNewExecutionPostIds = new Set();
    const candidates = snapshot.posts.filter((post) => {
      if (post.campaignId !== campaignId || !post.campaignAuthorizationId) return false;
      if (["blocked", "draft"].includes(post.status)) return true;
      if (post.status !== "queued") return false;
      const authorization = snapshot.campaignAuthorizations?.find((item) => item.id === post.campaignAuthorizationId);
      if (authorization?.executionMode === "standing_autonomous" && !post.executionState) return true;
      const executions = (snapshot.executionRequests || []).filter((item) => item.jobId === post.id)
        .sort((a, b) => (Number(b.attempt) || 0) - (Number(a.attempt) || 0));
      const latestExecution = executions.find((item) => {
        if (item.state !== "REQUEST_READY" || item.submitState !== "NOT_STARTED" || item.request?.dryRun === true) return false;
        const request = item.request || {};
        const windowId = request.oneTimeWindow?.windowId;
        const window = windowId ? (snapshot.oneTimeExecutionWindows || []).find((candidate) => candidate.windowId === windowId) : null;
        const grantId = request.liveGrant?.grantId;
        const grant = grantId ? (snapshot.liveExecutionGrants || []).find((candidate) => candidate.grantId === grantId) : null;
        if (!window || !grant || liveGrantEffectiveStatus(grant) !== "ACTIVE" || grant.boundExecutionId !== item.executionId) return false;
        if (!['ACTIVE', 'RESERVED'].includes(oneTimeExecutionWindowStatus(window, new Date())) ||
            !oneTimeExecutionWindowInBounds(window, new Date()) ||
            (window.status === "RESERVED" && window.reservedExecutionId !== item.executionId)) return false;
        try { return assertLiveGrantMatchesExecution(grant, request, authorization, new Date(), { checkWindow: false }); }
        catch { return false; }
      }) || executions[0];
      if (authorization?.executionMode === "standing_autonomous" && latestExecution?.state === "REQUEST_READY" && latestExecution.submitState === "NOT_STARTED" && latestExecution.request?.dryRun !== true) {
        const requestGrantId = latestExecution.request?.liveGrant?.grantId || null;
        const rowGrantId = latestExecution.liveGrantId || null;
        const grant = requestGrantId ? (snapshot.liveExecutionGrants || []).find((item) => item.grantId === requestGrantId) : null;
        const requestWindowId = latestExecution.request?.oneTimeWindow?.windowId || null;
        const requestWindow = requestWindowId ? (snapshot.oneTimeExecutionWindows || []).find((item) => item.windowId === requestWindowId) : null;
        const windowStatus = requestWindow ? oneTimeExecutionWindowStatus(requestWindow, new Date()) : "INVALID";
        const windowBound = Boolean(requestWindow && requestWindow.campaignId === post.campaignId &&
          requestWindow.campaignAuthorizationId === authorization.id && requestWindow.jobId === post.id &&
          requestWindow.binding === oneTimeExecutionWindowFingerprint(requestWindow) &&
          oneTimeExecutionWindowInBounds(requestWindow, new Date()) &&
          ((windowStatus === "RESERVED" && requestWindow.reservedExecutionId === latestExecution.executionId) ||
            (windowStatus === "ACTIVE" && !requestWindow.reservedExecutionId)));
        const grantInvalid = !requestGrantId || rowGrantId !== requestGrantId || !grant || liveGrantEffectiveStatus(grant) !== "ACTIVE" || grant.boundExecutionId !== latestExecution.executionId;
        if (grantInvalid) {
          if (windowBound) grantRecoveryPostIds.add(post.id);
          else forceNewExecutionPostIds.add(post.id);
          return true;
        }
      }
      if (latestExecution?.state === "FAILED" && latestExecution.recoveryClassification === "RECOVERABLE" && latestExecution.submitState === "FAILED" && latestExecution.attempt < 3) return true;
      if (post.executionState !== "REQUEST_READY") return false;
      const target = snapshot.targets.find((item) => item.id === post.targetId);
      return !target || !isReadinessFresh(target.readiness, { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id }, new Date(), this.readinessTtlMs);
    });
    const decisions = [];
    for (const post of candidates) {
      const result = await this.refreshCampaignJobReadiness(post.id, actor);
      decisions.push({ postId: post.id, status: result.status, readinessState: result.readinessState, reasons: result.reasons || [] });
      if (result.status === "queued") {
        // Recover the existing REQUEST_READY row in place. Calling prepare
        // here would intentionally force a fresh execution when its grant is
        // missing, which can collide with its already RESERVED window.
        if (!grantRecoveryPostIds.has(post.id)) await this.prepareExecutionRequest(post.id, actor, { forceNewLiveExecution: forceNewExecutionPostIds.has(post.id) });
        await this.ensureStandingExecutionGrant(post.id, "campaign-queue-scheduler");
      }
    }
    return decisions;
  }

  /**
   * Re-derive one bounded standing campaign authority from the high-level
   * bootstrap policy that is already persisted on the campaign.  This is the
   * scheduler bridge for zero-touch operation: it reuses the existing
   * bootstrap path and never reconstructs payload bytes, hashes, grants or
   * leases in a second code path.
   *
   * Only an expired standing authorization may be renewed.  Paused, revoked,
   * superseded and otherwise operator-terminal authorities remain terminal.
   * Any post that crossed the submit/publication boundary (including UNKNOWN)
   * is a hard safety fence for the exact current story identity.
   */
  async #renewPersistedBootstrapCampaigns(actor = "campaign-queue-scheduler") {
    const snapshot = await this.store.read();
    const failures = new Map();
    for (const campaign of snapshot.campaigns || []) {
      const policy = campaign.autonomousBootstrap;
      if (campaign.status !== "active" || !policy || policy.schemaVersion !== 1) continue;
      if (snapshot.control?.killSwitch?.active === true) {
        failures.set(campaign.id, "BOOTSTRAP_RENEWAL_KILL_SWITCH_ACTIVE");
        continue;
      }
      const authorizations = (snapshot.campaignAuthorizations || [])
        .filter((item) => item.campaignId === campaign.id &&
          item.standingAuthorizationReference === policy.authorizationReference)
        .sort((left, right) => String(right.updatedAt || right.approvedAt || right.createdAt || "")
          .localeCompare(String(left.updatedAt || left.approvedAt || left.createdAt || "")));
      if (!authorizations.length || authorizations.some((item) => item.status === "active")) continue;
      // A standing campaign may renew only the normal expiry path.  An
      // operator pause/revoke/supersede is an explicit stop signal and must
      // never be silently converted back into live authority.
      if (authorizations[0].status !== "expired") continue;

      const target = (snapshot.targets || []).find((item) => item.id === policy.targetId);
      const account = target && (snapshot.executionAccounts || [])
        .find((item) => item.id === executionAccountKey(target.channel, target.accountId));
      const exactBinding = target && account &&
        target.channel === policy.platform &&
        target.url === policy.targetUrl &&
        target.accountId === policy.accountId &&
        target.profileId === policy.profileId &&
        account.platform === policy.platform &&
        account.accountId === policy.accountId &&
        account.profileId === policy.profileId &&
        target.status === "active" && account.status === "enabled" && account.health === "healthy";
      if (!exactBinding) {
        failures.set(campaign.id, "BOOTSTRAP_RENEWAL_BINDING_BLOCKED");
        continue;
      }

      const latestStory = (snapshot.stories || [])
        .filter((item) => item.campaignId === campaign.id)
        .sort((left, right) => String(right.updatedAt || right.createdAt || "")
          .localeCompare(String(left.updatedAt || left.createdAt || "")))[0] || null;
      const schedule = policy.schedule;
      const from = Date.parse(schedule?.validFrom || "");
      const until = Date.parse(schedule?.validUntil || "");
      let canonicalSchedule;
      try {
        canonicalSchedule = deriveBootstrapSchedule({
          now: new Date(),
          validFrom: schedule?.validFrom,
          validUntil: schedule?.validUntil,
          timezone: schedule?.timezone,
          quota: schedule?.quota,
          concurrency: schedule?.concurrency
        });
      } catch {
        canonicalSchedule = null;
      }
      const scheduleShapeValid = canonicalSchedule &&
        schedule.cadence === "single" &&
        JSON.stringify(schedule.weekdays || []) === JSON.stringify(canonicalSchedule.weekdays) &&
        schedule.startLocal === canonicalSchedule.startLocal &&
        schedule.endLocal === canonicalSchedule.endLocal &&
        schedule.nextExecutionAt === canonicalSchedule.nextExecutionAt &&
        schedule.identity === canonicalSchedule.identity;
      const validityHours = (Number.isFinite(from) && Number.isFinite(until) && until > from)
        ? (until - from) / (60 * 60 * 1000)
        : null;
      if (!scheduleShapeValid || !Number.isFinite(validityHours) || validityHours <= 0 || validityHours > 24 * 90) {
        failures.set(campaign.id, "BOOTSTRAP_RENEWAL_POLICY_INCOMPLETE");
        continue;
      }

      // Resolve the exact current content identity when the product handoff
      // is available.  This lets a changed high-level story policy proceed
      // while still fencing the exact content identity of an UNKNOWN attempt.
      let currentContentIdentities = new Set();
      try {
        const candidates = deriveContentCandidates({
          productIntelligence: campaign.productIntelligence,
          story: latestStory,
          targets: [target]
        });
        currentContentIdentities = new Set(candidates.map((item) => item.contentIdentity));
      } catch {
        currentContentIdentities = new Set((campaign.contentCandidates || [])
          .filter((item) => (!latestStory || item.storyId === latestStory.id) && item.targetId === target.id)
          .map((item) => item.contentIdentity));
      }
      const matchingPosts = (snapshot.posts || []).filter((post) =>
        post.campaignId === campaign.id && post.targetId === target.id &&
        (currentContentIdentities.size === 0 || currentContentIdentities.has(post.contentIdentity)));
      const unsafePost = matchingPosts.find((post) => {
        if (unresolvedSubmission(snapshot, post)) return true;
        if (["publishing", "processing", UNKNOWN_POST_STATUS, "published"].includes(post.status)) return true;
        if ((snapshot.executionRequests || []).some((item) => item.jobId === post.id && (
          ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state) ||
          ["SUBMIT_SENT", "UNKNOWN", "CONFIRMED"].includes(item.submitState)
        ))) return true;
        if ((snapshot.executionReceipts || []).some((item) => item.jobId === post.id &&
          ["SUBMIT_SENT", "UNKNOWN", "CONFIRMED"].includes(item.receipt?.submitState))) return true;
        return (snapshot.publicationAttempts || []).some((item) => item.postId === post.id);
      });
      if (unsafePost) {
        failures.set(campaign.id, "BOOTSTRAP_RENEWAL_SUBMISSION_UNCERTAIN");
        continue;
      }

      const brief = {
        productRepo: campaign.productRepo,
        name: campaign.name,
        objective: campaign.objective,
        audience: campaign.audience,
        platform: policy.platform,
        authorizationReference: policy.authorizationReference,
        targetId: policy.targetId,
        targetUrl: policy.targetUrl,
        accountId: policy.accountId,
        profileId: policy.profileId,
        visibility: policy.visibility,
        timezone: schedule.timezone,
        validityHours,
        quota: schedule.quota,
        concurrency: schedule.concurrency,
        ...(latestStory?.callToAction ? { callToAction: latestStory.callToAction } : {}),
        ...(latestStory?.disclosure ? { disclosure: latestStory.disclosure } : {}),
        ...(latestStory?.language ? { language: latestStory.language } : {})
      };
      try {
        const result = await this.bootstrapAutonomousCampaign(brief, actor);
        if (result.status !== "READY_FOR_AUTONOMOUS_EXECUTION") {
          failures.set(campaign.id, String(result.blockers?.[0]?.code || result.code || "BOOTSTRAP_RENEWAL_BLOCKED"));
        }
      } catch (error) {
        failures.set(campaign.id, boundedQueueFailureReason(error));
      }
    }
    return failures;
  }

  async queueDueCampaignJobs(actor = "scheduler") {
    await this.expireLiveExecutionGrants(actor);
    await this.expireOneTimeExecutionWindows(actor);
    await this.expireCampaignAuthorizations(actor);
    const renewalFailures = await this.#renewPersistedBootstrapCampaigns(actor);
    const candidateSnapshot = await this.store.read();
    const candidateFailures = new Map(renewalFailures);
    for (const campaign of candidateSnapshot.campaigns || []) {
      const activeAuthorizations = (candidateSnapshot.campaignAuthorizations || [])
        .filter((authorization) => authorization.campaignId === campaign.id && authorization.status === "active");
      const templateQueueSource = campaign.status === "active" && activeAuthorizations.length === 1 &&
        activeAuthorizations[0].executionMode === "standing_autonomous" &&
        activeAuthorizations[0].allowLiveExecution === true &&
        activeAuthorizations[0].contentBoundary?.mode === "approved_template_set" &&
        (activeAuthorizations[0].contentBoundary?.storyPolicy ||
          (candidateSnapshot.stories || []).some((story) => story.campaignId === campaign.id));
      if ((campaign.contentCandidates || []).some((candidate) => candidate.status === "draft") || templateQueueSource) {
        try {
          await this.materializeAuthorizedContentCandidates(campaign.id, actor);
        } catch (error) {
          candidateFailures.set(campaign.id, boundedQueueFailureReason(error));
        }
      }
    }
    const state = await this.store.read();
    const now = Date.now();
    const campaignIds = [...new Set(state.posts
      .filter((post) => post.campaignAuthorizationId)
      .filter((post) => {
        if (["blocked", "draft"].includes(post.status)) {
          if (post.readinessState === "HUMAN_REQUIRED") return false;
          if ((post.readinessAttempts || 0) === 0) return true;
          if (post.readinessRetryAt && Date.parse(post.readinessRetryAt) <= now && (post.readinessAttempts || 0) < this.maxReadinessAttempts) return true;
          const target = state.targets.find((item) => item.id === post.targetId);
          const readinessContext = target && { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id };
          if (post.readinessState === "READY" && target && !isReadinessFresh(target.readiness, readinessContext, new Date(now), this.readinessTtlMs)) return true;
          const previousReasons = post.authorizationDecision?.reasons || [];
          if (post.readinessState === "READY" && previousReasons.some((reason) => DYNAMIC_EXECUTION_REASONS.has(reason))) {
            const currentReasons = evaluateCampaignAuthorization(post, state, new Date(now)).reasons;
            if (previousReasons.some((reason) => DYNAMIC_EXECUTION_REASONS.has(reason) && !currentReasons.includes(reason))) return true;
          }
          return false;
        }
        if (post.status !== "queued") return false;
        const authorization = state.campaignAuthorizations?.find((item) => item.id === post.campaignAuthorizationId);
        if (authorization?.executionMode === "standing_autonomous" && !post.executionState) return true;
        const latestExecution = (state.executionRequests || []).filter((item) => item.jobId === post.id).sort((a, b) => b.attempt - a.attempt)[0];
        if (latestExecution?.state === "FAILED" && latestExecution.recoveryClassification === "RECOVERABLE" && latestExecution.submitState === "FAILED" && latestExecution.attempt < 3) return true;
        if (post.executionState !== "REQUEST_READY") return false;
        const target = state.targets.find((item) => item.id === post.targetId);
        return !target || !isReadinessFresh(target.readiness, {
          platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id
        }, new Date(now), this.readinessTtlMs);
      })
      .map((post) => post.campaignId))];
    for (const campaignId of candidateFailures.keys()) {
      if (!campaignIds.includes(campaignId)) campaignIds.push(campaignId);
    }
    const results = [];
    for (const campaignId of campaignIds) {
      try {
        const decisions = await this.queueAuthorizedCampaignJobs(campaignId, actor);
        const failureReason = candidateFailures.get(campaignId);
        results.push(failureReason
          ? { campaignId, decisions, failed: true, reason: failureReason }
          : { campaignId, decisions });
      } catch (error) {
        results.push({ campaignId, decisions: [], failed: true, reason: boundedQueueFailureReason(error) });
      }
    }
    return results;
  }

  async refreshCampaignJobReadiness(postId, actor = "scheduler", { force = false, executionId = null } = {}) {
    if (this.readinessInFlight.has(postId)) return { postId, status: "blocked", readinessState: "READINESS_CHECKING", reasons: ["readiness_check_in_progress"] };
    this.readinessInFlight.add(postId);
    try {
      const snapshot = await this.store.read();
      const post = requireItem(snapshot.posts, postId, "Post");
      const target = requireItem(snapshot.targets, post.targetId, "Target");
      if (!post.campaignAuthorizationId) return { postId, status: post.status, readinessState: "NOT_REQUIRED", reasons: ["campaign_authorization_missing"] };
      const account = (snapshot.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
      const priorProfileMissingGate = [...(post.jobLifecycle || [])].reverse().find((item) => item.state === "HUMAN_REQUIRED");
      const profileBindingRecovery = target.channel === "linkedin" && priorProfileMissingGate?.reasonCode === "expected_profile_missing" &&
        isCanonicalOrcaProfileId(target.profileId) && target.profileId === account?.profileId &&
        Number.isFinite(Date.parse(account?.lastReadinessAt || "")) &&
        Math.abs(Date.parse(account.lastReadinessAt) - Date.parse(priorProfileMissingGate.at || "")) <= 10_000;
      const authenticationDetectionRecheck = force && target.channel === "linkedin" &&
        post.readinessState === "HUMAN_REQUIRED" && post.readinessReasonCode === "authentication_required" &&
        isCanonicalOrcaProfileId(target.profileId) && target.profileId === account?.profileId && account?.status === "enabled";
      const canRecheckHumanRequired = profileBindingRecovery || authenticationDetectionRecheck;
      if (post.readinessState === "HUMAN_REQUIRED" && !canRecheckHumanRequired) {
        return { postId, status: post.status, readinessState: "HUMAN_REQUIRED", reasons: [post.readinessReasonCode || "human_required"] };
      }
      if (account?.health === "human_required" && !canRecheckHumanRequired) {
        return { postId, status: post.status, readinessState: "HUMAN_REQUIRED", reasons: ["account_requires_human_intervention"] };
      }
      if (!account || account.status !== "enabled" || target.profileId !== account.profileId) {
        return this.#persistReadinessOutcome(postId, {
          state: "HUMAN_REQUIRED", checkedAt: nowIso(), reasonCode: "account_profile_binding_missing", retryable: false, recoveryClassification: "HUMAN_REQUIRED"
        }, actor, { attempt: post.readinessAttempts || 0, skipProvider: true, executionId });
      }
      const authorizationCheck = evaluateCampaignAuthorization(post, snapshot, new Date(), { executionId });
      const readinessBlockingReasons = authorizationCheck.reasons.filter((reason) => !READINESS_IGNORED_EXECUTION_REASONS.has(reason));
      if (readinessBlockingReasons.length) {
        return this.#persistReadinessOutcome(postId, {
          state: "BLOCKED", checkedAt: nowIso(), reasonCode: readinessBlockingReasons[0], retryable: false, recoveryClassification: "NONE"
        }, actor, { attempt: post.readinessAttempts || 0, skipProvider: true, executionId });
      }
      if (!force && post.readinessRetryAt && Date.parse(post.readinessRetryAt) > Date.now()) {
        return { postId, status: post.status, readinessState: post.readinessState, reasons: ["readiness_retry_wait"], retryAt: post.readinessRetryAt };
      }
      if (!force && post.readinessAttempts > 0 && ["UNKNOWN", "BLOCKED"].includes(post.readinessState) && !post.readinessRetryAt) {
        return { postId, status: post.status, readinessState: post.readinessState, reasons: [post.readinessReasonCode || post.readinessState.toLowerCase()] };
      }
      const context = {
        jobId: post.id, campaignId: post.campaignId, platform: target.channel,
        accountId: target.accountId, profileId: target.profileId, targetId: target.id,
        targetUrl: target.url, identityReference: executionAccountIdentityReference(account)
      };
      if (!force && isReadinessFresh(target.readiness, context, new Date(), this.readinessTtlMs)) {
        const readiness = normalizeReadinessResult({
          state: "READY", checkedAt: target.readiness.checkedAt, expiresAt: target.readiness.expiresAt,
          reasonCode: target.readiness.reasonCode, capabilities: target.readiness.capabilities,
          evidenceReference: target.readiness.evidence, retryable: false, recoveryClassification: "NONE"
        }, context, { ttlMs: this.readinessTtlMs });
        return this.#persistReadinessOutcome(postId, readiness, actor, { attempt: post.readinessAttempts || 0, alreadyFresh: true, executionId });
      }
      if (!force && post.readinessState === "HUMAN_REQUIRED" && !profileBindingRecovery) return { postId, status: post.status, readinessState: "HUMAN_REQUIRED", reasons: [post.readinessReasonCode || "human_required"] };
      if (!force && post.readinessState === "UNKNOWN" && !post.readinessRetryAt) return { postId, status: post.status, readinessState: "UNKNOWN", reasons: [post.readinessReasonCode || "readiness_unknown"] };
      const priorAttempts = Number(post.readinessAttempts || 0);
      if (!force && priorAttempts >= this.maxReadinessAttempts) {
        return this.#persistReadinessOutcome(postId, {
          state: "UNKNOWN", checkedAt: nowIso(), reasonCode: "readiness_attempts_exhausted", retryable: false, recoveryClassification: "UNKNOWN"
        }, actor, { attempt: priorAttempts, skipProvider: true, executionId });
      }

      const attempt = priorAttempts + 1;
      await this.store.mutate(actor, "job_readiness_checking", (state) => {
        const current = requireItem(state.posts, postId, "Post");
        current.readinessState = "READINESS_CHECKING";
        current.readinessAttempts = attempt;
        current.readinessReasonCode = null;
        current.readinessRetryAt = null;
        current.status = "blocked";
        current.blockedAt ||= nowIso();
        current.jobLifecycle ||= [{ state: "CREATED", at: current.createdAt || nowIso() }];
        if (current.jobLifecycle.at(-1)?.state !== "READINESS_CHECKING") current.jobLifecycle.push({ state: "READINESS_CHECKING", at: nowIso(), attempt });
      });

      const provider = this.readinessProviders.resolve(target.channel);
      let providerResult;
      if (!provider || typeof provider.checkReadiness !== "function") {
        providerResult = { state: "BLOCKED", reasonCode: "readiness_provider_not_registered", retryable: false, recoveryClassification: "NONE" };
      } else {
        try {
          providerResult = await Promise.race([
            provider.checkReadiness(context),
            new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Readiness provider timed out"), { code: "PROVIDER_TIMEOUT" })), this.readinessTimeoutMs))
          ]);
        } catch (error) {
          providerResult = classifyReadinessError(error);
        }
      }
      let readiness;
      try {
        readiness = normalizeReadinessResult(providerResult, context, { ttlMs: this.readinessTtlMs });
      } catch {
        readiness = normalizeReadinessResult({ state: "UNKNOWN", reasonCode: "invalid_provider_result", retryable: false, recoveryClassification: "UNKNOWN" }, context, { ttlMs: this.readinessTtlMs });
      }
      return this.#persistReadinessOutcome(postId, readiness, actor, { attempt, executionId });
    } finally {
      this.readinessInFlight.delete(postId);
    }
  }

  async #persistReadinessOutcome(postId, readiness, actor, { attempt = 0, skipProvider = false, alreadyFresh = false, executionId = null } = {}) {
    const result = await this.store.mutate(actor, "job_readiness_result_recorded", (state) => {
      const post = requireItem(state.posts, postId, "Post");
      const target = requireItem(state.targets, post.targetId, "Target");
      const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
      const context = { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id };
      const stateName = String(readiness.state).toUpperCase();
      const readinessAt = readiness.checkedAt || nowIso();
      const capabilities = readiness.capabilities || {};
      const checks = {
        sessionValid: capabilities.sessionAuthenticated === true,
        composerCapable: capabilities.composerAvailable === true,
        platformAvailable: capabilities.feedReachable === true
      };
      if (!skipProvider) {
        target.readiness = normalizeTargetReadiness({
          state: stateName === "READY" ? "ready" : "blocked",
          checkedAt: readinessAt,
          expiresAt: readiness.expiresAt,
          reasonCode: String(readiness.reasonCode || stateName.toLowerCase()).replace(/[^a-z0-9_]/g, "_").slice(0, 64) || "unknown",
          summary: stateName === "READY" ? "Readiness verified for the bound execution profile" : "Readiness is blocked or requires recovery",
          evidence: readiness.evidenceReference,
          capabilities,
          checks,
          binding: readiness.binding,
          outcome: stateName,
          retryable: readiness.retryable,
          recoveryClassification: readiness.recoveryClassification
        }, target.status, context, this.readinessTtlMs);
        if (account) {
          account.lastReadinessAt = readinessAt;
          account.health = stateName === "READY" ? "healthy" : stateName === "HUMAN_REQUIRED" ? "human_required" : stateName === "BLOCKED" ? "blocked" : "error";
          account.updatedAt = nowIso();
        }
      }
      post.readinessState = stateName;
      post.readinessReasonCode = readiness.reasonCode;
      // Readiness attempts are a bounded retry budget for consecutive
      // provider failures.  A successful observation starts a new freshness
      // epoch; carrying failures from older READY epochs eventually blocks a
      // healthy target even though the provider is currently available.
      post.readinessAttempts = stateName === "READY"
        ? 0
        : Math.max(Number(post.readinessAttempts || 0), attempt);
      post.readinessRetryAt = null;
      if (stateName !== "READY") {
        const retryAllowed = readiness.retryable === true && post.readinessAttempts < this.maxReadinessAttempts;
        if (retryAllowed) {
          const delay = Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, post.readinessAttempts - 1)));
          post.readinessRetryAt = new Date(Date.now() + delay).toISOString();
        }
        post.status = "blocked";
        post.blockedAt = nowIso();
        post.authorizationDecision = { evaluatedAt: nowIso(), allowed: false, reasons: [readiness.reasonCode || "readiness_not_ready"] };
        if (post.jobLifecycle?.at(-1)?.state !== stateName) post.jobLifecycle?.push({ state: stateName, at: nowIso(), reasonCode: readiness.reasonCode });
        return { postId, status: post.status, readinessState: stateName, reasons: post.authorizationDecision.reasons, retryAt: post.readinessRetryAt, skipProvider, alreadyFresh };
      }
      const decision = evaluateQueue(post, state, new Date(), { executionId });
      post.authorizationDecision = { evaluatedAt: nowIso(), allowed: decision.allowed, reasons: decision.reasons };
      if (decision.allowed) {
        const at = nowIso();
        post.status = "queued";
        post.queuedAt = at;
        post.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
        post.jobLifecycle ||= [{ state: "CREATED", at: post.createdAt || at }];
        post.jobLifecycle.push({ state: "READY", at }, { state: "QUEUED", at });
        delete post.blockedAt;
      } else {
        post.status = "blocked";
        post.blockedAt ||= nowIso();
      }
      return { postId, status: post.status, readinessState: stateName, reasons: decision.reasons, skipProvider, alreadyFresh };
    });
    return result.result;
  }

  async prepareExecutionRequest(postId, actor = "execution-router", { dryRun = false, forceNewLiveExecution = false } = {}) {
    let snapshot = await this.store.read();
    const post = requireItem(snapshot.posts, postId, "Post");
    const authorizationForDelegation = (snapshot.campaignAuthorizations || []).find((item) => item.id === post.campaignAuthorizationId);
    if (forceNewLiveExecution && (dryRun || authorizationForDelegation?.executionMode !== "standing_autonomous")) {
      throw new Error("Forced live renewal requires standing autonomous authorization");
    }
    if (!dryRun && authorizationForDelegation?.executionMode === "standing_autonomous") {
      await this.ensureStandingExecutionWindow(postId, "execution-router");
      snapshot = await this.store.read();
    }
    if (unresolvedSubmission(snapshot, post)) throw new Error("SUBMISSION_UNCERTAIN: job or publication identity is quarantined");
    const pendingRequests = (snapshot.executionRequests || [])
      .filter((item) => item.jobId === postId && item.request?.dryRun !== true &&
        item.state === "REQUEST_READY" && item.submitState === "NOT_STARTED")
      .sort((a, b) => (Number(b.attempt) || 0) - (Number(a.attempt) || 0));
    // A scheduler tick may have left a newer pre-submit row behind while an
    // earlier row still owns the only valid standing window/grant. Prefer the
    // exact row with usable controls so a readiness refresh updates it in
    // place. This preserves the execution identity and prevents a second
    // request from shadowing the authorized one.
    const usablePending = pendingRequests.find((item) => {
      const request = item.request || {};
      const grantId = request.liveGrant?.grantId;
      const grant = grantId ? (snapshot.liveExecutionGrants || []).find((candidate) => candidate.grantId === grantId) : null;
      if (!grant || liveGrantEffectiveStatus(grant) !== "ACTIVE" || grant.boundExecutionId !== item.executionId) return false;
      const windowId = request.oneTimeWindow?.windowId;
      if (windowId) {
        const window = (snapshot.oneTimeExecutionWindows || []).find((candidate) => candidate.windowId === windowId);
        if (!window || !['ACTIVE', 'RESERVED'].includes(oneTimeExecutionWindowStatus(window, new Date())) ||
            !oneTimeExecutionWindowInBounds(window, new Date()) ||
            (window.status === "RESERVED" && window.reservedExecutionId !== item.executionId)) return false;
      }
      try { assertLiveGrantMatchesExecution(grant, request, authorizationForDelegation, new Date(), { checkWindow: false }); return true; }
      catch { return false; }
    });
    const previous = usablePending || (snapshot.executionRequests || []).filter((item) => item.jobId === postId)
      .sort((a, b) => (Number(b.attempt) || 0) - (Number(a.attempt) || 0))[0];
    const operator = ["operator", "local-human-operator"].includes(actor);
    const resumingOwnedDryRun = String(actor).startsWith("jev-worker:") && previous?.request?.dryRun === true && previous.state === "REQUEST_READY";
    const rehearsalScheduler = actor === "dry-run-handoff-scheduler";
    if (dryRun && !operator && !resumingOwnedDryRun && !rehearsalScheduler) throw new Error("Dry-run execution requests require an operator");
    const priorSubmitted = (snapshot.executionRequests || []).filter((item) => item.jobId === postId && ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state)).sort((a, b) => b.attempt - a.attempt)[0];
    if (priorSubmitted) return priorSubmitted;
    if (previous && ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(previous.state)) return previous;
    const target = requireItem(snapshot.targets, post.targetId, "Target");
    const account = (snapshot.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
    const authorization = (snapshot.campaignAuthorizations || []).find((item) => item.id === post.campaignAuthorizationId);
    post.idempotencyKey ||= publicationIdentityKey({ campaignId: post.campaignId, contentId: post.contentId, platform: target.channel, accountId: target.accountId, targetId: target.id });
    const readinessContext = { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id };
    if (dryRun) {
      if (["published", "publishing", "processing", UNKNOWN_POST_STATUS, "removed", "rejected"].includes(post.status)) throw new Error("Dry-run cannot use a published or actively executing job");
    } else if (post.status !== "queued") {
      throw new Error("Execution request requires a queued job");
    }
    if (post.readinessState !== "READY" || !isReadinessFresh(target.readiness, readinessContext, new Date(), this.readinessTtlMs)) {
      throw new Error("Execution request requires fresh bound READY readiness");
    }
    if (!account || account.status !== "enabled" || account.health !== "healthy" || account.profileId !== target.profileId) {
      throw new Error("Execution request requires the registered healthy account/profile binding");
    }
    const eligibility = evaluateQueue(post, snapshot, new Date(), { mode: dryRun ? "dry_run" : "live", executionId: previous?.executionId || null });
    if (!eligibility.allowed) throw new Error(`Execution request blocked: ${eligibility.reasons.join(", ")}`);
    if (!dryRun && !forceNewLiveExecution && previous?.state === "REQUEST_READY" && previous.submitState === "NOT_STARTED" && authorization?.executionMode === "standing_autonomous") {
      const currentWindow = eligibility.oneTimeWindow;
      const currentGrant = (snapshot.liveExecutionGrants || []).find((item) => item.grantId === previous.request?.liveGrant?.grantId);
      const previousControlsCurrent = previous.request?.executionId === previous.executionId &&
        previous.request?.oneTimeWindow?.windowId === currentWindow?.windowId &&
        previous.request?.liveGrant?.grantId === currentGrant?.grantId &&
        currentGrant && liveGrantEffectiveStatus(currentGrant) === "ACTIVE" &&
        currentGrant.boundExecutionId === previous.executionId;
      if (!previousControlsCurrent) forceNewLiveExecution = true;
    }
    if (!dryRun && !forceNewLiveExecution && previous?.state !== "CANCELLED_PRE_SUBMIT" && previous?.request?.oneTimeWindow?.windowId && previous?.request?.authorization?.authorizationId === authorization?.id && eligibility.oneTimeWindow?.windowId !== previous.request.oneTimeWindow.windowId) {
      throw new Error("Execution request's reserved one-time window is no longer valid");
    }
    if (!authorization) throw new Error("Execution request requires a campaign authorization");
    if (dryRun && (snapshot.executionLeases || []).some((item) => Date.parse(item.expiresAt) > Date.now() && item.profileKey === `${target.channel}:${target.profileId}` && !(item.executionId === previous?.executionId && actor === `jev-worker:${item.workerId}`))) {
      throw new Error("Dry-run profile is already leased by another execution");
    }
    if (dryRun && previous && previous.request?.dryRun !== true && previous.state === "REQUEST_READY") {
      throw new Error("A live execution request already owns this job");
    }
    const artifact = post.artifactId ? requireItem(snapshot.artifacts || [], post.artifactId, "Artifact") : null;
    const result = await this.store.mutate(actor, "execution_request_prepared", (state) => {
      if (unresolvedSubmission(state, requireItem(state.posts, postId, "Post"))) throw new Error("SUBMISSION_UNCERTAIN: job or publication identity is quarantined");
      state.executionRequests ||= [];
      const currentPost = requireItem(state.posts, postId, "Post");
      const currentAuthorization = requireItem(state.campaignAuthorizations || [], currentPost.campaignAuthorizationId, "Campaign authorization");
      const pendingRequests = state.executionRequests
        .filter((item) => item.jobId === postId && item.request?.dryRun !== true &&
          item.state === "REQUEST_READY" && item.submitState === "NOT_STARTED")
        .sort((a, b) => (Number(b.attempt) || 0) - (Number(a.attempt) || 0));
      const usablePending = pendingRequests.find((item) => {
        const request = item.request || {};
        const grantId = request.liveGrant?.grantId;
        const grant = grantId ? (state.liveExecutionGrants || []).find((candidate) => candidate.grantId === grantId) : null;
        if (!grant || liveGrantEffectiveStatus(grant) !== "ACTIVE" || grant.boundExecutionId !== item.executionId) return false;
        const windowId = request.oneTimeWindow?.windowId;
        if (windowId) {
          const window = (state.oneTimeExecutionWindows || []).find((candidate) => candidate.windowId === windowId);
          if (!window || !["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(window, new Date())) ||
              !oneTimeExecutionWindowInBounds(window, new Date()) ||
              (window.status === "RESERVED" && window.reservedExecutionId !== item.executionId)) return false;
        }
        try {
          return assertLiveGrantMatchesExecution(grant, request, currentAuthorization, new Date(), { checkWindow: false });
        } catch {
          return false;
        }
      });
      // A newer pre-submit row without usable standing controls must never
      // shadow the exact row that owns the active one-time window and grant.
      // Re-select from the transaction snapshot so concurrent scheduler ticks
      // cannot create a second live execution identity.
      const previous = usablePending || state.executionRequests.filter((item) => item.jobId === postId)
        .sort((a, b) => (Number(b.attempt) || 0) - (Number(a.attempt) || 0))[0];
      const provenFailedPrevious = previous?.state === "PROVEN_FAILED" && (state.submissionUncertainties || []).some((item) => item.jobId === postId && item.executionId === previous.executionId && item.status === "PROVEN_FAILED");
      if (previous && ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(previous.state)) return previous;
      if (previous && ["DRY_RUN_COMPLETE", "DRY_RUN_FAILED"].includes(previous.state) && (!dryRun || previous.submitState !== "NOT_STARTED")) {
        // A completed no-submit record may be followed by a separately requested
        // live attempt only through normal live eligibility; it is never reused.
      } else if (previous && !["CANCELLED_PRE_SUBMIT", "DRY_RUN_COMPLETE", "DRY_RUN_FAILED"].includes(previous.state) && !provenFailedPrevious && !isSafePreSubmitFailureForRenewal(state, postId, previous) && !(previous.state === "FAILED" && previous.recoveryClassification === "RECOVERABLE" && previous.submitState === "FAILED" && previous.attempt < 3)) {
        if (previous.state !== "REQUEST_READY" && !(dryRun && ["DRY_RUN_COMPLETE", "DRY_RUN_FAILED"].includes(previous.state))) throw new Error("Execution cannot be redispatched after SUBMIT_SENT or an unresolved result");
        if (Boolean(previous.request?.dryRun) !== dryRun) throw new Error("Execution request mode cannot be changed after creation");
      }
      const reusePrevious = !forceNewLiveExecution && previous?.state === "REQUEST_READY" && Boolean(previous.request?.dryRun) === dryRun && (dryRun || previous.request?.authorization?.authorizationId === authorization.id);
      const executionId = reusePrevious ? previous.executionId : randomUUID();
      const attempt = reusePrevious ? previous.attempt : (previous?.attempt || 0) + 1;
      const currentEligibility = evaluateQueue(currentPost, state, new Date(), { mode: dryRun ? "dry_run" : "live", executionId });
      if (!currentEligibility.allowed) throw new Error(`Execution request blocked: ${currentEligibility.reasons.join(", ")}`);
      const oneTimeWindow = dryRun ? null : currentEligibility.oneTimeWindow;
      if (!dryRun && !forceNewLiveExecution && previous?.state !== "CANCELLED_PRE_SUBMIT" && previous?.request?.oneTimeWindow?.windowId && previous?.request?.authorization?.authorizationId === currentAuthorization.id && oneTimeWindow?.windowId !== previous.request.oneTimeWindow.windowId) {
        throw new Error("Execution request's reserved one-time window is no longer valid");
      }
      const matchingGrants = dryRun ? [] : (state.liveExecutionGrants || []).filter((item) => item.jobId === postId && liveGrantEffectiveStatus(item) === "ACTIVE" && (!item.boundExecutionId || item.boundExecutionId === executionId));
      if (matchingGrants.length > 1) throw new Error("Multiple active live grants match this job");
      const liveGrant = matchingGrants[0] || null;
      const request = createExecutionRequestV1({
        executionId, post, target, account, authorization, readiness: target.readiness, artifact, liveGrant,
        oneTimeWindowId: oneTimeWindow?.windowId || null, dryRun, createdAt: nowIso()
      });
      if (liveGrant) {
        liveGrant.boundExecutionId ||= executionId;
        assertLiveGrantMatchesExecution(liveGrant, request, currentAuthorization, new Date(), { checkWindow: false });
      }
      if (reusePrevious && previous.submitState === "NOT_STARTED") {
        if (oneTimeWindow) {
          const currentWindow = (state.oneTimeExecutionWindows || []).find((item) => item.windowId === oneTimeWindow.windowId);
          if (currentWindow?.status === "ACTIVE") {
            currentWindow.status = "RESERVED";
            currentWindow.reservedExecutionId = executionId;
            currentWindow.reservedAt = request.createdAt;
          } else {
            assertWindowExecutionBinding(currentWindow, executionId, "RESERVED");
          }
        }
        previous.request = request;
        previous.liveGrantId = liveGrant?.grantId || null;
        previous.lastRefreshedAt = request.createdAt;
        return previous;
      }
      const row = {
        executionId, jobId: post.id, campaignId: post.campaignId, attempt,
        state: "REQUEST_READY", submitState: "NOT_STARTED", recoveryClassification: "NONE",
        request, dryRun, liveGrantId: liveGrant?.grantId || null, createdAt: request.createdAt, dispatchedAt: null
      };
      if (oneTimeWindow) {
        const currentWindow = (state.oneTimeExecutionWindows || []).find((item) => item.windowId === oneTimeWindow.windowId);
        if (currentWindow?.status !== "ACTIVE") throw new Error("One-time execution window was reserved by another execution");
        if (currentWindow.binding !== oneTimeExecutionWindowFingerprint(currentWindow) || currentWindow.authorizationFingerprint !== campaignAuthorizationFingerprint(currentAuthorization)) {
          throw new Error("One-time execution window authorization binding is stale");
        }
        currentWindow.status = "RESERVED";
        currentWindow.reservedExecutionId = executionId;
        currentWindow.reservedAt = request.createdAt;
      }
      state.executionRequests.push(row);
      if (!dryRun) {
        const current = requireItem(state.posts, postId, "Post");
        current.idempotencyKey ||= post.idempotencyKey;
        current.executionState = "REQUEST_READY";
        current.executionId = executionId;
        current.jobLifecycle ||= [{ state: "CREATED", at: current.createdAt || row.createdAt }];
        current.jobLifecycle.push({ state: "EXECUTION_REQUEST_READY", at: row.createdAt, executionId });
      }
      return row;
    });
    return result.result;
  }

  async cancelExecutionRequest(executionId, input, actor = "operator") {
    if (!["operator", "local-human-operator"].includes(actor)) throw new Error("Only an operator may cancel an execution request");
    const reason = String(input?.reason || "").trim();
    const operatorAuthorizationReference = String(input?.operatorAuthorizationReference || "").trim();
    if (!reason || reason.length > 500) throw new Error("A cancellation reason of 1 to 500 characters is required");
    if (!operatorAuthorizationReference || operatorAuthorizationReference.length > 200) throw new Error("An operator authorization reference of 1 to 200 characters is required");
    const result = await this.store.mutate(actor, "execution_request_cancelled_pre_submit", (state) => {
      const request = (state.executionRequests || []).find((item) => item.executionId === executionId);
      if (!request) throw new Error(`Execution request not found: ${executionId}`);
      if (request.state === "CANCELLED_PRE_SUBMIT") return request;
      if (request.state !== "REQUEST_READY" || request.submitState !== "NOT_STARTED") throw new Error("Only a REQUEST_READY execution with NOT_STARTED submit state can be cancelled");
      const post = requireItem(state.posts, request.jobId, "Post");
      if (request.executionPhase === "EXECUTING" || request.executionStartedAt || activeExecutionForPost(state, request.jobId)) throw new Error("Execution worker ownership has already started");
      if (["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(request.state) ||
          (state.executionRequests || []).some((item) => item.executionId !== executionId && item.jobId === request.jobId && item.request?.idempotencyKey === request.request?.idempotencyKey && (["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state) || ["SUBMIT_SENT", "UNKNOWN", "CONFIRMED"].includes(item.submitState))) ||
          (state.executionReceipts || []).some((item) => (item.executionId === executionId || item.jobId === request.jobId) && ["SUBMIT_SENT", "UNKNOWN", "CONFIRMED"].includes(item.receipt?.submitState)) ||
          (state.publicationAttempts || []).some((item) => item.executionId === executionId || (item.id === post.publicationAttemptId && item.postId === post.id)) ||
          ["published", "publishing", "processing", "submit_result_unknown"].includes(String(post.status || "").toLowerCase()) || post.publicationUrl || unresolvedSubmission(state, post, request.request?.idempotencyKey)) {
        throw new Error("Possible or confirmed submission history prevents pre-submit cancellation");
      }
      const now = nowIso();
      if ((state.executionLeases || []).some((item) => (item.executionId === executionId || item.jobId === request.jobId) && Date.parse(item.expiresAt) > Date.now())) {
        throw new Error("An active execution lease prevents cancellation");
      }
      const grants = (state.liveExecutionGrants || []).filter((item) => item.grantId === request.liveGrantId || item.grantId === request.request?.liveGrant?.grantId || item.jobId === request.jobId);
      if (grants.some((grant) => liveGrantEffectiveStatus(grant) === "CONSUMED" || grant.status === "CONSUMED")) {
        throw new Error("A consumed LiveExecutionGrant prevents pre-submit cancellation");
      }
      for (const grant of grants) {
        const effectiveStatus = liveGrantEffectiveStatus(grant);
        if (effectiveStatus !== "ACTIVE") continue;
        if (grant.boundExecutionId && grant.boundExecutionId !== executionId) throw new Error("An active LiveExecutionGrant is bound to another execution");
      }
      const windowId = request.request?.oneTimeWindow?.windowId;
      const window = windowId ? (state.oneTimeExecutionWindows || []).find((item) => item.windowId === windowId) : null;
      if (window && window.status === "RESERVED" && window.reservedExecutionId !== executionId) throw new Error("Reserved one-time window is owned by another execution");

      // Revoke any still-usable grant for this job atomically with terminalizing
      // the request, so it cannot be rebound by a later request.
      for (const grant of grants) {
        if (liveGrantEffectiveStatus(grant) !== "ACTIVE") continue;
        grant.status = "REVOKED";
        grant.revokedAt = now;
        grant.revokedBy = actor;
        grant.revocationReason = "execution_cancelled_pre_submit";
      }
      // A cancelled request never returns its one-time window to the pool.
      if (window && ["ACTIVE", "RESERVED"].includes(window.status)) {
        window.status = "REVOKED";
        window.revokedAt = now;
        window.revokedBy = actor;
        window.revocationReason = "execution_cancelled_pre_submit";
      }
      request.state = "CANCELLED_PRE_SUBMIT";
      request.executionPhase = "CANCELLED_PRE_SUBMIT";
      request.cancelledAt = now;
      request.cancelledBy = actor;
      request.cancellationReason = reason;
      request.operatorAuthorizationReference = operatorAuthorizationReference;
      post.executionState = "CANCELLED_PRE_SUBMIT";
      post.jobLifecycle ||= [];
      post.jobLifecycle.push({ state: "CANCELLED_PRE_SUBMIT", at: now, executionId, reason, operatorAuthorizationReference });
      return request;
    });
    return result.result;
  }

  async readyExecutionRequests() {
    const state = await this.store.read();
    return (state.executionRequests || []).filter((item) => {
      if (item.state !== "REQUEST_READY" || item.submitState !== "NOT_STARTED") return false;
      if (item.request?.dryRun === true) return false;
      const post = state.posts.find((candidate) => candidate.id === item.jobId);
      const target = state.targets.find((candidate) => candidate.id === post?.targetId);
      if (!post || post.status !== "queued" || !target) return false;
      if (unresolvedSubmission(state, post, item.request?.idempotencyKey)) return false;
      const account = (state.executionAccounts || []).find((candidate) => candidate.id === executionAccountKey(target.channel, target.accountId));
      if (!account || account.status !== "enabled" || account.health !== "healthy" || account.profileId !== target.profileId) return false;
      const grant = (state.liveExecutionGrants || []).find((candidate) => candidate.grantId === item.request?.liveGrant?.grantId);
      const authorization = (state.campaignAuthorizations || []).find((candidate) => candidate.id === post.campaignAuthorizationId);
      try { assertLiveGrantMatchesExecution(grant, item.request, authorization); } catch { return false; }
      if (authorization?.executionMode === "standing_autonomous") {
        const window = (state.oneTimeExecutionWindows || []).find((candidate) => candidate.windowId === item.request.oneTimeWindow?.windowId);
        const delegated = deriveStandingExecutionControlPlan({ authorization, state, post, target, account, executionId: item.executionId, oneTimeWindow: window, liveGrant: grant });
        if (!delegated.allowed) return false;
      }
      if (item.request?.oneTimeWindow?.windowId) {
        const window = (state.oneTimeExecutionWindows || []).find((candidate) => candidate.windowId === item.request.oneTimeWindow.windowId);
        if (!window || window.status !== "RESERVED" || window.reservedExecutionId !== item.executionId ||
            oneTimeExecutionWindowStatus(window) !== "RESERVED" || !oneTimeExecutionWindowInBounds(window) || window.authorizationFingerprint !== campaignAuthorizationFingerprint(authorization) ||
            window.binding !== oneTimeExecutionWindowFingerprint(window)) return false;
      }
      const binding = { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id };
      return isReadinessFresh(target.readiness, binding, new Date(), this.readinessTtlMs) && evaluateQueue(post, state, new Date(), { executionId: item.executionId }).allowed;
    });
  }

  /**
   * Return only explicitly-created dry-run requests that are safe to rehearse.
   * This intentionally has no live grant/window checks and is separate from
   * readyExecutionRequests(), whose contract is live dispatch only.
   */
  async readyDryRunExecutionRequests() {
    const state = await this.store.read();
    return (state.executionRequests || []).filter((item) => {
      if (item.state !== "REQUEST_READY" || item.submitState !== "NOT_STARTED" || item.dryRun !== true || item.request?.dryRun !== true) return false;
      const post = (state.posts || []).find((candidate) => candidate.id === item.jobId);
      const target = (state.targets || []).find((candidate) => candidate.id === post?.targetId);
      if (!post || post.status !== "queued" || !target) return false;
      if (unresolvedSubmission(state, post, item.request?.idempotencyKey)) return false;
      const account = (state.executionAccounts || []).find((candidate) => candidate.id === executionAccountKey(target.channel, target.accountId));
      if (!account || account.status !== "enabled" || account.health !== "healthy" || account.profileId !== target.profileId || account.accountId !== target.accountId) return false;
      const decision = evaluateQueue(post, state, new Date(), { mode: "dry_run", executionId: item.executionId });
      if (!decision.allowed) return false;
      const binding = { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id };
      return isReadinessFresh(target.readiness, binding, new Date(), this.readinessTtlMs);
    });
  }

  async executionContext(executionId) {
    const state = await this.store.read();
    const requestRow = (state.executionRequests || []).find((item) => item.executionId === executionId);
    if (!requestRow) throw new Error(`Execution request not found: ${executionId}`);
    const post = requireItem(state.posts, requestRow.jobId, "Post");
    const target = requireItem(state.targets, post.targetId, "Target");
    const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
    const authorization = (state.campaignAuthorizations || []).find((item) => item.id === post.campaignAuthorizationId);
    const artifact = post.artifactId ? (state.artifacts || []).find((item) => item.id === post.artifactId) : null;
    const liveGrant = (state.liveExecutionGrants || []).find((item) => item.grantId === requestRow.request?.liveGrant?.grantId) || null;
    return { requestRow, request: requestRow.request, post, target, account, authorization, artifact, liveGrant, state };
  }

  async pendingExecutionReconciliations({ now = Date.now(), minIntervalMs = 60_000, maxAttempts = 10 } = {}) {
    const state = await this.store.read();
    return (state.executionRequests || []).filter((item) => ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN"].includes(item.state))
      .filter((item) => Number(item.reconciliationAttempts || 0) < maxAttempts)
      .filter((item) => !Number.isFinite(Date.parse(item.lastReconciliationAt || "")) || now - Date.parse(item.lastReconciliationAt) >= minIntervalMs);
  }

  async markExecutionReconciliationAttempt(executionId) {
    const result = await this.store.mutate("execution-reconciler", "execution_reconciliation_started", (state) => {
      const request = state.executionRequests.find((item) => item.executionId === executionId);
      if (!request || !["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN"].includes(request.state)) throw new Error("Execution is not awaiting reconciliation");
      request.lastReconciliationAt = nowIso();
      request.reconciliationAttempts = Number(request.reconciliationAttempts || 0) + 1;
      return request;
    });
    return result.result;
  }

  async acquireExecutionLease(executionId, workerId, { leaseMs = 60_000, mode = "execute" } = {}) {
    const owner = String(workerId || "").trim();
    if (!owner) throw new Error("workerId is required");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 10 * 60_000) throw new Error("leaseMs must be between 5000 and 600000");
    const context = await this.executionContext(executionId);
    if (!context.account?.profileId || context.account.profileId !== context.target.profileId) throw new Error("Execution profile binding is invalid");
    const at = Date.now();
    const lease = {
      id: randomUUID(), token: randomUUID(), executionId, jobId: context.post.id,
      platform: context.target.channel, accountId: context.target.accountId,
      profileId: context.account.profileId, profileKey: `${context.target.channel}:${context.account.profileId}`,
      workerId: owner, acquiredAt: new Date(at).toISOString(), expiresAt: new Date(at + leaseMs).toISOString()
    };
    const result = await this.store.mutate(owner, "execution_lease_acquired", (state) => {
      state.executionLeases ||= [];
      state.executionLeases = state.executionLeases.filter((item) => Date.parse(item.expiresAt) > at);
      const request = state.executionRequests.find((item) => item.executionId === executionId);
      const executable = request?.state === "REQUEST_READY" && request.submitState === "NOT_STARTED";
      const reconcilable = mode === "reconcile" && ["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN"].includes(request?.state);
      if (!executable && !reconcilable) return { acquired: false, reason: "execution_not_ready" };
      const conflict = state.executionLeases.find((item) => item.executionId === executionId || item.jobId === lease.jobId || item.profileKey === lease.profileKey);
      if (conflict) return { acquired: false, reason: "execution_lease_held" };
      state.executionLeases.push(lease);
      return { acquired: true, lease };
    });
    return result.result;
  }

  async renewExecutionLease(leaseId, token, { leaseMs = 60_000 } = {}) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 10 * 60_000) throw new Error("leaseMs must be between 5000 and 600000");
    const at = Date.now();
    const result = await this.store.mutate("execution-worker", "execution_lease_renewed", (state) => {
      const lease = state.executionLeases.find((item) => item.id === leaseId && item.token === token);
      if (!lease || Date.parse(lease.expiresAt) <= at) return false;
      lease.expiresAt = new Date(at + leaseMs).toISOString();
      lease.renewedAt = new Date(at).toISOString();
      return true;
    });
    return result.result;
  }

  async releaseExecutionLease(leaseId, token) {
    const result = await this.store.mutate("execution-worker", "execution_lease_released", (state) => {
      const index = state.executionLeases.findIndex((item) => item.id === leaseId && item.token === token);
      if (index < 0) return false;
      state.executionLeases.splice(index, 1);
      return true;
    });
    return result.result;
  }

  async markExecutionStarted(executionId, lease, { dryRun = false } = {}) {
    const result = await this.store.mutate("execution-worker", "execution_started", (state) => {
      const request = state.executionRequests.find((item) => item.executionId === executionId);
      const persistedLease = state.executionLeases.find((item) => item.id === lease.id && item.token === lease.token && Date.parse(item.expiresAt) > Date.now());
      if (!request || request.state !== "REQUEST_READY" || request.submitState !== "NOT_STARTED" || !persistedLease) throw new Error("Execution cannot start without a dispatchable request and active lease");
      if (dryRun) {
        if (request.request?.dryRun !== true) throw new Error("A non-dry-run request cannot use the policy-isolated dry-run path");
        request.lastDryRunAt = nowIso();
        return request;
      }
      const post = requireItem(state.posts, request.jobId, "Post");
      const killReasons = killSwitchReasons(post, state);
      if (killReasons.length) throw new Error(`Execution blocked before worker start: ${killReasons.join(", ")}`);
      const target = requireItem(state.targets, post.targetId, "Target");
      const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
      if (!account || account.status !== "enabled" || account.health !== "healthy" || account.profileId !== target.profileId) throw new Error("Execution account/profile health is not ready before worker start");
      if (!isReadinessFresh(target.readiness, { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id }, new Date(), this.readinessTtlMs)) throw new Error("Execution readiness is not fresh before worker start");
      if (request.request?.oneTimeWindow?.windowId) {
        const eligibility = evaluateQueue(post, state, new Date(), { executionId });
        if (!eligibility.allowed) throw new Error(`Execution blocked before worker start: ${eligibility.reasons.join(", ")}`);
        const window = (state.oneTimeExecutionWindows || []).find((item) => item.windowId === request.request.oneTimeWindow.windowId);
        const authorization = (state.campaignAuthorizations || []).find((item) => item.id === post.campaignAuthorizationId);
        const grant = (state.liveExecutionGrants || []).find((item) => item.grantId === request.request?.liveGrant?.grantId);
        if (authorization?.allowLiveExecution !== true) throw new Error("One-time window does not authorize live execution");
        assertLiveGrantMatchesExecution(grant, request.request, authorization);
        assertWindowExecutionBinding(window, executionId, "RESERVED");
        if (oneTimeExecutionWindowStatus(window, new Date()) !== "RESERVED" || !oneTimeExecutionWindowInBounds(window) || window.authorizationFingerprint !== campaignAuthorizationFingerprint(authorization)) {
          throw new Error("One-time execution window expired or authorization binding changed before worker start");
        }
        window.status = "CONSUMED";
        window.consumedExecutionId = executionId;
        window.consumedAt = nowIso();
      }
      request.executionPhase = "EXECUTING";
      request.executionStartedAt ||= nowIso();
      post.executionState = "EXECUTING";
      post.jobLifecycle ||= [{ state: "CREATED", at: post.createdAt || request.createdAt }];
      if (!post.jobLifecycle.some((item) => item.state === "EXECUTING" && item.executionId === executionId)) {
        post.jobLifecycle.push({ state: "EXECUTING", at: request.executionStartedAt, executionId });
      }
      return request;
    });
    return result.result;
  }

  async beginExecutionSubmitIntent(executionId, lease, { liveEnabled = false, liveExecutionId = null, autonomousLiveEnabled = false, exactLiveDispatchEnabled = false, verifiedGates = {}, requireTransportCertification = false, transportIdentity = null, transportCertification = null, preSubmitControlEvidence = null } = {}) {
    const reject = (reasonCode, gate, message) => {
      const error = Object.assign(new Error(message), { code: reasonCode });
      error.preSubmitFailure = { reasonCode, stage: "submit_boundary", gate, gateStatus: false };
      throw error;
    };
    const snapshot = await this.executionContext(executionId);
    const { request, post, target, account, authorization, artifact, liveGrant } = snapshot;
    const normalizedTransportIdentity = normalizeSubmitTransportIdentity(transportIdentity);
    const normalizedTransportCertification = normalizeTransportCertification(transportCertification);
    const normalizedPreSubmitControlEvidence = normalizeSubmitIntentEvidence(preSubmitControlEvidence);
    if (requireTransportCertification === true && !normalizedTransportIdentity) reject("TRANSPORT_NOT_CERTIFIED", "browserTransport", "A certified browser transport identity is required before live submit intent");
    if (requireTransportCertification === true && !normalizedTransportCertification) reject("TRANSPORT_NOT_CERTIFIED", "browserTransport", "Certified transport provenance is required before live submit intent");
    if (requireTransportCertification === true && !hasSubmitControlEvidence(normalizedPreSubmitControlEvidence)) {
      reject("SUBMIT_CONTROL_EVIDENCE_INVALID", "finalSubmitControl", "Durable submit intent requires actionable owned submit-control evidence");
    }
    const preIntentKillReasons = killSwitchReasons(post, snapshot.state);
    if (preIntentKillReasons.length) reject("KILL_SWITCH_BLOCKED", preIntentKillReasons[0], `Live submit blocked by global control: ${preIntentKillReasons.join(", ")}`);
    if (authorization?.executionMode === "standing_autonomous") {
      const window = (snapshot.state.oneTimeExecutionWindows || []).find((item) => item.windowId === request.oneTimeWindow?.windowId);
      const delegated = deriveStandingExecutionControlPlan({ authorization, state: snapshot.state, post, target, account, executionId, oneTimeWindow: window, liveGrant });
      if (!delegated.allowed) reject("STANDING_DELEGATION_INVALID", "authorizationValid", `Standing execution delegation blocked: ${delegated.reasons.join(", ")}`);
    }
    const expectedGates = ["authorizationValid", "readinessFresh", "accountMatch", "profileMatch", "targetMatch", "contentHashMatch", "mediaHashMatch", "audienceMatch", "composerConfirmed", "mediaPreviewConfirmed", "noDuplicateReceipt", "noExistingConfirmedPublication"];
    const failedGate = expectedGates.find((key) => verifiedGates[key] !== true);
    if (failedGate) {
      const readinessExpired = Number.isFinite(Date.parse(target?.readiness?.expiresAt || "")) && Date.parse(target.readiness.expiresAt) <= this.now().getTime();
      const reasonCode = failedGate === "readinessFresh" ? (readinessExpired ? "READINESS_EXPIRED" : "READINESS_NOT_READY")
        : failedGate === "authorizationValid" ? "AUTHORIZATION_INVALID"
          : failedGate === "mediaHashMatch" ? "ARTIFACT_INTEGRITY_FAILED"
            : failedGate === "mediaPreviewConfirmed" ? "MEDIA_PREVIEW_FAILED"
              : failedGate === "audienceMatch" ? "AUDIENCE_MISMATCH"
                : ["accountMatch", "profileMatch", "targetMatch"].includes(failedGate) ? "IDENTITY_MISMATCH"
                  : "OTHER_PLATFORM_PRE_SUBMIT_ERROR";
      reject(reasonCode, failedGate, "Pre-submit validation did not pass every required gate");
    }
    if (!liveEnabled || (liveExecutionId !== executionId && autonomousLiveEnabled !== true && exactLiveDispatchEnabled !== true) || authorization?.allowLiveExecution !== true) {
      reject("AUTHORIZATION_INVALID", "authorizationValid", "Live submit requires explicit worker mode and campaign authorization");
    }
    try { assertLiveGrantMatchesExecution(liveGrant, request, authorization); }
    catch (error) {
      error.code ||= "GRANT_INVALID";
      error.preSubmitFailure = { reasonCode: "GRANT_INVALID", stage: "submit_boundary", gate: "liveGrantValid", gateStatus: false };
      throw error;
    }
    if (request.content.sha256 !== createHash("sha256").update(post.content).digest("hex") || request.content.payload !== post.content) reject("CONTENT_MISMATCH", "contentHashMatch", "Execution content changed after request creation");
    if (request.audience !== post.audience || !authorization.audienceRules.allowedAudiences.includes(post.audience)) reject("AUDIENCE_MISMATCH", "audienceMatch", "Execution audience does not match authorized audience");
    if (request.publicationVisibility !== (post.publicationVisibility || "PUBLIC")) reject("TARGET_MISMATCH", "targetMatch", "Execution publication visibility changed");
    if (!(authorization.publicationVisibilityRules?.allowedVisibilities || ["PUBLIC"]).includes(request.publicationVisibility)) reject("TARGET_MISMATCH", "targetMatch", "Publication visibility is outside authorization");
    if (artifact && (request.media.length !== 1 || request.media[0].artifactId !== artifact.id || request.media[0].reference !== artifact.path || request.media[0].sha256 !== artifact.sha256 || !authorization.approvedAssets.some((item) => item.artifactId === artifact.id && item.sha256 === artifact.sha256))) reject("ARTIFACT_INTEGRITY_FAILED", "mediaHashMatch", "Execution media identity is not the approved artifact");
    if (!artifact && request.media.length !== 0) reject("ARTIFACT_INTEGRITY_FAILED", "mediaHashMatch", "Execution request contains unregistered media");
    if (!account || account.status !== "enabled" || account.health !== "healthy" || account.profileId !== target.profileId || request.accountId !== target.accountId || request.profileId !== target.profileId) reject("IDENTITY_MISMATCH", "accountMatch", "Execution account/profile binding changed");
    if (!isReadinessFresh(target.readiness, { platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id }, new Date(), this.readinessTtlMs)) {
      const expired = Number.isFinite(Date.parse(target.readiness?.expiresAt || "")) && Date.parse(target.readiness.expiresAt) <= Date.now();
      reject(expired ? "READINESS_EXPIRED" : "READINESS_NOT_READY", "readinessFresh", "Readiness expired or was not READY before submit intent");
    }

    const result = await this.store.mutate("execution-worker", "execution_submit_intent_persisted", (currentState) => {
      const requestRow = currentState.executionRequests.find((item) => item.executionId === executionId);
      const persistedLease = currentState.executionLeases.find((item) => item.id === lease.id && item.token === lease.token && Date.parse(item.expiresAt) > Date.now());
      const currentPost = requireItem(currentState.posts, post.id, "Post");
      if (unresolvedSubmission(currentState, currentPost, request.idempotencyKey)) reject("SUBMISSION_UNCERTAIN", "idempotencyClear", "SUBMISSION_UNCERTAIN: live grant cannot bypass an unresolved submission");
      if (!requestRow || requestRow.state !== "REQUEST_READY" || requestRow.submitState !== "NOT_STARTED") reject("NOT_DISPATCHABLE", "executionDispatchable", "Execution is no longer dispatchable");
      if (!persistedLease || persistedLease.profileKey !== `${target.channel}:${target.profileId}`) reject("LEASE_INVALID", "executionLeaseValid", "A valid execution lease is required");
      const currentAuthorization = (currentState.campaignAuthorizations || []).find((item) => item.id === currentPost.campaignAuthorizationId);
      const currentTarget = requireItem(currentState.targets, currentPost.targetId, "Target");
      const currentAccount = (currentState.executionAccounts || []).find((item) => item.id === executionAccountKey(currentTarget.channel, currentTarget.accountId));
      const currentKillReasons = killSwitchReasons(currentPost, currentState);
      if (currentKillReasons.length) reject("KILL_SWITCH_BLOCKED", currentKillReasons[0], `Live submit blocked by global control: ${currentKillReasons.join(", ")}`);
      const currentGrant = (currentState.liveExecutionGrants || []).find((item) => item.grantId === requestRow.request?.liveGrant?.grantId);
      try { assertLiveGrantMatchesExecution(currentGrant, requestRow.request, currentAuthorization); }
      catch (error) {
        error.code ||= "GRANT_INVALID";
        error.preSubmitFailure = { reasonCode: "GRANT_INVALID", stage: "submit_boundary", gate: "liveGrantValid", gateStatus: false };
        throw error;
      }
      if (requestRow.request.content.sha256 !== createHash("sha256").update(currentPost.content).digest("hex") || requestRow.request.content.contentId !== currentPost.contentId ||
          currentGrant.content.canonicalSha256 !== campaignContentHash(currentPost.content) || requestRow.request.audience !== currentPost.audience ||
          requestRow.request.publicationVisibility !== (currentPost.publicationVisibility || "PUBLIC") || currentGrant.publicationVisibility !== requestRow.request.publicationVisibility ||
          requestRow.request.platform !== currentTarget.channel || requestRow.request.target.targetId !== currentPost.targetId ||
          requestRow.request.accountId !== currentTarget.accountId || requestRow.request.profileId !== currentTarget.profileId ||
          currentAccount?.profileId !== currentTarget.profileId || currentAccount?.status !== "enabled" || currentAccount?.health !== "healthy" ||
          requestRow.request.media.length !== (currentPost.artifactId ? 1 : 0)) reject("IDENTITY_MISMATCH", "executionBindingsMatch", "Job identity changed before live submit intent");
      if (currentPost.artifactId) {
        const currentArtifact = requireItem(currentState.artifacts || [], currentPost.artifactId, "Artifact");
        if (currentArtifact.sha256 !== requestRow.request.media[0].sha256 || currentArtifact.id !== requestRow.request.media[0].artifactId || currentArtifact.path !== requestRow.request.media[0].reference) reject("ARTIFACT_INTEGRITY_FAILED", "mediaHashMatch", "Media identity changed before live submit intent");
      }
      if (!isReadinessFresh(currentTarget.readiness, { platform: currentTarget.channel, accountId: currentTarget.accountId, profileId: currentTarget.profileId, targetId: currentTarget.id }, new Date(), this.readinessTtlMs)) reject("READINESS_NOT_READY", "readinessFresh", "Readiness expired or was not READY before live submit intent");
      const decision = evaluateQueue(currentPost, currentState, new Date(), { executionId });
      if (!decision.allowed || currentAuthorization?.allowLiveExecution !== true) {
        const reason = decision.reasons[0] || "authorization_invalid";
        const reasonCode = reason.startsWith("readiness_") ? (reason === "readiness_expired" ? "READINESS_EXPIRED" : "READINESS_NOT_READY")
          : reason.includes("authorization") ? "AUTHORIZATION_INVALID"
            : reason.includes("window") ? "WINDOW_INVALID"
              : reason.includes("audience") ? "AUDIENCE_MISMATCH"
                : reason.includes("account") || reason.includes("profile") || reason.includes("target") ? "IDENTITY_MISMATCH"
                  : "OTHER_PLATFORM_PRE_SUBMIT_ERROR";
        reject(reasonCode, reason, `Pre-submit governance blocked: ${decision.reasons.join(", ")}`);
      }
      if (requestRow.request?.oneTimeWindow?.windowId) {
        const window = (currentState.oneTimeExecutionWindows || []).find((item) => item.windowId === requestRow.request.oneTimeWindow.windowId);
        try { assertWindowExecutionBinding(window, executionId, "CONSUMED"); }
        catch { reject("WINDOW_INVALID", "oneTimeWindowValid", "One-time execution window is not bound to this execution"); }
        if (oneTimeExecutionWindowStatus(window, new Date()) !== "CONSUMED" || !oneTimeExecutionWindowInBounds(window) || window.authorizationFingerprint !== campaignAuthorizationFingerprint(currentAuthorization)) {
          reject("WINDOW_INVALID", "oneTimeWindowValid", "One-time execution window is no longer valid for this submit");
        }
      }
      const siblingOwnsPreSubmitControls = (item) => {
        if (item.state !== "REQUEST_READY") return false;
        // A stale scheduler row with no live controls is historical pre-submit
        // bookkeeping, not an execution owner. It must not shadow the exact
        // request that still owns the active grant/window. Any non-NOT_STARTED
        // submit state remains a fail-closed blocker because the row is
        // internally inconsistent or has already crossed the submit boundary.
        if (item.submitState !== "NOT_STARTED") return true;
        const grantId = item.request?.liveGrant?.grantId || item.liveGrantId;
        const grant = grantId ? (currentState.liveExecutionGrants || []).find((candidate) => candidate.grantId === grantId) : null;
        if (grant && liveGrantEffectiveStatus(grant) === "ACTIVE" && grant.boundExecutionId === item.executionId) return true;
        const windowId = item.request?.oneTimeWindow?.windowId;
        const window = windowId ? (currentState.oneTimeExecutionWindows || []).find((candidate) => candidate.windowId === windowId) : null;
        return Boolean(window && ["ACTIVE", "RESERVED"].includes(oneTimeExecutionWindowStatus(window, new Date())) &&
          oneTimeExecutionWindowInBounds(window, new Date()) &&
          ((window.status === "ACTIVE" && !window.reservedExecutionId) ||
            (window.status === "RESERVED" && window.reservedExecutionId === item.executionId)));
      };
      if ((currentState.executionRequests || []).some((item) => item.executionId !== executionId && item.request?.idempotencyKey === request.idempotencyKey &&
        (["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state) || siblingOwnsPreSubmitControls(item)))) {
        reject("IDEMPOTENCY_BLOCKED", "idempotencyClear", "Another execution already owns this publication identity");
      }
      if ((currentState.executionReceipts || []).some((item) => item.receipt?.submitState === "CONFIRMED" && item.executionId !== executionId && (currentState.executionRequests || []).find((row) => row.executionId === item.executionId)?.request?.idempotencyKey === request.idempotencyKey)) reject("IDEMPOTENCY_BLOCKED", "idempotencyClear", "A confirmed publication already exists for this idempotency key");
      if ((currentState.posts || []).some((item) => item.id !== currentPost.id && item.idempotencyKey === request.idempotencyKey && item.status === "published")) reject("IDEMPOTENCY_BLOCKED", "idempotencyClear", "A publication already exists for this idempotency key");
      if (currentPost.status !== "queued") reject("NOT_DISPATCHABLE", "jobQueued", "Job is no longer queued");
      assertTransition(currentPost.status, "publishing");
      const at = nowIso();
      const attempt = {
        id: randomUUID(), postId: currentPost.id, targetId: target.id,
        contentSha256: createHash("sha256").update(currentPost.content).digest("hex"),
        approvalBinding: currentPost.approvalBinding || null,
        campaignAuthorizationId: currentPost.campaignAuthorizationId,
        campaignAuthorizationBinding: currentPost.campaignAuthorizationBinding,
        status: "prepared", preparedAt: at,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), executionId
      };
      currentState.publicationAttempts ||= [];
      currentState.publicationAttempts.push(attempt);
      currentPost.publicationAttemptId = attempt.id;
      currentPost.status = "publishing";
      currentPost.publishingAt = at;
      currentPost.executionState = "SUBMIT_SENT_INTENT";
      currentPost.jobLifecycle ||= [{ state: "CREATED", at: currentPost.createdAt || at }];
      if (!currentPost.jobLifecycle.some((item) => item.state === "EXECUTING" && item.executionId === executionId)) currentPost.jobLifecycle.push({ state: "EXECUTING", at, executionId });
      currentPost.jobLifecycle.push({ state: "SUBMIT_SENT_INTENT", at, executionId });
      requestRow.state = "SUBMIT_SENT_INTENT";
      requestRow.executionPhase = "SUBMIT_SENT_INTENT";
      requestRow.submitIntentAt = at;
      requestRow.idempotencyKey = request.idempotencyKey;
      if (normalizedTransportIdentity) requestRow.submitTransport = normalizedTransportIdentity;
      if (normalizedTransportCertification) {
        if (requestRow.submitTransportCertification && JSON.stringify(requestRow.submitTransportCertification) !== JSON.stringify(normalizedTransportCertification)) {
          reject("TRANSPORT_CERTIFICATION_CHANGED", "browserTransport", "Transport certification provenance cannot change after durable submit intent");
        }
        requestRow.submitTransportCertification = normalizedTransportCertification;
      }
      if (normalizedPreSubmitControlEvidence) requestRow.submitIntentEvidence = normalizedPreSubmitControlEvidence;
      currentGrant.status = "CONSUMED";
      currentGrant.consumedAt = at;
      currentGrant.consumedExecutionId = executionId;
      return requestRow;
    });
    return result.result;
  }

  async markExecutionSubmitSent(executionId, lease, submitAcceptanceEvidence = null) {
    const clickEvidence = validateSubmitAcceptanceEvidence(submitAcceptanceEvidence);
    if (clickEvidence && clickEvidence.clickStatus !== "CLICK_EMITTED") throw new Error("SUBMIT_SENT requires confirmed click-command emission evidence");
    const result = await this.store.mutate("execution-worker", "execution_submit_sent", (state) => {
      const request = state.executionRequests.find((item) => item.executionId === executionId);
      const persistedLease = state.executionLeases.find((item) => item.id === lease.id && item.token === lease.token && Date.parse(item.expiresAt) > Date.now());
      if (!request || request.state !== "SUBMIT_SENT_INTENT" || !persistedLease) throw new Error("Cannot mark submit sent without durable intent and active lease");
      request.state = "SUBMIT_SENT";
      request.executionPhase = "SUBMIT_SENT";
      request.submitState = "SUBMIT_SENT";
      request.dispatchedAt = clickEvidence?.clickEmittedAt || nowIso();
      if (clickEvidence) {
        request.clickEmittedAt = clickEvidence.clickEmittedAt;
        request.submitAcceptanceEvidence = clickEvidence;
      }
      const post = requireItem(state.posts, request.jobId, "Post");
      post.executionState = "SUBMIT_SENT";
      post.jobLifecycle.push({ state: "SUBMIT_SENT", at: request.dispatchedAt, executionId });
      return request;
    });
    return result.result;
  }

  async recordExecutionReceipt(executionId, input, actor = "execution-adapter") {
    const receipt = validateExecutionReceiptV1(input);
    if (receipt.executionId !== executionId) throw new Error("Receipt executionId does not match request");
    if (receipt.submitState === "CONFIRMED" && !String(actor).startsWith("jev-worker:")) throw new Error("CONFIRMED receipts must be produced by the in-process JEV verifier");
    const result = await this.store.mutate(actor, "execution_receipt_recorded", (state) => {
      const request = (state.executionRequests || []).find((item) => item.executionId === executionId);
      if (!request) throw new Error(`Execution request not found: ${executionId}`);
      if (request.jobId !== receipt.jobId || request.attempt !== receipt.attempt) throw new Error("Receipt job/attempt does not match execution request");
      state.executionReceipts ||= [];
      const exactReceipt = state.executionReceipts.find((item) => item.executionId === executionId && item.attempt === receipt.attempt && JSON.stringify(item.receipt) === JSON.stringify(receipt));
      if (exactReceipt) return exactReceipt;
      const priorReceipt = state.executionReceipts.find((item) => item.executionId === executionId && item.attempt === receipt.attempt && item.receipt.dryRun !== true);
      if (priorReceipt && !receipt.dryRun && !(receipt.reconciliation === true && priorReceipt.receipt.submitState === "UNKNOWN" && receipt.submitState === "CONFIRMED")) {
        throw new Error("A different receipt already exists for this execution attempt");
      }
      if (request.state === "CONFIRMED") throw new Error("Confirmed execution cannot be overwritten");
      if (request.state === "SUBMIT_RESULT_UNKNOWN" && !(receipt.reconciliation === true && receipt.submitState === "CONFIRMED" && receipt.publicationEvidence)) throw new Error("Unknown execution requires verified reconciliation; it cannot be resubmitted");
      if (request.state === "SUBMIT_SENT" && receipt.submitState === "FAILED") throw new Error("A submitted execution cannot be downgraded to FAILED");
      if (request.state === "SUBMIT_SENT_INTENT" && ["FAILED", "NOT_STARTED"].includes(receipt.submitState)) throw new Error("A durable submit intent cannot be downgraded to a safe pre-submit result");
      if (receipt.submitState === "SUBMIT_SENT" && !["SUBMIT_SENT_INTENT", "SUBMIT_SENT"].includes(request.state)) throw new Error("SUBMIT_SENT receipt requires a durable submit intent");
      if (receipt.submitState === "UNKNOWN" && !["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN"].includes(request.state)) throw new Error("UNKNOWN receipt requires a durable submit intent");
      if (receipt.submitState === "FAILED" && request.state !== "REQUEST_READY") throw new Error("FAILED receipt is only safe before a durable submit intent");
      if (receipt.submitState === "NOT_STARTED" && request.state !== "REQUEST_READY") throw new Error("NOT_STARTED receipt is only valid before submit intent");
      const post = requireItem(state.posts, request.jobId, "Post");
      const row = { id: randomUUID(), executionId, jobId: receipt.jobId, attempt: receipt.attempt, receivedAt: nowIso(), receipt };
      state.executionReceipts.push(row);
      if (receipt.dryRun) {
        if (request.request?.dryRun === true) {
          const gatesPassed = receipt.errorClassification === "NONE"
            && receipt.verificationGates
            && Object.values(receipt.verificationGates).length > 0
            && Object.values(receipt.verificationGates).every((passed) => passed === true);
          request.state = gatesPassed ? "DRY_RUN_COMPLETE" : "DRY_RUN_FAILED";
          request.executionPhase = request.state;
          request.dryRunCompletedAt = row.receivedAt;
        }
        return row;
      }
      request.submitState = receipt.submitState;
      request.recoveryClassification = receipt.recoveryClassification;
      request.lastReceiptAt = row.receivedAt;
      if (receipt.submitAcceptanceEvidence) request.submitAcceptanceEvidence = receipt.submitAcceptanceEvidence;
      if (receipt.submitState === "SUBMIT_SENT") {
        request.state = "SUBMIT_SENT";
        request.executionPhase = "SUBMIT_SENT";
        request.dispatchedAt ||= receipt.startedAt;
        post.executionState = "SUBMIT_SENT";
      } else if (receipt.submitState === "UNKNOWN") {
        request.state = "SUBMIT_RESULT_UNKNOWN";
        request.executionPhase = "SUBMIT_RESULT_UNKNOWN";
        request.dispatchedAt ||= receipt.startedAt;
        post.executionState = "SUBMIT_RESULT_UNKNOWN";
        const attempt = (state.publicationAttempts || []).find((item) => item.id === post.publicationAttemptId && item.executionId === executionId);
        if (!attempt) throw new Error("Unknown execution requires its durable publication attempt");
        const uncertaintyReasonCode = receipt.submitAcceptanceEvidence?.platformAcceptance === "REJECTED"
          ? receipt.submitAcceptanceEvidence.errorReasonCode
          : receipt.errorClassification === "NONE" ? "SUBMIT_OUTCOME_UNKNOWN" : receipt.errorClassification;
        recordSubmissionUnknown(state, post, attempt, { executionId, reasonCode: uncertaintyReasonCode, evidenceReferences: receipt.publicationReference ? [receipt.publicationReference] : [], detectedAt: row.receivedAt });
        if (!post.jobLifecycle?.some((item) => item.state === "SUBMIT_RESULT_UNKNOWN" && item.executionId === executionId)) post.jobLifecycle?.push({ state: "SUBMIT_RESULT_UNKNOWN", at: row.receivedAt, executionId });
      } else if (receipt.submitState === "CONFIRMED") {
        if (!["SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN"].includes(request.state)) throw new Error("CONFIRMED receipt requires a durable submit intent");
        const evidence = receipt.publicationEvidence;
        const target = requireItem(state.targets, post.targetId, "Target");
        const artifact = post.artifactId ? (state.artifacts || []).find((item) => item.id === post.artifactId) : null;
        if (post.artifactId && !artifact) throw new Error("Confirmed publication references a missing canonical media artifact");
        if (!post.artifactId && request.request?.media?.length) throw new Error("Execution request contains media without a canonical job artifact");
        if (!evidence || evidence.accountMatched !== true || evidence.targetMatched !== true || evidence.contentHashMatched !== true || !receipt.publicationUrl) {
          throw new Error("Confirmed receipt requires verified account, target, content, and permalink evidence");
        }
        const postContentHash = createHash("sha256").update(post.content).digest("hex");
        if (evidence.contentHash !== postContentHash || evidence.targetId !== target.id || evidence.accountId !== target.accountId || evidence.profileId !== target.profileId) {
          throw new Error("Publication evidence does not match the expected job identity");
        }
        if (!artifact) {
          if (evidence.mediaHashMatched !== true || evidence.mediaHash !== null) throw new Error("Text-only publication requires media-not-applicable evidence");
        } else {
          const expectedMedia = {
            artifactId: artifact.id,
            sha256: artifact.sha256,
            type: artifact.mimeType || artifact.mediaType || "application/octet-stream"
          };
          const requestMedia = request.request?.media?.[0];
          if (!requestMedia || requestMedia.artifactId !== expectedMedia.artifactId || requestMedia.sha256 !== expectedMedia.sha256 || requestMedia.type !== expectedMedia.type) {
            throw new Error("Execution request media binding does not match the canonical artifact");
          }
          const mediaEvidence = evidence.verificationDetails?.media;
          if (!mediaEvidence || mediaEvidence.present !== true || mediaEvidence.hashStatus === "MISMATCHED") throw new Error("Publication media evidence is missing or mismatched");
          if (mediaEvidence.type !== (expectedMedia.type.startsWith("video/") ? "video" : expectedMedia.type.startsWith("image/") ? "image" : expectedMedia.type)) {
            throw new Error("Publication media type does not match the canonical artifact");
          }
          if (mediaEvidence.hashStatus === "MATCHED") {
            if (evidence.mediaHashMatched !== true || evidence.mediaHash !== expectedMedia.sha256) throw new Error("Verifiable publication media hash does not match the canonical artifact");
          } else if (mediaEvidence.hashStatus === "NOT_VERIFIABLE") {
            const policy = this.platformPolicies.resolve(target.channel);
            const preSubmitIntegrity = evidence.preSubmitMediaIntegrity;
            if (policy?.postPublishMediaHash !== "NOT_AVAILABLE" || evidence.mediaHashMatched !== false || evidence.mediaHash !== null ||
                mediaEvidence.present !== true || !isPreSubmitMediaIntegrityProven(preSubmitIntegrity, expectedMedia)) {
              throw new Error("Publication media hash is unavailable without a matching platform capability and proven pre-submit artifact integrity");
            }
            const details = evidence.verificationDetails;
            const candidate = details?.candidate;
            if (details?.executionId !== executionId || !details?.authorIdentity?.matched || !details?.contentMatch?.matched ||
                !candidate?.timestampMatched || !(candidate?.postId || candidate?.activityUrn) ||
                !candidate?.permalink || candidate.permalink !== receipt.publicationUrl) {
              throw new Error("Unverifiable publication media requires stable post identity, permalink, author, content, and submit-time evidence");
            }
            const submittedMs = Date.parse(details.submittedAt || request.submitIntentAt || request.dispatchedAt || "");
            const observedMs = Date.parse(details.observedAt || "");
            const candidateMs = Date.parse(candidate.timestamp || "");
            if (!Number.isFinite(submittedMs) || !Number.isFinite(observedMs) || !Number.isFinite(candidateMs) || candidateMs < submittedMs || candidateMs > submittedMs + PUBLICATION_CANDIDATE_MAX_AGE_MS || candidateMs > observedMs) {
              throw new Error("Unverifiable publication media requires a candidate timestamp within the submit-to-observation interval");
            }
            const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
            const expectedIdentity = account?.identityReference ? this.platformPolicies.normalizeIdentityUrl(target.channel, account.identityReference) : null;
            const expectedAuthorPath = expectedIdentity ? new URL(expectedIdentity).pathname.replace(/\/$/, "").toLowerCase() : null;
            if (!expectedAuthorPath || details.authorIdentity.expectedPath !== expectedAuthorPath || details.authorIdentity.observedPath !== expectedAuthorPath) {
              throw new Error("Unverifiable publication media requires the registered author identity to match");
            }
          } else {
            throw new Error("Publication media hash status is invalid for a media-bearing job");
          }
        }
        const targetHost = new URL(target.url).hostname.toLowerCase().replace(/^www\./, "");
        const publicationHost = new URL(receipt.publicationUrl).hostname.toLowerCase().replace(/^www\./, "");
        if (publicationHost !== targetHost && !publicationHost.endsWith(`.${targetHost}`)) throw new Error("Publication URL host does not match the approved target platform");
        if (!["publishing", UNKNOWN_POST_STATUS].includes(post.status)) throw new Error("Confirmed publication requires a previously persisted submit intent");
        assertTransition(post.status, "published");
        const attempt = (state.publicationAttempts || []).find((item) => item.id === post.publicationAttemptId && item.executionId === executionId);
        if (!attempt || !["prepared", "unknown"].includes(attempt.status) || attempt.contentSha256 !== postContentHash) throw new Error("Publication attempt is missing or stale");
        const uncertainty = (state.submissionUncertainties || []).find((item) => item.jobId === post.id && item.executionId === executionId && item.status === "UNKNOWN");
        if (uncertainty) { uncertainty.status = "CONFIRMED"; uncertainty.lastReconciliationAt = evidence.verifiedAt; uncertainty.resolvedAt = evidence.verifiedAt; uncertainty.evidenceReferences.push(evidence.evidenceReference || receipt.publicationUrl); uncertainty.publicationUrl = receipt.publicationUrl; }
        attempt.status = "verified";
        attempt.verifiedAt = evidence.verifiedAt;
        attempt.publicationUrl = receipt.publicationUrl;
        request.state = "CONFIRMED";
        request.executionPhase = "VERIFIED";
        request.dispatchedAt ||= receipt.startedAt;
        request.publicationUrl = receipt.publicationUrl;
        request.publicationReference = receipt.publicationReference;
        post.executionState = "CONFIRMED";
        post.status = "published";
        post.publishedAt = evidence.verifiedAt;
        post.publicationUrl = receipt.publicationUrl;
        post.evidence = evidence.evidenceReference || `verified:${evidence.verificationMethod}:${evidence.verifiedAt}`;
        post.jobLifecycle.push({ state: "PUBLISHED", at: evidence.verifiedAt, executionId, publicationUrl: receipt.publicationUrl }, { state: "VERIFIED", at: evidence.verifiedAt, executionId });
      } else if (receipt.submitState === "FAILED") {
        if (request.state === "SUBMIT_SENT") throw new Error("A submitted execution cannot be marked as safely failed");
        request.state = "FAILED";
        request.executionPhase = "FAILED";
        post.executionState = "FAILED";
        if (receipt.recoveryClassification !== "RECOVERABLE") {
          const at = row.receivedAt;
          post.status = "blocked";
          post.blockedAt = at;
          post.readinessState = receipt.recoveryClassification === "HUMAN_REQUIRED" ? "HUMAN_REQUIRED" : "BLOCKED";
          post.readinessReasonCode = receipt.errorClassification.toLowerCase();
          post.authorizationDecision = { evaluatedAt: at, allowed: false, reasons: [post.readinessReasonCode] };
          if (!post.jobLifecycle?.some((item) => item.state === post.readinessState && item.executionId === executionId)) post.jobLifecycle?.push({ state: post.readinessState, at, executionId, reasonCode: post.readinessReasonCode });
          if (receipt.recoveryClassification === "HUMAN_REQUIRED") {
            const target = state.targets.find((item) => item.id === post.targetId);
            const account = target && (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
            if (account) {
              account.health = "human_required";
              account.lastFailureAt = at;
              account.updatedAt = at;
            }
          }
        }
      }
      return row;
    });
    return result.result;
  }

  async expireCampaignAuthorizations(actor = "scheduler") {
    const snapshot = await this.store.read();
    const now = Date.now();
    const dueIds = new Set((snapshot.campaignAuthorizations || [])
      .filter((authorization) => authorization.status === "active")
      .filter((authorization) => !Number.isFinite(Date.parse(authorization.validUntil)) || Date.parse(authorization.validUntil) <= now)
      .map((authorization) => authorization.id));
    if (dueIds.size === 0) return [];
    const result = await this.store.mutate(actor, "campaign_authorizations_expired", (state) => {
      const expired = [];
      for (const authorization of (state.campaignAuthorizations || []).filter((item) => dueIds.has(item.id) && item.status === "active")) {
        const at = nowIso();
        authorization.status = "expired";
        authorization.updatedAt = at;
        expired.push(authorization.id);
        for (const post of state.posts.filter((item) => item.campaignAuthorizationId === authorization.id && item.status === "queued")) {
          post.status = "blocked";
          post.blockedAt = at;
          post.authorizationDecision = { evaluatedAt: at, allowed: false, reasons: ["campaign_authorization_expired"] };
        }
      }
      return expired;
    });
    return result.result;
  }

  async registerExecutionAccount(input, actor = "operator") {
    const account = normalizeExecutionAccount(input, new Date(), this.platformPolicies);
    const result = await this.store.mutate(actor, "execution_account_registered", (state) => {
      const collision = (state.executionAccounts || []).find((item) => item.platform === account.platform && item.profileId === account.profileId && item.id !== account.id && item.status === "enabled");
      if (collision) throw new Error(`Browser profile ${account.profileId} is already bound to another ${account.platform} account`);
      state.executionAccounts ||= [];
      const existing = state.executionAccounts.find((item) => item.id === account.id);
      if (existing) {
        Object.assign(existing, account, { createdAt: existing.createdAt, lastReadinessAt: existing.lastReadinessAt || account.lastReadinessAt });
        return existing;
      }
      state.executionAccounts.push(account);
      return account;
    });
    return result.result;
  }

  async createSchedule(campaignId, input, actor = "operator") {
    const channels = [...new Set(Array.isArray(input.channels) ? input.channels.map(String) : [])];
    if (channels.length === 0 || channels.some((channel) => !CHANNELS[channel])) {
      throw new Error("Schedule channels must contain supported channels");
    }
    const localTime = String(input.localTime || "09:00");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error("Schedule localTime must use HH:mm");
    const mode = normalizeScheduleMode(input.mode);
    const result = await this.store.mutate(actor, "schedule_created", (state) => {
      const campaign = requireItem(state.campaigns, campaignId, "Campaign");
      const track = optionalProductTrack(input.track === undefined ? campaign.track : input.track);
      state.schedules ||= [];
      const schedule = {
        id: randomUUID(),
        campaignId,
        name: requiredText(input.name || "Daily product content", "schedule name"),
        cadence: "daily",
        localTime,
        timezone: String(input.timezone || "Asia/Saigon"),
        track,
        channels,
        mode,
        status: input.status === "paused" ? "paused" : "active",
        requiresHumanPublishApproval: false,
        approvalPolicy: "campaign_authorization",
        approvalReference: mode === "publish_with_standing_approval"
          ? requiredText(input.approvalReference, "schedule approvalReference")
          : null,
        createdAt: nowIso()
      };
      state.schedules.push(schedule);
      return schedule;
    });
    return result.result;
  }

  async updateSchedule(scheduleId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "schedule_updated", (state) => {
      const schedule = requireItem(state.schedules || [], scheduleId, "Schedule");
      if (input.name !== undefined) schedule.name = requiredText(input.name, "schedule name");
      if (input.localTime !== undefined) {
        const localTime = String(input.localTime);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error("Schedule localTime must use HH:mm");
        schedule.localTime = localTime;
      }
      if (input.timezone !== undefined) schedule.timezone = requiredText(input.timezone, "schedule timezone");
      if (input.track !== undefined) schedule.track = optionalProductTrack(input.track);
      if (input.channels !== undefined) {
        const channels = [...new Set(Array.isArray(input.channels) ? input.channels.map(String) : [])];
        if (channels.length === 0 || channels.some((channel) => !CHANNELS[channel])) {
          throw new Error("Schedule channels must contain supported channels");
        }
        schedule.channels = channels;
      }
      if (input.status !== undefined) {
        if (!new Set(["active", "paused"]).has(String(input.status))) throw new Error("Invalid schedule status");
        schedule.status = String(input.status);
      }
      if (input.mode !== undefined) {
        const mode = String(input.mode);
        const normalizedMode = normalizeScheduleMode(mode);
        schedule.mode = normalizedMode;
        schedule.requiresHumanPublishApproval = false;
        schedule.approvalPolicy = "campaign_authorization";
        schedule.approvalReference = normalizedMode === "publish_with_standing_approval"
          ? requiredText(input.approvalReference || schedule.approvalReference, "schedule approvalReference")
          : null;
      } else if (input.approvalReference !== undefined && schedule.mode === "publish_with_standing_approval") {
        schedule.approvalReference = requiredText(input.approvalReference, "schedule approvalReference");
      }
      schedule.updatedAt = nowIso();
      return schedule;
    });
    return result.result;
  }

  async recordScheduleRun(scheduleId, input, actor = "scheduler") {
    const allowed = new Set(["due", "running", "succeeded", "failed", "blocked"]);
    const status = String(input.status || "");
    if (!allowed.has(status)) throw new Error("Invalid schedule run status");
    const result = await this.store.mutate(actor, "schedule_run_recorded", (state) => {
      const schedule = requireItem(state.schedules || [], scheduleId, "Schedule");
      if (input.artifactId) {
        const artifact = requireItem(state.artifacts || [], input.artifactId, "Artifact");
        if (artifact.campaignId !== schedule.campaignId) throw new Error("Schedule run artifact must belong to the campaign");
      }
      if (input.storyId) {
        const story = requireItem(state.stories || [], input.storyId, "Story");
        if (story.campaignId !== schedule.campaignId) throw new Error("Schedule run story must belong to the campaign");
      }
      state.scheduleRuns ||= [];
      const run = {
        id: randomUUID(),
        scheduleId,
        campaignId: schedule.campaignId,
        status,
        artifactId: input.artifactId || null,
        storyId: input.storyId || null,
        note: String(input.note || "").slice(0, 1000),
        externalSideEffects: input.externalSideEffects === true,
        recordedAt: nowIso()
      };
      state.scheduleRuns.push(run);
      return run;
    });
    return result.result;
  }

  async updateCampaign(campaignId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "campaign_updated", (state) => {
      const campaign = requireItem(state.campaigns, campaignId, "Campaign");
      const authorizationScopeBefore = JSON.stringify({ objective: campaign.objective, audience: campaign.audience || [], track: campaign.track || null, landingUrl: campaign.landingUrl || null, productRepo: campaign.productRepo });
      for (const field of ["name", "objective", "status"]) {
        if (input[field] !== undefined) campaign[field] = String(input[field]).trim();
      }
      if (input.landingUrl !== undefined) campaign.landingUrl = optionalHttpUrl(input.landingUrl, "Campaign landingUrl");
      if (input.keywords !== undefined) campaign.keywords = normalizeKeywords(input.keywords);
      if (input.audience !== undefined) campaign.audience = Array.isArray(input.audience) ? input.audience : [];
      if (input.discoverySources !== undefined) campaign.discoverySources = normalizeDiscoverySources(input.discoverySources);
      if (input.discoveryFit !== undefined) {
        const discoveryFit = normalizeDiscoveryFit(input.discoveryFit);
        if (discoveryFit) campaign.discoveryFit = discoveryFit;
        else delete campaign.discoveryFit;
      }
      if (input.track !== undefined) campaign.track = optionalProductTrack(input.track);
      if (!campaign.name || !campaign.objective) throw new Error("Campaign name and objective are required");
      campaign.updatedAt = nowIso();
      const authorizationScopeAfter = JSON.stringify({ objective: campaign.objective, audience: campaign.audience || [], track: campaign.track || null, landingUrl: campaign.landingUrl || null, productRepo: campaign.productRepo });
      if (authorizationScopeBefore !== authorizationScopeAfter) {
        for (const authorization of (state.campaignAuthorizations || []).filter((item) => item.campaignId === campaignId && item.status === "active")) {
          authorization.status = "paused";
          authorization.updatedAt = campaign.updatedAt;
          for (const post of state.posts.filter((item) => item.campaignAuthorizationId === authorization.id && item.status === "queued")) {
            post.status = "blocked";
            post.blockedAt = campaign.updatedAt;
            post.authorizationDecision = { evaluatedAt: campaign.updatedAt, allowed: false, reasons: ["campaign_scope_changed"] };
          }
        }
      }
      if (campaign.status !== "active") {
        for (const authorization of (state.campaignAuthorizations || []).filter((item) => item.campaignId === campaignId && item.status === "active")) {
          authorization.status = "paused";
          authorization.updatedAt = campaign.updatedAt;
          for (const post of state.posts.filter((item) => item.campaignAuthorizationId === authorization.id && item.status === "queued")) {
            post.status = "blocked";
            post.blockedAt = campaign.updatedAt;
            post.authorizationDecision = { evaluatedAt: campaign.updatedAt, allowed: false, reasons: ["campaign_paused"] };
          }
        }
      }
      return campaign;
    });
    return result.result;
  }

  async createPost(input, actor = "operator") {
    const result = await this.store.mutate(actor, "post_created", (state) => {
      if (input.testJob === true && !["operator", "local-human-operator"].includes(actor)) {
        throw new Error("Only an operator can mark a job as a live-test job");
      }
      requireItem(state.campaigns, input.campaignId, "Campaign");
      const target = requireItem(state.targets, input.targetId, "Target");
      const content = String(input.content || "");
      const contentId = String(input.contentId || createHash("sha256").update(content).digest("hex"));
      const idempotencyKey = publicationIdentityKey({ campaignId: input.campaignId, contentId, platform: target.channel, accountId: target.accountId, targetId: target.id });
      const existing = state.posts.find((item) => item.idempotencyKey === idempotencyKey || publicationIdentityKeysForPost(item, state).includes(idempotencyKey));
      if (existing) return existing;
      const artifact = input.artifactId ? requireItem(state.artifacts || [], input.artifactId, "Artifact") : null;
      if (artifact && (artifact.campaignId !== input.campaignId || artifact.status !== "verified")) {
        throw new Error("Post artifact must be verified and belong to its campaign");
      }
      if (input.assetPath && !artifact) throw new Error("A post asset must reference a registered artifact");
      const assetPath = artifact ? artifact.path : null;
      if (input.assetPath && path.resolve(String(input.assetPath)) !== path.resolve(artifact.path)) {
        throw new Error("Post asset path must match its registered artifact");
      }
      if (input.assetSha256 && (!artifact || String(input.assetSha256).toLowerCase() !== artifact.sha256)) {
        throw new Error("Post asset SHA-256 must match its registered artifact");
      }
      const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (scheduledAt && !Number.isFinite(scheduledAt.getTime())) throw new Error("scheduledAt must be a valid timestamp");
      const at = nowIso();
      const post = {
        id: randomUUID(),
        campaignId: input.campaignId,
        targetId: input.targetId,
        storyId: String(input.storyId || "").trim() || null,
        content,
        contentId,
        idempotencyKey,
        audience: String(input.audience || "").trim(),
        publicationVisibility: input.publicationVisibility ? String(input.publicationVisibility).trim().toUpperCase() : "PUBLIC",
        testJob: input.testJob === true,
        templateId: String(input.templateId || "").trim() || null,
        claimIds: Array.isArray(input.claimIds) ? [...new Set(input.claimIds.map(String))] : [],
        contentSourceRefs: Array.isArray(input.contentSourceRefs) ? input.contentSourceRefs.map((reference) => typeof reference === "string" ? reference : ({ relativePath: String(reference.relativePath || ""), sha256: String(reference.sha256 || "").toLowerCase() })) : [],
        artifactId: artifact?.id || null,
        assetPath,
        assetSha256: artifact?.sha256 || null,
        scheduledAt: scheduledAt?.toISOString() || null,
        language: input.language || "en",
        status: "draft",
        approvedAt: null,
        createdAt: at,
        updatedAt: at
      };
      state.posts.push(post);
      const authorizations = (state.campaignAuthorizations || []).filter((item) => item.campaignId === input.campaignId);
      const authorization = [...authorizations].reverse().find((item) => item.status === "active") || authorizations.at(-1);
      if (authorization) {
        post.campaignAuthorizationId = authorization.id;
        post.campaignAuthorizationBinding = authorization.binding;
        post.jobLifecycle = [{ state: "CREATED", at }, { state: "AUTHORIZED", at, authorizationId: authorization.id }];
        const eligibility = evaluateQueue(post, state);
        post.authorizationDecision = { evaluatedAt: at, allowed: eligibility.allowed, reasons: eligibility.reasons };
        if (eligibility.allowed) {
          post.status = "queued";
          post.queuedAt = at;
          post.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
          post.jobLifecycle.push({ state: "READY", at }, { state: "QUEUED", at });
        } else {
          post.status = "blocked";
          post.blockedAt = at;
          post.jobLifecycle.push({ state: "BLOCKED", at, reasons: eligibility.reasons });
        }
      }
      return post;
    });
    if (result.result.campaignAuthorizationId) {
      const readinessResult = await this.refreshCampaignJobReadiness(result.result.id, actor);
      if (readinessResult.status === "queued") {
        await this.prepareExecutionRequest(result.result.id, actor);
        await this.ensureStandingExecutionGrant(result.result.id, "execution-router");
      }
      const latest = await this.store.read();
      return latest.posts.find((item) => item.id === result.result.id) || result.result;
    }
    return result.result;
  }

  async createTarget(input, actor = "operator") {
    const result = await this.store.mutate(actor, "target_created", (state) => {
      if (!CHANNELS[input.channel]) throw new Error(`Unsupported channel: ${input.channel}`);
      const target = {
        id: randomUUID(),
        channel: input.channel,
        name: String(input.name || "").trim(),
        url: channelUrl(input.channel, input.url, "Target URL", this.platformPolicies),
        accountId: String(input.accountId || "").trim(),
        profileId: String(input.profileId || "").trim() || null,
        status: input.status || "needs_review",
        rulesStatus: input.rulesStatus || (CHANNELS[input.channel].requiresRulesReview ? "pending" : "not_required"),
        locale: input.locale || "en",
        notes: input.notes || "",
        consentBasis: input.consentBasis ? String(input.consentBasis).trim() : null,
        audienceSource: input.audienceSource ? String(input.audienceSource).trim() : null,
        unsubscribeMechanism: input.unsubscribeMechanism ? String(input.unsubscribeMechanism).trim() : null,
        readiness: null,
        createdAt: nowIso()
      };
      if (!target.name || !target.url || !target.accountId) {
        throw new Error("Target name, URL and accountId are required");
      }
      if (target.profileId) {
        const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
        if (!account || account.profileId !== target.profileId) throw new Error("Target profileId must match a registered execution account");
      }
      target.readiness = normalizeTargetReadiness(input.readiness, input.status || "needs_review", {
        platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id
      }, this.readinessTtlMs);
      if (CHANNELS[input.channel].requiresConsent && target.status === "active" &&
          (!target.consentBasis || !target.audienceSource || !target.unsubscribeMechanism)) {
        throw new Error("Active email targets require consentBasis, audienceSource and unsubscribeMechanism");
      }
      state.targets.push(target);
      return target;
    });
    return result.result;
  }

  async updateTarget(targetId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "target_updated", (state) => {
      const target = requireItem(state.targets, targetId, "Target");
      const priorAccountKey = executionAccountKey(target.channel, target.accountId);
      const priorProfileId = target.profileId || null;
      for (const field of ["name", "url", "accountId", "profileId", "status", "rulesStatus", "locale", "notes", "consentBasis", "audienceSource", "unsubscribeMechanism"]) {
        if (input[field] !== undefined) target[field] = input[field];
      }
      const accountChanged = priorAccountKey !== executionAccountKey(target.channel, target.accountId) || priorProfileId !== (target.profileId || null);
      if (target.profileId) {
        const account = (state.executionAccounts || []).find((item) => item.id === executionAccountKey(target.channel, target.accountId));
        if (!account || account.profileId !== target.profileId) throw new Error("Target profileId must match a registered execution account");
      }
      if (input.readiness !== undefined) target.readiness = normalizeTargetReadiness(input.readiness, target.status, {
        platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id
      }, this.readinessTtlMs);
      else if (accountChanged) target.readiness = normalizeTargetReadiness(null, target.status, {
        platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id
      }, this.readinessTtlMs);
      else target.readiness = normalizeTargetReadiness(target.readiness, target.status, {
        platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id
      }, this.readinessTtlMs);
      if (target.readiness.state !== "ready") target.status = "needs_review";
      if (input.status === "active" && target.readiness.state !== "ready") {
        throw new Error("Target cannot become active until readiness state is ready");
      }
      target.url = channelUrl(target.channel, target.url, "Target URL", this.platformPolicies);
      if (CHANNELS[target.channel]?.requiresConsent && target.status === "active" &&
          (!String(target.consentBasis || "").trim() || !String(target.audienceSource || "").trim() || !String(target.unsubscribeMechanism || "").trim())) {
        throw new Error("Active email targets require consentBasis, audienceSource and unsubscribeMechanism");
      }
      target.updatedAt = nowIso();
      for (const post of state.posts.filter((item) => item.targetId === target.id && ["approved", "queued"].includes(item.status))) {
        post.status = post.campaignAuthorizationId ? "blocked" : "needs_review";
        if (post.campaignAuthorizationId) {
          post.blockedAt = target.updatedAt;
          post.authorizationDecision = { evaluatedAt: target.updatedAt, allowed: false, reasons: ["target_identity_or_readiness_changed"] };
        }
        post.approvedAt = null;
        delete post.approvedBy;
        delete post.approvalBinding;
        delete post.approvalBinding;
        post.updatedAt = target.updatedAt;
      }
      for (const post of state.posts.filter((item) => item.targetId === target.id && item.campaignAuthorizationId && item.status === "blocked")) {
        const decision = evaluateQueue(post, state);
        post.authorizationDecision = { evaluatedAt: target.updatedAt, allowed: decision.allowed, reasons: decision.reasons };
        if (decision.allowed) {
          post.status = "queued";
          post.queuedAt = target.updatedAt;
          post.queuedKillEpoch = Number.isSafeInteger(state.control?.killSwitch?.epoch) ? state.control.killSwitch.epoch : 0;
          post.jobLifecycle ||= [{ state: "CREATED", at: post.createdAt }];
          post.jobLifecycle.push({ state: "READY", at: target.updatedAt }, { state: "QUEUED", at: target.updatedAt });
          delete post.blockedAt;
        }
      }
      return target;
    });
    return result.result;
  }

  async createCommunityMembership(input, actor = "operator") {
    const normalized = normalizeCommunityMembership(input, this.platformPolicies);
    const result = await this.store.mutate(actor, "community_membership_recorded", (state) => {
      state.communityMemberships ||= [];
      const existing = state.communityMemberships.find((item) => item.productRepo === normalized.productRepo && item.platform === normalized.platform && item.communityUrl === normalized.communityUrl && item.communityName === normalized.communityName);
      if (existing) {
        Object.assign(existing, normalized, { updatedAt: nowIso() });
        return existing;
      }
      const membership = { id: randomUUID(), ...normalized, createdAt: nowIso(), updatedAt: nowIso() };
      state.communityMemberships.push(membership);
      return membership;
    });
    return result.result;
  }

  async updateCommunityMembership(membershipId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "community_membership_updated", (state) => {
      state.communityMemberships ||= [];
      const membership = requireItem(state.communityMemberships, membershipId, "Community membership");
      const normalized = normalizeCommunityMembership({ ...membership, ...input }, this.platformPolicies);
      Object.assign(membership, normalized, { updatedAt: nowIso() });
      return membership;
    });
    return result.result;
  }

  async updatePost(postId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "post_updated", (state) => {
      const post = requireItem(state.posts, postId, "Post");
      if (!["draft", "needs_review", "paused", "failed", "blocked"].includes(post.status)) {
        throw new Error(`Post cannot be edited from ${post.status}`);
      }
      const contentChanged = input.content !== undefined && String(input.content) !== post.content;
      const assetChanged = input.assetPath !== undefined && String(input.assetPath || "") !== String(post.assetPath || "");
      const assetHashChanged = input.assetSha256 !== undefined && String(input.assetSha256 || "").toLowerCase() !== String(post.assetSha256 || "").toLowerCase();
      let verifiedAssetHash;
      if (input.assetSha256 !== undefined) {
        verifiedAssetHash = String(input.assetSha256 || "").trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(verifiedAssetHash)) {
          throw new Error("assetSha256 must be a 64-character SHA-256 hex digest");
        }
        const artifact = (state.artifacts || []).find((item) => item.id === post.artifactId);
        if (!artifact || artifact.sha256 !== verifiedAssetHash) {
          throw new Error("assetSha256 must match the post's registered artifact");
        }
        const assetPath = input.assetPath !== undefined ? input.assetPath : post.assetPath;
        if (!assetPath || path.resolve(assetPath) !== path.resolve(artifact.path)) {
          throw new Error("assetPath must resolve to the post's registered artifact path");
        }
      }
      if (input.content !== undefined) post.content = String(input.content).trim();
      if (input.assetPath !== undefined) post.assetPath = input.assetPath || null;
      if (verifiedAssetHash !== undefined) post.assetSha256 = verifiedAssetHash;
      if (input.audience !== undefined) post.audience = requiredText(input.audience, "post audience");
      if (input.language !== undefined) post.language = input.language;
      if (input.externalId !== undefined) post.externalId = String(input.externalId || "").trim() || null;
      if (!post.content) throw new Error("Post content is required");
      if (contentChanged || assetChanged || assetHashChanged) {
        post.status = post.campaignAuthorizationId ? "blocked" : "needs_review";
        if (post.campaignAuthorizationId) {
          post.authorizationDecision = { evaluatedAt: nowIso(), allowed: false, reasons: ["job_content_or_asset_changed"] };
          post.blockedAt = nowIso();
        }
        post.approvedAt = null;
        delete post.approvedBy;
        delete post.approvalBinding;
      }
      post.updatedAt = nowIso();
      return post;
    });
    return result.result;
  }

  async approvePost(postId, actor = "operator") {
    const result = await this.store.mutate(actor, "post_approved", (state) => {
      const post = requireItem(state.posts, postId, "Post");
      if (!["draft", "needs_review", "paused"].includes(post.status)) {
        throw new Error(`Post cannot be approved from ${post.status}`);
      }
      post.status = "approved";
      const target = requireItem(state.targets, post.targetId, "Target");
      post.approvedAt = nowIso();
      post.approvedBy = actor;
      post.approvalBinding = approvalFingerprint(post, target);
      post.updatedAt = post.approvedAt;
      return post;
    });
    return result.result;
  }

  async transitionPost(postId, input, actor = "operator") {
    const result = await this.store.mutate(actor, `post_transition_${input.status}`, async (state) => {
      const post = requireItem(state.posts, postId, "Post");
      if (post.status === UNKNOWN_POST_STATUS || input.status === UNKNOWN_POST_STATUS || unresolvedSubmission(state, post)) throw new Error("SUBMISSION_UNCERTAIN: use evidence-based reconciliation");
      assertTransition(post.status, input.status);
      if (["queued", "publishing"].includes(input.status)) {
        await assertPostArtifactCurrent(post, state);
        const decision = evaluateQueue(post, state);
        if (!decision.allowed) throw new Error(`Publication guard blocked: ${decision.reasons.join(", ")}`);
      }
      let publicationEvidence = null;
      if (input.status === "published") {
        const target = requireItem(state.targets, post.targetId, "Target");
        publicationEvidence = requirePublicationEvidence(input, target, this.platformPolicies);
      }
      const at = nowIso();
      state.publicationAttempts ||= [];
      if (input.status === "publishing") {
        const attempt = {
          id: randomUUID(), postId: post.id, targetId: post.targetId,
          contentSha256: createHash("sha256").update(post.content).digest("hex"),
          approvalBinding: post.approvalBinding,
          campaignAuthorizationId: post.campaignAuthorizationId || null,
          campaignAuthorizationBinding: post.campaignAuthorizationBinding || null,
          status: "prepared",
          preparedAt: at,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
        };
        state.publicationAttempts.push(attempt);
        post.publicationAttemptId = attempt.id;
      }
      if (input.status === "published") {
        const attempt = requireItem(state.publicationAttempts, post.publicationAttemptId, "Publication attempt");
        if (attempt.status !== "prepared" || attempt.approvalBinding !== post.approvalBinding ||
            attempt.campaignAuthorizationId !== (post.campaignAuthorizationId || null) ||
            attempt.campaignAuthorizationBinding !== (post.campaignAuthorizationBinding || null) ||
            attempt.contentSha256 !== createHash("sha256").update(post.content).digest("hex")) {
          throw new Error("Publication attempt is stale or does not match the approved content");
        }
        if (Date.parse(attempt.expiresAt) < Date.now()) throw new Error("Publication attempt expired; return the post through review");
        attempt.status = "verified";
        attempt.verifiedAt = at;
        attempt.publicationUrl = publicationEvidence.publicationUrl;
      }
      if (input.status === "failed" && post.publicationAttemptId) {
        const attempt = state.publicationAttempts.find((item) => item.id === post.publicationAttemptId);
        if (attempt && attempt.status === "prepared") {
          attempt.status = "failed";
          attempt.finishedAt = at;
          attempt.error = String(input.error || "Publication failed").slice(0, 500);
        }
      }
      post.status = input.status;
      post.updatedAt = at;
      post[`${input.status}At`] = at;
      if (publicationEvidence) {
        post.publicationUrl = publicationEvidence.publicationUrl;
        post.evidence = publicationEvidence.evidence;
        if (input.externalId !== undefined) post.externalId = String(input.externalId || "").trim() || null;
      }
      if (input.status === "needs_review") {
        post.approvedAt = null;
        delete post.approvedBy;
        delete post.approvalBinding;
      }
      if (input.error) post.error = input.error;
      else if (input.status === "published") delete post.error;
      return post;
    });
    return result.result;
  }

  async quarantineLegacySubmission(postId, input, actor = "operator") {
    if (!["operator", "local-human-operator"].includes(actor)) throw new Error("Only an operator may quarantine a legacy submission");
    if (input?.operatorConfirmedNoWorker !== true) throw new Error("Operator must confirm that no worker is running");
    const refs = Array.isArray(input.evidenceReferences) ? input.evidenceReferences.map((value) => String(value || "").trim()).filter(Boolean) : [];
    if (refs.some((value) => value.length > 300 || /[\r\n]/.test(value))) throw new Error("Evidence references must be short single-line identifiers");
    if (!refs.length) throw new Error("Quarantine requires evidence references for the UNKNOWN investigation");
    const result = await this.store.mutate(actor, "legacy_submission_quarantined_unknown", (state) => {
      const post = requireItem(state.posts, postId, "Post");
      if (post.status === UNKNOWN_POST_STATUS) return (state.submissionUncertainties || []).find((item) => item.id === post.submissionUncertaintyId);
      if (post.status !== "publishing") throw new Error("Legacy quarantine requires a stale publishing job");
      const attempt = (state.publicationAttempts || []).find((item) => item.id === post.publicationAttemptId && item.postId === post.id);
      if (!attempt || attempt.status !== "prepared" || !Number.isFinite(Date.parse(attempt.expiresAt)) || Date.parse(attempt.expiresAt) > Date.now()) throw new Error("Legacy quarantine requires an expired prepared publication attempt");
      if (attempt.executionId) throw new Error("Legacy quarantine cannot be used for an execution with an executionId");
      if (activeExecutionForPost(state, post.id)) throw new Error("Active execution lease or worker prevents quarantine");
      if ((state.executionRequests || []).some((item) => item.jobId === post.id && ["REQUEST_READY", "EXECUTING", "SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED"].includes(item.state))) throw new Error("Related execution request prevents legacy quarantine");
      if (unresolvedSubmission(state, post)) throw new Error("Submission identity is already quarantined");
      const at = nowIso();
      const uncertainty = recordSubmissionUnknown(state, post, attempt, { reasonCode: "LEGACY_SUBMIT_OUTCOME_UNKNOWN", evidenceReferences: refs, detectedAt: at });
      post.jobLifecycle ||= [];
      post.jobLifecycle.push({ state: "SUBMIT_RESULT_UNKNOWN", at, publicationAttemptId: attempt.id, reasonCode: uncertainty.reasonCode });
      return uncertainty;
    });
    return result.result;
  }

  async getSubmissionUncertainty(uncertaintyId) {
    const state = await this.store.read();
    const row = (state.submissionUncertainties || []).find((item) => item.id === uncertaintyId);
    if (!row) throw new Error(`Submission uncertainty not found: ${uncertaintyId}`);
    return row;
  }

  async reconcileSubmissionUncertainty(uncertaintyId, input, actor = "operator") {
    if (!["operator", "local-human-operator"].includes(actor)) throw new Error("Only an operator may reconcile a submission uncertainty");
    if (!["CONFIRMED", "PROVEN_FAILED"].includes(input?.outcome)) throw new Error("Reconciliation outcome must be CONFIRMED or PROVEN_FAILED");
    const evidence = input.evidence;
    if (!evidence || typeof evidence !== "object" || !String(evidence.evidenceReference || "").trim() || !String(evidence.verificationMethod || "").trim()) throw new Error("Reconciliation requires structured evidence and a reference");
    if (String(evidence.evidenceReference).length > 300 || String(evidence.verificationMethod).length > 100 || /[\r\n]/.test(String(evidence.evidenceReference))) throw new Error("Reconciliation evidence reference and method must be short identifiers");
    const result = await this.store.mutate(actor, `submission_uncertainty_${input.outcome.toLowerCase()}`, (state) => {
      const uncertainty = (state.submissionUncertainties || []).find((item) => item.id === uncertaintyId);
      if (!uncertainty) throw new Error(`Submission uncertainty not found: ${uncertaintyId}`);
      if (uncertainty.status !== "UNKNOWN") throw new Error("Submission uncertainty is already resolved");
      const post = requireItem(state.posts, uncertainty.jobId, "Post");
      const attempt = requireItem(state.publicationAttempts || [], uncertainty.publicationAttemptId, "Publication attempt");
      const target = requireItem(state.targets, uncertainty.targetId, "Target");
      if (input.outcome === "CONFIRMED") {
        if (uncertainty.executionId) throw new Error("Modern execution confirmation must use the verified execution receipt path");
        const contentHash = createHash("sha256").update(String(post.content || "")).digest("hex");
        const artifact = (state.artifacts || []).find((item) => item.id === post.artifactId);
        if (evidence.accountId !== target.accountId || evidence.profileId !== target.profileId || evidence.targetId !== target.id || evidence.contentSha256 !== contentHash || (attempt.contentSha256 && attempt.contentSha256 !== contentHash) || evidence.mediaSha256 !== (artifact?.sha256 || null) || !evidence.publicationUrl || !Number.isFinite(Date.parse(evidence.verifiedAt || ""))) throw new Error("Confirmation evidence does not match the quarantined publication identity");
        const expectedHost = new URL(target.url).hostname.toLowerCase().replace(/^www\./, "");
        const publicationHost = new URL(evidence.publicationUrl).hostname.toLowerCase().replace(/^www\./, "");
        if (publicationHost !== expectedHost && !publicationHost.endsWith(`.${expectedHost}`)) throw new Error("Publication URL host does not match the original target");
        uncertainty.status = "CONFIRMED";
        uncertainty.publicationUrl = evidence.publicationUrl;
        uncertainty.publicationReference = evidence.publicationReference || null;
        uncertainty.lastReconciliationAt = evidence.verifiedAt;
        uncertainty.resolvedAt = evidence.verifiedAt;
        uncertainty.evidenceReferences.push(evidence.evidenceReference);
        post.status = "published";
        post.executionState = "CONFIRMED";
        post.publishedAt = evidence.verifiedAt;
        post.publicationUrl = evidence.publicationUrl;
        post.evidence = evidence.evidenceReference;
        attempt.status = "verified";
        attempt.verifiedAt = evidence.verifiedAt;
        attempt.publicationUrl = evidence.publicationUrl;
        post.jobLifecycle ||= [];
        post.jobLifecycle.push({ state: "PUBLISHED", at: evidence.verifiedAt, publicationAttemptId: attempt.id, publicationUrl: evidence.publicationUrl }, { state: "VERIFIED", at: evidence.verifiedAt, evidenceReference: evidence.evidenceReference });
      } else {
        if (evidence.provesSubmitNeverOccurred !== true || !["PRE_SUBMIT_ABORT_TRACE", "PLATFORM_REJECTION_BEFORE_ACCEPTANCE"].includes(evidence.proofType)) throw new Error("PROVEN_FAILED requires an allowlisted proof that submit never occurred");
        if ((state.executionReceipts || []).some((row) => row.jobId === post.id && ["SUBMIT_SENT", "CONFIRMED"].includes(row.receipt?.submitState))) throw new Error("Existing sent or confirmed receipt conflicts with proven-never-submitted evidence");
        const modernRequest = uncertainty.executionId && (state.executionRequests || []).find((row) => row.executionId === uncertainty.executionId);
        if (uncertainty.executionId && (!modernRequest || !["SUBMIT_SENT_INTENT", "SUBMIT_RESULT_UNKNOWN"].includes(modernRequest.state))) throw new Error("Modern execution is not in a reconcilable submit state");
        uncertainty.status = "PROVEN_FAILED";
        uncertainty.lastReconciliationAt = nowIso();
        uncertainty.resolvedAt = uncertainty.lastReconciliationAt;
        uncertainty.evidenceReferences.push(evidence.evidenceReference);
        uncertainty.proofType = evidence.proofType;
        if (modernRequest) {
          modernRequest.state = "PROVEN_FAILED";
          modernRequest.executionPhase = "PROVEN_FAILED";
          modernRequest.submitState = "FAILED";
          modernRequest.reconciledAt = uncertainty.resolvedAt;
          modernRequest.reconciliationEvidenceReference = evidence.evidenceReference;
        }
        post.status = "failed";
        post.executionState = "PROVEN_FAILED";
        post.failedAt = uncertainty.resolvedAt;
        post.error = "Submission proven not sent by reconciliation evidence";
        attempt.status = "failed";
        attempt.finishedAt = uncertainty.resolvedAt;
        attempt.provenNeverSubmitted = true;
        post.jobLifecycle ||= [];
        post.jobLifecycle.push({ state: "PROVEN_FAILED", at: uncertainty.resolvedAt, publicationAttemptId: attempt.id, evidenceReference: evidence.evidenceReference });
      }
      return uncertainty;
    });
    return result.result;
  }

  async recordMetrics(postId, input, actor = "operator", trusted = {}) {
    const result = await this.store.mutate(actor, "metrics_recorded", (state) => {
      requireItem(state.posts, postId, "Post");
      const readings = Object.fromEntries(METRIC_FIELDS.map((field) => [field, metricReading(input, field)]));
      const snapshot = {
        id: randomUUID(),
        postId,
        capturedAt: nowIso(),
        ...Object.fromEntries(METRIC_FIELDS.map((field) => [field, readings[field].value])),
        coverage: Object.fromEntries(METRIC_FIELDS.map((field) => [field, readings[field].status])),
        source: trusted.officialChannel ? `official:${trusted.officialChannel}` : "manual",
        provenance: trusted.officialChannel
          ? { kind: "official_api", adapter: trusted.officialChannel, verifiedAt: nowIso() }
          : { kind: "verified_manual", actor, verifiedAt: nowIso() }
      };
      state.metricSnapshots.push(snapshot);
      return snapshot;
    });
    return result.result;
  }

  async recordBrowserObservation(postId, input, actor = "local-draft-automation") {
    const screenshot = await readBrowserScreenshot(this.store.filePath, input.screenshotPath, input.screenshotSha256);
    const result = await this.store.mutate(actor, "browser_observation_recorded", (state) => {
      const post = requireItem(state.posts, postId, "Post");
      if (post.status !== "published" || !post.publicationUrl) {
        throw new Error("Browser observation requires a published post with a permalink");
      }
      const target = requireItem(state.targets, post.targetId, "Target");
      const observedUrl = channelUrl(target.channel, input.observedUrl, "Observed URL", this.platformPolicies);
      const comparableUrl = (value) => {
        const parsed = canonicalPublicationUrl(value);
        return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
      };
      if (comparableUrl(observedUrl) !== comparableUrl(post.publicationUrl)) {
        throw new Error("Browser observation URL must match the stored publication permalink");
      }
      const evidence = requiredText(input.evidence, "browser observation evidence");
      const screenshotSha256 = screenshot.sha256;
      const observedAt = new Date(input.observedAt || Date.now());
      if (!Number.isFinite(observedAt.getTime())) throw new Error("observedAt must be a valid timestamp");
      if (observedAt.getTime() > Date.now() + 5 * 60_000 || observedAt.getTime() < Date.now() - 24 * 60 * 60_000) {
        throw new Error("observedAt must be within the last 24 hours and not in the future");
      }
      const status = String(input.status || "verified").trim().toLowerCase();
      if (!["verified", "unknown"].includes(status)) throw new Error("Browser observation status must be verified or unknown");
      state.collectorRuns ||= [];
      const run = {
        id: randomUUID(), postId, channel: target.channel,
        status: status === "verified" ? "succeeded" : "unknown",
        mode: "browser_assisted", at: observedAt.toISOString(), observedUrl,
        evidence: evidence.slice(0, 500), screenshotPath: screenshot.path,
        screenshotSha256, screenshotBytes: screenshot.bytes
      };
      if (status === "unknown") {
        run.reason = requiredText(input.reason, "unknown observation reason").slice(0, 300);
        state.collectorRuns.push(run);
        return { status, collectorRun: run, metricSnapshot: null };
      }
      if (!METRIC_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
        throw new Error("Verified browser observation requires at least one visible metric");
      }
      const readings = Object.fromEntries(METRIC_FIELDS.map((field) => [field, metricReading(input, field)]));
      const snapshot = {
        id: randomUUID(), postId, capturedAt: observedAt.toISOString(),
        ...Object.fromEntries(METRIC_FIELDS.map((field) => [field, readings[field].value])),
        coverage: Object.fromEntries(METRIC_FIELDS.map((field) => [field, readings[field].status])),
        source: `browser:${target.channel}`,
        provenance: {
          kind: "browser_verified", observedUrl, evidence: evidence.slice(0, 500),
          screenshotPath: screenshot.path, screenshotSha256, screenshotBytes: screenshot.bytes,
          actor, verifiedAt: nowIso()
        }
      };
      const previous = [...state.metricSnapshots]
        .filter((item) => item.postId === postId)
        .sort((left, right) => String(right.capturedAt || "").localeCompare(String(left.capturedAt || "")))[0];
      const metricsChanged = !metricReadingsMatchSnapshot(previous, readings);
      run.metricsChanged = metricsChanged;
      if (metricsChanged) state.metricSnapshots.push(snapshot);
      state.collectorRuns.push(run);
      return { status, collectorRun: run, metricSnapshot: metricsChanged ? snapshot : null, metricsChanged };
    });
    return result.result;
  }

  async collectMetrics(postId, actor = "official-collector", options = {}) {
    const state = await this.store.read();
    const post = requireItem(state.posts, postId, "Post");
    const target = requireItem(state.targets, post.targetId, "Target");
    try {
      const metrics = await collectOfficialMetrics(post, target, options);
      const persisted = await this.store.mutate(actor, "collector_succeeded", (nextState) => {
        const currentPost = requireItem(nextState.posts, postId, "Post");
        const capturedAt = nowIso();
        const readings = Object.fromEntries(METRIC_FIELDS.map((field) => [field, metricReading(metrics, field)]));
        const snapshot = {
          id: randomUUID(), postId, capturedAt: nowIso(),
          ...Object.fromEntries(METRIC_FIELDS.map((field) => [field, readings[field].value])),
          coverage: Object.fromEntries(METRIC_FIELDS.map((field) => [field, readings[field].status])),
          source: `official:${target.channel}`,
          provenance: { kind: "official_api", adapter: target.channel, verifiedAt: nowIso() }
        };
        nextState.collectorRuns ||= [];
        const source = `official:${target.channel}`;
        const previous = [...(nextState.metricSnapshots || [])]
          .filter((item) => item.postId === currentPost.id && item.source === source)
          .sort(compareMetricSnapshots)
          .at(-1);
        const metricsChanged = !metricReadingsMatchSnapshot(previous, readings);
        if (metricsChanged) nextState.metricSnapshots.push(snapshot);
        const run = {
          id: randomUUID(), postId, channel: target.channel, status: "succeeded", at: capturedAt,
          source, metricsChanged
        };
        nextState.collectorRuns.push(run);
        return { metricSnapshot: metricsChanged ? snapshot : null, collectorRun: run, metricsChanged };
      });
      return persisted.result;
    } catch (error) {
      await this.store.mutate(actor, "collector_failed", (nextState) => {
        nextState.collectorRuns ||= [];
        nextState.collectorRuns.push({
          id: randomUUID(), postId, channel: target.channel, status: "failed", at: nowIso(),
          source: `official:${target.channel}`, metricsChanged: false,
          error: String(error?.code || error?.message || "collector_failed").slice(0, 300)
        });
      });
      throw error;
    }
  }

  async collectAllMetrics(actor = "official-collector", options = {}) {
    const state = await this.store.read();
    const results = [];
    const readiness = new Map(integrationReadiness(options.env || process.env).map((item) => [item.id, item]));
    const planByPostId = new Map(buildMetricCollectionPlan(state, { now: options.now || new Date(), dueOnly: options.dueOnly === true }).map((item) => [item.postId, item]));
    for (const post of state.posts.filter((item) => item.status === "published")) {
      const plan = planByPostId.get(post.id);
      if (plan && !plan.shouldCollect && (options.dueOnly === true || plan.reason === "published_at_invalid")) {
        results.push({ postId: post.id, ok: null, status: plan.reason === "published_at_invalid" ? "not_collected" : "not_due", reason: plan.reason || "checkpoint_not_due", dueCheckpoints: plan.dueCheckpoints });
        continue;
      }
      const target = state.targets.find((item) => item.id === post.targetId);
      const provider = readiness.get(target?.channel);
      if (!provider || provider.mode === "manual_only" || !provider.configured) {
        const status = provider?.mode === "manual_only" ? "not_applicable" : "unknown";
        await this.store.mutate(actor, `collector_${status}`, (nextState) => {
          nextState.collectorRuns ||= [];
          nextState.collectorRuns.push({ id: randomUUID(), postId: post.id, channel: target?.channel || "unknown", status, at: nowIso(), reason: provider?.mode === "manual_only" ? "manual_only" : "official_api_not_configured" });
        });
        results.push({ postId: post.id, ok: null, status, reason: provider?.mode === "manual_only" ? "manual_only" : "official_api_not_configured" });
        continue;
      }
      try {
        const metric = await this.collectMetrics(post.id, actor, options);
        results.push({ postId: post.id, ok: true, status: "succeeded", metricsChanged: metric.metricsChanged, metricId: metric.metricSnapshot?.id || null });
      } catch (error) {
        results.push({ postId: post.id, ok: false, status: "failed", error: String(error?.code || error?.message || "collector_failed").slice(0, 300) });
      }
    }
    return results;
  }

  async recordConversion(campaignId, input, actor = "conversion-collector") {
    const result = await this.store.mutate(actor, "conversion_recorded", (state) => {
      requireItem(state.campaigns, campaignId, "Campaign");
      state.conversions ||= [];
      const eventId = requiredText(input.eventId, "eventId");
      const source = requiredText(input.source, "source");
      if (state.conversions.some((event) => event.source === source && event.eventId === eventId)) {
        throw new Error("Duplicate conversion event");
      }
      const occurredAt = new Date(requiredText(input.occurredAt, "occurredAt"));
      if (Number.isNaN(occurredAt.getTime())) throw new Error("occurredAt must be a valid timestamp");
      const conversion = {
        id: randomUUID(), campaignId, eventId, source,
        name: requiredText(input.name, "name"), valueMinor: metricValue(input, "valueMinor"),
        currency: currencyCode(input.currency), occurredAt: occurredAt.toISOString(), recordedAt: nowIso(),
        consentBasis: requiredText(input.consentBasis, "consentBasis")
      };
      state.conversions.push(conversion);
      return conversion;
    });
    return result.result;
  }

  async recordKeywordMetrics(campaignId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "keyword_metrics_recorded", (state) => {
      const campaign = requireItem(state.campaigns, campaignId, "Campaign");
      const keyword = String(input.keyword || "").trim();
      if (!keyword) throw new Error("Keyword is required");
      const configured = (campaign.keywords || []).some((item) => item.phrase.toLocaleLowerCase("en-US") === keyword.toLocaleLowerCase("en-US"));
      if (!configured) throw new Error(`Keyword is not configured for campaign: ${keyword}`);
      const rank = input.rank === undefined || input.rank === null || input.rank === "" ? null : metricValue(input, "rank");
      if (rank === 0) throw new Error("rank must be a positive integer when provided");
      const snapshot = {
        id: randomUUID(),
        campaignId,
        keyword,
        capturedAt: nowIso(),
        impressions: metricValue(input, "impressions"),
        clicks: metricValue(input, "clicks"),
        leads: metricValue(input, "leads"),
        rank,
        source: input.source || "manual"
      };
      state.keywordSnapshots ||= [];
      state.keywordSnapshots.push(snapshot);
      return snapshot;
    });
    return result.result;
  }

  async addInteraction(postId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "interaction_added", (state) => {
      requireItem(state.posts, postId, "Post");
      const externalId = String(input.externalId || "").trim() || null;
      if (externalId) {
        const existing = state.interactions.find((item) => item.postId === postId && item.externalId === externalId);
        if (existing) return existing;
      }
      const interaction = {
        id: randomUUID(),
        postId,
        kind: input.kind || "comment",
        authorLabel: input.authorLabel || "unknown",
        text: String(input.text || ""),
        externalId,
        status: "open",
        capturedAt: nowIso()
      };
      state.interactions.push(interaction);
      return interaction;
    });
    return result.result;
  }

  async draftReply(interactionId, input, actor = "ai-drafter") {
    const result = await this.store.mutate(actor, "reply_drafted", async (state) => {
      const interaction = requireItem(state.interactions, interactionId, "Interaction");
      const post = requireItem(state.posts, interaction.postId, "Post");
      const campaign = requireItem(state.campaigns, post.campaignId, "Campaign");
      const requestedSources = Array.isArray(input.groundingSources) ? input.groundingSources : [];
      const productRepo = await requireProductRepo(campaign.productRepo);
      const groundingSources = await Promise.all(requestedSources.map((source) => readGroundingSource(productRepo, source)));
      const reply = {
        id: randomUUID(),
        interactionId,
        text: String(input.text || "").trim(),
        groundingSources,
        groundingSummary: String(input.groundingSummary || "").trim(),
        productRepo,
        status: "draft",
        approvedAt: null,
        createdAt: nowIso()
      };
      if (!reply.text) throw new Error("Reply text is required");
      if (groundingSources.length === 0 || !reply.groundingSummary) {
        throw new Error("Reply requires product-repository grounding sources and summary");
      }
      state.replies.push(reply);
      return reply;
    });
    return result.result;
  }

  async approveReply(replyId, actor = "operator") {
    const result = await this.store.mutate(actor, "reply_approved", (state) => {
      const reply = requireItem(state.replies, replyId, "Reply");
      if (reply.status !== "draft") throw new Error(`Reply cannot be approved from ${reply.status}`);
      reply.status = "approved";
      reply.approvedAt = nowIso();
      reply.approvedBy = actor;
      return reply;
    });
    return result.result;
  }

  async markReplySent(replyId, input, actor = "operator") {
    const result = await this.store.mutate(actor, "reply_sent", (state) => {
      const reply = requireItem(state.replies, replyId, "Reply");
      assertReplyCanSend(reply, state);
      const evidence = String(input.evidence || "").trim();
      if (!evidence) throw new Error("Reply send evidence is required");
      reply.status = "sent";
      reply.sentAt = nowIso();
      reply.evidence = evidence;
      const interaction = requireItem(state.interactions, reply.interactionId, "Interaction");
      interaction.status = "replied";
      interaction.repliedAt = reply.sentAt;
      return reply;
    });
    return result.result;
  }

  async recordFixtureAutomation(postId, input, actor = "fixture-worker") {
    const evidence = requiredText(input.evidence, "fixture automation evidence");
    const e2eStatus = String(input.e2eStatus || "").trim();
    const allowedE2EStatuses = new Set(["e2e_verified_readonly", "e2e_dom_timeout", "e2e_network_error"]);
    if (e2eStatus && !allowedE2EStatuses.has(e2eStatus)) throw new Error("Unsupported E2E fixture status");
    const fixturePublicationUrl = input.fixturePublicationUrl ? requiredText(input.fixturePublicationUrl, "fixture publication URL") : null;
    if (!fixturePublicationUrl && !e2eStatus) throw new Error("Fixture automation requires a fixture URL or E2E status");
    if (fixturePublicationUrl && !fixturePublicationUrl.startsWith("https://fixture.local/")) {
      throw new Error("Fixture automation URL must remain on fixture.local");
    }
    const contentSha256 = requiredText(input.contentSha256, "fixture content hash");
    const result = await this.store.mutate(actor, "fixture_automation_completed", (state) => {
      const post = requireItem(state.posts, postId, "Post");
      state.fixtureAutomationRuns ||= [];
      const existing = state.fixtureAutomationRuns.find((run) => run.postId === post.id && run.contentSha256 === contentSha256);
      if (existing) return existing;
      const run = {
        id: randomUUID(),
        postId: post.id,
        mode: "local-fixture",
        dashboardStatus: "Đã chuẩn bị (Auto-Worker mô phỏng)",
        e2eStatus: e2eStatus || null,
        fixturePublicationUrl,
        publicationUrl: null,
        observedUrl: input.observedUrl ? String(input.observedUrl) : null,
        selector: input.selector ? String(input.selector) : null,
        evidence,
        contentSha256,
        cdpEndpointConfigured: input.cdpEndpointConfigured === true,
        cdpAttached: input.cdpAttached === true,
        externalSideEffects: false,
        at: nowIso()
      };
      state.fixtureAutomationRuns.push(run);
      return run;
    });
    return result.result;
  }

  async dashboard() {
    const state = await this.store.read();
    state.keywordSnapshots ||= [];
    state.conversions ||= [];
    state.collectorRuns ||= [];
    state.artifacts ||= [];
    state.stories ||= [];
    state.schedules ||= [];
    state.scheduleRuns ||= [];
    state.publicationAttempts ||= [];
    state.fixtureAutomationRuns ||= [];
    state.communityMemberships ||= [];
    const accountRuntime = projectExecutionAccountRuntime(state);
    const authorizedAccountCandidates = projectAuthorizedAccountCandidates(state, { readinessTtlMs: this.readinessTtlMs });
    const authorizedAccountPool = projectAuthorizedAccountPool(state, { readinessTtlMs: this.readinessTtlMs });
    const authorizedAccountPoolSummary = projectAuthorizedAccountPoolSummary(authorizedAccountCandidates);
    const campaignAuthorityRuntime = projectCampaignAuthorityRuntime(state, { readinessTtlMs: this.readinessTtlMs });
    const productIntelligenceRuntime = projectProductIntelligence(state);
    const engagementContext = projectEngagementContext(state, { now: new Date() });
    const conversationContinuity = projectConversationContinuity(state, { now: new Date() });
    const executionRuntime = projectExecutionRuntime(state);
    const productFactorySandbox = await this.productFactorySandboxCapability();
    const latestMetrics = new Map();
    for (const metric of state.metricSnapshots) {
      const current = latestMetrics.get(metric.postId);
      if (!current || compareMetricSnapshots(metric, current) > 0) latestMetrics.set(metric.postId, metric);
    }
    const metricCoverage = Object.fromEntries(METRIC_FIELDS.map((field) => [field, { measured: 0, unknown: 0, unsupported: 0 }]));
    const totals = [...latestMetrics.values()].reduce((sum, metric) => {
      for (const key of METRIC_FIELDS) {
        const status = metricCoverageStatus(metric, key);
        metricCoverage[key][status] = (metricCoverage[key][status] || 0) + 1;
        if (status === "measured" && Number.isSafeInteger(metric[key])) sum[key] += metric[key];
      }
      return sum;
    }, { impressions: 0, reactions: 0, comments: 0, shares: 0, clicks: 0, leads: 0 });
    const statuses = Object.fromEntries(state.posts.map((post) => post.status).reduce((map, status) => {
      map.set(status, (map.get(status) || 0) + 1);
      return map;
    }, new Map()));
    const channels = Object.entries(CHANNELS).map(([id, policy]) => ({
      id,
      label: policy.label,
      targets: state.targets.filter((target) => target.channel === id).length,
      posts: state.posts.filter((post) => state.targets.find((target) => target.id === post.targetId)?.channel === id).length
    }));
    const channelCapabilities = projectChannelCapabilities({ channels: CHANNELS, targets: state.targets, posts: state.posts });
    const trafficPulse = state.posts
      .filter((post) => post.status === "published")
      .map((post) => buildTrafficPulse(post, state.metricSnapshots, state.interactions, new Date(), state.collectorRuns));
    const metricCheckpointSummary = projectMetricCheckpointSummary(state.posts, state.metricSnapshots, state.collectorRuns, new Date());
    const browserWindowMinutes = 24 * 60;
    const browserWindowStartedAt = Date.now() - browserWindowMinutes * 60 * 1000;
    const publishedPosts = state.posts.filter((post) => post.status === "published" && post.publicationUrl);
    const latestBrowserRunByPost = new Map();
    for (const run of state.collectorRuns.filter((item) => item.mode === "browser_assisted")) {
      const current = latestBrowserRunByPost.get(run.postId);
      if (!current || String(run.at || "") >= String(current.at || "")) latestBrowserRunByPost.set(run.postId, run);
    }
    const currentBrowserRuns = publishedPosts
      .map((post) => latestBrowserRunByPost.get(post.id))
      .filter((run) => run && Date.parse(run.at || "") >= browserWindowStartedAt);
    const browserCoverage = {
      windowMinutes: browserWindowMinutes,
      totalPublished: publishedPosts.length,
      observed: currentBrowserRuns.length,
      verified: currentBrowserRuns.filter((run) => run.status === "succeeded").length,
      unknown: currentBrowserRuns.filter((run) => run.status === "unknown").length,
      missing: Math.max(0, publishedPosts.length - currentBrowserRuns.length),
      complete: publishedPosts.length > 0 && currentBrowserRuns.length === publishedPosts.length,
      lastObservationAt: currentBrowserRuns.map((run) => run.at).sort().at(-1) || null,
      missingPostIds: publishedPosts.filter((post) => !currentBrowserRuns.some((run) => run.postId === post.id)).map((post) => post.id)
    };
    const latestKeywordMetrics = new Map();
    for (const snapshot of state.keywordSnapshots) {
      const key = `${snapshot.campaignId}\u0000${snapshot.keyword.toLocaleLowerCase("en-US")}`;
      const current = latestKeywordMetrics.get(key);
      if (!current || snapshot.capturedAt > current.capturedAt) latestKeywordMetrics.set(key, snapshot);
    }
    const keywordPerformance = state.campaigns.flatMap((campaign) => (campaign.keywords || []).map((keyword) => {
      const key = `${campaign.id}\u0000${keyword.phrase.toLocaleLowerCase("en-US")}`;
      return { campaignId: campaign.id, ...keyword, latest: latestKeywordMetrics.get(key) || null };
    }));
    const discoveries = state.campaigns
      .filter((campaign) => campaign.discovery?.observations?.length)
      .flatMap((campaign) => campaign.discovery.observations.map((observation) => ({
        campaignId: campaign.id,
        ...observation
      })))
      .sort((left, right) => (right.score?.score || 0) - (left.score?.score || 0));
    const discoveryOpportunities = projectDiscoveryOpportunities(discoveries);
    return {
      revision: state.revision,
      updatedAt: state.updatedAt,
      campaignCount: state.campaigns.length,
      targetCount: state.targets.length,
      postCount: state.posts.length,
      accountRuntime,
      executionAccounts: accountRuntime,
      authorizedAccountCandidates,
      authorizedAccountPool,
      authorizedAccountPoolSummary,
      campaignAuthorityRuntime,
      productIntelligenceRuntime,
      engagementContext,
      conversationContinuity,
      executionRuntime,
      productFactorySandbox,
      communityMemberships: state.communityMemberships,
      statuses,
      totals,
      metricCoverage,
      openInteractions: state.interactions.filter((item) => item.status === "open").length,
      pendingReplies: state.replies.filter((item) => item.status !== "sent").length,
      channels,
      channelCapabilities,
      campaigns: state.campaigns,
      outcomes: state.campaigns.filter((campaign) => campaign.outcomeSummary).map((campaign) => ({ campaignId: campaign.id, latest: campaign.outcomeSummary, recent: (campaign.outcomeSummaries || []).slice(-24), updatedAt: campaign.outcomeUpdatedAt || null })),
      learning: state.campaigns.filter((campaign) => campaign.latestLearningFeedback).map((campaign) => ({ campaignId: campaign.id, latest: campaign.latestLearningFeedback, recent: (campaign.learningFeedback || []).slice(-24), updatedAt: campaign.learningUpdatedAt || null })),
      distributionHandoffs: state.campaigns.flatMap((campaign) => (campaign.distributionHandoffs || []).map((handoff) => ({ campaignId: campaign.id, ...handoff }))),
      productIntelligence: state.campaigns
        .filter((campaign) => campaign.productIntelligence)
        .map((campaign) => ({
          campaignId: campaign.id,
          handoff: campaign.productIntelligence.handoff,
          document: campaign.productIntelligence.document,
          repositoryInspection: campaign.productIntelligence.repositoryInspection || null,
          attachedAt: campaign.productIntelligence.attachedAt,
          attachedBy: campaign.productIntelligence.attachedBy
        })),
      strategy: state.campaigns
        .filter((campaign) => Array.isArray(campaign.strategyDecisions) && campaign.strategyDecisions.length)
        .map((campaign) => ({
          campaignId: campaign.id,
          latest: campaign.strategyDecisions.at(-1),
          recent: campaign.strategyDecisions.slice(-24),
          updatedAt: campaign.strategyUpdatedAt || null
        })),
      discoveries,
      discoveryOpportunities,
      targets: state.targets.map((target) => ({
        ...target,
        readiness: normalizeTargetReadiness(target.readiness, target.status)
      })),
      posts: state.posts,
      latestMetrics: Object.fromEntries(latestMetrics),
      latestMetricSnapshots: newest([...latestMetrics.values()], "capturedAt"),
      trafficPulse,
      metricCheckpointSummary,
      browserCoverage,
      keywordPerformance,
      recentInteractions: newest(state.interactions, "capturedAt"),
      recentReplies: newest(state.replies, "createdAt"),
      recentAudit: newest(state.auditLog, "at"),
      integrations: integrationReadiness(),
      recentConversions: newest(state.conversions, "occurredAt"),
      recentCollectorRuns: newest(state.collectorRuns, "at"),
      recentArtifacts: newest(state.artifacts, "createdAt"),
      recentStories: newest(state.stories, "createdAt"),
      recentProductFactoryRuns: newest(state.campaigns.flatMap((campaign) => (campaign.productFactoryRuns || []).map((run) => ({ ...run, campaignId: campaign.id }))), "completedAt"),
      productFactoryEvidence: projectFactoryRunEvidence(state.campaigns.flatMap((campaign) => (campaign.productFactoryRuns || []).map((run) => ({ ...run, campaignId: campaign.id })))),
      recentPublicationAttempts: newest(state.publicationAttempts, "preparedAt"),
      fixtureAutomation: {
        mode: "local-fixture",
        runs: newest(state.fixtureAutomationRuns, "at")
      },
      schedules: state.schedules,
      recentScheduleRuns: newest(state.scheduleRuns, "recordedAt"),
      flowGraph: buildMarketingFlowGraph(state)
    };
  }
}

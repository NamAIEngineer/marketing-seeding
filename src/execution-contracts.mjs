import { createHash } from "node:crypto";
import { normalizePublicationVisibility } from "./publication-visibility.mjs";
import { canonicalIdentityUrl, canonicalProvider } from "./execution-binding.mjs";

export const EXECUTION_REQUEST_SCHEMA_VERSION = 1;
export const EXECUTION_RECEIPT_SCHEMA_VERSION = 1;
export const PUBLICATION_CANDIDATE_MAX_AGE_MS = 30 * 60_000;
export const SUBMIT_STATES = Object.freeze(["NOT_STARTED", "SUBMIT_SENT", "CONFIRMED", "UNKNOWN", "FAILED"]);
export const EXECUTION_STATES = Object.freeze(["REQUEST_READY", "DRY_RUN_COMPLETE", "DRY_RUN_FAILED", "CANCELLED_PRE_SUBMIT", "SUBMIT_SENT_INTENT", "SUBMIT_SENT", "SUBMIT_RESULT_UNKNOWN", "CONFIRMED", "FAILED"]);

const sha256Pattern = /^[a-f0-9]{64}$/i;
const secretKeyPattern = /(password|passwd|cookie|bearer|token|credential|mfa|passkey|sessionstorage|localstorage|secret|authorizationheader)/i;
const errorClasses = new Set(["AUTH_REQUIRED", "ACCOUNT_MISMATCH", "CONTENT_MISMATCH", "MEDIA_MISMATCH", "UPLOAD_ERROR", "UNKNOWN_COMPOSER", "PLATFORM_ERROR", "NETWORK_ERROR", "TIMEOUT", "VALIDATION_ERROR", "NONE"]);
const recoveryClasses = new Set(["RECOVERABLE", "HUMAN_REQUIRED", "UNKNOWN", "NONE"]);

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function isPreSubmitMediaIntegrityProven(evidence, expected) {
  return Boolean(evidence && expected &&
    evidence.artifactId === expected.artifactId &&
    evidence.expectedSha256 === expected.sha256 &&
    evidence.localFileSha256 === expected.sha256 &&
    evidence.mediaType === expected.type &&
    evidence.attached === true && evidence.previewReady === true);
}

function hasStrongPublicationIdentity(evidence, publicationUrl) {
  const details = evidence?.verificationDetails;
  const candidate = details?.candidate;
  return evidence?.accountMatched === true && evidence?.targetMatched === true && evidence?.contentHashMatched === true &&
    details?.authorIdentity?.matched === true && details?.contentMatch?.matched === true &&
    candidate?.timestampMatched === true && Boolean(candidate?.postId || candidate?.activityUrn) &&
    Boolean(candidate?.permalink) && candidate.permalink === publicationUrl;
}

function assertNoSecrets(value, path = "contract") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) throw new Error(`Execution contract cannot include secret-like field ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function safeLinkedInPath(value, label) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    throw new Error(`${label} must be a LinkedIn URL`);
  }
}

export function validateSubmitAcceptanceEvidence(input) {
  if (!input || typeof input !== "object") return null;
  assertNoSecrets(input, "submitAcceptanceEvidence");
  const timestamp = (value, field) => {
    if (!value) return null;
    const normalized = String(value);
    if (!Number.isFinite(Date.parse(normalized))) throw new Error(`submitAcceptanceEvidence.${field} must be an ISO timestamp`);
    return normalized;
  };
  const enumValue = (value, allowed, field, fallback) => {
    const normalized = String(value || fallback).toUpperCase();
    if (!allowed.includes(normalized)) throw new Error(`submitAcceptanceEvidence.${field} is invalid`);
    return normalized;
  };
  const candidateInput = input.candidate && typeof input.candidate === "object" ? input.candidate : {};
  const activityUrn = candidateInput.activityUrn ? String(candidateInput.activityUrn).slice(0, 200) : null;
  if (activityUrn && !/^urn:li:(?:activity|share):[\w-]+$/.test(activityUrn)) throw new Error("submitAcceptanceEvidence.candidate.activityUrn is invalid");
  const candidate = {
    activityUrn,
    postId: (candidateInput.postId || candidateInput.activityId) ? String(candidateInput.postId || candidateInput.activityId).slice(0, 120) : null,
    permalink: safeLinkedInPath(candidateInput.permalink, "submitAcceptanceEvidence.candidate.permalink"),
    authorMatched: candidateInput.authorMatched === true,
    contentMatched: candidateInput.contentMatched === true,
    timestamp: timestamp(candidateInput.timestamp, "candidate.timestamp"),
    timestampMatched: candidateInput.timestampMatched === true
  };
  const clickCommandInput = input.clickCommandEvidence && typeof input.clickCommandEvidence === "object" ? input.clickCommandEvidence : null;
  const clickCommandEvidence = clickCommandInput ? {
    status: enumValue(clickCommandInput.status, ["COMMAND_COMPLETED", "OUTCOME_UNKNOWN"], "clickCommandEvidence.status", "OUTCOME_UNKNOWN"),
    observedAt: timestamp(clickCommandInput.observedAt, "clickCommandEvidence.observedAt"),
    transport: clickCommandInput.transport ? String(clickCommandInput.transport).slice(0, 80) : null,
    commandStatus: clickCommandInput.commandStatus ? String(clickCommandInput.commandStatus).toUpperCase().slice(0, 40) : null,
    targetIdentity: clickCommandInput.targetIdentity ? String(clickCommandInput.targetIdentity).slice(0, 160) : null,
    elementRef: clickCommandInput.elementRef ? String(clickCommandInput.elementRef).slice(0, 100) : null,
    commandStartedAt: timestamp(clickCommandInput.commandStartedAt, "clickCommandEvidence.commandStartedAt"),
    commandCompletedAt: timestamp(clickCommandInput.commandCompletedAt, "clickCommandEvidence.commandCompletedAt"),
    providerCallStarted: clickCommandInput.providerCallStarted === true ? true : clickCommandInput.providerCallStarted === false ? false : null,
    providerCallStartedAt: timestamp(clickCommandInput.providerCallStartedAt, "clickCommandEvidence.providerCallStartedAt"),
    providerResult: clickCommandInput.providerResult && typeof clickCommandInput.providerResult === "object" ? {
      clicked: clickCommandInput.providerResult.clicked ? String(clickCommandInput.providerResult.clicked).slice(0, 100) : null
    } : null,
    diagnostics: clickCommandInput.diagnostics && typeof clickCommandInput.diagnostics === "object" ? {
      trial: Number.isSafeInteger(Number(clickCommandInput.diagnostics.trial)) ? Number(clickCommandInput.diagnostics.trial) : null
    } : null,
    preflight: clickCommandInput.preflight && typeof clickCommandInput.preflight === "object" ? {
      status: enumValue(clickCommandInput.preflight.status, ["PASSED", "FAILED"], "clickCommandEvidence.preflight.status", "FAILED"),
      checkedAt: timestamp(clickCommandInput.preflight.checkedAt, "clickCommandEvidence.preflight.checkedAt"),
      controlIdentity: clickCommandInput.preflight.controlIdentity ? String(clickCommandInput.preflight.controlIdentity).toLowerCase().slice(0, 64) : null,
      controlRef: clickCommandInput.preflight.controlRef ? String(clickCommandInput.preflight.controlRef).slice(0, 100) : null,
      connected: clickCommandInput.preflight.connected === true,
      visible: clickCommandInput.preflight.visible === true,
      enabled: clickCommandInput.preflight.enabled === true,
      actionable: clickCommandInput.preflight.actionable === true,
      hitTargetMatched: clickCommandInput.preflight.hitTargetMatched === true,
      composerMatched: clickCommandInput.preflight.composerMatched === true,
      composerState: String(clickCommandInput.preflight.composerState || "UNKNOWN").toUpperCase().slice(0, 20),
      activeElement: clickCommandInput.preflight.activeElement && typeof clickCommandInput.preflight.activeElement === "object" ? {
        tagName: clickCommandInput.preflight.activeElement.tagName ? String(clickCommandInput.preflight.activeElement.tagName).slice(0, 30) : null,
        role: clickCommandInput.preflight.activeElement.role ? String(clickCommandInput.preflight.activeElement.role).slice(0, 40) : null,
        id: clickCommandInput.preflight.activeElement.id ? String(clickCommandInput.preflight.activeElement.id).slice(0, 100) : null,
        accessibleName: clickCommandInput.preflight.activeElement.accessibleName ? String(clickCommandInput.preflight.activeElement.accessibleName).slice(0, 120) : null,
        isTargetControl: clickCommandInput.preflight.activeElement.isTargetControl === true
      } : null,
      scrollPosition: clickCommandInput.preflight.scrollPosition && typeof clickCommandInput.preflight.scrollPosition === "object" ? {
        x: Number.isFinite(Number(clickCommandInput.preflight.scrollPosition.x)) ? Number(clickCommandInput.preflight.scrollPosition.x) : null,
        y: Number.isFinite(Number(clickCommandInput.preflight.scrollPosition.y)) ? Number(clickCommandInput.preflight.scrollPosition.y) : null
      } : null,
      stateHash: clickCommandInput.preflight.stateHash ? String(clickCommandInput.preflight.stateHash).toLowerCase().slice(0, 64) : null
    } : null
  } : null;
  if (clickCommandEvidence && !clickCommandEvidence.observedAt) throw new Error("submitAcceptanceEvidence.clickCommandEvidence.observedAt is required");
  const activationInput = input.controlActivationEvidence && typeof input.controlActivationEvidence === "object" ? input.controlActivationEvidence : null;
  const controlActivationEvidence = activationInput ? {
    status: enumValue(activationInput.status, ["CONTROL_ACTIVATED", "CONTROL_NOT_OBSERVED", "CONTROL_ACTIVATION_UNKNOWN", "CONTROL_CHANGED_UNEXPECTEDLY"], "controlActivationEvidence.status", "CONTROL_ACTIVATION_UNKNOWN"),
    observedAt: timestamp(activationInput.observedAt, "controlActivationEvidence.observedAt"),
    expectedTransition: activationInput.expectedTransition ? String(activationInput.expectedTransition).slice(0, 120) : null,
    observedTransitions: Array.isArray(activationInput.observedTransitions) ? activationInput.observedTransitions.map((signal) => String(signal).toLowerCase()).filter((signal) => /^[a-z0-9_:-]{1,80}$/.test(signal)).slice(0, 12) : [],
    signals: Array.isArray(activationInput.signals) ? activationInput.signals.map((signal) => String(signal).toLowerCase()).filter((signal) => /^[a-z0-9_:-]{1,80}$/.test(signal)).slice(0, 12) : [],
    controlIdentity: activationInput.controlIdentity ? String(activationInput.controlIdentity).toLowerCase().slice(0, 64) : null,
    beforeActiveElement: activationInput.beforeActiveElement && typeof activationInput.beforeActiveElement === "object" ? {
      tagName: activationInput.beforeActiveElement.tagName ? String(activationInput.beforeActiveElement.tagName).slice(0, 30) : null,
      role: activationInput.beforeActiveElement.role ? String(activationInput.beforeActiveElement.role).slice(0, 40) : null,
      id: activationInput.beforeActiveElement.id ? String(activationInput.beforeActiveElement.id).slice(0, 100) : null,
      accessibleName: activationInput.beforeActiveElement.accessibleName ? String(activationInput.beforeActiveElement.accessibleName).slice(0, 120) : null,
      isTargetControl: activationInput.beforeActiveElement.isTargetControl === true
    } : null,
    afterActiveElement: activationInput.afterActiveElement && typeof activationInput.afterActiveElement === "object" ? {
      tagName: activationInput.afterActiveElement.tagName ? String(activationInput.afterActiveElement.tagName).slice(0, 30) : null,
      role: activationInput.afterActiveElement.role ? String(activationInput.afterActiveElement.role).slice(0, 40) : null,
      id: activationInput.afterActiveElement.id ? String(activationInput.afterActiveElement.id).slice(0, 100) : null,
      accessibleName: activationInput.afterActiveElement.accessibleName ? String(activationInput.afterActiveElement.accessibleName).slice(0, 120) : null,
      isTargetControl: activationInput.afterActiveElement.isTargetControl === true
    } : null,
    beforeAriaExpanded: activationInput.beforeAriaExpanded === undefined ? null : activationInput.beforeAriaExpanded,
    afterAriaExpanded: activationInput.afterAriaExpanded === undefined ? null : activationInput.afterAriaExpanded,
    beforeRelatedComponentVisible: activationInput.beforeRelatedComponentVisible === undefined ? null : activationInput.beforeRelatedComponentVisible === true,
    afterRelatedComponentVisible: activationInput.afterRelatedComponentVisible === undefined ? null : activationInput.afterRelatedComponentVisible === true,
    beforeScrollPosition: activationInput.beforeScrollPosition && typeof activationInput.beforeScrollPosition === "object" ? {
      x: Number.isFinite(Number(activationInput.beforeScrollPosition.x)) ? Number(activationInput.beforeScrollPosition.x) : null,
      y: Number.isFinite(Number(activationInput.beforeScrollPosition.y)) ? Number(activationInput.beforeScrollPosition.y) : null
    } : null,
    afterScrollPosition: activationInput.afterScrollPosition && typeof activationInput.afterScrollPosition === "object" ? {
      x: Number.isFinite(Number(activationInput.afterScrollPosition.x)) ? Number(activationInput.afterScrollPosition.x) : null,
      y: Number.isFinite(Number(activationInput.afterScrollPosition.y)) ? Number(activationInput.afterScrollPosition.y) : null
    } : null,
    beforeStateHash: activationInput.beforeStateHash ? String(activationInput.beforeStateHash).toLowerCase().slice(0, 64) : null,
    afterStateHash: activationInput.afterStateHash ? String(activationInput.afterStateHash).toLowerCase().slice(0, 64) : null,
    activationConfidence: activationInput.activationConfidence ? String(activationInput.activationConfidence).toUpperCase().slice(0, 20) : "NONE"
  } : null;
  if (controlActivationEvidence && !controlActivationEvidence.observedAt) throw new Error("submitAcceptanceEvidence.controlActivationEvidence.observedAt is required");
  if (controlActivationEvidence?.status === "CONTROL_ACTIVATED" && !controlActivationEvidence.signals.length) throw new Error("CONTROL_ACTIVATED requires an observed transition signal");
  if (controlActivationEvidence?.status === "CONTROL_NOT_OBSERVED" && controlActivationEvidence.signals.length) throw new Error("CONTROL_NOT_OBSERVED cannot include activation signals");
  const controlInput = input.preClickControlEvidence && typeof input.preClickControlEvidence === "object" ? input.preClickControlEvidence : null;
  const boxInput = controlInput?.boundingBox && typeof controlInput.boundingBox === "object" ? controlInput.boundingBox : null;
  const boundingBox = boxInput && [boxInput.x, boxInput.y, boxInput.width, boxInput.height].every((value) => Number.isFinite(Number(value)))
    ? { x: Number(boxInput.x), y: Number(boxInput.y), width: Number(boxInput.width), height: Number(boxInput.height) } : null;
  const preClickControlEvidence = controlInput ? {
    role: controlInput.role ? String(controlInput.role).slice(0, 40) : null,
    accessibleName: controlInput.accessibleName ? String(controlInput.accessibleName).replace(/[\r\n\t]+/g, " ").slice(0, 120) : null,
    controlRef: controlInput.controlRef ? String(controlInput.controlRef).slice(0, 100) : null,
    controlIdentity: controlInput.controlIdentity ? String(controlInput.controlIdentity).toLowerCase().slice(0, 64) : null,
    visible: controlInput.visible === true,
    connected: controlInput.connected === true,
    enabled: controlInput.enabled === true,
    busy: controlInput.busy === true,
    actionable: controlInput.actionable === true,
    ariaExpanded: controlInput.ariaExpanded === undefined ? null : controlInput.ariaExpanded,
    ariaPressed: controlInput.ariaPressed === undefined ? null : controlInput.ariaPressed,
    composerState: enumValue(controlInput.composerState, ["OPEN", "CLOSED", "UNKNOWN"], "preClickControlEvidence.composerState", "UNKNOWN"),
    composerMatched: controlInput.composerMatched === true,
    composerCount: Number.isFinite(Number(controlInput.composerCount)) ? Number(controlInput.composerCount) : 0,
    buttonCount: Number.isFinite(Number(controlInput.buttonCount)) ? Number(controlInput.buttonCount) : 0,
    hitTargetMatched: controlInput.hitTargetMatched === true,
    boundingBox,
    url: safeLinkedInPath(controlInput.url, "submitAcceptanceEvidence.preClickControlEvidence.url"),
    capturedAt: timestamp(controlInput.capturedAt, "preClickControlEvidence.capturedAt"),
    ownershipProof: controlInput.ownershipProof && typeof controlInput.ownershipProof === "object" ? {
      composerId: controlInput.ownershipProof.composerId ? String(controlInput.ownershipProof.composerId).slice(0, 200) : null,
      composerCount: Number.isFinite(Number(controlInput.ownershipProof.composerCount)) ? Number(controlInput.ownershipProof.composerCount) : 0,
      editorCount: Number.isFinite(Number(controlInput.ownershipProof.editorCount)) ? Number(controlInput.ownershipProof.editorCount) : 0,
      editorPayloadHash: controlInput.ownershipProof.editorPayloadHash ? String(controlInput.ownershipProof.editorPayloadHash).toLowerCase().slice(0, 64) : null,
      expectedPayloadHash: controlInput.ownershipProof.expectedPayloadHash ? String(controlInput.ownershipProof.expectedPayloadHash).toLowerCase().slice(0, 64) : null,
      payloadMatched: controlInput.ownershipProof.payloadMatched === true,
      publicationVisibility: controlInput.ownershipProof.visibility ? String(controlInput.ownershipProof.visibility).toUpperCase().slice(0, 40) : null,
      visibilityLabels: Array.isArray(controlInput.ownershipProof.visibilityLabels)
        ? controlInput.ownershipProof.visibilityLabels.slice(0, 12).map((label) => String(label).replace(/[\r\n\t]+/g, " ").slice(0, 120))
        : [],
      visibilityMatched: controlInput.ownershipProof.visibilityMatched === true,
      ownedControlCount: Number.isFinite(Number(controlInput.ownershipProof.ownedControlCount)) ? Number(controlInput.ownershipProof.ownedControlCount) : 0,
      globalControlCount: Number.isFinite(Number(controlInput.ownershipProof.globalControlCount)) ? Number(controlInput.ownershipProof.globalControlCount) : 0,
      controlBelongsToComposer: controlInput.ownershipProof.controlBelongsToComposer === true,
      structuralEvidenceVersion: Number.isSafeInteger(Number(controlInput.ownershipProof.structuralEvidenceVersion)) ? Number(controlInput.ownershipProof.structuralEvidenceVersion) : 0
    } : null
  } : null;
  if (preClickControlEvidence?.controlIdentity && !/^[a-f0-9]{64}$/.test(preClickControlEvidence.controlIdentity)) throw new Error("submitAcceptanceEvidence.preClickControlEvidence.controlIdentity is invalid");
  if (preClickControlEvidence && (!preClickControlEvidence.visible || !preClickControlEvidence.connected || !preClickControlEvidence.enabled || preClickControlEvidence.busy ||
    !preClickControlEvidence.composerMatched || !preClickControlEvidence.hitTargetMatched || !preClickControlEvidence.boundingBox ||
    preClickControlEvidence.boundingBox.width <= 0 || preClickControlEvidence.boundingBox.height <= 0)) {
    throw new Error("preClickControlEvidence must identify a visible actionable control inside the active composer");
  }
  const evidence = {
    clickStatus: enumValue(input.clickStatus, ["CLICK_EMITTED", "UNKNOWN"], "clickStatus", "UNKNOWN"),
    clickEmittedAt: timestamp(input.clickEmittedAt, "clickEmittedAt"),
    clickCommandEvidence,
    preClickControlEvidence,
    controlActivationEvidence,
    postClickObservedAt: timestamp(input.postClickObservedAt, "postClickObservedAt"),
    platformAcceptance: enumValue(input.platformAcceptance, ["ACCEPTED", "REJECTED", "UNKNOWN"], "platformAcceptance", "UNKNOWN"),
    acceptanceSource: enumValue(input.acceptanceSource, ["SUCCESS_CONFIRMATION", "STABLE_PUBLICATION_IDENTITY", "VISIBLE_PLATFORM_ERROR", "NONE"], "acceptanceSource", "NONE"),
    observedAt: timestamp(input.observedAt, "observedAt"),
    composerState: enumValue(input.composerState, ["OPEN", "CLOSED", "UNKNOWN"], "composerState", "UNKNOWN"),
    postButtonState: enumValue(input.postButtonState, ["ENABLED", "DISABLED", "SUBMITTING", "DISAPPEARED", "UNKNOWN"], "postButtonState", "UNKNOWN"),
    confirmationState: enumValue(input.confirmationState, ["SUCCESS", "ERROR", "NONE", "UNKNOWN"], "confirmationState", "UNKNOWN"),
    confirmationText: input.confirmationText ? String(input.confirmationText).replace(/[\r\n\t]+/g, " ").slice(0, 240) : null,
    errorReasonCode: input.errorReasonCode ? String(input.errorReasonCode).toLowerCase().slice(0, 80) : null,
    errorText: input.errorText ? String(input.errorText).replace(/[\r\n\t]+/g, " ").slice(0, 240) : null,
    urlBefore: safeLinkedInPath(input.urlBefore, "submitAcceptanceEvidence.urlBefore"),
    urlAfter: safeLinkedInPath(input.urlAfter, "submitAcceptanceEvidence.urlAfter"),
    candidate
  };
  if (evidence.errorReasonCode && !/^[a-z0-9_:-]+$/.test(evidence.errorReasonCode)) throw new Error("submitAcceptanceEvidence.errorReasonCode is invalid");
  if (evidence.platformAcceptance === "ACCEPTED") {
    const successUi = evidence.acceptanceSource === "SUCCESS_CONFIRMATION" && evidence.confirmationState === "SUCCESS";
    const stableCandidate = evidence.acceptanceSource === "STABLE_PUBLICATION_IDENTITY" && candidate.authorMatched && candidate.contentMatched && candidate.timestampMatched && Boolean(candidate.postId || candidate.activityUrn) && Boolean(candidate.permalink);
    if (!successUi && !stableCandidate) throw new Error("Submit acceptance requires an explicit success confirmation or strong publication identity");
  }
  if (evidence.platformAcceptance === "REJECTED" && (evidence.acceptanceSource !== "VISIBLE_PLATFORM_ERROR" || evidence.confirmationState !== "ERROR" || !evidence.errorReasonCode)) {
    throw new Error("Submit rejection requires a visible platform error and normalized reason code");
  }
  if (evidence.clickStatus === "CLICK_EMITTED" && !evidence.clickEmittedAt) throw new Error("CLICK_EMITTED requires clickEmittedAt");
  return evidence;
}

export function contentSha256(content) {
  return createHash("sha256").update(String(content || "")).digest("hex");
}

export function validateExecutionRequestV1(input) {
  if (!input || typeof input !== "object" || input.schemaVersion !== EXECUTION_REQUEST_SCHEMA_VERSION) {
    throw new Error("ExecutionRequestV1 schemaVersion must equal 1");
  }
  assertNoSecrets(input);
  const request = {
    schemaVersion: 1,
    executionId: required(input.executionId, "executionId"),
    jobId: required(input.jobId, "jobId"),
    campaignId: required(input.campaignId, "campaignId"),
    platform: required(input.platform, "platform"),
    provider: canonicalProvider(input.provider, { allowLegacy: true }),
    accountId: required(input.accountId, "accountId"),
    profileId: required(input.profileId, "profileId"),
    providerProfileId: required(input.providerProfileId || input.profileId, "providerProfileId"),
    identityReference: canonicalIdentityUrl(input.identityReference || input.expectedIdentityUrl),
    target: {
      targetId: required(input.target?.targetId, "target.targetId"),
      url: required(input.target?.url, "target.url"),
      identityReference: canonicalIdentityUrl(input.target?.identityReference || input.target?.expectedIdentityUrl)
    },
    audience: required(input.audience, "audience"),
    publicationVisibility: normalizePublicationVisibility(input.publicationVisibility || "PUBLIC"),
    testJob: input.testJob === true,
    dryRun: input.dryRun === true,
    content: {
      contentId: required(input.content?.contentId, "content.contentId"),
      sha256: required(input.content?.sha256, "content.sha256").toLowerCase(),
      payload: String(input.content?.payload ?? "")
    },
    media: Array.isArray(input.media) ? input.media.map((item, index) => ({
      artifactId: required(item.artifactId, `media[${index}].artifactId`),
      reference: required(item.reference, `media[${index}].reference`),
      sha256: required(item.sha256, `media[${index}].sha256`).toLowerCase(),
      type: required(item.type, `media[${index}].type`)
    })) : [],
    authorization: {
      authorizationId: required(input.authorization?.authorizationId, "authorization.authorizationId"),
      binding: required(input.authorization?.binding, "authorization.binding")
    },
    liveGrant: input.liveGrant ? { grantId: required(input.liveGrant.grantId, "liveGrant.grantId") } : null,
    oneTimeWindow: input.oneTimeWindow ? { windowId: required(input.oneTimeWindow.windowId, "oneTimeWindow.windowId") } : null,
    idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
    readiness: {
      state: required(input.readiness?.state, "readiness.state"),
      checkedAt: required(input.readiness?.checkedAt, "readiness.checkedAt"),
      expiresAt: required(input.readiness?.expiresAt, "readiness.expiresAt"),
      binding: required(input.readiness?.binding, "readiness.binding")
    },
    createdAt: required(input.createdAt, "createdAt")
  };
  if (!sha256Pattern.test(request.content.sha256) || request.content.sha256 !== contentSha256(request.content.payload)) {
    throw new Error("ExecutionRequestV1 content hash does not match payload");
  }
  if (request.media.some((item) => !sha256Pattern.test(item.sha256))) throw new Error("ExecutionRequestV1 media entries require SHA-256 digests");
  if (request.readiness.state !== "READY") throw new Error("ExecutionRequestV1 requires READY readiness");
  if (request.provider !== "orca" && !request.identityReference) throw new Error("Provider-aware ExecutionRequestV1 requires verified identityReference");
  for (const field of ["checkedAt", "expiresAt", "createdAt"]) {
    if (!Number.isFinite(Date.parse(request[field] || request.readiness[field] || ""))) throw new Error(`ExecutionRequestV1 ${field} must be an ISO timestamp`);
  }
  if (Date.parse(request.readiness.expiresAt) <= Date.parse(request.readiness.checkedAt)) throw new Error("ExecutionRequestV1 readiness expiry must follow checkedAt");
  return request;
}

export function validateExecutionReceiptV1(input) {
  if (!input || typeof input !== "object" || input.schemaVersion !== EXECUTION_RECEIPT_SCHEMA_VERSION) {
    throw new Error("ExecutionReceiptV1 schemaVersion must equal 1");
  }
  assertNoSecrets(input);
  const receipt = {
    schemaVersion: 1,
    executionId: required(input.executionId, "executionId"),
    jobId: required(input.jobId, "jobId"),
    ...(input.provider ? { provider: canonicalProvider(input.provider, { allowLegacy: true }) } : {}),
    ...(input.providerProfileId ? { providerProfileId: String(input.providerProfileId).trim() } : {}),
    ...(input.identityReference ? { identityReference: canonicalIdentityUrl(input.identityReference) } : {}),
    ...(input.targetUrl ? { targetUrl: String(input.targetUrl).trim() } : {}),
    attempt: Number(input.attempt),
    startedAt: required(input.startedAt, "startedAt"),
    finishedAt: required(input.finishedAt, "finishedAt"),
    readinessResult: {
      state: required(input.readinessResult?.state, "readinessResult.state").toUpperCase(),
      checkedAt: required(input.readinessResult?.checkedAt, "readinessResult.checkedAt"),
      reasonCode: String(input.readinessResult?.reasonCode || "ready").slice(0, 80),
      expiresAt: input.readinessResult?.expiresAt ? String(input.readinessResult.expiresAt) : null,
      evidenceReference: input.readinessResult?.evidenceReference ? String(input.readinessResult.evidenceReference).slice(0, 240) : null
    },
    preSubmitFailure: input.preSubmitFailure && typeof input.preSubmitFailure === "object" ? {
      reasonCode: required(input.preSubmitFailure.reasonCode, "preSubmitFailure.reasonCode").slice(0, 80),
      stage: required(input.preSubmitFailure.stage, "preSubmitFailure.stage").slice(0, 80),
      gate: input.preSubmitFailure.gate ? String(input.preSubmitFailure.gate).slice(0, 80) : null,
      gateStatus: typeof input.preSubmitFailure.gateStatus === "boolean" ? input.preSubmitFailure.gateStatus : null
    } : null,
    reasonCode: input.reasonCode ? String(input.reasonCode).slice(0, 80) : null,
    submitBoundaryAttemptedAt: input.submitBoundaryAttemptedAt ? String(input.submitBoundaryAttemptedAt) : null,
    submitAcceptanceEvidence: validateSubmitAcceptanceEvidence(input.submitAcceptanceEvidence),
    submitState: required(input.submitState, "submitState").toUpperCase(),
    dryRun: input.dryRun === true,
    publicationUrl: input.publicationUrl ? String(input.publicationUrl) : null,
    publicationReference: input.publicationReference ? String(input.publicationReference) : null,
    publicationEvidence: input.publicationEvidence && typeof input.publicationEvidence === "object" ? {
      verifiedAt: required(input.publicationEvidence.verifiedAt, "publicationEvidence.verifiedAt"),
      accountMatched: input.publicationEvidence.accountMatched === true,
      targetMatched: input.publicationEvidence.targetMatched === true,
      contentHashMatched: input.publicationEvidence.contentHashMatched === true,
      mediaHashMatched: input.publicationEvidence.mediaHashMatched === true,
      accountId: required(input.publicationEvidence.accountId, "publicationEvidence.accountId"),
      profileId: required(input.publicationEvidence.profileId, "publicationEvidence.profileId"),
      targetId: required(input.publicationEvidence.targetId, "publicationEvidence.targetId"),
      contentHash: required(input.publicationEvidence.contentHash, "publicationEvidence.contentHash"),
      mediaHash: input.publicationEvidence.mediaHash ? String(input.publicationEvidence.mediaHash).toLowerCase() : null,
      verificationMethod: required(input.publicationEvidence.verificationMethod, "publicationEvidence.verificationMethod"),
      evidenceReference: input.publicationEvidence.evidenceReference ? String(input.publicationEvidence.evidenceReference) : null,
      preSubmitMediaIntegrity: input.publicationEvidence.preSubmitMediaIntegrity ? {
        artifactId: required(input.publicationEvidence.preSubmitMediaIntegrity.artifactId, "publicationEvidence.preSubmitMediaIntegrity.artifactId"),
        expectedSha256: required(input.publicationEvidence.preSubmitMediaIntegrity.expectedSha256, "publicationEvidence.preSubmitMediaIntegrity.expectedSha256").toLowerCase(),
        localFileSha256: required(input.publicationEvidence.preSubmitMediaIntegrity.localFileSha256, "publicationEvidence.preSubmitMediaIntegrity.localFileSha256").toLowerCase(),
        mediaType: required(input.publicationEvidence.preSubmitMediaIntegrity.mediaType, "publicationEvidence.preSubmitMediaIntegrity.mediaType"),
        attached: input.publicationEvidence.preSubmitMediaIntegrity.attached === true,
        previewReady: input.publicationEvidence.preSubmitMediaIntegrity.previewReady === true
      } : null,
      verificationDetails: input.publicationEvidence.verificationDetails && typeof input.publicationEvidence.verificationDetails === "object" ? {
        executionId: input.publicationEvidence.verificationDetails.executionId ? String(input.publicationEvidence.verificationDetails.executionId) : null,
        submittedAt: input.publicationEvidence.verificationDetails.submittedAt ? String(input.publicationEvidence.verificationDetails.submittedAt) : null,
        observedAt: input.publicationEvidence.verificationDetails.observedAt ? String(input.publicationEvidence.verificationDetails.observedAt) : null,
        authorIdentity: input.publicationEvidence.verificationDetails.authorIdentity ? {
          expectedPath: String(input.publicationEvidence.verificationDetails.authorIdentity.expectedPath || ""),
          observedPath: input.publicationEvidence.verificationDetails.authorIdentity.observedPath ? String(input.publicationEvidence.verificationDetails.authorIdentity.observedPath) : null,
          matched: input.publicationEvidence.verificationDetails.authorIdentity.matched === true
        } : null,
        contentMatch: input.publicationEvidence.verificationDetails.contentMatch ? {
          expectedSha256: String(input.publicationEvidence.verificationDetails.contentMatch.expectedSha256 || ""),
          matched: input.publicationEvidence.verificationDetails.contentMatch.matched === true
        } : null,
        candidate: input.publicationEvidence.verificationDetails.candidate ? {
          surface: input.publicationEvidence.verificationDetails.candidate.surface ? String(input.publicationEvidence.verificationDetails.candidate.surface) : null,
          activityUrn: input.publicationEvidence.verificationDetails.candidate.activityUrn ? String(input.publicationEvidence.verificationDetails.candidate.activityUrn) : null,
          postId: input.publicationEvidence.verificationDetails.candidate.postId ? String(input.publicationEvidence.verificationDetails.candidate.postId) : null,
          permalink: input.publicationEvidence.verificationDetails.candidate.permalink ? String(input.publicationEvidence.verificationDetails.candidate.permalink) : null,
          timestamp: input.publicationEvidence.verificationDetails.candidate.timestamp ? String(input.publicationEvidence.verificationDetails.candidate.timestamp) : null,
          timestampMatched: input.publicationEvidence.verificationDetails.candidate.timestampMatched === true
        } : null,
        media: input.publicationEvidence.verificationDetails.media ? {
          present: input.publicationEvidence.verificationDetails.media.present === true,
          type: input.publicationEvidence.verificationDetails.media.type ? String(input.publicationEvidence.verificationDetails.media.type) : null,
          hashStatus: String(input.publicationEvidence.verificationDetails.media.hashStatus || "NOT_VERIFIABLE")
        } : null,
        confirmationSignals: Array.isArray(input.publicationEvidence.verificationDetails.confirmationSignals)
          ? input.publicationEvidence.verificationDetails.confirmationSignals.slice(0, 5).map((item) => String(item).slice(0, 200))
          : []
      } : null
    } : null,
    reconciliation: input.reconciliation === true,
    errorClassification: String(input.errorClassification || "NONE").toUpperCase(),
    recoveryClassification: String(input.recoveryClassification || "NONE").toUpperCase(),
    uploadFailure: input.uploadFailure ? {
      subreason: required(input.uploadFailure.subreason, "uploadFailure.subreason").toUpperCase(),
      dialogCount: Number(input.uploadFailure.dialogCount ?? 0),
      fileInputCount: Number(input.uploadFailure.fileInputCount ?? 0),
      selectedSurface: String(input.uploadFailure.selectedSurface || "unknown").slice(0, 40),
      waitDurationMs: Number(input.uploadFailure.waitDurationMs ?? 0),
      attachAttempted: input.uploadFailure.attachAttempted === true,
      previewObserved: input.uploadFailure.previewObserved === true
    } : null,
    telemetry: {
      durationMs: Number(input.telemetry?.durationMs ?? 0),
      browserCommands: Number(input.telemetry?.browserCommands ?? 0),
      computerUseCalls: Number(input.telemetry?.computerUseCalls ?? 0),
      retries: Number(input.telemetry?.retries ?? 0),
      readinessRefreshMs: Number(input.telemetry?.readinessRefreshMs ?? 0),
      queueToWorkerMs: Number(input.telemetry?.queueToWorkerMs ?? 0),
      leaseAcquireMs: Number(input.telemetry?.leaseAcquireMs ?? 0),
      profileAcquireMs: Number(input.telemetry?.profileAcquireMs ?? 0),
      navigationMs: Number(input.telemetry?.navigationMs ?? 0),
      targetVerifyMs: Number(input.telemetry?.targetVerifyMs ?? 0),
      composerOpenMs: Number(input.telemetry?.composerOpenMs ?? 0),
      contentFillMs: Number(input.telemetry?.contentFillMs ?? 0),
      mediaAttachMs: Number(input.telemetry?.mediaAttachMs ?? 0),
      mediaReadyMs: Number(input.telemetry?.mediaReadyMs ?? 0),
      mediaControlOpenMs: Number(input.telemetry?.mediaControlOpenMs ?? 0),
      uploadTargetDiscoveryMs: Number(input.telemetry?.uploadTargetDiscoveryMs ?? 0),
      fileAttachMs: Number(input.telemetry?.fileAttachMs ?? 0),
      preSubmitVerifyMs: Number(input.telemetry?.preSubmitVerifyMs ?? 0),
      cleanupMs: Number(input.telemetry?.cleanupMs ?? 0),
      totalDryRunMs: Number(input.telemetry?.totalDryRunMs ?? 0),
      domClickFallbacks: Number(input.telemetry?.domClickFallbacks ?? 0)
    },
    verificationGates: input.verificationGates && typeof input.verificationGates === "object"
      ? Object.fromEntries(Object.entries(input.verificationGates).filter(([, value]) => typeof value === "boolean"))
      : null
  };
  if (!Number.isSafeInteger(receipt.attempt) || receipt.attempt < 1) throw new Error("ExecutionReceiptV1 attempt must be a positive integer");
  if (receipt.providerProfileId && !receipt.providerProfileId.length) throw new Error("ExecutionReceiptV1 providerProfileId must not be empty");
  if (receipt.provider && receipt.provider !== "orca" && (!receipt.providerProfileId || !receipt.identityReference || !receipt.targetUrl)) {
    throw new Error("Provider-aware ExecutionReceiptV1 requires exact profile, identity, and target binding");
  }
  for (const field of ["startedAt", "finishedAt"]) if (!Number.isFinite(Date.parse(receipt[field]))) throw new Error(`ExecutionReceiptV1 ${field} must be an ISO timestamp`);
  if (receipt.submitBoundaryAttemptedAt && !Number.isFinite(Date.parse(receipt.submitBoundaryAttemptedAt))) throw new Error("ExecutionReceiptV1 submitBoundaryAttemptedAt must be an ISO timestamp");
  if (Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)) throw new Error("ExecutionReceiptV1 finishedAt cannot precede startedAt");
  if (!new Set(["READY", "BLOCKED", "HUMAN_REQUIRED", "UNKNOWN"]).has(receipt.readinessResult.state)) throw new Error("ExecutionReceiptV1 readinessResult state is invalid");
  if (!SUBMIT_STATES.includes(receipt.submitState)) throw new Error("ExecutionReceiptV1 submitState is invalid");
  if (receipt.dryRun && receipt.submitState !== "NOT_STARTED") throw new Error("A dry-run receipt must remain NOT_STARTED");
  if (!errorClasses.has(receipt.errorClassification)) throw new Error("ExecutionReceiptV1 errorClassification is invalid");
  if (!recoveryClasses.has(receipt.recoveryClassification)) throw new Error("ExecutionReceiptV1 recoveryClassification is invalid");
  if (receipt.uploadFailure) {
    const subreasons = new Set(["MEDIA_DIALOG_NOT_FOUND", "MEDIA_DIALOG_AMBIGUOUS", "FILE_INPUT_NOT_MOUNTED", "FILE_INPUT_NOT_FOUND", "FILE_INPUT_AMBIGUOUS", "FILE_ATTACH_FAILED", "MEDIA_PREVIEW_NOT_FOUND", "MEDIA_PREVIEW_TIMEOUT", "MEDIA_PREVIEW_INVALID"]);
    if (receipt.errorClassification !== "UPLOAD_ERROR" || !subreasons.has(receipt.uploadFailure.subreason)) throw new Error("ExecutionReceiptV1 uploadFailure is invalid");
    if (!/^[a-z_]{2,40}$/.test(receipt.uploadFailure.selectedSurface)) throw new Error("ExecutionReceiptV1 uploadFailure.selectedSurface is invalid");
    for (const field of ["dialogCount", "fileInputCount", "waitDurationMs"]) {
      if (!Number.isSafeInteger(receipt.uploadFailure[field]) || receipt.uploadFailure[field] < 0) throw new Error(`ExecutionReceiptV1 uploadFailure.${field} is invalid`);
    }
  }
  for (const [name, value] of Object.entries(receipt.telemetry)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ExecutionReceiptV1 telemetry.${name} must be a nonnegative integer`);
  }
  if (receipt.submitState === "CONFIRMED" && !receipt.publicationUrl && !receipt.publicationReference) {
    throw new Error("CONFIRMED receipt requires a publication URL or reference");
  }
  if (receipt.submitState === "CONFIRMED" && (!receipt.publicationEvidence || receipt.publicationEvidence.accountMatched !== true || receipt.publicationEvidence.targetMatched !== true || receipt.publicationEvidence.contentHashMatched !== true)) throw new Error("CONFIRMED receipt requires positive account, target, and content evidence");
  if (receipt.dryRun && (receipt.publicationUrl || receipt.publicationReference || receipt.publicationEvidence)) {
    throw new Error("Dry-run receipt cannot contain publication evidence");
  }
  if (receipt.dryRun && (receipt.publicationUrl || receipt.publicationReference || receipt.publicationEvidence)) {
    throw new Error("Dry-run receipt cannot contain publication evidence");
  }
  if (receipt.publicationEvidence && !Number.isFinite(Date.parse(receipt.publicationEvidence.verifiedAt))) throw new Error("publicationEvidence.verifiedAt must be an ISO timestamp");
  if (receipt.publicationEvidence && !/^[a-f0-9]{64}$/i.test(receipt.publicationEvidence.contentHash)) throw new Error("publicationEvidence.contentHash must be a SHA-256 digest");
  if (receipt.publicationEvidence?.mediaHash && !/^[a-f0-9]{64}$/i.test(receipt.publicationEvidence.mediaHash)) throw new Error("publicationEvidence.mediaHash must be a SHA-256 digest");
  if (receipt.publicationEvidence?.preSubmitMediaIntegrity) {
    const integrity = receipt.publicationEvidence.preSubmitMediaIntegrity;
    if (!sha256Pattern.test(integrity.expectedSha256) || !sha256Pattern.test(integrity.localFileSha256)) throw new Error("preSubmitMediaIntegrity hashes must be SHA-256 digests");
  }
  if (receipt.publicationEvidence?.verificationDetails) {
    const details = receipt.publicationEvidence.verificationDetails;
    for (const field of ["submittedAt", "observedAt"]) {
      if (details[field] && !Number.isFinite(Date.parse(details[field]))) throw new Error(`publicationEvidence.verificationDetails.${field} must be an ISO timestamp`);
    }
    if (details.candidate?.timestamp && !Number.isFinite(Date.parse(details.candidate.timestamp))) throw new Error("publicationEvidence.verificationDetails.candidate.timestamp must be an ISO timestamp");
    if (details.contentMatch?.expectedSha256 && !/^[a-f0-9]{64}$/i.test(details.contentMatch.expectedSha256)) throw new Error("publicationEvidence.verificationDetails.contentMatch.expectedSha256 must be a SHA-256 digest");
    if (details.media && !["MATCHED", "NOT_VERIFIABLE", "MISMATCHED"].includes(details.media.hashStatus)) throw new Error("publicationEvidence.verificationDetails.media.hashStatus is invalid");
    if (details.executionId && details.executionId !== receipt.executionId) throw new Error("publicationEvidence.verificationDetails.executionId must match the receipt");
    if (details.contentMatch?.expectedSha256 && details.contentMatch.expectedSha256 !== receipt.publicationEvidence.contentHash) throw new Error("publicationEvidence content identity does not match verification details");
    if (details.submittedAt && details.observedAt && Date.parse(details.observedAt) < Date.parse(details.submittedAt)) throw new Error("publicationEvidence observation cannot precede submission");
    if (details.media && details.media.hashStatus !== "MATCHED" && receipt.publicationEvidence.mediaHashMatched) throw new Error("Unverified media identity cannot be recorded as mediaHashMatched");
    if (details.media?.hashStatus === "NOT_VERIFIABLE" && (receipt.publicationEvidence.mediaHash !== null || receipt.publicationEvidence.mediaHashMatched)) throw new Error("NOT_VERIFIABLE publication media cannot claim a matched hash");
    if (details.media?.hashStatus === "MISMATCHED" && receipt.submitState === "CONFIRMED") throw new Error("MISMATCHED publication media cannot be confirmed");
    if (receipt.submitState === "CONFIRMED" && details.media?.hashStatus === "NOT_VERIFIABLE" &&
        (!receipt.publicationEvidence.preSubmitMediaIntegrity || !hasStrongPublicationIdentity(receipt.publicationEvidence, receipt.publicationUrl))) {
      throw new Error("NOT_VERIFIABLE publication media requires pre-submit integrity and strong publication identity evidence");
    }
  }
  if (["SUBMIT_SENT", "UNKNOWN"].includes(receipt.submitState) && receipt.recoveryClassification === "RECOVERABLE") {
    throw new Error("A possibly submitted execution cannot be classified as safely recoverable");
  }
  return receipt;
}

export function createExecutionRequestV1({ executionId, post, target, account, authorization, readiness, artifact, liveGrant = null, oneTimeWindowId = null, dryRun = false, createdAt = new Date().toISOString() }) {
  return validateExecutionRequestV1({
    schemaVersion: 1,
    executionId,
    liveGrant: liveGrant ? { grantId: liveGrant.grantId } : null,
    jobId: post.id,
    campaignId: post.campaignId,
    platform: target.channel,
    provider: target.provider || account.provider,
    accountId: account.accountId,
    profileId: account.profileId,
    providerProfileId: target.providerProfileId || account.providerProfileId || target.profileId,
    identityReference: target.identityReference || target.expectedIdentityUrl || account.identityReference || account.expectedIdentityUrl,
    target: { targetId: target.id, url: target.url, identityReference: target.identityReference || target.expectedIdentityUrl || account.identityReference || account.expectedIdentityUrl },
    audience: post.audience,
    publicationVisibility: post.publicationVisibility || "PUBLIC",
    testJob: post.testJob === true,
    dryRun,
    content: { contentId: post.contentId, sha256: contentSha256(post.content), payload: post.content },
    media: artifact ? [{ artifactId: artifact.id, reference: artifact.path, sha256: artifact.sha256, type: artifact.mimeType || artifact.mediaType || "application/octet-stream" }] : [],
    authorization: { authorizationId: authorization.id, binding: authorization.binding },
    oneTimeWindow: oneTimeWindowId ? { windowId: oneTimeWindowId } : null,
    idempotencyKey: post.idempotencyKey,
    readiness: { state: "READY", checkedAt: readiness.checkedAt, expiresAt: readiness.expiresAt, binding: readiness.binding },
    createdAt
  });
}

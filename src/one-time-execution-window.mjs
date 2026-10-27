import { createHash } from "node:crypto";
import { canonicalIdentityUrl, canonicalProvider, canonicalTargetUrl } from "./execution-binding.mjs";

const STATUSES = new Set(["ACTIVE", "RESERVED", "CONSUMED", "EXPIRED", "REVOKED"]);

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function immutableScope(window) {
  const scope = {
    schemaVersion: window.schemaVersion,
    windowId: window.windowId,
    campaignId: window.campaignId,
    campaignAuthorizationId: window.campaignAuthorizationId,
    jobId: window.jobId,
    authorizationFingerprint: window.authorizationFingerprint,
    validFrom: window.validFrom,
    validUntil: window.validUntil,
    timezone: window.timezone,
    maxExecutions: window.maxExecutions
  };
  if (window.provider || window.providerProfileId) Object.assign(scope, {
    platform: window.platform,
    provider: canonicalProvider(window.provider, { allowLegacy: true }),
    providerProfileId: window.providerProfileId,
    identityReference: canonicalIdentityUrl(window.identityReference),
    accountId: window.accountId,
    targetId: window.targetId,
    targetUrl: canonicalTargetUrl(window.targetUrl)
  });
  return scope;
}

export function oneTimeExecutionWindowFingerprint(window) {
  return digest(immutableScope(window));
}

export function normalizeOneTimeExecutionWindow(input, { post, authorization, authorizationFingerprint, binding = null, now = new Date(), createdBy }) {
  if (!post || !authorization || post.campaignId !== authorization.campaignId || post.campaignAuthorizationId !== authorization.id) {
    throw new Error("One-time window job must belong to the referenced campaign authorization");
  }
  if (required(input.campaignId, "campaignId") !== post.campaignId ||
      required(input.campaignAuthorizationId, "campaignAuthorizationId") !== authorization.id ||
      required(input.jobId, "jobId") !== post.id) {
    throw new Error("One-time execution window must bind the exact job and campaign authorization");
  }
  const validFrom = required(input.validFrom, "validFrom");
  const validUntil = required(input.validUntil, "validUntil");
  const fromMs = Date.parse(validFrom);
  const untilMs = Date.parse(validUntil);
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) throw new Error("One-time execution window requires a valid, increasing absolute time range");
  if (untilMs <= now.getTime()) throw new Error("One-time execution window must not already be expired");
  const timezone = required(input.timezone || input.displayTimezone || "UTC", "timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(now); } catch { throw new Error("One-time execution window timezone is invalid"); }
  if (input.maxExecutions !== undefined && Number(input.maxExecutions) !== 1) throw new Error("One-time execution window maxExecutions must equal 1");
  const window = {
    windowId: required(input.windowId || `one-time-window-${Date.now()}`, "windowId"),
    schemaVersion: 1,
    campaignId: post.campaignId,
    campaignAuthorizationId: authorization.id,
    jobId: post.id,
    authorizationFingerprint: required(authorizationFingerprint, "authorizationFingerprint"),
    validFrom: new Date(fromMs).toISOString(),
    validUntil: new Date(untilMs).toISOString(),
    timezone,
    status: "ACTIVE",
    reservedExecutionId: null,
    consumedExecutionId: null,
    maxExecutions: 1,
    createdAt: now.toISOString(),
    createdBy: required(createdBy, "createdBy"),
    reason: required(input.reason, "reason"),
    ...(binding && (binding.provider || binding.providerProfileId) ? {
      platform: required(binding.platform, "platform"),
      provider: canonicalProvider(binding.provider, { allowLegacy: true }),
      providerProfileId: required(binding.providerProfileId || binding.profileId, "providerProfileId"),
      identityReference: canonicalIdentityUrl(binding.identityReference || binding.expectedIdentityUrl),
      accountId: required(binding.accountId, "accountId"),
      targetId: required(binding.targetId, "targetId"),
      targetUrl: canonicalTargetUrl(binding.targetUrl || binding.url)
    } : {})
  };
  // Legacy rows have no provider fields and retain their historical digest.
  // Only an explicitly provider-aware row requires a verified identity.
  if (window.provider && window.provider !== "orca" && !window.identityReference) throw new Error("Provider-aware one-time window requires verified identityReference");
  window.binding = oneTimeExecutionWindowFingerprint(window);
  return window;
}

export function oneTimeExecutionWindowStatus(window, now = new Date()) {
  if (!STATUSES.has(window?.status)) return "INVALID";
  if (["ACTIVE", "RESERVED"].includes(window.status) && Date.parse(window.validUntil) < now.getTime()) return "EXPIRED";
  return window.status;
}

export function oneTimeExecutionWindowInBounds(window, now = new Date()) {
  const from = Date.parse(window?.validFrom || "");
  const until = Date.parse(window?.validUntil || "");
  return Number.isFinite(from) && Number.isFinite(until) && from <= now.getTime() && now.getTime() <= until;
}

export function matchingOneTimeExecutionWindow(state, post, authorization, authorizationFingerprint, now = new Date(), executionId = null) {
  const candidates = (state.oneTimeExecutionWindows || []).filter((window) => {
    if (window.jobId !== post.id || window.campaignId !== post.campaignId || window.campaignAuthorizationId !== authorization.id) return false;
    if (window.authorizationFingerprint !== authorizationFingerprint) return false;
    if (window.binding !== oneTimeExecutionWindowFingerprint(window)) return false;
    if (Date.parse(window.validFrom) > now.getTime() || Date.parse(window.validUntil) < now.getTime()) return false;
    const status = oneTimeExecutionWindowStatus(window, now);
    if (status === "ACTIVE") return true;
    if ((status === "RESERVED" || status === "CONSUMED") && executionId) {
      return (window.reservedExecutionId === executionId || window.consumedExecutionId === executionId);
    }
    return false;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function assertWindowExecutionBinding(window, executionId, expectedStatus = "RESERVED") {
  if (!window || window.status !== expectedStatus || window.maxExecutions !== 1) throw new Error("One-time execution window is not available for this execution");
  if (expectedStatus === "RESERVED" && window.reservedExecutionId !== executionId) throw new Error("One-time execution window is reserved for another execution");
  if (expectedStatus === "CONSUMED" && window.consumedExecutionId !== executionId) throw new Error("One-time execution window was consumed by another execution");
  if (window.binding !== oneTimeExecutionWindowFingerprint(window)) throw new Error("One-time execution window binding is stale");
}

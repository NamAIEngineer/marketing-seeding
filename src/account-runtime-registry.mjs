import { createHash } from "node:crypto";
import { canonicalIdentityUrl } from "./execution-binding.mjs";

const MAX_ACCOUNTS = 128;
const SECRET_KEY = /(password|passwd|cookie|bearer|token|credential|mfa|passkey|sessionstorage|localstorage|secret|authorizationheader|privatekey|accesskey)/i;
const HEALTHY = new Set(["healthy", "ready", "active"]);
const CHALLENGE = new Set(["challenge", "challenge_required", "human_required", "mfa_required", "security_challenge", "account_locked", "identity_verification"]);
const QUARANTINED = new Set(["quarantined", "blocked", "suspended", "disabled", "revoked", "error"]);

function text(value) { return String(value ?? "").trim(); }
function list(value) { return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))].sort() : []; }
function validDate(value) { const t = Date.parse(value || ""); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function keyOf(account) {
  const provider = text(account.provider).toLowerCase() || "orca";
  const profile = text(account.providerProfileId || account.profileRef);
  return `${account.platform}\u0000${account.accountId}\u0000${provider}\u0000${profile}`;
}
function fingerprint(value) { return createHash("sha256").update(text(value)).digest("hex"); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertNoSecrets(value, path = "account") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`Account metadata contains secret-like field: ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function cleanPermissions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([name, enabled]) => !SECRET_KEY.test(name) && (enabled === true || typeof enabled === "string"))
    .map(([name, enabled]) => `${name}:${enabled === true ? "granted" : text(enabled).slice(0, 80)}`)
    .sort();
}

/** Normalize one sanitized account reference. No browser or credential I/O occurs. */
export function normalizeAccountRuntimeEntry(input = {}) {
  assertNoSecrets(input);
  const platform = text(input.platform).toLowerCase();
  const accountId = text(input.accountId);
  const profileRef = text(input.profileRef || input.profileReference);
  const provider = text(input.provider).toLowerCase() || null;
  if (!provider && text(input.providerProfileId)) throw new Error("provider is required when providerProfileId is supplied");
  const providerProfileId = provider ? text(input.providerProfileId || profileRef) || null : null;
  if (provider && providerProfileId && profileRef && providerProfileId !== profileRef) throw new Error("providerProfileId must match profileRef");
  const identityReference = canonicalIdentityUrl(input.identityReference || input.expectedIdentityUrl);
  if (!platform || !accountId || !profileRef) throw new Error("platform, accountId and profileRef are required");
  const sessionHealth = text(input.sessionHealth || "unknown").toLowerCase();
  const risk = text(input.risk || "normal").toLowerCase();
  const quota = input.quota && typeof input.quota === "object" ? structuredClone(input.quota) : {};
  const cadence = input.cadence && typeof input.cadence === "object" ? structuredClone(input.cadence) : {};
  const cooldown = input.cooldown && typeof input.cooldown === "object" ? structuredClone(input.cooldown) : {};
  return deepFreeze({
    platform, accountId, profileRef, provider, providerProfileId, identityReference,
    sessionHealth,
    permissions: cleanPermissions(input.permissions),
    allowedCampaigns: list(input.allowedCampaigns),
    allowedTargets: list(input.allowedTargets),
    quota, cadence, cooldown, risk,
    lastHealthCheck: validDate(input.lastHealthCheck),
    runtimeFingerprint: text(input.runtimeFingerprint) || fingerprint(profileRef),
    metadataVersion: text(input.metadataVersion) || "1"
  });
}

/** Build a bounded, immutable registry sorted by stable account identity. */
export function createAccountRuntimeRegistry(accounts = []) {
  if (!Array.isArray(accounts)) throw new Error("Account registry input must be an array");
  if (accounts.length > MAX_ACCOUNTS) throw new Error(`Account registry is limited to ${MAX_ACCOUNTS} entries`);
  const normalized = accounts.map(normalizeAccountRuntimeEntry).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const seen = new Set();
  for (const account of normalized) {
    const key = keyOf(account);
    if (seen.has(key)) throw new Error(`Duplicate account registry entry: ${account.platform}:${account.accountId}`);
    seen.add(key);
  }
  return Object.freeze(normalized);
}

function eligibility(account, request, now) {
  const reasons = [];
  const campaignId = text(request.campaignId);
  const targetId = text(request.targetId);
  const requestedPlatform = text(request.platform || request.workloadPlatform).toLowerCase();
  const requestedProvider = text(request.provider || request.executionProvider).toLowerCase();
  const requestedProfile = text(request.providerProfileId || request.profileReference || request.profileRef);
  const accountProvider = text(account.provider).toLowerCase() || "orca";
  const accountProfile = text(account.providerProfileId || account.profileRef);
  const health = account.sessionHealth;
  if (requestedPlatform && account.platform !== requestedPlatform) reasons.push("platform:mismatch");
  if (requestedProvider && accountProvider !== requestedProvider) reasons.push("provider:mismatch");
  if (requestedProfile && accountProfile !== requestedProfile) reasons.push("profile:mismatch");
  if (request.identityReference && (!account.identityReference || account.identityReference !== canonicalIdentityUrl(request.identityReference))) reasons.push("identity:mismatch");
  if (CHALLENGE.has(health)) reasons.push(`session:${health}`);
  else if (!HEALTHY.has(health)) reasons.push(`session:${health || "unknown"}`);
  if (QUARANTINED.has(account.risk)) reasons.push(`risk:${account.risk}`);
  if (account.allowedCampaigns.length && (!campaignId || !account.allowedCampaigns.includes("*") && !account.allowedCampaigns.includes(campaignId))) reasons.push("campaign:not_allowed");
  if (account.allowedTargets.length && (!targetId || !account.allowedTargets.includes("*") && !account.allowedTargets.includes(targetId))) reasons.push("target:not_allowed");
  const cooldownUntil = validDate(account.cooldown.until || account.cooldown.untilAt || account.cooldownUntil);
  if (cooldownUntil && Date.parse(cooldownUntil) > now.getTime()) reasons.push("cooldown:active");
  const quotaLimit = Number(account.quota.maxActionsPerDay ?? account.quota.dailyLimit);
  const quotaUsed = Number(account.quota.usedToday ?? account.quota.actionsToday ?? 0);
  if (Number.isFinite(quotaLimit) && quotaLimit >= 0 && Number.isFinite(quotaUsed) && quotaUsed >= quotaLimit) reasons.push("quota:daily_limit");
  const state = reasons.some((reason) => {
    if (reason.startsWith("risk:")) return true;
    if (!reason.startsWith("session:")) return false;
    return CHALLENGE.has(health) || QUARANTINED.has(health);
  }) ? "QUARANTINED" : reasons.length ? "INELIGIBLE" : "ELIGIBLE";
  return { state, eligible: state === "ELIGIBLE", reasons: [...new Set(reasons)] };
}

/** Project eligibility and choose one deterministic account without mutating state. */
export function selectAccountRuntimeCandidate(registry = [], request = {}) {
  const accounts = createAccountRuntimeRegistry(registry);
  const now = request.now instanceof Date ? request.now : new Date(request.now || Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error("Selection time must be valid");
  const rows = accounts.map((account) => ({
    account: missionControlAccount(account),
    ...eligibility(account, request, now)
  }));
  const preferred = list(request.preferredAccountIds || request.accountPreference);
  const eligible = rows.filter((row) => row.eligible).sort((a, b) => {
    const ai = preferred.indexOf(a.account.accountId); const bi = preferred.indexOf(b.account.accountId);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || keyOf(a.account).localeCompare(keyOf(b.account));
  });
  const selected = eligible[0] || null;
  return Object.freeze({
    status: selected ? "SELECTED" : "NO_ELIGIBLE_ACCOUNT",
    selected: selected ? selected.account : null,
    selectionReason: selected ? (preferred.includes(selected.account.accountId) ? "preferred_account" : "stable_identity_order") : "all_candidates_ineligible",
    candidates: rows.map((row) => Object.freeze({ ...row.account, eligibilityState: row.state, eligibilityReasons: row.reasons }))
  });
}

function missionControlAccount(account) {
  return {
    platform: account.platform,
    provider: account.provider,
    accountId: account.accountId,
    profileRef: account.profileRef,
    providerProfileId: account.providerProfileId,
    identityReference: account.identityReference,
    profileFingerprint: fingerprint(account.profileRef),
    sessionHealth: account.sessionHealth,
    permissions: [...account.permissions],
    allowedCampaigns: [...account.allowedCampaigns],
    allowedTargets: [...account.allowedTargets],
    risk: account.risk,
    lastHealthCheck: account.lastHealthCheck,
    runtimeFingerprint: account.runtimeFingerprint
  };
}

/** Read-only Mission Control account/selection projection; secrets are rejected and never copied. */
export function projectAccountRuntimeMissionControl(registry = [], request = {}) {
  const selection = selectAccountRuntimeCandidate(registry, request);
  return Object.freeze({
    observedAt: new Date(request.now || Date.now()).toISOString(),
    readOnly: true,
    accounts: selection.candidates,
    selection: {
      status: selection.status,
      selectionReason: selection.selectionReason,
      selectedAccountId: selection.selected?.accountId || null,
      selectedProfileFingerprint: selection.selected?.profileFingerprint || null
    }
  });
}

// Compatibility aliases for callers using the shorter projection vocabulary.
export const createAccountRegistry = createAccountRuntimeRegistry;
export const selectAccountCandidate = selectAccountRuntimeCandidate;
export const projectAccountRuntime = projectAccountRuntimeMissionControl;
export const ACCOUNT_RUNTIME_REGISTRY_MAX = MAX_ACCOUNTS;

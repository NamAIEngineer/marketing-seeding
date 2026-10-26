import { createHash } from "node:crypto";
import { canonicalIdentityUrl, canonicalProvider } from "./execution-binding.mjs";

const MAX_ROWS = 128;
const HEALTHY = new Set(["healthy", "ready", "active"]);
const CHALLENGE = new Set(["challenge", "challenge_required", "human_required", "mfa_required", "security_challenge", "identity_verification"]);
const QUARANTINE = new Set(["quarantined", "blocked", "suspended", "disabled", "revoked", "error"]);
const SECRET = /(cookie|token|secret|password|credential|authorization|session(?:token|cookie|storage|secret)|proxy|storage|private[_-]?key|access[_-]?key)/i;

const text = (value, limit = 240) => value === undefined || value === null ? null : (String(value).trim().slice(0, limit) || null);
const lower = (value) => text(value, 80)?.toLowerCase() || null;
const iso = (value) => { const t = Date.parse(String(value || "")); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const fingerprint = (profileRef) => createHash("sha256").update(String(profileRef)).digest("hex");

function rejectSecrets(value, path = "input") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET.test(key)) throw new Error(`session readiness contains secret-like field: ${path}.${key}`);
    rejectSecrets(child, `${path}.${key}`);
  }
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const platform = lower(raw.platform);
  const accountId = text(raw.accountId, 160);
  const profileRef = text(raw.profileRef || raw.profileReference, 160);
  const provider = lower(raw.provider) || "orca";
  const providerProfileId = text(raw.providerProfileId || profileRef, 160);
  const identityReference = canonicalIdentityUrl(raw.identityReference || raw.expectedIdentityUrl);
  if (!platform || !accountId || !profileRef) return null;
  return {
    platform, accountId, profileRef, provider, providerProfileId, identityReference,
    profileFingerprint: text(raw.profileFingerprint, 160) || fingerprint(profileRef),
    sessionHealth: lower(raw.sessionHealth || raw.health || "unknown"),
    risk: lower(raw.risk || "normal"),
    authorized: raw.authorized !== false
  };
}

function normalizeObserved(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return {
    platform: lower(raw.platform), accountId: text(raw.accountId, 160),
    profileRef: text(raw.profileRef || raw.profileReference, 160),
    provider: lower(raw.provider) || "orca",
    providerProfileId: text(raw.providerProfileId || raw.profileRef || raw.profileReference, 160),
    identityReference: canonicalIdentityUrl(raw.identityReference || raw.expectedIdentityUrl),
    profileFingerprint: text(raw.profileFingerprint, 160),
    state: lower(raw.state || raw.status || raw.health || "unknown"),
    checkedAt: iso(raw.checkedAt || raw.observedAt),
    expiresAt: iso(raw.expiresAt || raw.validUntil),
    expiryProvided: raw.expiresAt !== undefined || raw.validUntil !== undefined,
    challenge: raw.challenge === true || raw.challengeRequired === true
  };
}

function observedFor(account, observed) {
  const candidates = observed.filter((item) => item && item.platform === account.platform && item.accountId === account.accountId);
  return candidates.find((item) => item.provider === account.provider && item.providerProfileId === account.providerProfileId && (account.provider === "orca" || item.identityReference === account.identityReference)) || candidates[0] || null;
}

function projectRow(account, observed, nowMs) {
  const expectedFp = account.profileFingerprint;
  const expiryMs = Date.parse(observed?.expiresAt || "");
  const exactProfile = Boolean(observed && ((observed.profileRef && observed.profileRef === account.profileRef) || (observed.profileFingerprint && observed.profileFingerprint === expectedFp)));
  const exactIdentity = Boolean(observed && observed.platform === account.platform && observed.accountId === account.accountId && observed.provider === account.provider && observed.providerProfileId === account.providerProfileId && (account.provider === "orca" || observed.identityReference === account.identityReference) && exactProfile);
  const reasons = [];
  let status = "UNKNOWN";
  let executionEligible = false;
  if (!account.authorized) { status = "QUARANTINED"; reasons.push("account_not_authorized"); }
  else if (QUARANTINE.has(account.risk) || QUARANTINE.has(account.sessionHealth)) { status = "QUARANTINED"; reasons.push("account_quarantined"); }
  else if (!observed) { status = "UNKNOWN"; reasons.push("session_not_observed"); }
  else if (!exactIdentity) { status = "MISMATCH"; reasons.push("exact_binding_mismatch"); }
  else if (observed.challenge || CHALLENGE.has(observed.state) || CHALLENGE.has(account.sessionHealth)) { status = "CHALLENGE"; reasons.push("human_action_required"); }
  else if (!observed.expiryProvided || !observed.expiresAt || !Number.isFinite(expiryMs)) { status = "EXPIRED"; reasons.push("readiness_expiry_invalid"); }
  else if (expiryMs <= nowMs) { status = "EXPIRED"; reasons.push("readiness_expired"); }
  else if (!HEALTHY.has(observed.state) || !HEALTHY.has(account.sessionHealth)) { status = "UNKNOWN"; reasons.push("healthy_observed_binding_required"); }
  else { status = "READY"; executionEligible = true; }
  return {
    platform: account.platform, accountId: account.accountId, profileFingerprint: expectedFp,
    observedProfileFingerprint: observed?.profileFingerprint || null, status,
    executionEligible, checkedAt: observed?.checkedAt || null, expiresAt: observed?.expiresAt || null,
    reasons: [...new Set(reasons)]
  };
}

/** Pure Mission Control projection. No lifecycle, lease, authority, or state mutation. */
export function projectSessionReadiness(executionAccounts = [], observedSessions = [], { now = new Date() } = {}) {
  rejectSecrets(executionAccounts); rejectSecrets(observedSessions);
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) throw new Error("session readiness observation time must be valid");
  const accounts = Array.isArray(executionAccounts) ? executionAccounts.slice(0, MAX_ROWS).map(normalizeAccount).filter(Boolean) : [];
  const observed = Array.isArray(observedSessions) ? observedSessions.slice(0, MAX_ROWS).map(normalizeObserved).filter(Boolean) : [];
  const rows = accounts.map((account) => projectRow(account, observedFor(account, observed), at.getTime()));
  return Object.freeze({ readOnly: true, observedAt: at.toISOString(), rows: Object.freeze(rows), summary: Object.freeze({ accounts: rows.length, ready: rows.filter((r) => r.status === "READY").length, executionEligible: rows.filter((r) => r.executionEligible).length, unknown: rows.filter((r) => r.status === "UNKNOWN").length, challenges: rows.filter((r) => r.status === "CHALLENGE").length, quarantined: rows.filter((r) => r.status === "QUARANTINED").length, mismatched: rows.filter((r) => r.status === "MISMATCH").length, expired: rows.filter((r) => r.status === "EXPIRED").length }) });
}

export { fingerprint as sessionProfileFingerprint };

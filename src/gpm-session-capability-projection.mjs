/**
 * Read-only capability projection for the composed GPM execution session.
 *
 * This module accepts already observed provider metadata. It never resolves an
 * account, starts a profile, attaches a browser, creates authority, or mutates
 * runtime state. Profile identifiers and secret-like fields are intentionally
 * excluded from the returned read model.
 */
const MAX_ROWS = 128;
const HEALTHY = new Set(["READY", "HEALTHY", "ACTIVE"]);
const CHALLENGE = new Set(["CHALLENGE", "CHALLENGE_REQUIRED", "MFA_REQUIRED", "HUMAN_REQUIRED", "SECURITY_CHALLENGE", "IDENTITY_VERIFICATION"]);
const SECRET = /(cookie|token|secret|password|credential|authorization|session|storage|proxy|private[_-]?key|access[_-]?key)/i;

const text = (value, limit = 160) => value === undefined || value === null ? null : (String(value).trim().slice(0, limit) || null);
const upper = (value) => text(value, 64)?.toUpperCase() || null;
const providerName = (value) => text(value, 80)?.toLowerCase() || null;

function safeFingerprint(value) {
  const result = text(value, 160);
  return result && !SECRET.test(result) ? result : null;
}

function normalizeHealth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "UNKNOWN", reason: "HEALTH_NOT_OBSERVED" };
  const state = upper(value.state || value.status || value.health) || "UNKNOWN";
  return { state, reason: text(value.code || value.reason, 120) };
}

function normalizeRows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ROWS).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    return {
      provider: providerName(row.provider),
      runtime: text(row.runtime || row.runtimeId || row.transport, 100),
      fingerprint: safeFingerprint(row.profileFingerprint || row.fingerprint),
      health: upper(row.health || row.state || row.status) || "UNKNOWN",
      challenge: row.challenge === true || row.challengeRequired === true
    };
  }).filter(Boolean);
}

/**
 * Project composed-session capability from observed, caller-supplied metadata.
 * `AVAILABLE` requires exact provider/configuration/runtime identity and a
 * healthy observation with no challenge or unknown rows.
 */
export function projectGpmSessionCapability(metadata = {}, { expectedProvider = "gpm" } = {}) {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const expected = providerName(expectedProvider);
  const provider = providerName(source.provider || source.providerId || source.runtimeIdentity?.provider);
  const configured = source.configured === true || source.providerConfigured === true;
  const runtime = source.runtimeIdentity && typeof source.runtimeIdentity === "object" ? source.runtimeIdentity : {};
  const runtimeProvider = providerName(runtime.provider || runtime.providerId || source.runtimeProvider);
  const health = normalizeHealth(source.health || source.providerHealth);
  const rows = normalizeRows(source.sessions || source.accounts || source.runtimeRows);
  const providerExact = Boolean(expected && provider === expected && (!runtimeProvider || runtimeProvider === expected));
  const hasUnknown = health.state === "UNKNOWN" || rows.some((row) => row.health === "UNKNOWN");
  const hasChallenge = CHALLENGE.has(health.state) || rows.some((row) => row.challenge || CHALLENGE.has(row.health));
  const runtimeObserved = Boolean(text(runtime.transport || runtime.runtime || runtime.id, 120));
  const ready = configured && providerExact && runtimeObserved && HEALTHY.has(health.state) && !hasUnknown && !hasChallenge;
  let status = "UNAVAILABLE";
  let reason = "PROVIDER_NOT_CONFIGURED";
  if (configured && providerExact) {
    status = hasChallenge ? "CHALLENGE" : hasUnknown ? "UNKNOWN" : ready ? "AVAILABLE" : "UNAVAILABLE";
    reason = hasChallenge ? "HUMAN_ACTION_REQUIRED" : hasUnknown ? "HEALTH_UNKNOWN" : ready ? "PROVIDER_READY" : "RUNTIME_NOT_OBSERVED";
  } else if (configured && provider) {
    reason = "PROVIDER_MISMATCH";
  }
  const fingerprints = rows.filter((row) => row.fingerprint).map((row) => row.fingerprint);
  return Object.freeze({
    readOnly: true,
    status,
    reason,
    provider: providerExact ? expected : provider,
    runtime: {
      observed: runtimeObserved,
      transport: text(runtime.transport || runtime.runtime, 100),
      providerVersion: text(runtime.providerVersion || source.providerVersion, 80)
    },
    counts: {
      providers: provider ? 1 : 0,
      configuredProviders: configured && providerExact ? 1 : 0,
      runtimes: runtimeObserved ? 1 : 0,
      sessions: rows.length,
      profileFingerprints: new Set(fingerprints).size,
      healthy: rows.filter((row) => HEALTHY.has(row.health)).length,
      unknown: rows.filter((row) => row.health === "UNKNOWN").length,
      challenges: rows.filter((row) => row.challenge || CHALLENGE.has(row.health)).length
    },
    executionEligible: ready,
    authoritySideEffects: false,
    externalSideEffects: false
  });
}

export default projectGpmSessionCapability;

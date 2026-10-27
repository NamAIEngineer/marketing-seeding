import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const SECRET_KEY = /(cookie|password|passwd|token|secret|credential|authorization|sessionstorage|localstorage|rawsession|privatekey|accesskey)/i;
const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const iso = (value) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function rejectSecrets(value, path = "metadata", depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw Object.assign(new Error("Camoufox session metadata contains a secret-like field"), { code: "CAMOUFOX_SESSION_METADATA_SECRET_FIELD" });
    if (typeof child === "string" && /bearer\s+|cookie\s*=|access[_ -]?token|session[_ -]?token/i.test(child)) {
      throw Object.assign(new Error("Camoufox session metadata contains a secret-like value"), { code: "CAMOUFOX_SESSION_METADATA_SECRET_VALUE" });
    }
    rejectSecrets(child, `${path}.${key}`, depth + 1);
  }
}

function profileFingerprint(profileReference) {
  return `sha256:${createHash("sha256").update(profileReference).digest("hex")}`;
}

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeMetadata(input) {
  rejectSecrets(input);
  const platform = text(input?.platform, 80).toLowerCase();
  const accountId = text(input?.accountId, 160);
  const profileReference = text(input?.profileReference || input?.profileRef, 180);
  const provider = text(input?.provider, 80).toLowerCase();
  const identity = input?.verifiedIdentity && typeof input.verifiedIdentity === "object" ? input.verifiedIdentity : {};
  const identityReference = text(identity.profileUrl || input?.identityReference || input?.expectedIdentityUrl, 400);
  const displayName = text(identity.displayName, 160) || null;
  const status = text(input?.status, 40).toUpperCase();
  const authState = text(input?.authState, 40).toUpperCase();
  const identityStatus = text(input?.identityStatus, 40).toUpperCase();
  if (!platform || !accountId || !profileReference || provider !== "camoufox") {
    return { state: "UNKNOWN", code: "CAMOUFOX_SESSION_METADATA_INCOMPLETE", sessions: [] };
  }
  const ready = status === "READY" && authState === "READY" && identityStatus === "VERIFIED" && Boolean(identityReference);
  const observedAt = iso(input?.observedAt) || new Date().toISOString();
  const expiresAt = iso(input?.expiresAt) || new Date(Date.parse(observedAt) + 5 * 60_000).toISOString();
  return {
    state: "OBSERVED",
    source: "camoufox-profile-session-metadata",
    observedAt,
    sessions: [{
      platform,
      accountId,
      provider,
      providerProfileId: profileReference,
      profileRef: profileReference,
      profileFingerprint: profileFingerprint(profileReference),
      identityReference: identityReference || null,
      displayName,
      state: ready ? "READY" : status || "UNKNOWN",
      authState: authState || "UNKNOWN",
      identityStatus: identityStatus || "UNKNOWN",
      checkedAt: observedAt,
      expiresAt,
      evidence: "sanitized Camoufox profile metadata; canonical authority/readiness evaluated separately"
    }]
  };
}

export async function observeCamoufoxSessionMetadata(filePath, { now = new Date() } = {}) {
  const file = text(filePath, 2_000);
  if (!file) return { state: "UNKNOWN", code: "CAMOUFOX_SESSION_METADATA_PATH_UNCONFIGURED", sessions: [] };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const result = normalizeMetadata(parsed);
    if (result.state !== "OBSERVED") return result;
    const at = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(at.getTime())) return { state: "UNKNOWN", code: "CAMOUFOX_SESSION_METADATA_CLOCK_INVALID", sessions: [] };
    const sessions = result.sessions.map((session) => {
      const expiresAt = Date.parse(String(session.expiresAt || ""));
      if (!Number.isFinite(expiresAt) || expiresAt > at.getTime()) return session;
      return {
        ...session,
        state: "STALE",
        freshness: "EXPIRED"
      };
    });
    const expired = sessions.some((session) => session.freshness === "EXPIRED");
    return {
      ...result,
      state: expired ? "STALE" : result.state,
      code: expired ? "CAMOUFOX_SESSION_METADATA_EXPIRED" : null,
      sessions
    };
  } catch (error) {
    const code = error?.code === "ENOENT" ? "CAMOUFOX_SESSION_METADATA_UNAVAILABLE" : error?.code || "CAMOUFOX_SESSION_METADATA_INVALID";
    return { state: "UNKNOWN", code: String(code).slice(0, 120), sessions: [] };
  }
}

/**
 * Persist one verified, sanitized Camoufox identity observation.
 *
 * This file is evidence for the read-only dashboard projection. It never
 * carries authority, credentials, browser storage, or page content. The
 * rename is performed only after the complete sanitized document is flushed.
 */
export async function persistCamoufoxSessionMetadata(filePath, input, { now = new Date(), ttlMs = 5 * 60_000 } = {}) {
  const target = text(filePath, 2_000);
  if (!target) throw fail("CAMOUFOX_SESSION_METADATA_PATH_UNCONFIGURED", "Camoufox session metadata path is required");
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) throw fail("CAMOUFOX_SESSION_METADATA_CLOCK_INVALID", "Camoufox session metadata clock is invalid");
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 24 * 60 * 60_000) throw fail("CAMOUFOX_SESSION_METADATA_TTL_INVALID", "Camoufox session metadata TTL is invalid");
  const normalized = normalizeMetadata({
    ...input,
    observedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + ttl).toISOString()
  });
  if (normalized.state !== "OBSERVED" || normalized.sessions.length !== 1 || normalized.sessions[0].state !== "READY") {
    throw fail(normalized.code || "CAMOUFOX_SESSION_METADATA_NOT_READY", "Camoufox identity observation is not ready");
  }
  const parent = path.dirname(path.resolve(target));
  const base = path.basename(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stagingDir = await mkdtemp(path.join(parent, `.${base}.`), { encoding: "utf8" });
  const temporary = path.join(stagingDir, `${base}.tmp`);
  try {
    const session = normalized.sessions[0];
    const payloadValue = {
      schemaVersion: 1,
      provider: session.provider,
      platform: session.platform,
      accountId: session.accountId,
      profileReference: session.profileRef,
      status: session.state,
      authState: session.authState,
      identityStatus: session.identityStatus,
      identityReference: session.identityReference,
      observedAt: normalized.observedAt,
      expiresAt: session.expiresAt,
      verifiedIdentity: {
        displayName: session.displayName,
        profileUrl: session.identityReference
      }
    };
    const payload = `${JSON.stringify(payloadValue)}\n`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path.resolve(target));
    try {
      const directory = await open(parent, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { /* directory fsync is best effort on platforms that disallow it */ }
    return normalized;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export { normalizeMetadata };

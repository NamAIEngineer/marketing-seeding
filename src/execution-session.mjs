import { createHash } from "node:crypto";

const LIFECYCLE = new Set(["DISCOVERED", "ATTACHING", "ATTACHED", "READY", "STALE", "CHALLENGED", "DETACHED", "FAILED"]);
const SECRET_KEY = /(cookie|password|token|secret|credential|authorization|sessionsecret|privatekey|accesskey)/i;
const clean = (v, n = 160) => typeof v === "string" ? v.trim().slice(0, n) : "";
const freezeRecord = (v) => Object.freeze({ ...v });
const boundedRecord = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new TypeError(`${label} must be an object`), { code: "SESSION_RECORD_INVALID" });
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, 32)) {
    if (SECRET_KEY.test(key)) throw Object.assign(new TypeError(`${label} contains secret-like material`), { code: "SESSION_SECRET_FIELD" });
    if (child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") result[String(key).slice(0, 64)] = typeof child === "string" ? child.slice(0, 180) : child;
  }
  return freezeRecord(result);
};

/** Secret-free immutable snapshot of one bounded execution session. */
export class ExecutionSession {
  constructor(input = {}) {
    const lifecycle = clean(input.lifecycle).toUpperCase();
    if (!LIFECYCLE.has(lifecycle)) throw Object.assign(new TypeError("execution session lifecycle is invalid"), { code: "SESSION_LIFECYCLE_INVALID" });
    for (const key of ["provider", "profileReference", "platform", "accountId"]) {
      if (!clean(input[key])) throw Object.assign(new TypeError(`execution session ${key} is required`), { code: "SESSION_BINDING_REQUIRED" });
    }
    if (!input.transportRef || typeof input.transportRef !== "object") throw Object.assign(new TypeError("transportRef is required"), { code: "SESSION_TRANSPORT_REQUIRED" });
    const createdAt = clean(input.createdAt) || new Date().toISOString();
    const expiresAt = clean(input.expiresAt);
    if (!Number.isFinite(Date.parse(createdAt))) throw Object.assign(new TypeError("session creation time is invalid"), { code: "SESSION_CREATED_AT_INVALID" });
    const sessionId = clean(input.sessionId, 120) || `session-${createHash("sha256").update(`${clean(input.provider)}\u0000${clean(input.profileReference)}\u0000${createdAt}`).digest("hex").slice(0, 32)}`;
    const allowed = {
      sessionId, lifecycle, provider: clean(input.provider).toLowerCase(), profileReference: clean(input.profileReference),
      platform: clean(input.platform).toLowerCase(), accountId: clean(input.accountId),
      expectedIdentity: freezeRecord({ platform: clean(input.expectedIdentity?.platform || input.platform).toLowerCase(), accountId: clean(input.expectedIdentity?.accountId || input.accountId) }),
      capabilities: Object.freeze(Array.isArray(input.capabilities) ? [...new Set(input.capabilities.map((x) => clean(x, 48)).filter(Boolean))] : []),
      transportRef: boundedRecord(input.transportRef, "transportRef"),
      transportIdentity: freezeRecord({
        transport: clean(input.transportIdentity?.transport, 100),
        provider: clean(input.transportIdentity?.provider, 80),
        providerVersion: clean(input.transportIdentity?.providerVersion, 80)
      }),
      attestation: freezeRecord({ host: clean(input.attestation?.host, 100), runtime: clean(input.attestation?.runtime, 100), version: clean(input.attestation?.version, 80), evidence: clean(input.attestation?.evidence, 180), observedAt: clean(input.attestation?.observedAt || input.attestation?.attestedAt, 40), expiresAt: clean(input.attestation?.expiresAt, 40) || null }),
      createdAt, expiresAt: expiresAt || null
    };
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw Object.assign(new TypeError("session expiry is invalid"), { code: "SESSION_EXPIRY_INVALID" });
    if (allowed.attestation.expiresAt && !Number.isFinite(Date.parse(allowed.attestation.expiresAt))) throw Object.assign(new TypeError("attestation expiry is invalid"), { code: "SESSION_ATTESTATION_INVALID" });
    Object.assign(this, allowed);
    Object.freeze(this);
  }

  /** Persist only bounded metadata; provider handles and raw profile refs stay in memory. */
  toJSON() {
    return {
      sessionId: this.sessionId || null,
      lifecycle: this.lifecycle,
      provider: this.provider,
      providerProfileRef: this.profileReference ? `sha256:${createHash("sha256").update(this.profileReference).digest("hex")}` : null,
      platform: this.platform,
      accountId: this.accountId,
      expectedIdentity: this.expectedIdentity,
      capabilities: this.capabilities,
      transportRef: this.transportRef,
      transportIdentity: this.transportIdentity,
      attestation: this.attestation,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt
    };
  }

  assertUsable({ now = Date.now() } = {}) {
    if (["CHALLENGED", "STALE", "DETACHED", "FAILED"].includes(this.lifecycle)) throw Object.assign(new Error("execution session is not usable"), { code: `SESSION_${this.lifecycle}` });
    if (this.expiresAt && Date.parse(this.expiresAt) <= Number(now)) throw Object.assign(new Error("execution session expired"), { code: "SESSION_STALE" });
    if (this.attestation.expiresAt && Date.parse(this.attestation.expiresAt) <= Number(now)) throw Object.assign(new Error("execution session attestation expired"), { code: "SESSION_ATTESTATION_STALE" });
    return this;
  }
}

export const EXECUTION_SESSION_LIFECYCLES = Object.freeze([...LIFECYCLE]);
export default ExecutionSession;

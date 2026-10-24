const LIFECYCLE = new Set(["DISCOVERED", "ATTACHING", "ATTACHED", "READY", "STALE", "CHALLENGED", "DETACHED", "FAILED"]);
const clean = (v, n = 160) => typeof v === "string" ? v.trim().slice(0, n) : "";
const freezeRecord = (v) => Object.freeze({ ...v });

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
    const allowed = {
      lifecycle, provider: clean(input.provider).toLowerCase(), profileReference: clean(input.profileReference),
      platform: clean(input.platform).toLowerCase(), accountId: clean(input.accountId),
      expectedIdentity: freezeRecord({ platform: clean(input.expectedIdentity?.platform || input.platform).toLowerCase(), accountId: clean(input.expectedIdentity?.accountId || input.accountId) }),
      capabilities: Object.freeze(Array.isArray(input.capabilities) ? [...new Set(input.capabilities.map((x) => clean(x, 48)).filter(Boolean))] : []),
      transportRef: input.transportRef,
      attestation: freezeRecord({ host: clean(input.attestation?.host, 100), runtime: clean(input.attestation?.runtime, 100), version: clean(input.attestation?.version, 80), evidence: clean(input.attestation?.evidence, 180), observedAt: clean(input.attestation?.observedAt, 40) }),
      createdAt, expiresAt: expiresAt || null
    };
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw Object.assign(new TypeError("session expiry is invalid"), { code: "SESSION_EXPIRY_INVALID" });
    Object.assign(this, allowed);
    Object.freeze(this);
  }

  assertUsable({ now = Date.now() } = {}) {
    if (["CHALLENGED", "STALE", "DETACHED", "FAILED"].includes(this.lifecycle)) throw Object.assign(new Error("execution session is not usable"), { code: `SESSION_${this.lifecycle}` });
    if (this.expiresAt && Date.parse(this.expiresAt) <= Number(now)) throw Object.assign(new Error("execution session expired"), { code: "SESSION_STALE" });
    return this;
  }
}

export const EXECUTION_SESSION_LIFECYCLES = Object.freeze([...LIFECYCLE]);
export default ExecutionSession;

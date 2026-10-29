import { createHash, randomBytes } from "node:crypto";
import { selectAccountRuntimeCandidate } from "./account-runtime-registry.mjs";

const READY = new Set(["ready", "healthy"]);
const SECRET = /(secret|token|cookie|password|credential|authorization|session|storage|proxy|header|key)/i;
const text = (v) => typeof v === "string" ? v.trim() : "";
const fingerprint = (v) => createHash("sha256").update(text(v)).digest("hex");
const safeCode = (v, fallback = "UNAVAILABLE") => text(v).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 48) || fallback;

function profileHash(value) { return fingerprint(value); }
function failResult(code, reason, selection = null) {
  return Object.freeze({ ready: false, status: "NOT_READY", code: safeCode(code), reason: text(reason).slice(0, 240), selectionStatus: selection?.status || null });
}
function safeRuntimeIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  const profileKey = /^(profile(?:id|ref|reference)?|profile)$/i;
  const sensitiveQuery = /(secret|token|cookie|auth|password|key|credential)/i;
  const safePrimitive = (item) => {
    if (typeof item !== "string") return item;
    if (item.length > 160) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(item)) return item;
    try {
      const url = new URL(item);
      if (url.username || url.password) return null;
      for (const key of [...url.searchParams.keys()]) if (sensitiveQuery.test(key)) url.searchParams.delete(key);
      url.hash = "";
      url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
      return url.toString().slice(0, 160);
    } catch { return null; }
  };
  for (const [key, item] of Object.entries(value)) {
    if (SECRET.test(key) || profileKey.test(key) || typeof item === "object") continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const safe = safePrimitive(item);
      if (safe !== null && String(safe).length <= 160) out[key] = safe;
    }
  }
  return Object.keys(out).length ? Object.freeze(out) : null;
}

/** Provider-neutral, in-memory GPM session lease coordinator. Injected dependencies only. */
export class GpmSessionCoordinator {
  #registry; #select; #lifecycle; #healthProbe; #clock; #leases = new Map(); #sequence = 0;
  constructor({ accountRegistry, selectAccountRuntimeCandidate: selector = selectAccountRuntimeCandidate, lifecycle, healthProbe, clock = () => new Date() } = {}) {
    if (!Array.isArray(accountRegistry)) throw new TypeError("accountRegistry is required");
    if (typeof selector !== "function" || !lifecycle || typeof lifecycle.start !== "function" || typeof lifecycle.stop !== "function") throw new TypeError("selector and lifecycle are required");
    if (typeof healthProbe !== "function") throw new TypeError("healthProbe is required");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.#registry = accountRegistry; this.#select = selector; this.#lifecycle = lifecycle; this.#healthProbe = healthProbe; this.#clock = clock;
  }

  async acquire(request = {}) {
    let selection;
    try { selection = this.#select(this.#registry, { ...request, now: request.now || this.#clock() }); }
    catch { return failResult("SELECTION_FAILED", "account selection failed"); }
    const selected = selection?.selected;
    if (!selected) return failResult("NO_ELIGIBLE_ACCOUNT", "no eligible authorized account", selection);
    const profileRef = text(selected.profileRef);
    if (!profileRef || !text(selected.accountId) || !text(selected.platform)) return failResult("PROFILE_BINDING_MISSING", "selected account lacks exact profile binding", selection);
    const selectedProfileFingerprint = text(selected.profileFingerprint) || profileHash(profileRef);
    let health;
    try { health = await this.#healthProbe({ account: selected, request: { ...request }, profileRef }); }
    catch { return failResult("HEALTH_PROBE_FAILED", "health probe failed", selection); }
    const healthStatus = text(health?.status || health?.state).toLowerCase();
    const healthy = health?.healthy === true || READY.has(healthStatus);
    if (!healthy) return failResult(safeCode(health?.code, healthStatus === "challenge" ? "CHALLENGE" : "HEALTH_UNKNOWN"), "account health is not ready", selection);
    const boundPlatform = text(health?.platform || health?.account?.platform).toLowerCase();
    const boundAccount = text(health?.accountId || health?.account?.accountId);
    const boundProfile = text(health?.profileRef || health?.profileReference || health?.account?.profileRef);
    const boundFingerprint = text(health?.profileFingerprint || health?.account?.profileFingerprint);
    const profileBindingMatches = boundProfile ? boundProfile === profileRef : boundFingerprint === selectedProfileFingerprint;
    if (boundPlatform !== text(selected.platform).toLowerCase() || boundAccount !== text(selected.accountId) || !profileBindingMatches) return failResult("HEALTH_BINDING_MISMATCH", "health binding does not exactly match selected account", selection);
    let started;
    try { started = await this.#lifecycle.start(profileRef); }
    catch { return failResult("START_FAILED", "profile start failed", selection); }
    const runtimeIdentity = safeRuntimeIdentity(started?.runtimeIdentity || started?.runtime || started?.identity) || safeRuntimeIdentity({ endpoint: started?.endpoint });
    const leaseFingerprint = fingerprint(`${this.#clock().toISOString?.() || Date.now()}:${++this.#sequence}:${randomBytes(12).toString("hex")}`);
    const lease = { leaseFingerprint, profileFingerprint: selectedProfileFingerprint, accountId: text(selected.accountId), runtimeIdentity, release: () => this.release(lease) };
    this.#leases.set(leaseFingerprint, { profileRef, lease, released: false });
    return Object.freeze({ ready: true, status: "READY", handle: Object.freeze(lease) });
  }

  async release(handle) {
    if (!handle || typeof handle !== "object") return Object.freeze({ released: false, status: "REJECTED", code: "FOREIGN_HANDLE" });
    const entry = this.#leases.get(handle.leaseFingerprint);
    if (!entry || entry.lease !== handle) return Object.freeze({ released: false, status: "REJECTED", code: "FOREIGN_HANDLE" });
    if (entry.released) return Object.freeze({ released: true, status: "ALREADY_RELEASED", code: "DUPLICATE_RELEASE" });
    entry.released = true;
    try { await this.#lifecycle.stop(entry.profileRef); }
    catch { return Object.freeze({ released: false, status: "STOP_FAILED", code: "STOP_FAILED" }); }
    return Object.freeze({ released: true, status: "RELEASED" });
  }
}

export default GpmSessionCoordinator;

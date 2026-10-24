const assertPreClickValidation = ({ validate } = {}) => { if (typeof validate !== "function") throw Object.assign(new Error("Browser transport requires pre-provider validation"), { code: "TRANSPORT_VALIDATION_REQUIRED" }); return true; };
import { ExecutionSession } from "./execution-session.mjs";

const fail = (code, message) => Object.assign(new Error(message), { code });
const METHODS = ["navigate", "snapshot", "resolve", "type", "click", "observeTransition", "verifyActivation", "detach"];

/** GPM protocol adapter. It consumes only injected profile/session references and client factory. */
export class GpmExecutionTransport {
  #profileReference; #sessionHandle; #protocolFactory; #attestation; #client = null; #session = null; #detached = false;

  constructor({ profileReference, sessionHandle, protocolFactory, hostAttestation } = {}) {
    this.#profileReference = typeof profileReference === "string" ? profileReference.trim() : "";
    this.#sessionHandle = typeof sessionHandle === "string" ? sessionHandle.trim() : "";
    this.#protocolFactory = protocolFactory;
    this.#attestation = hostAttestation && typeof hostAttestation === "object" ? Object.freeze({
      host: String(hostAttestation.host || "").slice(0, 100), runtime: String(hostAttestation.runtime || "").slice(0, 100),
      version: String(hostAttestation.version || "").slice(0, 80), evidence: String(hostAttestation.evidence || "").slice(0, 180),
      observedAt: String(hostAttestation.observedAt || "").slice(0, 40)
    }) : null;
    this.transportIdentity = Object.freeze({ transport: "gpm-execution", provider: "gpm", providerVersion: this.#attestation?.version || null });
    this.#detached = false;
  }

  async health() {
    if (!this.#profileReference) return { state: "UNAVAILABLE", reason: "GPM_PROFILE_REFERENCE_REQUIRED" };
    if (!this.#sessionHandle) return { state: "UNAVAILABLE", reason: "GPM_SESSION_HANDLE_REQUIRED" };
    if (typeof this.#protocolFactory !== "function") return { state: "UNAVAILABLE", reason: "GPM_PROTOCOL_FACTORY_REQUIRED" };
    if (!this.#attestation?.host || !this.#attestation?.runtime || !this.#attestation?.version || !this.#attestation?.evidence) return { state: "UNKNOWN", reason: "GPM_HOST_ATTESTATION_REQUIRED" };
    return { state: "READY", ...this.transportIdentity, attestation: this.#attestation };
  }

  async attach(session) {
    if (!(session instanceof ExecutionSession)) throw fail("GPM_SESSION_CONTRACT_REQUIRED", "ExecutionSession required");
    session.assertUsable();
    if (this.#detached) throw fail("GPM_TRANSPORT_DETACHED", "transport was detached");
    const health = await this.health();
    if (health.state !== "READY") throw fail(health.reason, "GPM host or protocol is not attested");
    if (session.provider !== "gpm" || session.profileReference !== this.#profileReference) throw fail("GPM_PROFILE_BINDING_MISMATCH", "session profile binding mismatch");
    if (session.lifecycle === "CHALLENGED") throw fail("GPM_SESSION_CHALLENGE", "session requires human action");
    let client;
    try { client = await this.#protocolFactory({ profileReference: this.#profileReference, sessionHandle: this.#sessionHandle, runtimeIdentity: this.transportIdentity }); }
    catch { throw fail("GPM_PROTOCOL_ATTACH_FAILED", "GPM protocol attach failed"); }
    if (!client || METHODS.some((name) => typeof client[name] !== "function")) throw fail("GPM_PROTOCOL_INCOMPLETE", "injected GPM protocol lacks required capabilities");
    let observed;
    try { observed = await client.observeIdentity?.(); }
    catch { throw fail("GPM_IDENTITY_OBSERVATION_FAILED", "GPM identity observation failed"); }
    if (!observed) throw fail("GPM_IDENTITY_UNKNOWN", "GPM identity was not observed");
    const state = String(observed.state || "").toUpperCase();
    if (["CHALLENGED", "CHALLENGE"].includes(state)) throw fail("GPM_SESSION_CHALLENGE", "GPM session has a challenge");
    if (["STALE", "EXPIRED"].includes(state)) throw fail("GPM_SESSION_STALE", "GPM session is stale");
    if (String(observed.platform || "").toLowerCase() !== session.expectedIdentity.platform || String(observed.accountId || "") !== session.expectedIdentity.accountId) throw fail("GPM_IDENTITY_MISMATCH", "observed account does not match session binding");
    this.#client = client;
    this.#session = session;
    return Object.freeze({ ...this.transportIdentity, profileReference: this.#profileReference, accountId: session.accountId, attestation: this.#attestation, capabilities: session.capabilities });
  }

  #ready() { if (!this.#client || !this.#session) throw fail("GPM_TRANSPORT_NOT_ATTACHED", "transport is not attached"); this.#session.assertUsable(); return this.#client; }
  navigate(...args) { return this.#ready().navigate(...args); }
  snapshot(...args) { return this.#ready().snapshot(...args); }
  observe(...args) { return this.snapshot(...args); }
  resolve(...args) { return this.#ready().resolve(...args); }
  findControl(...args) { return this.resolve(...args); }
  type(...args) { return this.#ready().type(...args); }
  async click(target, options = {}) { this.#ready(); assertPreClickValidation(options); await options.validate(); return this.#ready().click(target, options); }
  observeTransition(...args) { return this.#ready().observeTransition(...args); }
  verifyActivation(...args) { return this.#ready().verifyActivation(...args); }
  async detach() {
    if (this.#detached) return Object.freeze({ detached: true, status: "ALREADY_DETACHED" });
    this.#detached = true;
    const client = this.#client;
    this.#client = null; this.#session = null;
    if (client) await client.detach();
    return Object.freeze({ detached: true, status: "DETACHED" });
  }
  closeOwnedResources() { return this.detach(); }
}
export default GpmExecutionTransport;

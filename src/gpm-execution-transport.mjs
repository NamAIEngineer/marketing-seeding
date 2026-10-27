const assertPreClickValidation = ({ validate } = {}) => { if (typeof validate !== "function") throw Object.assign(new Error("Browser transport requires pre-provider validation"), { code: "TRANSPORT_VALIDATION_REQUIRED" }); return true; };
import { ExecutionSession } from "./execution-session.mjs";
import { ExecutionTransport } from "./execution-transport.mjs";
import { canonicalIdentityUrl } from "./execution-binding.mjs";

const fail = (code, message) => Object.assign(new Error(message), { code });
const METHODS = ["navigate", "snapshot", "resolve", "type", "click", "observeTransition", "verifyActivation", "detach"];
const SURFACE_METHODS = ["listTabs", "showTab", "navigate", "waitForUrl", "waitForFeed", "waitForExpression", "evaluate", "evaluateMutation", "snapshot", "fill", "upload", "uploadSelector", "browserCommandCount"];
const parseTime = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
};

/** GPM protocol adapter. It consumes only injected profile/session references and client factory. */
export class GpmExecutionTransport extends ExecutionTransport {
  #profileReference; #sessionHandle; #protocolFactory; #attestation; #client = null; #session = null; #browserSurface = null; #detached = false;

  constructor({ profileReference, sessionHandle, protocolFactory, hostAttestation } = {}) {
    super();
    this.#profileReference = typeof profileReference === "string" ? profileReference.trim() : "";
    this.#sessionHandle = typeof sessionHandle === "string" ? sessionHandle.trim() : "";
    this.#protocolFactory = protocolFactory;
    this.#attestation = hostAttestation && typeof hostAttestation === "object" ? Object.freeze({
      host: String(hostAttestation.host || "").slice(0, 100), runtime: String(hostAttestation.runtime || "").slice(0, 100),
      version: String(hostAttestation.version || "").slice(0, 80), evidence: String(hostAttestation.evidence || "").slice(0, 180),
      observedAt: String(hostAttestation.observedAt || hostAttestation.attestedAt || "").slice(0, 40),
      expiresAt: String(hostAttestation.expiresAt || "").slice(0, 40) || null
    }) : null;
    this.transportIdentity = Object.freeze({ transport: "gpm-execution", provider: "gpm", providerVersion: this.#attestation?.version || null });
    this.transportContractVersion = 1;
    this.requiresPreClickValidation = true;
    this.#detached = false;
  }

  /** Bounded host attestation projection; protocol/session handles stay private. */
  attestation() { return this.#attestation; }

  #attestationReady() {
    if (!this.#attestation?.host || !this.#attestation?.runtime || !this.#attestation?.version || !this.#attestation?.evidence) return false;
    if (this.#attestation.observedAt && !parseTime(this.#attestation.observedAt)) return false;
    if (this.#attestation.expiresAt && (!parseTime(this.#attestation.expiresAt) || parseTime(this.#attestation.expiresAt) <= Date.now())) return false;
    return true;
  }

  async health() {
    if (!this.#profileReference) return { state: "UNAVAILABLE", reason: "GPM_PROFILE_REFERENCE_REQUIRED" };
    if (!this.#sessionHandle) return { state: "UNAVAILABLE", reason: "GPM_SESSION_HANDLE_REQUIRED" };
    if (typeof this.#protocolFactory !== "function") return { state: "UNAVAILABLE", reason: "GPM_PROTOCOL_FACTORY_REQUIRED" };
    if (!this.#attestationReady()) return { state: "UNKNOWN", reason: "GPM_HOST_ATTESTATION_REQUIRED" };
    return { state: "READY", ...this.transportIdentity, attestation: this.#attestation };
  }

  async attach(session) {
    if (!(session instanceof ExecutionSession)) throw fail("GPM_SESSION_CONTRACT_REQUIRED", "ExecutionSession required");
    session.assertUsable();
    if (this.#detached) throw fail("GPM_TRANSPORT_DETACHED", "transport was detached");
    const health = await this.health();
    if (health.state !== "READY") throw fail(health.reason, "GPM host or protocol is not attested");
    if (session.provider !== "gpm" || session.profileReference !== this.#profileReference || session.expectedIdentity?.provider !== "gpm" || session.expectedIdentity?.providerProfileId !== this.#profileReference) throw fail("GPM_PROFILE_BINDING_MISMATCH", "session provider/profile binding mismatch");
    if (session.lifecycle === "CHALLENGED") throw fail("GPM_SESSION_CHALLENGE", "session requires human action");
    let client;
    try { client = await this.#protocolFactory({ profileReference: this.#profileReference, sessionHandle: this.#sessionHandle, runtimeIdentity: this.transportIdentity }); }
    catch { throw fail("GPM_PROTOCOL_ATTACH_FAILED", "GPM protocol attach failed"); }
    if (!client || METHODS.some((name) => typeof client[name] !== "function")) throw fail("GPM_PROTOCOL_INCOMPLETE", "injected GPM protocol lacks required capabilities");
    // A protocol factory returns an inert client. Bind the exact browser
    // target before identity observation or any LinkedIn surface operation.
    // Legacy test doubles may already represent an attached client and omit
    // attach(); real GPM/CDP clients expose it and are required to succeed.
    if (typeof client.attach === "function") {
      try { await client.attach(); }
      catch { throw fail("GPM_PROTOCOL_ATTACH_FAILED", "GPM protocol target attach failed"); }
    }
    let observed;
    try { observed = await client.observeIdentity?.(); }
    catch { throw fail("GPM_IDENTITY_OBSERVATION_FAILED", "GPM identity observation failed"); }
    if (!observed) throw fail("GPM_IDENTITY_UNKNOWN", "GPM identity was not observed");
    const state = String(observed.state || "").toUpperCase();
    if (["CHALLENGED", "CHALLENGE"].includes(state)) throw fail("GPM_SESSION_CHALLENGE", "GPM session has a challenge");
    if (["STALE", "EXPIRED"].includes(state)) throw fail("GPM_SESSION_STALE", "GPM session is stale");
    const observedProvider = String(observed.provider || "").toLowerCase();
    const observedProfile = String(observed.providerProfileId || observed.profileReference || "");
    const expectedIdentity = session.expectedIdentity || {};
    if (observedProvider !== "gpm" || String(observed.platform || "").toLowerCase() !== expectedIdentity.platform || String(observed.accountId || "") !== expectedIdentity.accountId ||
        observedProfile !== expectedIdentity.providerProfileId ||
        (expectedIdentity.identityReference && canonicalIdentityUrl(observed.identityReference) !== canonicalIdentityUrl(expectedIdentity.identityReference))) throw fail("GPM_IDENTITY_MISMATCH", "observed account/profile/identity does not match session binding");
    this.#client = client;
    this.#session = session;
    return Object.freeze({ ...this.transportIdentity, profileReference: this.#profileReference, accountId: session.accountId, attestation: this.#attestation, capabilities: session.capabilities });
  }

  #ready() { if (!this.#client || !this.#session) throw fail("GPM_TRANSPORT_NOT_ATTACHED", "transport is not attached"); this.#session.assertUsable(); return this.#client; }
  runtimeIdentity() { return this.transportIdentity; }
  assertPreClickValidation({ validate } = {}) { return assertPreClickValidation({ validate }); }
  #capability(name) {
    const client = this.#ready();
    if (typeof client[name] !== "function") throw fail("GPM_PROTOCOL_CAPABILITY_UNSUPPORTED", `GPM protocol capability unsupported: ${name}`);
    return client[name].bind(client);
  }
  asBrowserSurface() {
    if (this.#browserSurface) return this.#browserSurface;
    const self = this;
    this.#browserSurface = Object.freeze(Object.fromEntries(SURFACE_METHODS.map((name) => [name, (...args) => self.#capability(name)(...args)])));
    return this.#browserSurface;
  }
  get browserSurface() { return this.asBrowserSurface(); }
  navigate(...args) { return this.#capability("navigate")(...args); }
  snapshot(...args) { return this.#capability("snapshot")(...args); }
  observe(...args) { return this.snapshot(...args); }
  resolve(...args) { return this.#capability("resolve")(...args); }
  findControl(...args) { return this.resolve(...args); }
  type(...args) { return this.#capability("type")(...args); }
  screenshot(...args) { return this.#capability("screenshot")(...args); }
  async click(target, options = {}) { this.#ready(); assertPreClickValidation(options); await options.validate(); return this.#ready().click(target, options); }
  observeTransition(...args) { return this.#capability("observeTransition")(...args); }
  verifyActivation(...args) { return this.#capability("verifyActivation")(...args); }
  waitForUrl(...args) { return this.#capability("waitForUrl")(...args); }
  waitForFeed(...args) { return this.#capability("waitForFeed")(...args); }
  waitForExpression(...args) { return this.#capability("waitForExpression")(...args); }
  evaluate(...args) { return this.#capability("evaluate")(...args); }
  evaluateMutation(...args) { return this.#capability("evaluateMutation")(...args); }
  fill(...args) { return this.#capability("fill")(...args); }
  upload(...args) { return this.#capability("upload")(...args); }
  uploadSelector(...args) { return this.#capability("uploadSelector")(...args); }
  listTabs(...args) { return this.#capability("listTabs")(...args); }
  showTab(...args) { return this.#capability("showTab")(...args); }
  browserCommandCount(...args) { return this.#capability("browserCommandCount")(...args); }
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

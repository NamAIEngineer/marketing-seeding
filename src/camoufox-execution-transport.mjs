import { ExecutionSession } from "./execution-session.mjs";
import { ExecutionTransport } from "./execution-transport.mjs";
import { canonicalIdentityUrl } from "./execution-binding.mjs";
import { persistCamoufoxSessionMetadata } from "./camoufox-session-observer.mjs";

const METHODS = ["navigate", "snapshot", "resolve", "type", "click", "observeTransition", "verifyActivation", "detach"];
const SURFACE_METHODS = [
  "listTabs", "showTab", "navigate", "waitForUrl", "waitForFeed", "waitForExpression",
  "evaluate", "evaluateMutation", "snapshot", "fill", "upload", "uploadSelector", "browserCommandCount"
];
const SECRET_KEY = /(cookie|password|token|secret|credential|authorization|sessionstorage|localstorage|rawsession|privatekey|accesskey)/i;
const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const fail = (code, message) => Object.assign(new Error(message), { code });

function rejectSecrets(value, path = "options", depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw fail("CAMOUFOX_SECRET_FIELD", `${path}.${key} is not accepted`);
    if (typeof child === "string" && /bearer\s+|cookie\s*=|access[_ -]?token|session[_ -]?token/i.test(child)) {
      throw fail("CAMOUFOX_SECRET_VALUE", `${path}.${key} is not accepted`);
    }
    if (child && typeof child === "object" && !(child instanceof Function)) rejectSecrets(child, `${path}.${key}`, depth + 1);
  }
}

function attestation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("CAMOUFOX_HOST_ATTESTATION_REQUIRED", "Camoufox host attestation is required");
  rejectSecrets(value, "hostAttestation");
  const result = Object.freeze({
    host: text(value.host, 100),
    runtime: text(value.runtime, 100),
    version: text(value.version, 80),
    evidence: text(value.evidence, 180),
    observedAt: text(value.observedAt || value.attestedAt, 40) || null,
    expiresAt: text(value.expiresAt, 40) || null
  });
  if (![result.host, result.runtime, result.version, result.evidence].every(Boolean)) {
    throw fail("CAMOUFOX_HOST_ATTESTATION_REQUIRED", "Camoufox host attestation is incomplete");
  }
  if (result.observedAt && !Number.isFinite(Date.parse(result.observedAt))) throw fail("CAMOUFOX_HOST_ATTESTATION_INVALID", "Camoufox attestation observedAt is invalid");
  if (!result.expiresAt || !Number.isFinite(Date.parse(result.expiresAt))) throw fail("CAMOUFOX_HOST_ATTESTATION_INVALID", "Camoufox attestation expiresAt is invalid");
  if (Date.parse(result.expiresAt) <= Date.now()) throw fail("CAMOUFOX_HOST_ATTESTATION_STALE", "Camoufox host attestation is stale");
  return result;
}

function observedIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    state: text(value.state || value.status).toUpperCase(),
    provider: text(value.provider).toLowerCase(),
    platform: text(value.platform).toLowerCase(),
    accountId: text(value.accountId || value.account),
    providerProfileId: text(value.providerProfileId || value.profileReference || value.profileRef),
    identityReference: canonicalIdentityUrl(value.identityReference || value.expectedIdentityUrl)
  };
}

/**
 * Camoufox execution transport.
 *
 * The protocol client is injected deliberately. Construction has no browser,
 * profile, login, network, or account side effect. A future launcher/attach
 * implementation must provide this client without exposing session material.
 */
export class CamoufoxExecutionTransport extends ExecutionTransport {
  #profileReference;
  #protocolFactory;
  #attestation;
  #sessionMetadataPath;
  #client = null;
  #session = null;
  #browserSurface = null;
  #detached = false;

  constructor({ profileReference, protocolFactory, hostAttestation, sessionMetadataPath = "" } = {}) {
    super();
    rejectSecrets({ profileReference, protocolFactory, hostAttestation });
    this.#profileReference = text(profileReference, 160);
    this.#protocolFactory = protocolFactory;
    this.#attestation = hostAttestation ? attestation(hostAttestation) : null;
    this.#sessionMetadataPath = text(sessionMetadataPath, 2_000);
    this.transportIdentity = Object.freeze({
      transport: "camoufox-execution",
      provider: "camoufox",
      providerVersion: this.#attestation?.version || null
    });
    this.transportContractVersion = 1;
    this.requiresPreClickValidation = true;
  }

  attestation() { return this.#attestation; }

  runtimeIdentity() { return this.transportIdentity; }

  profileIdentity() {
    return Object.freeze({ provider: "camoufox", profileReference: this.#profileReference, bound: Boolean(this.#profileReference) });
  }

  sessionIdentity() {
    return Object.freeze({ provider: "camoufox", attached: Boolean(this.#client), identityVerified: Boolean(this.#session) });
  }

  async health() {
    if (!this.#profileReference) return { state: "UNAVAILABLE", reason: "CAMOUFOX_PROFILE_REFERENCE_REQUIRED", ...this.transportIdentity };
    if (typeof this.#protocolFactory !== "function") return { state: "UNAVAILABLE", reason: "CAMOUFOX_PROTOCOL_FACTORY_REQUIRED", ...this.transportIdentity };
    if (!this.#attestation) return { state: "UNKNOWN", reason: "CAMOUFOX_HOST_ATTESTATION_REQUIRED", ...this.transportIdentity };
    if (Date.parse(this.#attestation.expiresAt) <= Date.now()) return { state: "UNKNOWN", reason: "CAMOUFOX_HOST_ATTESTATION_STALE", ...this.transportIdentity };
    return { state: "READY", ...this.transportIdentity, attestation: this.#attestation };
  }

  async attach(session) {
    if (!(session instanceof ExecutionSession)) throw fail("CAMOUFOX_SESSION_CONTRACT_REQUIRED", "ExecutionSession required");
    session.assertUsable();
    if (this.#detached) throw fail("CAMOUFOX_TRANSPORT_DETACHED", "Camoufox transport was detached");
    const health = await this.health();
    if (health.state !== "READY") throw fail(health.reason, "Camoufox host or protocol is not attested");
    const expected = session.expectedIdentity || {};
    if (session.provider !== "camoufox" || session.profileReference !== this.#profileReference || expected.provider !== "camoufox" || expected.providerProfileId !== this.#profileReference) {
      throw fail("CAMOUFOX_PROFILE_BINDING_MISMATCH", "session provider/profile binding mismatch");
    }
    let client;
    try {
      client = await this.#protocolFactory({
        profileReference: this.#profileReference,
        runtimeIdentity: this.transportIdentity,
        expectedIdentity: session.expectedIdentity,
        session
      });
    } catch {
      throw fail("CAMOUFOX_PROTOCOL_ATTACH_FAILED", "Camoufox protocol attach failed");
    }
    if (!client) throw fail("CAMOUFOX_PROTOCOL_INCOMPLETE", "injected Camoufox protocol lacks required capabilities");
    let verified = false;
    try {
      if (METHODS.some((name) => typeof client[name] !== "function")) throw fail("CAMOUFOX_PROTOCOL_INCOMPLETE", "injected Camoufox protocol lacks required capabilities");
      if (typeof client.attach === "function") {
        try { await client.attach(); } catch { throw fail("CAMOUFOX_PROTOCOL_ATTACH_FAILED", "Camoufox protocol target attach failed"); }
      }
      let observed;
      try { observed = await client.observeIdentity?.(); } catch { throw fail("CAMOUFOX_IDENTITY_OBSERVATION_FAILED", "Camoufox identity observation failed"); }
      const identity = observedIdentity(observed);
      if (!identity) throw fail("CAMOUFOX_IDENTITY_UNKNOWN", "Camoufox identity was not observed");
      if (["CHALLENGED", "CHALLENGE", "MFA", "SECURITY_CHALLENGE"].includes(identity.state)) throw fail("CAMOUFOX_SESSION_CHALLENGE", "Camoufox session has a security challenge");
      if (["LOGIN_REQUIRED", "AUTH_REQUIRED"].includes(identity.state)) throw fail("CAMOUFOX_AUTH_REQUIRED", "Camoufox session requires authentication");
      if (["STALE", "EXPIRED", "UNKNOWN", "UNAVAILABLE"].includes(identity.state)) throw fail("CAMOUFOX_IDENTITY_UNKNOWN", "Camoufox identity is not ready");
      if (identity.provider !== "camoufox" || identity.platform !== expected.platform || identity.accountId !== expected.accountId || identity.providerProfileId !== expected.providerProfileId || (expected.identityReference && identity.identityReference !== canonicalIdentityUrl(expected.identityReference))) {
        throw fail("CAMOUFOX_IDENTITY_MISMATCH", "observed account/profile/identity does not match session binding");
      }
      if (this.#sessionMetadataPath) {
        try {
          await persistCamoufoxSessionMetadata(this.#sessionMetadataPath, {
            provider: "camoufox",
            platform: identity.platform,
            accountId: identity.accountId,
            profileReference: identity.providerProfileId,
            identityReference: identity.identityReference,
            status: "READY",
            authState: "READY",
            identityStatus: "VERIFIED"
          });
        } catch (error) {
          throw fail("CAMOUFOX_SESSION_METADATA_PERSIST_FAILED", "Camoufox session metadata persistence failed");
        }
      }
      this.#client = client;
      this.#session = session;
      verified = true;
      return Object.freeze({ ...this.transportIdentity, profileReference: this.#profileReference, accountId: session.accountId, attestation: this.#attestation, capabilities: session.capabilities });
    } finally {
      // A protocol client may have attached before identity verification. Do
      // not leave that browser surface owned after a fail-closed mismatch.
      if (!verified) {
        try { await client.detach?.(); } catch { /* failure remains fail-closed */ }
      }
    }
  }

  #ready() {
    if (!this.#client || !this.#session) throw fail("CAMOUFOX_TRANSPORT_NOT_ATTACHED", "Camoufox transport is not attached");
    this.#session.assertUsable();
    return this.#client;
  }

  #capability(name) {
    const client = this.#ready();
    if (typeof client[name] !== "function") throw fail("CAMOUFOX_PROTOCOL_CAPABILITY_UNSUPPORTED", `Camoufox protocol capability unsupported: ${name}`);
    return client[name].bind(client);
  }

  assertPreClickValidation({ validate } = {}) {
    if (typeof validate !== "function") throw fail("TRANSPORT_VALIDATION_REQUIRED", "Browser transport requires pre-provider validation");
    return true;
  }

  async assertReadyForFinalSubmit() {
    this.#ready();
    const health = await this.health();
    if (health.state !== "READY") throw fail(health.reason, "Camoufox runtime is not ready for final submit");
    return this.runtimeIdentity();
  }

  asBrowserSurface() {
    if (this.#browserSurface) return this.#browserSurface;
    this.#browserSurface = Object.freeze(Object.fromEntries(SURFACE_METHODS.map((name) => [name, (...args) => this.#capability(name)(...args)])));
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
  observeTransition(...args) { return this.#capability("observeTransition")(...args); }
  verifyActivation(...args) { return this.#capability("verifyActivation")(...args); }
  async click(target, options = {}) {
    this.#ready();
    this.assertPreClickValidation(options);
    const preflight = await options.validate();
    const result = await this.#capability("click")(target, options);
    return result && typeof result === "object" ? { ...result, preflight } : { result, preflight };
  }

  async detach() {
    if (this.#detached) return Object.freeze({ detached: true, status: "ALREADY_DETACHED" });
    this.#detached = true;
    const client = this.#client;
    this.#client = null;
    this.#session = null;
    if (client && typeof client.detach === "function") await client.detach();
    return Object.freeze({ detached: true, status: "DETACHED" });
  }

  closeOwnedResources() { return this.detach(); }
}

export default CamoufoxExecutionTransport;

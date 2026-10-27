import { CamoufoxExecutionTransport } from "./camoufox-execution-transport.mjs";
import { ExecutionSession } from "./execution-session.mjs";
import { canonicalIdentityUrl } from "./execution-binding.mjs";
import { selectAccountRuntimeCandidate } from "./account-runtime-registry.mjs";

const SECRET_KEY = /(cookie|password|token|secret|credential|authorization|sessionstorage|localstorage|rawsession|privatekey|accesskey)/i;
const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const fail = (code, message) => Object.assign(new Error(message), { code });
const failure = (code, reason, selectionStatus = null) => Object.freeze({ ready: false, status: "NOT_READY", code, reason, selectionStatus });

function rejectSecrets(value, path = "config", depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw fail("CAMOUFOX_RESOLVER_SECRET_FIELD", `${path}.${key} is not accepted`);
    if (typeof child === "string" && /bearer\s+|cookie\s*=|access[_ -]?token|session[_ -]?token/i.test(child)) {
      throw fail("CAMOUFOX_RESOLVER_SECRET_VALUE", `${path}.${key} is not accepted`);
    }
    if (child && typeof child === "object" && !(child instanceof Function)) rejectSecrets(child, `${path}.${key}`, depth + 1);
  }
}

function validateAttestation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("CAMOUFOX_RESOLVER_ATTESTATION_REQUIRED", "Camoufox host attestation is required");
  rejectSecrets(value, "hostAttestation");
  for (const key of ["host", "runtime", "version", "evidence"]) if (!text(value[key])) throw fail("CAMOUFOX_RESOLVER_ATTESTATION_REQUIRED", `Camoufox host attestation ${key} is required`);
  if (!text(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw fail("CAMOUFOX_RESOLVER_ATTESTATION_STALE", "Camoufox host attestation is stale or missing expiry");
  return Object.freeze({ ...value, host: text(value.host, 100), runtime: text(value.runtime, 100), version: text(value.version, 80), evidence: text(value.evidence, 180), observedAt: text(value.observedAt || value.attestedAt, 40) || null, expiresAt: text(value.expiresAt, 40) });
}

function exactSelection(selector, registry, request, configuredProfile = "") {
  const result = selector(registry, request);
  const selected = result?.selected;
  const provider = text(selected?.provider).toLowerCase();
  const profile = text(selected?.providerProfileId || selected?.profileRef || selected?.profileReference);
  const requestedProvider = text(request.provider).toLowerCase();
  const requestedProfile = text(request.providerProfileId || request.profileReference || request.profileRef || request.profileId);
  const requestedIdentity = canonicalIdentityUrl(request.identityReference || request.expectedIdentityUrl);
  const identity = canonicalIdentityUrl(selected?.identityReference || selected?.expectedIdentityUrl);
  if (requestedProvider && requestedProvider !== provider) return failure("PROVIDER_BINDING_MISMATCH", "selected account provider does not match the execution request", result?.status || null);
  if (!selected || provider !== "camoufox" || !profile || (configuredProfile && profile !== configuredProfile)) return failure("PROFILE_BINDING_MISSING", "selected account lacks exact Camoufox provider/profile binding", result?.status || null);
  if (requestedProfile && requestedProfile !== profile) return failure("PROFILE_BINDING_MISMATCH", "selected Camoufox profile does not match the execution request", result?.status || null);
  if (request.accountId && text(selected.accountId) !== text(request.accountId)) return failure("ACCOUNT_BINDING_MISMATCH", "selected account does not match the execution request", result?.status || null);
  if (request.platform && text(selected.platform).toLowerCase() !== text(request.platform).toLowerCase()) return failure("PLATFORM_BINDING_MISMATCH", "selected platform does not match the execution request", result?.status || null);
  if (requestedIdentity && identity !== requestedIdentity) return failure("IDENTITY_BINDING_MISMATCH", "selected identity does not match the execution request", result?.status || null);
  if (String(selected.platform).toLowerCase() === "linkedin" && !identity) return failure("IDENTITY_BINDING_MISSING", "selected LinkedIn account lacks verified identity binding", result?.status || null);
  return Object.freeze({ result, selected, provider, profile, identity });
}

/**
 * Provider-neutral session composition with an explicit Camoufox provider.
 * Profile lifecycle is delegated to an injected coordinator; this module never
 * creates profiles, logs in, reads cookies, or starts a browser.
 */
export class CamoufoxExecutionSessionResolver {
  #config;
  #handles = new Map();

  constructor({ accountRegistry, coordinator, protocolFactory, hostAttestation, profileReference = "", selector = selectAccountRuntimeCandidate, clock = () => new Date() } = {}) {
    rejectSecrets({ accountRegistry, coordinator, protocolFactory, hostAttestation, profileReference });
    if (!Array.isArray(accountRegistry)) throw fail("CAMOUFOX_RESOLVER_ACCOUNT_REGISTRY_REQUIRED", "account registry is required");
    if (!coordinator || typeof coordinator.acquire !== "function" || typeof coordinator.release !== "function") throw fail("CAMOUFOX_RESOLVER_COORDINATOR_REQUIRED", "profile coordinator is required");
    if (typeof protocolFactory !== "function") throw fail("CAMOUFOX_RESOLVER_PROTOCOL_FACTORY_REQUIRED", "Camoufox protocol factory is required");
    if (typeof selector !== "function") throw fail("CAMOUFOX_RESOLVER_SELECTOR_REQUIRED", "account selector is required");
    if (typeof clock !== "function") throw fail("CAMOUFOX_RESOLVER_CLOCK_INVALID", "clock must be a function");
    this.#config = Object.freeze({
      accountRegistry: accountRegistry.slice(),
      coordinator,
      protocolFactory,
      hostAttestation: validateAttestation(hostAttestation),
      profileReference: text(profileReference, 160),
      selector,
      clock
    });
  }

  get provider() { return "camoufox"; }
  get runtimeProvider() { return "camoufox"; }
  get hostAttestation() { return this.#config.hostAttestation; }

  async acquire(request = {}) {
    const now = request.now || this.#config.clock();
    let selected;
    try {
      selected = exactSelection(this.#config.selector, this.#config.accountRegistry, {
        ...request,
        ...(text(request.provider) ? { provider: text(request.provider).toLowerCase() } : {}),
        now
      }, this.#config.profileReference);
    }
    catch { return failure("SELECTION_FAILED", "Camoufox account selection failed"); }
    if (!selected?.selected) return selected;
    const account = selected.selected;
    const platform = text(account.platform).toLowerCase();
    const accountId = text(account.accountId);
    const profileReference = selected.profile;
    const identityReference = selected.identity;
    let coordinated;
    try { coordinated = await this.#config.coordinator.acquire({ ...request, provider: "camoufox", platform, accountId, providerProfileId: profileReference, profileReference, identityReference }); }
    catch { return failure("CAMOUFOX_PROFILE_ACQUIRE_FAILED", "Camoufox profile coordinator acquire failed", selected.result?.status || null); }
    if (!coordinated?.ready || !coordinated.handle) return Object.freeze({ ...coordinated, selectionStatus: selected.result?.status || null });

    const transport = new CamoufoxExecutionTransport({ profileReference, protocolFactory: this.#config.protocolFactory, hostAttestation: this.#config.hostAttestation });
    const runtimeIdentity = transport.runtimeIdentity();
    const session = new ExecutionSession({
      lifecycle: "READY", provider: "camoufox", profileReference, providerProfileId: profileReference,
      platform, accountId, identityReference,
      expectedIdentity: { provider: "camoufox", providerProfileId: profileReference, platform, accountId, identityReference },
      capabilities: ["health", "runtimeIdentity", "profileIdentity", "sessionIdentity", "navigate", "snapshot", "findControl", "type", "click", "screenshot", "observeTransition", "verifyActivation", "closeOwnedResources"],
      transportRef: { id: runtimeIdentity.transport }, transportIdentity: runtimeIdentity,
      attestation: this.#config.hostAttestation, createdAt: this.#config.clock().toISOString?.() || undefined
    });
    try {
      await transport.attach(session);
      const browserSurface = transport.browserSurface;
      const entry = { coordinatorHandle: coordinated.handle, released: false };
      const handle = Object.freeze({ accountId, profileFingerprint: coordinated.handle.profileFingerprint, runtimeIdentity, transport, browserSurface, session, release: () => this.release(handle) });
      entry.handle = handle;
      this.#handles.set(handle, entry);
      return Object.freeze({ ready: true, status: "READY", handle, session, transport, browserSurface, transportIdentity: runtimeIdentity, release: () => this.release(handle) });
    } catch (error) {
      await transport.detach().catch(() => undefined);
      await this.#config.coordinator.release(coordinated.handle).catch(() => undefined);
      return failure(error?.code || "CAMOUFOX_ATTACH_FAILED", "Camoufox execution transport attach failed", selected.result?.status || null);
    }
  }

  resolve(request = {}) { return this.acquire(request); }

  async release(handle) {
    const entry = this.#handles.get(handle);
    if (!entry) return Object.freeze({ released: false, status: "REJECTED", code: "FOREIGN_HANDLE" });
    if (entry.released) return Object.freeze({ released: true, status: "ALREADY_RELEASED", code: "DUPLICATE_RELEASE" });
    entry.released = true;
    try { await entry.handle.transport.detach(); } catch { /* coordinator release remains authoritative */ }
    return this.#config.coordinator.release(entry.coordinatorHandle);
  }
}

export function createCamoufoxExecutionSessionResolver(options = {}) {
  return new CamoufoxExecutionSessionResolver(options);
}

export default createCamoufoxExecutionSessionResolver;

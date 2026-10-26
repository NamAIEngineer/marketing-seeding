import { createHash } from "node:crypto";
import { GpmExecutionSession } from "./gpm-execution-session.mjs";
import { selectAccountRuntimeCandidate } from "./account-runtime-registry.mjs";

const SECRET_KEY = /(cookie|password|token|secret|credential|authorization|sessionsecret|privatekey|accesskey)/i;
const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const fail = (code, message) => Object.assign(new Error(message), { code });

function rejectSecrets(value, path = "config", depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw fail("GPM_RESOLVER_SECRET_FIELD", `${path}.${key} is not accepted`);
    if (typeof child === "string" && /bearer\s+|cookie\s*=|session[_ -]?token|access[_ -]?token/i.test(child)) throw fail("GPM_RESOLVER_SECRET_VALUE", `${path}.${key} is not accepted`);
    rejectSecrets(child, `${path}.${key}`, depth + 1);
  }
}

function validateAttestation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("GPM_RESOLVER_ATTESTATION_REQUIRED", "host attestation is required");
  rejectSecrets(value, "hostAttestation");
  for (const key of ["host", "runtime", "version", "evidence"]) if (!text(value[key])) throw fail("GPM_RESOLVER_ATTESTATION_REQUIRED", `host attestation ${key} is required`);
  if (value.observedAt && !Number.isFinite(Date.parse(value.observedAt))) throw fail("GPM_RESOLVER_ATTESTATION_INVALID", "host attestation observedAt is invalid");
  if (value.expiresAt && (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now())) throw fail("GPM_RESOLVER_ATTESTATION_STALE", "host attestation is stale");
  return Object.freeze({ host: text(value.host, 100), runtime: text(value.runtime, 100), version: text(value.version, 80), evidence: text(value.evidence, 180), observedAt: text(value.observedAt, 40) || null, expiresAt: text(value.expiresAt, 40) || null });
}

function validateConfig(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw fail("GPM_RESOLVER_CONFIG_REQUIRED", "resolver configuration is required");
  rejectSecrets(options);
  if (text(options.provider).toLowerCase() !== "gpm") throw fail("GPM_RESOLVER_PROVIDER_MISMATCH", "resolver provider must be gpm");
  const profileReference = text(options.profileReference || options.providerProfileRef, 160);
  if (!profileReference) throw fail("GPM_RESOLVER_PROFILE_REQUIRED", "GPM profile reference is required");
  const sessionAuthority = text(options.sessionAuthority || options.sessionAuthorityReference, 180);
  if (!sessionAuthority) throw fail("GPM_RESOLVER_AUTHORITY_REQUIRED", "GPM session authority reference is required");
  if (!Array.isArray(options.accountRegistry)) throw fail("GPM_RESOLVER_ACCOUNT_REGISTRY_REQUIRED", "account registry is required");
  if (!options.coordinator || typeof options.coordinator.acquire !== "function" || typeof options.coordinator.release !== "function") throw fail("GPM_RESOLVER_COORDINATOR_REQUIRED", "GPM session coordinator is required");
  if (typeof options.attach !== "function") throw fail("GPM_RESOLVER_ATTACH_REQUIRED", "explicit GPM attach function is required");
  return Object.freeze({ provider: "gpm", profileReference, sessionAuthority, hostAttestation: validateAttestation(options.hostAttestation), accountRegistry: options.accountRegistry.slice(), coordinator: options.coordinator, attach: options.attach, selector: options.selector });
}

/**
 * Build an explicit GPM execution-session resolver. Construction is inert:
 * profile lifecycle, browser attach, protocol calls, and identity observation
 * begin only when the returned resolver is acquired for one exact request.
 */
export function createGpmExecutionSessionResolver(options = {}) {
  const config = validateConfig(options);
  const selector = typeof config.selector === "function" ? config.selector : (registry, request) => {
    const result = selectAccountRuntimeCandidate(registry, request);
    const selected = result?.selected;
    if (selected && (text(selected.provider).toLowerCase() !== config.provider ||
        selected.profileRef !== config.profileReference ||
        (selected.providerProfileId || selected.profileRef) !== config.profileReference ||
        (request.provider && text(request.provider).toLowerCase() !== config.provider) ||
        (request.accountId && selected.accountId !== text(request.accountId)) ||
        (request.providerProfileId && (selected.providerProfileId || selected.profileRef) !== text(request.providerProfileId)) ||
        (request.identityReference && text(selected.identityReference) !== text(request.identityReference)))) {
      return { ...result, status: "NO_ELIGIBLE_ACCOUNT", selected: null, selectionReason: "configured_profile_binding_mismatch" };
    }
    return result;
  };
  const composed = new GpmExecutionSession({
    coordinator: config.coordinator,
    accountRegistry: config.accountRegistry,
    selectAccountRuntimeCandidate: selector,
    attach: async (binding) => {
      if (String(binding.profileReference || "") !== config.profileReference || String(binding.provider || "gpm").toLowerCase() !== config.provider) throw fail("GPM_RESOLVER_PROFILE_MISMATCH", "selected provider/profile does not match resolver binding");
      return config.attach({ ...binding, provider: config.provider, sessionAuthority: config.sessionAuthority, hostAttestation: config.hostAttestation });
    }
  });
  return Object.freeze({
    provider: "gpm",
    runtimeProvider: "gpm",
    profileReference: config.profileReference,
    sessionAuthorityReference: `sha256:${createHash("sha256").update(config.sessionAuthority).digest("hex").slice(0, 32)}`,
    hostAttestation: config.hostAttestation,
    async acquire(request = {}) {
      const requested = { ...request, platform: text(request.platform).toLowerCase() || "linkedin", accountId: text(request.accountId) || undefined };
      return composed.acquire(requested);
    },
    async resolve(request = {}) { return this.acquire(request); },
    async release(handle) { return composed.release(handle?.handle || handle); }
  });
}

export const createExecutionSessionResolver = createGpmExecutionSessionResolver;
export default createGpmExecutionSessionResolver;

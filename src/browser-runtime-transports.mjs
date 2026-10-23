import { BrowserInteractionTransport, OrcaAccessibilityTransport, OrcaPointerTransport } from "./browser-interaction-transport.mjs";

export const TRANSPORT_CAPABILITIES = Object.freeze([
  "health", "runtimeIdentity", "profileIdentity", "sessionIdentity", "navigate", "snapshot",
  "findControl", "type", "click", "screenshot", "observeTransition", "verifyActivation", "closeOwnedResources"
]);

function bounded(value, limit = 240) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, limit);
}

function safeEndpoint(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|auth|password|cookie/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return bounded(url.toString());
  } catch {
    return bounded(String(value).replace(/(token|secret|key|password)=([^&\s]+)/ig, "$1=[REDACTED]"));
  }
}

function unavailable(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

/**
 * Shared bounded transport seam. Construction never implies provider
 * readiness; health() must observe an injected probe or report UNKNOWN.
 */
export class BrowserRuntimeTransport extends BrowserInteractionTransport {
  constructor({ id, provider, providerVersion = null, endpoint = null, profileReference = null, sessionReference = null, executable = null, client = null, probe = null } = {}) {
    super({ id, provider, providerVersion });
    this.endpoint = safeEndpoint(endpoint);
    this.profileReference = bounded(profileReference);
    this.sessionReference = bounded(sessionReference);
    this.executable = bounded(executable);
    this.client = client;
    this.probe = typeof probe === "function" ? probe : null;
  }

  runtimeIdentity() {
    return {
      ...super.runtimeIdentity(),
      endpoint: this.endpoint,
      executable: this.executable,
      profileReference: this.profileReference,
      sessionReference: this.sessionReference
    };
  }

  profileIdentity() {
    return { profileReference: this.profileReference };
  }

  sessionIdentity() {
    return { sessionReference: this.sessionReference };
  }

  async health() {
    const missing = [];
    if (!this.endpoint && !this.executable && !this.client) missing.push("endpoint_or_executable");
    if (!this.profileReference && !this.client) missing.push("profile_reference");
    if (missing.length) return { state: "UNAVAILABLE", ...this.runtimeIdentity(), missing };
    if (!this.probe) return { state: "UNKNOWN", ...this.runtimeIdentity(), reason: "READINESS_PROBE_NOT_CONFIGURED" };
    try {
      const observed = await this.probe({ runtime: this.runtimeIdentity() });
      const state = ["READY", "UNKNOWN", "UNAVAILABLE"].includes(observed?.state) ? observed.state : "UNKNOWN";
      return { state, ...this.runtimeIdentity(), ...(observed && typeof observed === "object" ? observed : {}) };
    } catch (error) {
      return { state: "UNAVAILABLE", ...this.runtimeIdentity(), error: { code: error.code || "PROBE_FAILED", message: String(error.message || error).slice(0, 200) } };
    }
  }

  #method(name) {
    const candidate = this.client?.[name];
    if (typeof candidate !== "function") throw unavailable("TRANSPORT_CAPABILITY_UNSUPPORTED", `${this.id} does not implement ${name}`, { transport: this.id, capability: name });
    return candidate.bind(this.client);
  }

  async navigate(...args) { return this.#method("navigate")(...args); }
  async snapshot(...args) { return this.#method("snapshot")(...args); }
  async findControl(...args) { return this.#method("findControl")(...args); }
  async type(...args) { return this.#method("type")(...args); }
  async click(target, options = {}) {
    this.assertPreClickValidation(options);
    const preflight = await options.validate();
    const result = await this.#method("click")(target, options);
    if (result && typeof result === "object") return { ...result, preflight };
    return { result, preflight };
  }
  async screenshot(...args) { return this.#method("screenshot")(...args); }
  async observeTransition(...args) { return this.#method("observeTransition")(...args); }
  async verifyActivation(...args) { return this.#method("verifyActivation")(...args); }
  async closeOwnedResources(...args) { return this.#method("closeOwnedResources")(...args); }
}

export class GpmChromeTransport extends BrowserRuntimeTransport {
  constructor(options = {}) {
    super({ ...options, id: options.id || "gpm-chrome", provider: "gpm-chrome" });
  }
}

export class CamoufoxTransport extends BrowserRuntimeTransport {
  constructor(options = {}) {
    super({ ...options, id: options.id || "camoufox", provider: "camoufox" });
  }
}

export { OrcaAccessibilityTransport, OrcaPointerTransport };


import { GpmChromeTransport } from "./browser-runtime-transports.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const fail = (code, message) => Object.assign(new Error(message), { code });
const safe = (value, limit = 120) => text(value).slice(0, limit);
const BROWSER_SURFACE = ["listTabs", "showTab", "navigate", "waitForUrl", "waitForFeed", "waitForExpression", "evaluate", "evaluateMutation", "snapshot", "fill", "upload", "uploadSelector", "browserCommandCount"];
const UNSAFE_TRANSPORT_KEY = /(cookie|password|token|secret|credential|sessionhandle|rawsession|storagestate|privatekey|accesskey)/i;

function observedIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    platform: text(value.platform || value.provider).toLowerCase(),
    accountId: text(value.accountId || value.account || value.identity),
    profileReference: text(value.profileReference || value.profileRef),
    profileFingerprint: text(value.profileFingerprint),
    state: text(value.state || value.status).toLowerCase()
  };
}

/**
 * Construction is inert. attach() is the only point where an injected
 * provider client may be requested, keeping the provider seam testable and
 * preventing profile starts, login, navigation, or social actions here.
 */
export class GpmBrowserSession {
  #selection; #attach; #attached = null;

  constructor({ selection, attach } = {}) {
    if (!selection || typeof selection !== "object") throw new TypeError("exact session selection is required");
    const platform = text(selection.platform).toLowerCase();
    const accountId = text(selection.accountId);
    const profileReference = text(selection.profileReference || selection.profileRef);
    if (!platform || !accountId || !profileReference) throw fail("SESSION_BINDING_REQUIRED", "platform, account, and profile binding are required");
    if (typeof attach !== "function") throw new TypeError("injected attach function is required");
    this.#selection = Object.freeze({ platform, accountId, profileReference });
    this.#attach = attach;
  }

  selection() { return Object.freeze({ platform: this.#selection.platform, accountBound: true, profileBound: true }); }

  async attach() {
    if (this.#attached) return this.#attached;
    let result;
    try { result = await this.#attach({ ...this.#selection }); }
    catch (error) { throw fail(error?.code || "GPM_ATTACH_FAILED", "GPM attach failed"); }
    const identity = observedIdentity(result?.identity || result?.observedIdentity || result?.sessionIdentity);
    const state = text(result?.state || result?.status || identity?.state).toLowerCase();
    if (["challenge", "challenged", "unknown", "unavailable", "not_ready"].includes(state)) throw fail(state === "challenge" || state === "challenged" ? "SESSION_CHALLENGE" : "SESSION_IDENTITY_UNKNOWN", "GPM session identity is not ready");
    if (!identity || !["ready", "healthy", "attached", ""].includes(state)) throw fail("SESSION_IDENTITY_UNKNOWN", "GPM session identity is unknown");
    if (identity.platform !== this.#selection.platform || identity.accountId !== this.#selection.accountId || identity.profileReference !== this.#selection.profileReference) throw fail("SESSION_BINDING_MISMATCH", "observed GPM identity does not match selected binding");
    const providedTransport = result?.transport;
    const client = result?.client || result?.transportClient;
    if (providedTransport) {
      if (Object.keys(providedTransport).some((key) => UNSAFE_TRANSPORT_KEY.test(key))) throw fail("GPM_TRANSPORT_SECRET_FIELD", "attached transport contains secret-like material");
      if (typeof providedTransport.runtimeIdentity !== "function") throw fail("GPM_TRANSPORT_IDENTITY_MISSING", "attached GPM transport identity is missing");
      const runtimeIdentity = providedTransport.runtimeIdentity();
      if (String(runtimeIdentity?.provider || "").toLowerCase() !== "gpm") throw fail("GPM_PROVIDER_MISMATCH", "attached transport is not GPM");
      const browserSurface = result?.browserSurface || providedTransport.browserSurface || providedTransport.browser;
      if (!browserSurface || typeof browserSurface !== "object") throw fail("GPM_BROWSER_SURFACE_MISSING", "attached GPM browser surface is missing");
      const capabilities = Array.isArray(result?.capabilities) ? result.capabilities : ["health", "runtimeIdentity", "profileIdentity", "sessionIdentity", "navigate", "snapshot", "findControl", "type", "click", "screenshot", "observeTransition", "verifyActivation", "closeOwnedResources", ...BROWSER_SURFACE];
      this.#attached = Object.freeze({ status: "ATTACHED", transport: providedTransport, browserSurface, runtimeIdentity, attestation: result?.attestation || providedTransport.attestation || null, capabilities: Object.freeze([...new Set(capabilities)]) });
      return this.#attached;
    }
    if (!client || typeof client !== "object") throw fail("GPM_CLIENT_MISSING", "attached GPM client is missing");
    const base = new GpmChromeTransport({ client, providerVersion: result?.providerVersion || null });
    const runtimeIdentity = () => Object.freeze({ transport: "gpm-chrome", provider: "gpm", providerVersion: base.providerVersion, attached: true });
    const transport = {
      runtimeIdentity,
      profileIdentity: () => Object.freeze({ bound: true }),
      sessionIdentity: () => Object.freeze({ state: "ATTACHED", identityVerified: true }),
      health: (...args) => base.health(...args),
      navigate: (...args) => base.navigate(...args),
      snapshot: (...args) => base.snapshot(...args),
      findControl: (...args) => base.findControl(...args),
      type: (...args) => base.type(...args),
      click: (...args) => base.click(...args),
      screenshot: (...args) => base.screenshot(...args),
      observeTransition: (...args) => base.observeTransition(...args),
      verifyActivation: (...args) => base.verifyActivation(...args),
      closeOwnedResources: (...args) => base.closeOwnedResources(...args)
    };
    const browserSurface = result?.browserSurface || Object.fromEntries(BROWSER_SURFACE.map((name) => [name, (...args) => {
      if (typeof client[name] !== "function") throw fail("GPM_PROTOCOL_CAPABILITY_UNSUPPORTED", `GPM protocol capability unsupported: ${name}`);
      return client[name](...args);
    }]));
    Object.freeze(browserSurface);
    Object.freeze(transport);
    this.#attached = Object.freeze({ status: "ATTACHED", transport, browserSurface, runtimeIdentity: transport.runtimeIdentity(), capabilities: Object.freeze(["health", "runtimeIdentity", "profileIdentity", "sessionIdentity", "navigate", "snapshot", "findControl", "type", "click", "screenshot", "observeTransition", "verifyActivation", "closeOwnedResources", ...BROWSER_SURFACE]) });
    return this.#attached;
  }
}

export const attachGpmBrowserSession = (options) => new GpmBrowserSession(options).attach();
export default GpmBrowserSession;

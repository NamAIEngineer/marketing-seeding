import { GpmChromeTransport } from "./browser-runtime-transports.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const fail = (code, message) => Object.assign(new Error(message), { code });
const safe = (value, limit = 120) => text(value).slice(0, limit);

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
    const client = result?.client || result?.transportClient;
    if (!client || typeof client !== "object") throw fail("GPM_CLIENT_MISSING", "attached GPM client is missing");
    const base = new GpmChromeTransport({ client, providerVersion: result?.providerVersion || null });
    const transport = Object.create(base);
    Object.defineProperties(transport, {
      runtimeIdentity: { value: () => Object.freeze({ transport: "gpm-chrome", provider: "gpm", providerVersion: base.providerVersion, attached: true }) },
      profileIdentity: { value: () => Object.freeze({ bound: true }) },
      sessionIdentity: { value: () => Object.freeze({ state: "ATTACHED", identityVerified: true }) },
      health: { value: (...args) => base.health(...args) }
    });
    Object.freeze(transport);
    this.#attached = Object.freeze({ status: "ATTACHED", transport, runtimeIdentity: transport.runtimeIdentity(), capabilities: Object.freeze(["health", "runtimeIdentity", "profileIdentity", "sessionIdentity", "navigate", "snapshot", "findControl", "type", "click", "screenshot", "observeTransition", "verifyActivation", "closeOwnedResources"]) });
    return this.#attached;
  }
}

export const attachGpmBrowserSession = (options) => new GpmBrowserSession(options).attach();
export default GpmBrowserSession;

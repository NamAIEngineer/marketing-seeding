import { GpmBrowserSession } from "./gpm-browser-session.mjs";
import { selectAccountRuntimeCandidate } from "./account-runtime-registry.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const safeCode = (value, fallback = "EXECUTION_FAILED") => text(value).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 48) || fallback;
const boundedReason = (value) => text(value).slice(0, 240);
const failure = (code, reason, selectionStatus = null) => Object.freeze({ ready: false, status: "NOT_READY", code: safeCode(code), reason: boundedReason(reason), selectionStatus });

/**
 * Composes account selection, GPM session coordination, and browser attachment.
 * Construction is inert. No profile, browser, network, login, or social action occurs here.
 */
export class GpmExecutionSession {
  #coordinator; #registry; #select; #attach; #clock; #handles = new Map();

  constructor({ coordinator, accountRegistry, selectAccountRuntimeCandidate: selector = selectAccountRuntimeCandidate, attach, clock = () => new Date() } = {}) {
    if (!coordinator || typeof coordinator.acquire !== "function" || typeof coordinator.release !== "function") throw new TypeError("coordinator is required");
    if (!Array.isArray(accountRegistry)) throw new TypeError("accountRegistry is required");
    if (typeof selector !== "function") throw new TypeError("selector is required");
    if (typeof attach !== "function") throw new TypeError("attach function is required");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.#coordinator = coordinator; this.#registry = accountRegistry; this.#select = selector; this.#attach = attach; this.#clock = clock;
  }

  async acquire(request = {}) {
    let selection;
    try { selection = this.#select(this.#registry, { ...request, now: request.now || this.#clock() }); }
    catch { return failure("SELECTION_FAILED", "account selection failed"); }
    const selected = selection?.selected;
    const platform = text(selected?.platform).toLowerCase();
    const accountId = text(selected?.accountId);
    const profileRef = text(selected?.profileRef || selected?.profileReference);
    if (!selected || !platform || !accountId || !profileRef) return failure("PROFILE_BINDING_MISSING", "selected account lacks exact profile binding", selection?.status || null);

    const coordinated = await this.#coordinator.acquire(request);
    if (!coordinated?.ready || !coordinated.handle) return Object.freeze({ ...coordinated, selectionStatus: coordinated?.selectionStatus || selection?.status || null });

    let attached;
    try {
      const session = new GpmBrowserSession({ selection: { platform, accountId, profileReference: profileRef }, attach: this.#attach });
      attached = await session.attach();
    } catch (error) {
      // The coordinator owns the started profile. One release is the sole cleanup path.
      await this.#coordinator.release(coordinated.handle);
      return failure(error?.code || "GPM_ATTACH_FAILED", "GPM browser session attach failed", selection?.status || null);
    }

    const token = Object.freeze({
      accountId,
      profileFingerprint: coordinated.handle.profileFingerprint,
      runtimeIdentity: coordinated.handle.runtimeIdentity,
      transport: attached.transport,
      capabilities: attached.capabilities,
      acquiredAt: this.#clock().toISOString?.() || null
    });
    const entry = { coordinatorHandle: coordinated.handle, released: false };
    const handle = Object.freeze({ ...token, release: () => this.release(handle) });
    entry.handle = handle;
    this.#handles.set(handle, entry);
    return Object.freeze({ ready: true, status: "READY", handle });
  }

  async release(handle) {
    const entry = this.#handles.get(handle);
    if (!entry) return Object.freeze({ released: false, status: "REJECTED", code: "FOREIGN_HANDLE" });
    if (entry.released) return Object.freeze({ released: true, status: "ALREADY_RELEASED", code: "DUPLICATE_RELEASE" });
    entry.released = true;
    return this.#coordinator.release(entry.coordinatorHandle);
  }
}

export const composeGpmExecutionSession = (options) => new GpmExecutionSession(options);
export default GpmExecutionSession;

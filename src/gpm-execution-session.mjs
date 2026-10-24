import { GpmBrowserSession } from "./gpm-browser-session.mjs";
import { selectAccountRuntimeCandidate } from "./account-runtime-registry.mjs";
import { ExecutionSession } from "./execution-session.mjs";

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

    const transport = attached.transport;
    const runtimeIdentity = attached.runtimeIdentity || transport.runtimeIdentity?.() || {};
    const attestation = attached.attestation || transport.attestation?.() || {
      runtime: runtimeIdentity.provider || "gpm",
      version: runtimeIdentity.providerVersion || "unknown",
      evidence: "injected-session-attach"
    };
    // The typed session is constructed only as the private binding passed to
    // the provider transport. The transport's attach performs the actual
    // host/session identity observation before this session is returned.
    const typedSession = new ExecutionSession({
      lifecycle: "READY", provider: "gpm", profileReference: profileRef, platform, accountId,
      expectedIdentity: { platform, accountId }, capabilities: attached.capabilities,
      transportRef: { id: runtimeIdentity.transport || "gpm-browser" },
      transportIdentity: runtimeIdentity,
      attestation,
      createdAt: this.#clock().toISOString?.() || undefined
    });
    try {
      if (typeof transport.attach === "function") await transport.attach(typedSession);
    } catch (error) {
      try { await transport.detach?.(); } catch { /* coordinator cleanup remains authoritative */ }
      await this.#coordinator.release(coordinated.handle);
      return failure(error?.code || "GPM_ATTACH_FAILED", "GPM execution transport attach failed", selection?.status || null);
    }
    const browserSurface = attached.browserSurface || transport.browserSurface || transport.browser;
    if (!browserSurface || typeof browserSurface !== "object") {
      try { await transport.detach?.(); } catch { /* coordinator cleanup remains authoritative */ }
      await this.#coordinator.release(coordinated.handle);
      return failure("GPM_BROWSER_SURFACE_MISSING", "GPM execution browser surface is missing", selection?.status || null);
    }
    const token = Object.freeze({
      accountId,
      profileFingerprint: coordinated.handle.profileFingerprint,
      runtimeIdentity,
      transport,
      browserSurface,
      capabilities: attached.capabilities,
      acquiredAt: typedSession.createdAt
    });
    const entry = { coordinatorHandle: coordinated.handle, released: false };
    const handle = Object.freeze({ ...token, session: typedSession, release: () => this.release(handle) });
    entry.handle = handle;
    this.#handles.set(handle, entry);
    return Object.freeze({ ready: true, status: "READY", handle, session: typedSession, transport, browserSurface, transportIdentity: runtimeIdentity, release: () => this.release(handle) });
  }

  async release(handle) {
    const entry = this.#handles.get(handle);
    if (!entry) return Object.freeze({ released: false, status: "REJECTED", code: "FOREIGN_HANDLE" });
    if (entry.released) return Object.freeze({ released: true, status: "ALREADY_RELEASED", code: "DUPLICATE_RELEASE" });
    entry.released = true;
    let transportResult = null;
    try {
      const transport = entry.handle.transport;
      if (typeof transport?.detach === "function") transportResult = await transport.detach();
      else if (typeof transport?.closeOwnedResources === "function") transportResult = await transport.closeOwnedResources();
    } catch (error) {
      transportResult = { detached: false, status: "DETACH_FAILED", code: error?.code || "GPM_DETACH_FAILED" };
    }
    const coordinatorResult = await this.#coordinator.release(entry.coordinatorHandle);
    // Keep the coordinator's historical release contract stable. Transport
    // detach is completed before it, while diagnostics remain internal.
    return coordinatorResult;
  }
}

export const composeGpmExecutionSession = (options) => new GpmExecutionSession(options);
export default GpmExecutionSession;

import { LinkedInReadinessProvider } from "./linkedin-readiness.mjs";

const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";

function result(state, reasonCode, { retryable = false, recoveryClassification = "NONE", checkedAt = new Date().toISOString() } = {}) {
  return { state, reasonCode, retryable, recoveryClassification, checkedAt };
}

function classifyResolverError(error) {
  const code = text(error?.code, 120).toUpperCase();
  if (["CAMOUFOX_SESSION_CHALLENGE", "CAMOUFOX_AUTH_REQUIRED", "CAMOUFOX_IDENTITY_MISMATCH", "CAMOUFOX_IDENTITY_UNKNOWN"].includes(code)) {
    return result("HUMAN_REQUIRED", code.toLowerCase(), { recoveryClassification: "HUMAN_REQUIRED" });
  }
  if (["CAMOUFOX_PROFILE_BUSY", "CAMOUFOX_LAUNCH_TIMEOUT", "CAMOUFOX_PROTOCOL_ATTACH_FAILED", "CAMOUFOX_PROTOCOL_ATTACH_FAILED", "CAMOUFOX_PROFILE_ACQUIRE_FAILED"].includes(code)) {
    return result("UNKNOWN", code.toLowerCase() || "camoufox_session_unavailable", { retryable: true, recoveryClassification: "RECOVERABLE" });
  }
  return result("UNKNOWN", code.toLowerCase() || "camoufox_session_unavailable", { retryable: true, recoveryClassification: "RECOVERABLE" });
}

function exactRequest(context = {}) {
  return {
    ...context,
    provider: "camoufox",
    providerProfileId: text(context.providerProfileId || context.profileId),
    profileReference: text(context.providerProfileId || context.profileId),
    profileId: text(context.profileId),
    identityReference: text(context.identityReference || context.expectedIdentityUrl),
    accountId: text(context.accountId),
    platform: text(context.platform).toLowerCase()
  };
}

function browserSurfaceFor({ surface, profileId }) {
  if (!surface || typeof surface !== "object") return null;
  if (typeof surface.listTabs !== "function" || typeof surface.showTab !== "function" || typeof surface.evaluate !== "function") return null;
  // Camoufox protocol surfaces intentionally do not expose a profile catalog.
  // Readiness still needs an exact profile assertion, so provide a bounded
  // synthetic catalog tied only to the resolver-selected profile reference.
  return Object.freeze({
    ...surface,
    listProfiles: async () => [{ id: profileId, profileId }]
  });
}

/**
 * Provider-bound LinkedIn readiness.
 *
 * Camoufox requests acquire one exact resolver session and feed its browser
 * surface into the existing LinkedIn checks. The adapter never reads secrets,
 * creates authority, or falls back to ORCA for a Camoufox request.
 */
export class CamoufoxLinkedInReadinessProvider {
  constructor({ resolver = null, fallbackProvider = null, ttlMs } = {}) {
    this.resolver = resolver;
    this.fallbackProvider = fallbackProvider || { async checkReadiness() { return result("BLOCKED", "linkedin_readiness_provider_unavailable"); } };
    this.camoufoxProvider = new LinkedInReadinessProvider({ listTabs() { throw new Error("Camoufox surface required"); } }, { ttlMs });
  }

  async checkReadiness(context = {}) {
    const provider = text(context.provider).toLowerCase();
    if (provider !== "camoufox") return this.fallbackProvider.checkReadiness(context);
    const checkedAt = new Date().toISOString();

    // A live JEV worker already acquired the exact Camoufox session before
    // readiness. Reuse that injected surface; reacquiring here would collide
    // with the profile lock and could split readiness from execution.
    const injected = browserSurfaceFor({ surface: context.browserSurface, profileId: text(context.profileId) });
    if (injected) return this.camoufoxProvider.checkReadiness({ ...context, browserSurface: injected });
    if (!this.resolver || (typeof this.resolver.resolve !== "function" && typeof this.resolver.acquire !== "function")) {
      return result("BLOCKED", "camoufox_session_resolver_unavailable", { checkedAt });
    }

    const acquire = typeof this.resolver.resolve === "function"
      ? this.resolver.resolve.bind(this.resolver)
      : this.resolver.acquire.bind(this.resolver);
    let envelope = null;
    try {
      envelope = await acquire(exactRequest(context));
      if (!envelope?.ready) {
        const code = text(envelope?.code || envelope?.reason || envelope?.status, 120).toLowerCase() || "camoufox_session_not_ready";
        return result("UNKNOWN", code, { retryable: true, recoveryClassification: "RECOVERABLE", checkedAt });
      }
      const surface = browserSurfaceFor({ surface: envelope.browserSurface || envelope.transport?.browserSurface, profileId: text(context.profileId) });
      if (!surface) return result("UNKNOWN", "camoufox_browser_surface_unavailable", { retryable: true, recoveryClassification: "RECOVERABLE", checkedAt });
      const readiness = await this.camoufoxProvider.checkReadiness({ ...context, browserSurface: surface });
      return readiness;
    } catch (error) {
      return { ...classifyResolverError(error), checkedAt };
    } finally {
      if (envelope && typeof envelope.release === "function") await Promise.resolve().then(() => envelope.release()).catch(() => undefined);
      else if (envelope?.handle && typeof this.resolver.release === "function") await Promise.resolve().then(() => this.resolver.release(envelope.handle)).catch(() => undefined);
    }
  }
}

export default CamoufoxLinkedInReadinessProvider;

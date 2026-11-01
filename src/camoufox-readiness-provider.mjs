import { createHash } from "node:crypto";
import { getCamoufoxPlatformLoginAdapter } from "./camoufox-platform-login-adapters.mjs";

const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
function result(state, reasonCode, { checkedAt = new Date().toISOString(), retryable = false, recoveryClassification = "NONE", capabilities = {}, evidenceReference = null } = {}) {
  const normalized = ["READY", "BLOCKED", "UNKNOWN"].includes(String(state).toUpperCase()) ? String(state).toUpperCase() : "UNKNOWN";
  return { state: normalized, reasonCode, checkedAt, retryable, recoveryClassification, capabilities, evidenceReference };
}

function classify(error, checkedAt) {
  const code = text(error?.code, 120).toUpperCase() || "CAMOUFOX_READINESS_FAILED";
  if (["CAMOUFOX_SESSION_CHALLENGE", "CAMOUFOX_AUTH_REQUIRED", "CAMOUFOX_IDENTITY_MISMATCH", "CAMOUFOX_IDENTITY_UNKNOWN"].includes(code)) {
    return result(code === "CAMOUFOX_SESSION_CHALLENGE" || code === "CAMOUFOX_AUTH_REQUIRED" ? "BLOCKED" : "UNKNOWN", code.toLowerCase(), { checkedAt, recoveryClassification: code.includes("CHALLENGE") || code.includes("AUTH") ? "HUMAN_REQUIRED" : "UNKNOWN" });
  }
  return result("UNKNOWN", code.toLowerCase(), { checkedAt, retryable: true, recoveryClassification: "RECOVERABLE" });
}

function surfaceWithProfile(surface, profileId) {
  if (!surface || typeof surface !== "object") return null;
  for (const method of ["listTabs", "showTab", "evaluate", "navigate"]) if (typeof surface[method] !== "function") return null;
  // The injected JEV surface is already bound to one profile. Keep an exact
  // synthetic profile catalog for providers that share LinkedIn's contract.
  return Object.freeze({ ...surface, listProfiles: async () => [{ id: profileId, profileId }] });
}

async function selectPage(surface, profileId) {
  const tabs = await surface.listTabs();
  const matching = tabs.filter((tab) => {
    const id = typeof tab?.profile === "string" ? tab.profile : tab?.profile?.id || tab?.profile?.profileId || tab?.profileId;
    return !id || id === profileId;
  });
  if (matching.length !== 1) return null;
  const tab = matching[0];
  const pageId = tab.browserPageId || tab.pageId || tab.id;
  if (!pageId) return null;
  const shown = await surface.showTab(pageId);
  if (shown?.profileId && shown.profileId !== profileId) return null;
  return pageId;
}

/** Generic readiness for non-LinkedIn Camoufox channels. It consumes the
 * exact JEV browser surface, proves owner identity plus target rights/rules,
 * and never treats a catalog entry or generic home page as READY. */
export class CamoufoxReadinessProvider {
  constructor({ resolver = null, ttlMs = 5 * 60 * 1000 } = {}) {
    this.resolver = resolver;
    this.ttlMs = ttlMs;
    this.tail = Promise.resolve();
  }

  async checkReadiness(context = {}) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await this.#check(context); } finally { release(); }
  }

  async #check(context) {
    const checkedAt = new Date();
    const at = checkedAt.toISOString();
    const platform = text(context.platform).toLowerCase();
    const adapter = getCamoufoxPlatformLoginAdapter(platform);
    if (!adapter) return result("BLOCKED", "camoufox_platform_not_supported", { checkedAt: at });
    const profileId = text(context.providerProfileId || context.profileId);
    const accountId = text(context.accountId);
    const identity = text(context.identityReference || context.expectedIdentityUrl);
    const target = context.target || { id: context.targetId, url: context.targetUrl };
    if (!profileId || !accountId || !identity || !text(target?.url)) return result("BLOCKED", "camoufox_readiness_binding_missing", { checkedAt: at });

    let envelope = null;
    let surface = surfaceWithProfile(context.browserSurface, profileId);
    try {
      if (!surface) {
        if (!this.resolver || (typeof this.resolver.resolve !== "function" && typeof this.resolver.acquire !== "function")) return result("BLOCKED", "camoufox_session_resolver_unavailable", { checkedAt: at });
        const acquire = typeof this.resolver.resolve === "function" ? this.resolver.resolve.bind(this.resolver) : this.resolver.acquire.bind(this.resolver);
        envelope = await acquire({ ...context, provider: "camoufox", providerProfileId: profileId, profileReference: profileId, identityReference: identity, allowLoginBootstrap: false });
        if (!envelope?.ready) return result("UNKNOWN", text(envelope?.code || envelope?.reason || "camoufox_session_not_ready").toLowerCase(), { checkedAt: at, retryable: true, recoveryClassification: "RECOVERABLE" });
        surface = surfaceWithProfile(envelope.browserSurface || envelope.transport?.browserSurface || envelope.session?.browserSurface, profileId);
      }
      if (!surface) return result("UNKNOWN", "camoufox_browser_surface_unavailable", { checkedAt: at, retryable: true, recoveryClassification: "RECOVERABLE" });
      const pageId = await selectPage(surface, profileId);
      if (!pageId) return result("UNKNOWN", "camoufox_profile_tab_unavailable", { checkedAt: at, retryable: true, recoveryClassification: "RECOVERABLE" });
      const identityResult = await adapter.verifyIdentity({ protocol: surface, pageId, accountId, expectedIdentity: identity });
      if (identityResult.status !== "READY") {
        const state = identityResult.status === "BLOCKED" ? "BLOCKED" : "UNKNOWN";
        return result(state, text(identityResult.code || "camoufox_identity_not_ready").toLowerCase(), { checkedAt: at, recoveryClassification: state === "BLOCKED" ? "HUMAN_REQUIRED" : "UNKNOWN" });
      }
      const rights = await adapter.checkPostingRights({ protocol: surface, pageId, target, identityReady: true });
      const rightsState = String(rights.status || "UNKNOWN").toUpperCase();
      const caps = {
        sessionAuthenticated: true,
        identityVerified: true,
        feedReachable: true,
        composerAvailable: rightsState === "READY",
        targetMatched: rights.evidence?.targetMatched === true,
        postingRights: rightsState === "READY",
        rulesEvidenceAccepted: rights.evidence?.rulesEvidenceAccepted === true
      };
      if (rightsState !== "READY") {
        const state = rightsState === "BLOCKED" ? "BLOCKED" : "UNKNOWN";
        return result(state, text(rights.reason || "target_posting_rights_unready").toLowerCase(), { checkedAt: at, retryable: state === "UNKNOWN", recoveryClassification: state === "UNKNOWN" ? "RECOVERABLE" : "NONE", capabilities: caps });
      }
      const evidence = { platform, accountId, profileId, targetId: text(target?.id || target?.targetId), identity, rights: rights.evidence, checkedAt: at };
      const evidenceReference = `camoufox-readiness:${createHash("sha256").update(JSON.stringify(evidence)).digest("hex").slice(0, 16)}`;
      return result("READY", "camoufox_session_identity_target_rights_verified", { checkedAt: at, capabilities: caps, evidenceReference, recoveryClassification: "NONE" });
    } catch (error) {
      return classify(error, at);
    } finally {
      if (envelope?.release && typeof envelope.release === "function") await Promise.resolve().then(() => envelope.release()).catch(() => undefined);
      else if (envelope?.handle && typeof this.resolver?.release === "function") await Promise.resolve().then(() => this.resolver.release(envelope.handle)).catch(() => undefined);
    }
  }
}

export function registerCamoufoxReadinessProviders(registry, { resolver = null, ttlMs = 5 * 60 * 1000 } = {}) {
  if (!registry || typeof registry.register !== "function") throw new Error("Readiness provider registry is required");
  const provider = new CamoufoxReadinessProvider({ resolver, ttlMs });
  for (const platform of ["threads", "reddit", "facebook_group", "product_hunt", "indie_hackers"]) registry.register(platform, provider);
  return provider;
}

export default CamoufoxReadinessProvider;

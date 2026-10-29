import { createHash } from "node:crypto";
import { browserElementTargetIdentity, createLiveBrowserSnapshot, normalizeBrowserSnapshot, resolveBrowserElement } from "./oi-browser-integration.mjs";

const text = (value, limit = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function providerIdentity(transport) {
  const value = typeof transport?.runtimeIdentity === "function" ? transport.runtimeIdentity() : {};
  const provider = text(value.provider || transport?.provider, 80).toLowerCase();
  if (provider !== "camoufox") throw Object.assign(new Error("Live oi-browser bridge requires Camoufox transport"), { code: "OI_BROWSER_CAMOUFOX_REQUIRED" });
  const providerVersion = text(value.providerVersion || transport?.providerVersion, 80);
  if (!providerVersion) throw Object.assign(new Error("Camoufox runtime version is required for live DOM evidence"), { code: "OI_BROWSER_RUNTIME_VERSION_REQUIRED" });
  return { provider, providerVersion };
}

function tabProfileId(tab) {
  return text(typeof tab?.profile === "string" ? tab.profile : tab?.profile?.id || tab?.profile?.profileId || tab?.profileId, 180);
}

function tabPageId(tab) {
  return text(tab?.browserPageId || tab?.pageId || tab?.id, 180);
}

function normalizedDocument(value) {
  try {
    const url = new URL(String(value || ""));
    return { origin: url.origin.toLowerCase(), pathname: url.pathname.replace(/\/+$/, "") || "/" };
  } catch {
    return null;
  }
}

function boundDocumentMatch(expected, observed) {
  const left = normalizedDocument(expected);
  const right = normalizedDocument(observed);
  if (!left || !right || left.origin !== right.origin) return false;
  if (left.pathname === right.pathname) return true;
  if (left.origin.endsWith("linkedin.com") && [left.pathname, right.pathname].every((value) => /^\/feed(?:\/foryou)?$/i.test(value))) return true;
  return false;
}

async function selectPage(browserSurface, { pageId = null, profileId = null, url = null } = {}) {
  if (pageId) {
    const tab = typeof browserSurface.showTab === "function" ? await browserSurface.showTab(pageId) : { pageId, id: pageId, profileId, url };
    if (profileId && tabProfileId(tab) && tabProfileId(tab) !== text(profileId, 180)) {
      throw Object.assign(new Error("Camoufox page profile does not match execution binding"), { code: "OI_BROWSER_PROFILE_MISMATCH" });
    }
    if (url && !boundDocumentMatch(url, tab?.url)) {
      throw Object.assign(new Error("Camoufox page URL does not match execution binding"), { code: "OI_BROWSER_PAGE_URL_MISMATCH" });
    }
    return { pageId: tabPageId(tab) || text(pageId, 180), tab };
  }
  if (typeof browserSurface.listTabs !== "function") throw Object.assign(new Error("Camoufox browser surface cannot list tabs"), { code: "OI_BROWSER_TAB_LIST_UNAVAILABLE" });
  const tabs = await browserSurface.listTabs();
  const scoped = tabs.filter((tab) => !profileId || tabProfileId(tab) === text(profileId, 180));
  const urlMatches = url ? scoped.filter((tab) => boundDocumentMatch(url, tab?.url)) : scoped;
  const candidates = (urlMatches.length ? urlMatches : scoped).filter((tab) => tabPageId(tab));
  if (candidates.length !== 1) throw Object.assign(new Error("Camoufox live DOM page identity is ambiguous"), { code: "OI_BROWSER_PAGE_AMBIGUOUS", count: candidates.length });
  return { pageId: tabPageId(candidates[0]), tab: candidates[0] };
}

/**
 * Adapter for the already-attached Camoufox surface. It only observes the
 * page and resolves semantic targets against a fresh snapshot. It never
 * creates a session, grants authority, submits a publication, or falls back
 * to another browser provider.
 */
export function createCamoufoxOiBrowserBridge({ transport, browserSurface } = {}) {
  if (!transport || !browserSurface) throw Object.assign(new Error("Camoufox oi-browser bridge requires an attached transport and surface"), { code: "OI_BROWSER_RUNTIME_UNAVAILABLE" });
  const runtime = providerIdentity(transport);

  async function capture({ pageId = null, profileId = null, url = null, frame = "top", screenshotReference = null, evidenceContext = {} } = {}) {
    if (typeof browserSurface.snapshot !== "function") throw Object.assign(new Error("Camoufox browser surface cannot capture snapshots"), { code: "OI_BROWSER_SNAPSHOT_UNAVAILABLE" });
    const selected = await selectPage(browserSurface, { pageId, profileId, url });
    const tab = selected.tab || (typeof browserSurface.showTab === "function" ? await browserSurface.showTab(selected.pageId) : {});
    const observedUrl = text(tab?.url || url, 2_000);
    if (!observedUrl) throw Object.assign(new Error("Camoufox snapshot URL is missing"), { code: "OI_BROWSER_SNAPSHOT_URL_MISSING" });
    const accessibilitySnapshot = await browserSurface.snapshot(selected.pageId);
    const evidenceRef = `camoufox-dom:${digest({ runtime, pageId: selected.pageId, url: observedUrl, executionId: evidenceContext.executionId || null, capturedAt: new Date().toISOString() })}`;
    const snapshot = createLiveBrowserSnapshot({
      url: observedUrl,
      accessibilitySnapshot,
      frame,
      screenshotReference,
      executionId: evidenceContext.executionId || null,
      runtimeEvidence: { verified: true, ...runtime, evidenceRef }
    });
    return { snapshot: normalizeBrowserSnapshot(snapshot), pageId: selected.pageId, tab, runtime, evidenceRef };
  }

  async function resolveTarget({ snapshot, intent, element, pageId = null, profileId = null } = {}) {
    const fresh = await capture({ pageId, profileId, url: snapshot?.url });
    let freshElement;
    try {
      freshElement = resolveBrowserElement(fresh.snapshot, { role: element?.role, label: element?.label });
    } catch (error) {
      if (error?.code === "DOM_TARGET_MISSING") {
        throw Object.assign(new Error("Camoufox semantic target is stale or changed"), { code: "DOM_TARGET_IDENTITY_CHANGED" });
      }
      throw error;
    }
    const semanticTargetIdentity = text(intent?.semanticTargetIdentity, 100);
    const targetIdentityMatches = semanticTargetIdentity
      ? browserElementTargetIdentity(freshElement) === semanticTargetIdentity
      : freshElement.runtimeRef === text(element?.runtimeRef, 120);
    if (freshElement.elementId !== intent?.elementId || freshElement.runtimeRef === null || fresh.snapshot.frame !== element?.frame || !targetIdentityMatches) {
      throw Object.assign(new Error("Camoufox semantic target is stale or changed"), { code: "DOM_TARGET_IDENTITY_CHANGED" });
    }
    return { targetRef: freshElement.runtimeRef, targetIdentity: intent.targetIdentity, pageId: fresh.pageId, snapshot: fresh.snapshot };
  }

  return Object.freeze({ runtime, capture, resolveTarget });
}

export async function captureCamoufoxLiveSnapshot(options = {}) {
  return createCamoufoxOiBrowserBridge(options).capture(options);
}

export default createCamoufoxOiBrowserBridge;

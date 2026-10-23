import { assertTransportCannotChangeAfterIntent } from "./browser-interaction-transport.mjs";
import { CamoufoxTransport, GpmChromeTransport, OrcaAccessibilityTransport, OrcaPointerTransport } from "./browser-runtime-transports.mjs";

export const WORKLOAD_TRANSPORT_POLICY = Object.freeze({
  AUTHENTICATED_SOCIAL_EXECUTION: "gpm",
  PUBLIC_DISCOVERY: "camoufox",
  COMMUNITY_RESEARCH: "camoufox",
  PRODUCT_WEB_DEMO: "camoufox",
  SCREENSHOT_CAPTURE: "camoufox",
  INDEPENDENT_PUBLICATION_VERIFY: "camoufox",
  // Accessibility is the deterministic host-session default. Pointer remains
  // registered as an explicit fallback/certification candidate; it is never
  // selected by array order.
  HOST_SESSION_SPECIAL_CASE: "orca-accessibility"
});

function routeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function identity(transport) {
  return typeof transport?.runtimeIdentity === "function" ? transport.runtimeIdentity() : {};
}

function routeKey(transport) {
  const value = identity(transport);
  return String(value.transport || "").toLowerCase().startsWith("orca") ? "orca" :
    String(value.provider || value.transport || "").toLowerCase().includes("gpm") ? "gpm" :
    String(value.provider || value.transport || "").toLowerCase().includes("camoufox") ? "camoufox" : "unknown";
}

/** Deterministic provider-neutral workload router. */
export class BrowserRuntimeRouter {
  constructor({ transports = [], gpm = null, camoufox = null, orca = null, policy = WORKLOAD_TRANSPORT_POLICY } = {}) {
    const candidates = [...transports];
    if (gpm) candidates.push(gpm);
    if (camoufox) candidates.push(camoufox);
    if (orca) candidates.push(...(Array.isArray(orca) ? orca : [orca]));
    this.transports = candidates.filter(Boolean);
    this.policy = policy && typeof policy === "object" ? policy : WORKLOAD_TRANSPORT_POLICY;
  }

  candidatesFor(key) {
    const exact = this.transports.filter((transport) => String(identity(transport).transport || "").toLowerCase() === String(key).toLowerCase());
    return exact.length ? exact : this.transports.filter((transport) => routeKey(transport) === key);
  }

  select({ workload, intentPersisted = false, selectedTransport = null } = {}) {
    const name = String(workload || "").trim().toUpperCase();
    if (!name) throw routeError("ROUTE_WORKLOAD_REQUIRED", "Browser workload is required");
    const configured = this.policy[name];
    if (!configured || typeof configured !== "string") throw routeError("ROUTE_WORKLOAD_UNSUPPORTED", `No transport policy for workload ${name}`, { workload: name });
    const key = configured.toLowerCase();
    const candidates = this.candidatesFor(key);
    if (candidates.length === 0) throw routeError("ROUTE_TRANSPORT_UNAVAILABLE", `No transport is registered for workload ${name}`, { workload: name, route: key });
    if (candidates.length > 1) throw routeError("ROUTE_POLICY_AMBIGUOUS", `Multiple transports are registered for workload ${name}`, { workload: name, route: key, transports: candidates.map((item) => identity(item)) });
    const transport = candidates[0];
    if (intentPersisted && selectedTransport) assertTransportCannotChangeAfterIntent({ selectedTransport, requestedTransport: transport, intentPersisted: true });
    const runtime = identity(transport);
    return {
      workload: name,
      route: key,
      transport,
      transportId: runtime.transport || null,
      runtimeIdentity: runtime,
      reason: `${name} policy selects ${key} transport`,
      selectedBeforeIrreversibleIntent: intentPersisted !== true,
      intentPersisted: intentPersisted === true
    };
  }

  async selectWithHealth(options = {}) {
    const decision = this.select(options);
    const health = typeof decision.transport.health === "function" ? await decision.transport.health() : { state: "UNKNOWN" };
    return { ...decision, health };
  }
}

export function createDefaultBrowserRuntimeRouter({ gpm = {}, camoufox = {}, orcaBrowser = null, orca = null, policy = WORKLOAD_TRANSPORT_POLICY } = {}) {
  const transports = [new GpmChromeTransport(gpm), new CamoufoxTransport(camoufox)];
  const orcaTransports = orca ? (Array.isArray(orca) ? orca : [orca]) : (orcaBrowser ? [new OrcaAccessibilityTransport(orcaBrowser), new OrcaPointerTransport(orcaBrowser)] : []);
  return new BrowserRuntimeRouter({ transports: [...transports, ...orcaTransports], policy });
}


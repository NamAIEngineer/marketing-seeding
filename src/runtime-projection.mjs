const DEFAULT_WORKLOADS = Object.freeze([
  "AUTHENTICATED_SOCIAL_EXECUTION",
  "PUBLIC_DISCOVERY",
  "COMMUNITY_RESEARCH",
  "PRODUCT_WEB_DEMO",
  "SCREENSHOT_CAPTURE",
  "INDEPENDENT_PUBLICATION_VERIFY",
  "HOST_SESSION_SPECIAL_CASE"
]);

function bounded(value, limit = 240) {
  return value === undefined || value === null ? null : String(value).slice(0, limit);
}

function safeIdentity(value) {
  if (!value || typeof value !== "object") return null;
  return {
    transport: bounded(value.transport, 80),
    provider: bounded(value.provider, 80),
    providerVersion: bounded(value.providerVersion, 80),
    endpoint: value.endpoint ? bounded(value.endpoint, 240) : null,
    executable: value.executable ? bounded(value.executable, 240) : null,
    profileReference: value.profileReference ? bounded(value.profileReference, 160) : null,
    sessionReference: value.sessionReference ? bounded(value.sessionReference, 160) : null
  };
}

function safeHealth(value) {
  if (!value || typeof value !== "object") return { state: "UNKNOWN", reason: "HEALTH_NOT_OBSERVED" };
  const state = ["READY", "UNKNOWN", "UNAVAILABLE"].includes(String(value.state || "").toUpperCase()) ? String(value.state).toUpperCase() : "UNKNOWN";
  return { state, reason: bounded(value.code || value.reason || value.error?.code || null, 120) };
}

/** Read-only route/health projection for Mission Control. Never starts a runtime. */
export async function projectBrowserRuntime(router, { workloads = DEFAULT_WORKLOADS } = {}) {
  const rows = [];
  for (const workload of [...new Set((Array.isArray(workloads) ? workloads : DEFAULT_WORKLOADS).map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))].sort()) {
    if (!router || typeof router.selectWithHealth !== "function") {
      rows.push({ workload, status: "UNAVAILABLE", route: null, runtimeIdentity: null, health: { state: "UNAVAILABLE", reason: "ROUTER_NOT_CONFIGURED" } });
      continue;
    }
    try {
      const decision = await router.selectWithHealth({ workload });
      rows.push({ workload, status: "ROUTED", route: bounded(decision.route, 80), transportId: bounded(decision.transportId, 120), runtimeIdentity: safeIdentity(decision.runtimeIdentity), health: safeHealth(decision.health), reason: bounded(decision.reason, 200) });
    } catch (error) {
      rows.push({ workload, status: "UNAVAILABLE", route: null, transportId: null, runtimeIdentity: null, health: { state: "UNAVAILABLE", reason: bounded(error?.code || "ROUTE_UNAVAILABLE", 120) }, reason: bounded(error?.message || "No route available", 200) });
    }
  }
  return { readOnly: true, observedAt: new Date().toISOString(), routes: rows };
}

export { DEFAULT_WORKLOADS };

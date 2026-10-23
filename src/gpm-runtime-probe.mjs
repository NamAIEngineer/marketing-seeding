/**
 * Read-only GPM Local API capability probe.
 *
 * This module deliberately does not know a fixed port, create/start/stop a
 * profile, or return credential material. Callers provide endpoint candidates
 * discovered from their local GPM installation/configuration.
 */

const STATES = new Set(["READY", "UNKNOWN", "UNAVAILABLE"]);
const SECRET_KEY = /(cookie|token|secret|password|authorization|credential|session|proxy|socks|access[_-]?key)/i;

function text(value, limit = 240) {
  return value === undefined || value === null ? null : String(value).trim().slice(0, limit) || null;
}

function safeEndpoint(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return text(String(value).replace(/(token|secret|password|cookie|auth)=([^&\s]+)/ig, "$1=[REDACTED]"));
  }
}

function endpointList({ endpoint, endpointCandidates } = {}) {
  const values = [endpoint, ...(Array.isArray(endpointCandidates) ? endpointCandidates : [])]
    .map(safeEndpoint)
    .filter(Boolean);
  return [...new Set(values)];
}

function boundedStatus(value) {
  const state = String(value || "").toUpperCase();
  return STATES.has(state) ? state : "UNKNOWN";
}

function sanitizeRecord(value, depth = 0) {
  if (depth > 2 || value === null || value === undefined) return undefined;
  if (typeof value !== "object") return typeof value === "string" ? text(value, 160) : value;
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => sanitizeRecord(item, depth + 1)).filter((item) => item !== undefined);
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, 64)) {
    if (SECRET_KEY.test(key)) continue;
    if (!/(id|name|version|status|state|platform|profile|browser|debug|port|healthy|ready|message|code|url)/i.test(key)) continue;
    const normalized = /url/i.test(key) ? safeEndpoint(child) : sanitizeRecord(child, depth + 1);
    if (normalized !== undefined) result[text(key, 80)] = normalized;
  }
  return result;
}

function responsePayload(response) {
  if (!response) return null;
  if (typeof response.json === "function") return response.json();
  if (typeof response === "object") return response.body ?? response.data ?? response;
  return null;
}

function identity(endpoint, profileReference, sessionReference = null) {
  return {
    transport: "gpm-chrome",
    provider: "gpm-chrome",
    providerVersion: null,
    endpoint: safeEndpoint(endpoint),
    profileReference: text(profileReference),
    sessionReference: text(sessionReference)
  };
}

/** Return dynamic endpoint candidates without inventing a default port. */
export function discoverGpmEndpoints({ endpoint, endpointCandidates } = {}) {
  return endpointList({ endpoint, endpointCandidates });
}

/** Probe one or more caller-supplied GPM endpoints without profile mutation. */
export async function probeGpmRuntime({ endpoint, endpointCandidates, profileReference = null, sessionReference = null, fetchImpl = globalThis.fetch, timeoutMs = 2_000, now = new Date().toISOString() } = {}) {
  const endpoints = discoverGpmEndpoints({ endpoint, endpointCandidates });
  const base = { observedAt: text(now, 64), profileReference: text(profileReference), sessionReference: text(sessionReference), endpoints: endpoints.map(safeEndpoint) };
  if (!endpoints.length) return { state: "UNAVAILABLE", code: "GPM_ENDPOINT_NOT_CONFIGURED", ...base, runtimeIdentity: identity(null, profileReference, sessionReference) };
  if (typeof fetchImpl !== "function") return { state: "UNKNOWN", code: "GPM_FETCH_NOT_CONFIGURED", ...base, runtimeIdentity: identity(endpoints[0], profileReference, sessionReference) };

  const failures = [];
  for (const candidate of endpoints) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), Math.max(100, Math.min(10_000, Number(timeoutMs) || 2_000))) : null;
    try {
      const response = await fetchImpl(candidate, { method: "GET", headers: { accept: "application/json" }, signal: controller?.signal });
      const payload = await responsePayload(response);
      const record = sanitizeRecord(payload) || {};
      const statusCode = Number(response?.status);
      const ok = response?.ok === true || (Number.isFinite(statusCode) && statusCode >= 200 && statusCode < 300);
      if (!ok) {
        failures.push({ endpoint: safeEndpoint(candidate), code: `HTTP_${Number.isFinite(statusCode) ? statusCode : "UNKNOWN"}` });
        continue;
      }
      const providerVersion = text(record.version || record.browserVersion || record.apiVersion);
      const observedState = boundedStatus(record.state || record.status || (record.ready === true ? "READY" : "UNKNOWN"));
      return {
        state: observedState,
        code: observedState === "READY" ? "GPM_ENDPOINT_READY" : "GPM_ENDPOINT_STATE_UNKNOWN",
        ...base,
        runtimeIdentity: { ...identity(candidate, profileReference, sessionReference), providerVersion },
        api: record,
        profile: profileReference ? { profileReference: text(profileReference), state: text(record.profileState || record.profileStatus || observedState) } : null
      };
    } catch (error) {
      failures.push({ endpoint: safeEndpoint(candidate), code: text(error?.code || error?.name || "GPM_ENDPOINT_UNREACHABLE", 80) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    state: "UNKNOWN",
    code: "GPM_ENDPOINT_UNREACHABLE",
    ...base,
    runtimeIdentity: identity(endpoints[0], profileReference, sessionReference),
    failures
  };
}

export { safeEndpoint as redactGpmEndpoint, sanitizeRecord as sanitizeGpmRecord };

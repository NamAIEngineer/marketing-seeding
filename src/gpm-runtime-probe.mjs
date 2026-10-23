/**
 * Read-only GPM Local API capability probe.
 *
 * This module deliberately does not know a fixed port, create/start/stop a
 * profile, or return credential material. Callers provide endpoint candidates
 * discovered from their local GPM installation/configuration.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_PROCESS_NAMES = Object.freeze(["GPMLoginGlobal", "GPMLoginG"]);
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

/** Parse listener ports from lsof output; no default port is invented. */
export function parseGpmListenerEndpoints(output = "") {
  const endpoints = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/\bTCP\s+(?:[^\s:]+|\*):(\d+)\s+\(LISTEN\)/i);
    if (!match) continue;
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    endpoints.push(`http://127.0.0.1:${port}`);
  }
  return [...new Set(endpoints)].sort((left, right) => Number(new URL(left).port) - Number(new URL(right).port));
}

/**
 * Discover listeners owned by an already-running GPM process. This helper is
 * metadata-only: it never starts/stops a profile or sends a WebSocket frame.
 */
export async function discoverGpmProcessEndpoints({ processNames = DEFAULT_PROCESS_NAMES, execFileImpl = execFileAsync } = {}) {
  if (typeof execFileImpl !== "function") return { state: "UNKNOWN", code: "GPM_PROCESS_DISCOVERY_NOT_CONFIGURED", endpoints: [] };
  const names = [...new Set((Array.isArray(processNames) ? processNames : DEFAULT_PROCESS_NAMES).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!names.length) return { state: "UNAVAILABLE", code: "GPM_PROCESS_NAME_NOT_CONFIGURED", endpoints: [] };
  const endpoints = [];
  const observedProcessNames = [];
  const failures = [];
  for (const processName of names) {
    try {
      const result = await execFileImpl("lsof", ["-nP", "-a", "-c", processName, "-iTCP", "-sTCP:LISTEN"], { timeout: 2_000, maxBuffer: 64_000 });
      const found = parseGpmListenerEndpoints(result?.stdout || result || "");
      if (found.length) observedProcessNames.push(processName);
      endpoints.push(...found);
    } catch (error) {
      failures.push({ processName: text(processName, 80), code: text(error?.code || "GPM_PROCESS_DISCOVERY_FAILED", 80) });
    }
  }
  const unique = [...new Set(endpoints)];
  if (unique.length) return { state: "DISCOVERED", code: "GPM_PROCESS_ENDPOINTS_DISCOVERED", endpoints: unique, processNames: observedProcessNames };
  return { state: failures.length ? "UNKNOWN" : "UNAVAILABLE", code: failures.length ? "GPM_PROCESS_ENDPOINTS_UNKNOWN" : "GPM_PROCESS_ENDPOINTS_NOT_FOUND", endpoints: [], failures };
}

function boundedStatus(value) {
  const state = String(value || "").toUpperCase();
  return STATES.has(state) ? state : "UNKNOWN";
}

function providerVersionFromRecord(record = {}) {
  const candidate = record.version || record.browserVersion || record.apiVersion || record.sender;
  const match = String(candidate || "").match(/(?:^|[^0-9])(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return text(match?.[1] || candidate || null, 80);
}

function sanitizeRecord(value, depth = 0) {
  if (depth > 2 || value === null || value === undefined) return undefined;
  if (typeof value !== "object") return typeof value === "string" ? text(value, 160) : value;
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => sanitizeRecord(item, depth + 1)).filter((item) => item !== undefined);
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, 64)) {
    if (SECRET_KEY.test(key)) continue;
    if (!/(id|name|version|status|state|platform|profile|browser|debug|port|healthy|ready|message|code|url|sender|data|success)/i.test(key)) continue;
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
      const providerVersion = providerVersionFromRecord(record);
      const observedState = boundedStatus(record.state || record.status || (record.ready === true ? "READY" : "UNKNOWN"));
      return {
        state: observedState,
        code: observedState === "READY" ? "GPM_ENDPOINT_READY" : (record.sender ? "GPM_ENDPOINT_IDENTITY_ONLY" : "GPM_ENDPOINT_STATE_UNKNOWN"),
        ...base,
        providerVersion,
        observedProviderVersion: providerVersion,
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

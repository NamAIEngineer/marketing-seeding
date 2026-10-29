/**
 * Explicit, provider-neutral GPM profile lifecycle adapter.
 * This module performs no I/O during construction and never selects a profile.
 * Callers must invoke start(profileId) or stop(profileId) explicitly.
 */

const SECRET_KEY = /(cookie|token|secret|password|authorization|credential|session|proxy|storage|header|access[_-]?key)/i;
const ENDPOINT_KEYS = new Set(["remote_debugging_address", "remote_debugging_port", "websocket_debugging_url"]);

export class GpmProfileLifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GpmProfileLifecycleError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new GpmProfileLifecycleError(code, message, details);
}

function boundedText(value, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizeBase(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => SECRET_KEY.test(key))) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function endpointFromData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("SCHEMA_INVALID", "start response data must be an object");
  const websocket = data.websocket_debugging_url;
  const address = data.remote_debugging_address;
  const port = data.remote_debugging_port;
  let raw;
  if (typeof websocket === "string" && websocket.trim()) {
    raw = websocket.trim();
  } else if (address !== undefined || port !== undefined) {
    // GPMLogin's Local API returns only the loopback port on current builds.
    // Keep the endpoint local when the optional address is omitted.
    const host = address === undefined ? "127.0.0.1" : address;
    if (typeof host !== "string" || !host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) fail("ENDPOINT_INVALID", "remote debugging address or port is invalid");
    raw = `${host.trim().includes("://") ? host.trim() : `http://${host.trim()}`}:${port}`;
  } else fail("SCHEMA_INVALID", "start response has no debugging endpoint");

  let url;
  try { url = new URL(raw); } catch { fail("ENDPOINT_INVALID", "debugging endpoint is not a URL"); }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some((key) => SECRET_KEY.test(key))) {
    fail("ENDPOINT_INVALID", "debugging endpoint contains invalid or secret material");
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function containsSecretKey(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return false;
  if (Array.isArray(value)) return value.some((item) => containsSecretKey(item, depth + 1));
  return Object.entries(value).some(([key, child]) => SECRET_KEY.test(key) || containsSecretKey(child, depth + 1));
}

async function readPayload(response) {
  try {
    if (!response || typeof response.json !== "function") fail("MALFORMED_JSON", "response has no JSON body");
    return await response.json();
  } catch (error) {
    if (error instanceof GpmProfileLifecycleError) throw error;
    fail("MALFORMED_JSON", "response JSON is malformed");
  }
}

export class GpmProfileLifecycle {
  constructor({ endpoint, endpointCandidates, apiPrefix = "/v1", fetchImpl = globalThis.fetch, profileIdentity = null } = {}) {
    this.fetchImpl = fetchImpl;
    this.profileIdentity = boundedText(profileIdentity, 120);
    if (typeof apiPrefix !== "string" || !/^\/(?:api\/)?[A-Za-z0-9._~-]+$/.test(apiPrefix)) fail("CONFIG_INVALID", "apiPrefix must be /v1 or /api/v1");
    this.apiPrefix = apiPrefix.startsWith("/api/") ? apiPrefix : `/api${apiPrefix}`;
    const values = [endpoint, ...(Array.isArray(endpointCandidates) ? endpointCandidates : [])].map(normalizeBase).filter(Boolean);
    this.endpoints = [...new Set(values)];
    if (!this.endpoints.length) fail("CONFIG_INVALID", "at least one valid endpoint is required");
    if (typeof fetchImpl !== "function") fail("CONFIG_INVALID", "fetchImpl must be a function");
  }

  #url(action, profileId) {
    const encoded = encodeURIComponent(profileId);
    return `${this.endpoints[0]}${this.apiPrefix}/profiles/${action}/${encoded}`;
  }

  async #request(action, profileId) {
    if (typeof profileId !== "string" || !profileId.trim()) fail("PROFILE_ID_REQUIRED", "profileId is required");
    const url = this.#url(action, profileId.trim());
    let response;
    try { response = await this.fetchImpl(url, { method: "GET", headers: { accept: "application/json" } }); }
    catch (error) { fail("HTTP_FAILURE", "GPM request failed", { cause: error }); }
    const status = Number(response?.status);
    if (!(response?.ok === true || (Number.isInteger(status) && status >= 200 && status < 300))) fail("HTTP_FAILURE", `GPM request returned HTTP ${Number.isFinite(status) ? status : "unknown"}`, { status });
    const payload = await readPayload(response);
    if (containsSecretKey(payload)) fail("SECRET_RESPONSE_FIELD", "response contains secret-like fields");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("SCHEMA_INVALID", "response must be an object");
    return payload;
  }

  async start(profileId) {
    const payload = await this.#request("start", profileId);
    const data = payload.data;
    return { profileId: profileId.trim(), endpoint: endpointFromData(data) };
  }

  async stop(profileId) {
    const payload = await this.#request("stop", profileId);
    if (payload.success === false || (payload.data !== undefined && payload.data !== null && typeof payload.data !== "object" && payload.data !== true)) fail("SCHEMA_INVALID", "stop response acknowledgement is invalid");
    return { profileId: profileId.trim(), acknowledged: true };
  }
}

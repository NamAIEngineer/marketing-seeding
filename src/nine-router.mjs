import { execFile } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dataDir } from "./paths.mjs";

const execFileAsync = promisify(execFile);
export const NINE_ROUTER_VERSION = "0.5.109";
export const NINE_ROUTER_DEFAULT_ENDPOINT = "http://127.0.0.1:20128/v1";
const keyFile = path.join(dataDir, "9router-api-key");
const state = { catalog: null, checkedAt: null, failures: new Map(), selection: null };
let statusCache = null;
let statusCacheAt = 0;

const CAPABILITY_ALIASES = new Map([
  ["vision", "vision"], ["visual", "vision"], ["multimodal", "vision"], ["image", "vision"], ["video", "vision"],
  ["code", "code"], ["coding", "code"], ["program", "code"], ["programming", "code"],
  ["reason", "reasoning"], ["reasoning", "reasoning"], ["research", "reasoning"], ["strategy", "reasoning"], ["analysis", "reasoning"],
]);

function capabilityToken(value) {
  const token = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return CAPABILITY_ALIASES.get(token) || (token ? token : null);
}

/** Normalize only explicit model capability evidence; absence stays unknown. */
export function normalizeNineRouterCapabilities(value) {
  if (value === undefined || value === null) return { capabilities: null, evidence: "absent" };
  if (Array.isArray(value)) {
    const capabilities = [...new Set(value.flatMap((item) => String(item || "").split(/[\s,]+/)).map(capabilityToken).filter(Boolean))];
    return { capabilities, evidence: capabilities.length ? "observed" : "empty" };
  }
  if (typeof value === "string") {
    const capabilities = [...new Set(value.split(/[\s,]+/).map(capabilityToken).filter(Boolean))];
    return { capabilities, evidence: capabilities.length ? "observed" : "empty" };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return { capabilities: [], evidence: "empty" };
    const booleanEntries = entries.filter(([, enabled]) => typeof enabled === "boolean");
    if (!booleanEntries.length || booleanEntries.length !== entries.length) return { capabilities: null, evidence: "unknown" };
    const capabilities = [...new Set(booleanEntries.filter(([, enabled]) => enabled).map(([name]) => capabilityToken(name)).filter(Boolean))];
    return { capabilities, evidence: "observed" };
  }
  return { capabilities: null, evidence: "unknown" };
}

export function requiredNineRouterCapability(task) {
  const value = String(task || "").trim().toLowerCase();
  if (/(^|[^a-z])(media|vision|image|video)([^a-z]|$)/.test(value)) return "vision";
  if (/(^|[^a-z])(code|coding|program|programming)([^a-z]|$)/.test(value)) return "code";
  if (/(^|[^a-z])(reason|reasoning|research|strategy|analysis)([^a-z]|$)/.test(value)) return "reasoning";
  return null;
}

function endpoint(value) {
  const raw = String(value || NINE_ROUTER_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  const parsed = new URL(raw);
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) throw new Error("9router endpoint must be an HTTP(S) URL without credentials");
  return raw;
}

function classifyFailure(status, body = "") {
  if (status === 401 || status === 403) return { kind: "AUTH_OR_ENTITLEMENT", retryable: false, reason: "9Router authentication or provider entitlement required" };
  if (status === 429) return { kind: "RATE_LIMIT", retryable: true, reason: "9Router rate limit; model is cooling down" };
  if (status >= 500) return { kind: "UPSTREAM_ERROR", retryable: true, reason: "9Router upstream error" };
  return { kind: "UNAVAILABLE", retryable: true, reason: String(body || `9Router HTTP ${status}`).slice(0, 180) };
}

async function readApiKey() {
  if (String(process.env.SEEDING_9ROUTER_API_KEY || "").trim()) return String(process.env.SEEDING_9ROUTER_API_KEY).trim();
  try { return (await readFile(keyFile, "utf8")).trim(); } catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function writeApiKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 512 || /[\r\n]/.test(key)) throw new Error("9Router API key is invalid");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(keyFile, `${key}\n`, { mode: 0o600 });
  await chmod(keyFile, 0o600);
}

async function discoverBinary() {
  const candidates = [process.env.SEEDING_9ROUTER_COMMAND, "/usr/local/bin/9router", "/opt/homebrew/bin/9router", "9router"].filter(Boolean);
  for (const command of candidates) {
    try {
      await access(command);
      let version = null;
      const packageCandidates = [path.join(path.dirname(command), "..", "lib", "node_modules", "9router", "package.json"), "/usr/local/lib/node_modules/9router/package.json", "/opt/homebrew/lib/node_modules/9router/package.json"];
      for (const packagePath of packageCandidates) {
        try { version = JSON.parse(await readFile(packagePath, "utf8")).version; break; } catch {}
      }
      if (!version) {
        const result = await execFileAsync(command, ["--version"], { timeout: 1_500, windowsHide: true });
        version = String(result.stdout || "").trim().split(/\s+/).pop() || null;
      }
      return { command, version, verified: version === NINE_ROUTER_VERSION };
    } catch {}
  }
  return { command: null, version: null, verified: false };
}

async function requestModels(base, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${base}/models`, { signal: controller.signal, headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
    const body = await response.text();
    if (!response.ok) return { ok: false, failure: classifyFailure(response.status, body), status: response.status };
    let parsed;
    try { parsed = JSON.parse(body); } catch { return { ok: false, failure: { kind: "INVALID_RESPONSE", retryable: false, reason: "9Router /v1/models returned invalid JSON" } }; }
    const models = Array.isArray(parsed?.data) ? parsed.data.map((item) => {
      const capabilityInfo = normalizeNineRouterCapabilities(item?.capabilities ?? item?.metadata?.capabilities);
      return {
        id: String(item?.id || "").trim(),
        ownedBy: String(item?.owned_by || item?.ownedBy || "").trim() || null,
        capabilities: capabilityInfo.capabilities,
        capabilityEvidence: capabilityInfo.evidence,
      };
    }).filter((item) => item.id).slice(0, 500) : [];
    return { ok: true, models };
  } catch (error) {
    return { ok: false, failure: { kind: error?.name === "AbortError" ? "TIMEOUT" : "UNAVAILABLE", retryable: true, reason: error?.name === "AbortError" ? "9Router model catalog timed out" : "9Router is not reachable" } };
  } finally { clearTimeout(timer); }
}

export async function nineRouterStatus({ refresh = true } = {}) {
  if (!refresh && statusCache && Date.now() - statusCacheAt < 15_000) return structuredClone(statusCache);
  const configuredEndpoint = endpoint(process.env.SEEDING_9ROUTER_ENDPOINT || NINE_ROUTER_DEFAULT_ENDPOINT);
  const binary = await discoverBinary();
  const apiKey = await readApiKey();
  let result = state.catalog;
  if (refresh || !result) result = await requestModels(configuredEndpoint, apiKey);
  state.catalog = result; state.checkedAt = new Date().toISOString();
  const models = result.ok && apiKey ? result.models : [];
  const cooldowns = [...state.failures.entries()].map(([model, failure]) => ({ model, ...failure })).filter((item) => item.until > Date.now());
  const output = {
    provider: "9router", endpoint: configuredEndpoint, binary: { command: binary.command, version: binary.version, verified: binary.verified },
    expectedVersion: NINE_ROUTER_VERSION, installed: Boolean(binary.command), authenticated: Boolean(apiKey) && result.ok,
    connectRequired: !apiKey || result.failure?.kind === "AUTH_OR_ENTITLEMENT", catalogStatus: result.ok && apiKey ? "READY" : (!apiKey ? "CONNECT_REQUIRED" : (result.failure?.kind || "UNKNOWN")),
    quotaStatus: "UNVERIFIED",
    catalogCheckedAt: state.checkedAt, models, cooldowns, selection: state.selection,
    failure: result.failure || null,
    security: { keyStored: Boolean(apiKey), keyPath: "local protected runtime storage", providerCredentialsImported: false, accountCredentialsStoredInKeychain: true }
  };
  statusCache = output; statusCacheAt = Date.now();
  return structuredClone(output);
}

export async function connectNineRouter({ endpoint: requestedEndpoint, apiKey }) {
  await writeApiKey(apiKey);
  process.env.SEEDING_9ROUTER_ENDPOINT = endpoint(requestedEndpoint || NINE_ROUTER_DEFAULT_ENDPOINT);
  state.catalog = null;
  statusCache = null;
  return nineRouterStatus({ refresh: true });
}

export async function selectNineRouterModel({ task = "default", preferredModel = null } = {}) {
  const status = await nineRouterStatus({ refresh: true });
  const normalizedTask = String(task).slice(0, 120);
  const requiredCapability = requiredNineRouterCapability(normalizedTask);
  if (!status.authenticated) {
    state.selection = { task: normalizedTask, requiredCapability, model: null, reason: "9Router connection required; live model catalog is not authenticated", at: new Date().toISOString() };
    return { ...state.selection, status };
  }
  const compatibleModels = status.models.filter((model) => !requiredCapability || (model.capabilityEvidence === "observed" && Array.isArray(model.capabilities) && model.capabilities.includes(requiredCapability)));
  const available = new Set(compatibleModels.map((model) => model.id));
  const candidates = [preferredModel, process.env.SEEDING_9ROUTER_DEFAULT_MODEL, ...status.models.map((model) => model.id)].filter(Boolean);
  const selected = candidates.find((model) => available.has(model) && !(state.failures.get(model)?.until > Date.now()));
  const fallbackReason = selected === preferredModel ? "preferred model available in live catalog" : selected ? "preferred model unavailable; selected compatible live catalog fallback" : requiredCapability ? `no live model has verified ${requiredCapability} capability evidence` : "no model passed live catalog and quota/error checks";
  state.selection = { task: normalizedTask, requiredCapability, model: selected || null, reason: fallbackReason, at: new Date().toISOString() };
  return { ...state.selection, status };
}

export async function completeNineRouter({ task = "default", preferredModel = null, messages = [], temperature } = {}) {
  const selected = await selectNineRouterModel({ task, preferredModel });
  if (!selected.model) return { ok: false, error: "model_selection_unavailable", selection: selected };
  const apiKey = await readApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${selected.status.endpoint}/chat/completions`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: selected.model, messages, ...(Number.isFinite(temperature) ? { temperature } : {}) })
    });
    const body = await response.text();
    if (!response.ok) {
      recordNineRouterFailure({ model: selected.model, status: response.status, body });
      return { ok: false, error: "model_request_failed", failure: classifyFailure(response.status, body), selection: { ...selected, reason: `${selected.reason}; request failed` } };
    }
    let payload; try { payload = JSON.parse(body); } catch { return { ok: false, error: "invalid_model_response", selection: selected }; }
    return { ok: true, model: selected.model, selection: selected, usage: payload.usage || null, response: payload };
  } catch (error) {
    recordNineRouterFailure({ model: selected.model, status: 503, body: error?.message });
    return { ok: false, error: "model_request_unavailable", failure: { kind: "UNAVAILABLE", reason: "9Router model request unavailable", retryable: true }, selection: selected };
  } finally { clearTimeout(timer); }
}

export function recordNineRouterFailure({ model, status, body } = {}) {
  const id = String(model || "").trim(); if (!id) return;
  const failure = classifyFailure(Number(status), body);
  state.failures.set(id, { kind: failure.kind, reason: failure.reason, until: Date.now() + (failure.kind === "RATE_LIMIT" ? 60_000 : failure.retryable ? 15_000 : 300_000) });
}

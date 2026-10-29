import { execFile } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dataDir } from "./paths.mjs";

const execFileAsync = promisify(execFile);
export const NINE_ROUTER_VERSION = "0.5.109";
export const NINE_ROUTER_DEFAULT_ENDPOINT = "http://127.0.0.1:20128/v1";
export const NINE_ROUTER_KEYCHAIN_SERVICE = "ai.marketing-seeding.9router-api-key";
const keyFile = path.join(dataDir, "9router-api-key");
const state = { catalog: null, checkedAt: null, failures: new Map(), selection: null, usage: new Map(), lastRequest: null };
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
  const envKey = String(process.env.SEEDING_9ROUTER_API_KEY || "").trim();
  if (envKey) return { value: envKey, storage: "environment" };
  if (process.platform === "darwin") {
    try {
      const result = await execFileAsync("security", ["find-generic-password", "-w", "-a", String(process.env.USER || process.env.LOGNAME || "marketing-seeding"), "-s", NINE_ROUTER_KEYCHAIN_SERVICE], { timeout: 5_000, windowsHide: true });
      const keychain = String(result.stdout || "").trim();
      if (keychain) return { value: keychain, storage: "macOS Keychain" };
    } catch {}
  }
  try { return { value: (await readFile(keyFile, "utf8")).trim(), storage: "protected runtime storage" }; } catch (error) { if (error.code === "ENOENT") return { value: "", storage: null }; throw error; }
}

async function writeApiKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 512 || /[\r\n\u0000]/.test(key)) throw new Error("9Router API key is invalid");
  if (process.platform === "darwin") {
    try {
      await new Promise((resolve, reject) => {
        const child = execFile("security", ["add-generic-password", "-U", "-a", String(process.env.USER || process.env.LOGNAME || "marketing-seeding"), "-s", NINE_ROUTER_KEYCHAIN_SERVICE, "-w"], { windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim() || "Keychain write failed")) : resolve());
        child.stdin.end(`${key}\n${key}\n`);
      });
      return { storage: "macOS Keychain", keyStored: true };
    } catch {}
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(keyFile, `${key}\n`, { mode: 0o600 });
  await chmod(keyFile, 0o600);
  return { storage: "protected runtime storage", keyStored: true };
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
      const capabilityInfo = normalizeNineRouterCapabilities(item?.capabilities ?? item?.supported_capabilities ?? item?.capability ?? item?.metadata?.capabilities);
      return {
        id: String(item?.id || "").trim(),
        ownedBy: String(item?.owned_by || item?.ownedBy || "").trim() || null,
        capabilities: capabilityInfo.capabilities,
        capabilityEvidence: capabilityInfo.evidence,
        contextWindow: Number.isSafeInteger(item?.context_length) ? item.context_length : Number.isSafeInteger(item?.contextWindow) ? item.contextWindow : null,
        metadata: item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? Object.fromEntries(Object.entries(item.metadata).slice(0, 16)) : null
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
  if (refresh || !result) result = await requestModels(configuredEndpoint, apiKey.value);
  state.catalog = result; state.checkedAt = new Date().toISOString();
  const models = result.ok && apiKey.value ? result.models : [];
  const cooldowns = [...state.failures.entries()].map(([model, failure]) => ({ model, ...failure })).filter((item) => item.until > Date.now());
  const usage = [...state.usage.entries()].map(([model, value]) => ({ model, ...value })).slice(-100);
  const output = {
    provider: "9router", endpoint: configuredEndpoint, binary: { command: binary.command, version: binary.version, verified: binary.verified },
    expectedVersion: NINE_ROUTER_VERSION, installed: Boolean(binary.command), authenticated: Boolean(apiKey.value) && result.ok,
    connectRequired: !apiKey.value || result.failure?.kind === "AUTH_OR_ENTITLEMENT", catalogStatus: result.ok && apiKey.value ? "READY" : (!apiKey.value ? "CONNECT_REQUIRED" : (result.failure?.kind || "UNKNOWN")),
    quotaStatus: state.lastRequest?.quotaStatus || "UNVERIFIED",
    catalogCheckedAt: state.checkedAt, models, cooldowns, usage, lastRequest: state.lastRequest, selection: state.selection,
    failure: result.failure || null,
    security: { keyStored: Boolean(apiKey.value), keyStorage: apiKey.storage, keyPath: apiKey.storage === "macOS Keychain" ? "macOS Keychain" : "local protected runtime storage", providerCredentialsImported: false, accountCredentialsStoredInKeychain: true }
  };
  statusCache = output; statusCacheAt = Date.now();
  return structuredClone(output);
}

export async function connectNineRouter({ endpoint: requestedEndpoint, apiKey }) {
  const stored = await writeApiKey(apiKey);
  process.env.SEEDING_9ROUTER_ENDPOINT = endpoint(requestedEndpoint || NINE_ROUTER_DEFAULT_ENDPOINT);
  state.catalog = null;
  statusCache = null;
  const result = await nineRouterStatus({ refresh: true });
  return { ...result, security: { ...result.security, keyStorage: stored.storage, keyStored: stored.keyStored } };
}

function taskRequirements(task) {
  const value = String(task || "default").toLowerCase();
  return [
    /vision|image|media|video/.test(value) ? "vision" : null,
    /code|coding|program/.test(value) ? "code" : null,
    /reason|research|strategy|analysis/.test(value) ? "reasoning" : null
  ].filter(Boolean);
}

function modelSupportsTask(model, task) {
  const required = taskRequirements(task);
  // A specialized task requires explicit capability evidence from the live
  // authenticated catalog. Unknown/omitted capabilities are not proof of
  // compatibility and must stay out of automatic selection.
  if (!required.length) return true;
  if (!Array.isArray(model.capabilities) || !model.capabilities.length) return false;
  return required.every((item) => model.capabilities.includes(item) || model.capabilities.includes(`supports_${item}`));
}

export async function selectNineRouterModel({ task = "default", preferredModel = null, excludeModels = [] } = {}) {
  const status = await nineRouterStatus({ refresh: true });
  const normalizedTask = String(task).slice(0, 120);
  const requiredCapability = requiredNineRouterCapability(normalizedTask);
  if (!status.authenticated) {
    state.selection = { task: normalizedTask, requiredCapability, model: null, reason: "9Router connection required; live model catalog is not authenticated", at: new Date().toISOString() };
    return { ...state.selection, status };
  }
  const excluded = new Set([...excludeModels.map(String), ...[...state.failures.entries()].filter(([, failure]) => failure.until > Date.now()).map(([model]) => model)]);
  const models = status.models.filter((model) => {
    if (excluded.has(model.id)) return false;
    if (!requiredCapability) return true;
    return model.capabilityEvidence === "observed" && Array.isArray(model.capabilities) && model.capabilities.includes(requiredCapability);
  });
  const preferred = String(preferredModel || process.env.SEEDING_9ROUTER_DEFAULT_MODEL || "").trim();
  const selected = models.find((model) => model.id === preferred) || models[0] || null;
  const fallbackReason = selected
    ? (selected.id === preferred ? "preferred model available in authenticated live catalog" : preferred ? "preferred model unavailable or cooling down; selected compatible live catalog fallback" : "selected first compatible live catalog model")
    : (status.models.length ? (requiredCapability ? `no live model has verified ${requiredCapability} capability evidence; all candidates are incompatible or cooling down` : "all live catalog models are incompatible or cooling down") : "authenticated live model catalog is empty");
  state.selection = { task: normalizedTask, requiredCapability, model: selected?.id || null, modelCapabilities: selected?.capabilities || [], reason: fallbackReason, at: new Date().toISOString() };
  return { ...state.selection, status: await nineRouterStatus({ refresh: false }) };
}

export async function completeNineRouter({ task = "default", preferredModel = null, messages = [], temperature } = {}) {
  const attempted = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const selected = await selectNineRouterModel({ task, preferredModel, excludeModels: attempted });
    if (!selected.model) return { ok: false, error: "model_selection_unavailable", selection: selected, attempted };
    const apiKey = await readApiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${selected.status.endpoint}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey.value}` },
        body: JSON.stringify({ model: selected.model, messages, ...(Number.isFinite(temperature) ? { temperature } : {}) })
      });
      const body = await response.text();
      if (!response.ok) {
        const failure = recordNineRouterFailure({ model: selected.model, status: response.status, body });
        attempted.push(selected.model);
        state.lastRequest = { model: selected.model, status: "FAILED", failure, at: new Date().toISOString(), quotaStatus: failure.kind === "RATE_LIMIT" ? "RATE_LIMITED" : failure.kind === "AUTH_OR_ENTITLEMENT" ? "ENTITLEMENT_BLOCKED" : "UNVERIFIED" };
        statusCache = null;
        if (!failure.retryable || attempt >= 1) return { ok: false, error: "model_request_failed", failure, selection: { ...selected, reason: `${selected.reason}; request failed; model cooling down` }, attempted };
        preferredModel = null;
        continue;
      }
      let payload; try { payload = JSON.parse(body); } catch { return { ok: false, error: "invalid_model_response", selection: selected }; }
      const usage = payload.usage || null;
      const previous = state.usage.get(selected.model) || { requests: 0, failures: 0 };
      state.usage.set(selected.model, { ...previous, requests: previous.requests + 1, lastUsedAt: new Date().toISOString(), lastUsage: usage, quotaStatus: "OBSERVED_REQUEST_SUCCESS" });
      state.lastRequest = { model: selected.model, status: "SUCCEEDED", usage, at: new Date().toISOString(), quotaStatus: "OBSERVED_REQUEST_SUCCESS" };
      statusCache = null;
      return { ok: true, model: selected.model, selection: selected, usage, response: payload, attempted };
    } catch (error) {
      const failure = recordNineRouterFailure({ model: selected.model, status: 503, body: error?.message });
      attempted.push(selected.model);
      state.lastRequest = { model: selected.model, status: "FAILED", failure, at: new Date().toISOString(), quotaStatus: "UNVERIFIED" };
      if (attempt >= 1) return { ok: false, error: "model_request_unavailable", failure, selection: selected, attempted };
      preferredModel = null;
    } finally { clearTimeout(timer); }
  }
  return { ok: false, error: "model_selection_unavailable", attempted };
}

export function recordNineRouterFailure({ model, status, body } = {}) {
  const id = String(model || "").trim(); if (!id) return;
  const failure = classifyFailure(Number(status), body);
  state.failures.set(id, { kind: failure.kind, reason: failure.reason, until: Date.now() + (failure.kind === "RATE_LIMIT" ? 60_000 : failure.retryable ? 15_000 : 300_000) });
  const previous = state.usage.get(id) || { requests: 0, failures: 0 };
  state.usage.set(id, { ...previous, failures: previous.failures + 1, lastFailure: failure.kind, lastFailureAt: new Date().toISOString() });
  statusCache = null;
  return failure;
}

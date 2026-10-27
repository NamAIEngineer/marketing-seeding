const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const MAX_TEXT = 2_000;

function text(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
function safeUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { return null; }
  if (!/^https?:$/i.test(parsed.protocol) || parsed.username || parsed.password) return null;
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  parsed.hash = "";
  return parsed;
}

function endpoint(baseUrl, suffix) {
  const parsed = safeUrl(baseUrl);
  if (!parsed) return null;
  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = `${basePath}${suffix}`;
  parsed.search = "";
  return parsed;
}

function abortError(message = "provider timeout") {
  return Object.assign(new Error(message), { name: "AbortError" });
}

async function fetchWithDeadline(fetchImpl, url, init = {}, timeoutMs = 2_000) {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener?.("abort", onCallerAbort, { once: true });
  const timeout = Math.max(100, Math.min(120_000, Number(timeoutMs) || 2_000));
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw abortError();
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener?.("abort", onCallerAbort);
  }
}

function modelList(payload) {
  return Array.isArray(payload?.data)
    ? payload.data.map((item) => text(item?.id, 240)).filter(Boolean)
    : [];
}

function extractOutput(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content ?? choice?.text;
  return text(typeof content === "string" ? content : "", MAX_TEXT);
}

function providerTaskPrompt(task = {}) {
  // Provider routing receives task metadata only. Campaign content, memory,
  // credentials and browser evidence stay in the canonical local control plane.
  return `Capability: ${text(task.capability, 100)}; privacy: ${text(task.privacyClass, 40)}; tools: ${(Array.isArray(task.tools) ? task.tools : []).map((item) => text(item, 40)).filter(Boolean).join(",") || "none"}; reasoning: ${text(task.reasoningClass || "deterministic", 60)}`;
}

export function createOpenAiCompatibleProvider({
  id = "local-openai-compatible",
  baseUrl,
  model,
  privacyClasses = ["local"],
  capabilities = ["strategy-context"],
  tools = [],
  reasoningClasses = ["deterministic", "general"],
  contextSize = 0,
  costClass = "local",
  latencyMs = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2_000,
  health = null
} = {}) {
  const normalizedId = text(id, 80);
  const normalizedModel = text(model, 240);
  const modelsUrl = endpoint(baseUrl, "/models");
  const chatUrl = endpoint(baseUrl, "/chat/completions");
  if (!normalizedId || !normalizedModel || !modelsUrl || !chatUrl || typeof fetchImpl !== "function") return null;
  const healthState = health && typeof health === "object" ? health : { state: "UNKNOWN", reason: "HEALTH_PROBE_NOT_RUN" };
  return {
    id: normalizedId,
    capabilities: [...new Set(capabilities.map((item) => text(item, 80)).filter(Boolean))],
    tools: [...new Set(tools.map((item) => text(item, 80)).filter(Boolean))],
    reasoningClasses: [...new Set(reasoningClasses.map((item) => text(item, 80)).filter(Boolean))],
    installed: true,
    authReady: true,
    healthy: healthState.state === "READY",
    privacyClasses: [...new Set(privacyClasses.map((item) => text(item, 40)).filter(Boolean))],
    contextSize: Math.max(0, Number(contextSize) || 0),
    costClass: text(costClass, 40).toLowerCase() || "local",
    latencyMs: Number.isFinite(Number(latencyMs)) ? Math.max(0, Number(latencyMs)) : null,
    health: { state: healthState.state, reason: text(healthState.reason, 160) || null, model: normalizedModel },
    adapter: {
      async infer({ task, signal } = {}) {
        const body = JSON.stringify({
          model: normalizedModel,
          messages: [
            { role: "system", content: "Return one bounded routing hint. Do not request credentials or perform external actions." },
            { role: "user", content: providerTaskPrompt(task) }
          ],
          temperature: 0,
          max_tokens: 256
        });
        const response = await fetchWithDeadline(fetchImpl, chatUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          ...(signal ? { signal } : {})
        }, timeoutMs);
        if (!response?.ok) return { ok: false, exitCode: Number(response?.status) || 1 };
        let payload;
        try { payload = await response.json(); } catch { return { ok: false, exitCode: 1 }; }
        const output = extractOutput(payload);
        return output ? { ok: true, output } : { ok: false, exitCode: 1 };
      }
    }
  };
}

export async function probeOpenAiCompatibleProvider({ baseUrl, model, fetchImpl = globalThis.fetch, timeoutMs = 2_000 } = {}) {
  const modelsUrl = endpoint(baseUrl, "/models");
  const normalizedModel = text(model, 240);
  if (!modelsUrl || !normalizedModel || typeof fetchImpl !== "function") return { state: "UNAVAILABLE", reason: "CONFIG_INVALID" };
  try {
    const response = await fetchWithDeadline(fetchImpl, modelsUrl, {}, timeoutMs);
    if (!response?.ok) return { state: "UNAVAILABLE", reason: `HTTP_${Number(response.status) || "UNKNOWN"}` };
    let payload;
    try { payload = await response.json(); } catch { return { state: "UNKNOWN", reason: "MODEL_LIST_INVALID" }; }
    const models = modelList(payload);
    return models.includes(normalizedModel)
      ? { state: "READY", reason: "MODEL_LIST_OBSERVED", model: normalizedModel }
      : { state: "UNAVAILABLE", reason: "MODEL_NOT_LISTED", model: normalizedModel };
  } catch (error) {
    return { state: error?.name === "AbortError" ? "UNKNOWN" : "UNAVAILABLE", reason: text(error?.message || error?.name || "PROBE_FAILED", 160) };
  }
}

export async function loadConfiguredLocalProvider(env = process.env, options = {}) {
  const baseUrl = text(env.SEEDING_OI_PROVIDER_BASE_URL || env.SEEDING_LOCAL_INFERENCE_BASE_URL, 400);
  const model = text(env.SEEDING_OI_PROVIDER_MODEL || env.SEEDING_LOCAL_INFERENCE_MODEL, 240);
  if (!baseUrl && !model) return null;
  const health = await probeOpenAiCompatibleProvider({ baseUrl, model, fetchImpl: options.fetchImpl || globalThis.fetch, timeoutMs: options.timeoutMs || 2_000 });
  return createOpenAiCompatibleProvider({
    id: env.SEEDING_OI_PROVIDER_ID || "local-qwen",
    baseUrl,
    model,
    health,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    timeoutMs: options.inferTimeoutMs || 20_000,
    capabilities: ["strategy-context", "community-research", "content-context"]
  });
}

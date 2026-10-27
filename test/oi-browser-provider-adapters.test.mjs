import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleProvider, loadConfiguredLocalProvider, probeOpenAiCompatibleProvider } from "../src/oi-browser-provider-adapters.mjs";
import { routeAgentTask } from "../src/oi-browser-integration.mjs";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test("provider adapter accepts loopback only and separates model health from inference", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body || null });
    if (String(url).endsWith("/models")) return response(200, { data: [{ id: "qwen-local" }] });
    return response(200, { choices: [{ message: { content: "bounded result" } }] });
  };
  const health = await probeOpenAiCompatibleProvider({ baseUrl: "http://127.0.0.1:8767/v1", model: "qwen-local", fetchImpl });
  assert.deepEqual(health, { state: "READY", reason: "MODEL_LIST_OBSERVED", model: "qwen-local" });
  const provider = createOpenAiCompatibleProvider({ baseUrl: "http://127.0.0.1:8767/v1", model: "qwen-local", health, fetchImpl });
  const routed = await routeAgentTask({ capability: "strategy-context", privacyClass: "local" }, { providers: [provider] });
  assert.equal(routed.status, "SUCCEEDED");
  assert.equal(routed.providerId, provider.id);
  assert.equal(routed.availability[0].health.state, "READY");
  assert.equal(routed.availability[0].health.model, "qwen-local");
  assert.equal(calls.length, 2);
  const request = JSON.parse(calls[1].body);
  assert.equal(request.model, "qwen-local");
  assert.match(request.messages[1].content, /strategy-context/);
  assert.equal(Object.hasOwn(request.messages[1], "memory"), false);
});

test("provider adapter rejects remote, credentialed, missing, and unlisted configuration", async () => {
  assert.equal(createOpenAiCompatibleProvider({ baseUrl: "https://example.test/v1", model: "qwen" }), null);
  assert.equal(createOpenAiCompatibleProvider({ baseUrl: "http://user:pass@127.0.0.1:8767/v1", model: "qwen" }), null);
  assert.deepEqual(await probeOpenAiCompatibleProvider({ baseUrl: "http://127.0.0.1:8767/v1", model: "qwen", fetchImpl: async () => response(200, { data: [{ id: "other" }] }) }), { state: "UNAVAILABLE", reason: "MODEL_NOT_LISTED", model: "qwen" });
  assert.deepEqual(await probeOpenAiCompatibleProvider({ baseUrl: "http://127.0.0.1:8767/v1", model: "qwen", fetchImpl: async () => response(200, {}) }), { state: "UNAVAILABLE", reason: "MODEL_NOT_LISTED", model: "qwen" });
});

test("provider adapter classifies timeout, nonzero, and empty inference without success", async () => {
  const timeoutProvider = createOpenAiCompatibleProvider({
    baseUrl: "http://127.0.0.1:8767/v1", model: "qwen", health: { state: "READY" }, timeoutMs: 20,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })) ))
  });
  const timeout = await routeAgentTask({ capability: "strategy-context", privacyClass: "local" }, { providers: [timeoutProvider], timeoutMs: 30 });
  assert.equal(timeout.status, "FAILED");
  assert.equal(timeout.failure, "timeout");
  const emptyProvider = createOpenAiCompatibleProvider({ baseUrl: "http://127.0.0.1:8767/v1", model: "qwen", health: { state: "READY" }, fetchImpl: async () => response(200, { choices: [{ message: { content: "" } }] }) });
  const empty = await routeAgentTask({ capability: "strategy-context", privacyClass: "local" }, { providers: [emptyProvider] });
  assert.equal(empty.status, "FAILED");
  assert.equal(empty.failure, "nonzero");
});

test("configured provider remains unavailable when model-list health is not proven", async () => {
  const provider = await loadConfiguredLocalProvider({ SEEDING_OI_PROVIDER_ID: "qwen", SEEDING_OI_PROVIDER_BASE_URL: "http://127.0.0.1:8767/v1", SEEDING_OI_PROVIDER_MODEL: "missing" }, { fetchImpl: async () => response(200, { data: [{ id: "other" }] }) });
  assert.equal(provider.healthy, false);
  const routed = await routeAgentTask({ capability: "strategy-context", privacyClass: "local" }, { providers: [provider] });
  assert.equal(routed.status, "FAILED");
  assert.equal(routed.failure, "unavailable");
});

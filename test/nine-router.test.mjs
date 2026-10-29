import assert from "node:assert/strict";
import test from "node:test";
import { nineRouterStatus, selectNineRouterModel, recordNineRouterFailure } from "../src/nine-router.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = {
  key: process.env.SEEDING_9ROUTER_API_KEY,
  endpoint: process.env.SEEDING_9ROUTER_ENDPOINT,
  defaultModel: process.env.SEEDING_9ROUTER_DEFAULT_MODEL
};

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(payload); } };
}

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({ SEEDING_9ROUTER_API_KEY: originalEnv.key, SEEDING_9ROUTER_ENDPOINT: originalEnv.endpoint, SEEDING_9ROUTER_DEFAULT_MODEL: originalEnv.defaultModel })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("9Router projects authenticated capability objects and selects only compatible live models", async () => {
  process.env.SEEDING_9ROUTER_API_KEY = "fixture-key";
  process.env.SEEDING_9ROUTER_ENDPOINT = "http://fixture-9router.test/v1";
  globalThis.fetch = async (url) => {
    assert.equal(url, "http://fixture-9router.test/v1/models");
    return response({ object: "list", data: [
      { id: "fixture-basic", owned_by: "fixture", capabilities: { reasoning: true } },
      { id: "fixture-vision", owned_by: "fixture", capabilities: { vision: true }, context_length: 12345 }
    ] });
  };
  const status = await nineRouterStatus({ refresh: true });
  assert.equal(status.authenticated, true);
  assert.deepEqual(status.models.find((model) => model.id === "fixture-vision").capabilities, ["vision"]);
  assert.equal(status.models.find((model) => model.id === "fixture-vision").contextWindow, 12345);
  const selected = await selectNineRouterModel({ task: "media", preferredModel: "fixture-missing" });
  assert.equal(selected.model, "fixture-vision");
  assert.match(selected.reason, /fallback|compatible/i);
  assert.equal(JSON.stringify(status).includes("fixture-key"), false);
});

test("9Router cooldown removes a failing model from automatic selection", async () => {
  process.env.SEEDING_9ROUTER_API_KEY = "fixture-key";
  process.env.SEEDING_9ROUTER_ENDPOINT = "http://fixture-9router.test/v1";
  globalThis.fetch = async () => response({ data: [{ id: "fixture-vision", capabilities: { vision: true } }] });
  recordNineRouterFailure({ model: "fixture-vision", status: 429 });
  const selected = await selectNineRouterModel({ task: "media", preferredModel: "fixture-vision" });
  assert.equal(selected.model, null);
  assert.match(selected.reason, /cooling down|incompatible/i);
  assert.equal(selected.status.lastRequest, null);
});

test("9Router rejects unknown capabilities for specialized tasks", async () => {
  process.env.SEEDING_9ROUTER_API_KEY = "fixture-key";
  process.env.SEEDING_9ROUTER_ENDPOINT = "http://fixture-9router.test/v1";
  globalThis.fetch = async () => response({ data: [{ id: "fixture-unknown" }] });
  const selected = await selectNineRouterModel({ task: "media", preferredModel: "fixture-unknown" });
  assert.equal(selected.model, null);
  assert.match(selected.reason, /incompatible|empty/i);
});


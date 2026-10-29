import test from "node:test";
import assert from "node:assert/strict";

import { normalizeNineRouterCapabilities, requiredNineRouterCapability, selectNineRouterModel } from "../src/nine-router.mjs";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.SEEDING_9ROUTER_API_KEY;
const originalEndpoint = process.env.SEEDING_9ROUTER_ENDPOINT;

function mockModels(models) {
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/models$/);
    assert.equal(options.headers.authorization, "Bearer fixture-api-key");
    return new Response(JSON.stringify({ data: models }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.SEEDING_9ROUTER_API_KEY;
  else process.env.SEEDING_9ROUTER_API_KEY = originalApiKey;
  if (originalEndpoint === undefined) delete process.env.SEEDING_9ROUTER_ENDPOINT;
  else process.env.SEEDING_9ROUTER_ENDPOINT = originalEndpoint;
});

test("capability normalization preserves unknown or empty evidence", () => {
  assert.deepEqual(normalizeNineRouterCapabilities(undefined), { capabilities: null, evidence: "absent" });
  assert.deepEqual(normalizeNineRouterCapabilities([]), { capabilities: [], evidence: "empty" });
  assert.deepEqual(normalizeNineRouterCapabilities("vision, coding"), { capabilities: ["vision", "code"], evidence: "observed" });
  assert.deepEqual(normalizeNineRouterCapabilities({ vision: true, reasoning: false }), { capabilities: ["vision"], evidence: "observed" });
  assert.deepEqual(normalizeNineRouterCapabilities({ vision: "maybe" }), { capabilities: null, evidence: "unknown" });
});

test("specialized task names map to strict required capabilities", () => {
  assert.equal(requiredNineRouterCapability("media campaign"), "vision");
  assert.equal(requiredNineRouterCapability("code review"), "code");
  assert.equal(requiredNineRouterCapability("market research"), "reasoning");
  assert.equal(requiredNineRouterCapability("default copy"), null);
});

test("specialized routing fails closed when live catalog omits capability evidence", async () => {
  process.env.SEEDING_9ROUTER_API_KEY = "fixture-api-key";
  process.env.SEEDING_9ROUTER_ENDPOINT = "http://127.0.0.1:20128/v1";
  mockModels([{ id: "opaque-model" }, { id: "empty-model", capabilities: [] }, { id: "wrong-model", capabilities: ["code"] }]);
  const selection = await selectNineRouterModel({ task: "media generation", preferredModel: "opaque-model" });
  assert.equal(selection.requiredCapability, "vision");
  assert.equal(selection.model, null);
  assert.match(selection.reason, /verified vision capability evidence/);
  assert.equal(JSON.stringify(selection).includes("fixture-api-key"), false);
});

test("specialized routing selects only an explicitly compatible live model", async () => {
  process.env.SEEDING_9ROUTER_API_KEY = "fixture-api-key";
  process.env.SEEDING_9ROUTER_ENDPOINT = "http://127.0.0.1:20128/v1";
  mockModels([{ id: "text-model" }, { id: "vision-model", capabilities: { vision: true } }]);
  const selection = await selectNineRouterModel({ task: "video analysis", preferredModel: "text-model" });
  assert.equal(selection.requiredCapability, "vision");
  assert.equal(selection.model, "vision-model");
  assert.match(selection.reason, /compatible live catalog fallback/);
});

test("default routing retains compatibility for catalogs without specialized metadata", async () => {
  process.env.SEEDING_9ROUTER_API_KEY = "fixture-api-key";
  process.env.SEEDING_9ROUTER_ENDPOINT = "http://127.0.0.1:20128/v1";
  mockModels([{ id: "text-model" }]);
  const selection = await selectNineRouterModel({ task: "default", preferredModel: "text-model" });
  assert.equal(selection.requiredCapability, null);
  assert.equal(selection.model, "text-model");
});

import test from "node:test";
import assert from "node:assert/strict";
import { GpmProfileLifecycle, GpmProfileLifecycleError } from "../src/gpm-profile-lifecycle.mjs";

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { if (body instanceof Error) throw body; return body; } });
const errorCode = async (promise, code) => { await assert.rejects(promise, (error) => error instanceof GpmProfileLifecycleError && error.code === code); };

test("start uses exact encoded path and parses dynamic websocket endpoint", async () => {
  const calls = [];
  const lifecycle = new GpmProfileLifecycle({ endpoint: "http://127.0.0.1:18000/", fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ data: { websocket_debugging_url: "ws://127.0.0.1:9222/devtools/browser/abc" } }); } });
  assert.deepEqual(await lifecycle.start("a profile/✓"), { profileId: "a profile/✓", endpoint: "ws://127.0.0.1:9222/devtools/browser/abc" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:18000/api/v1/profiles/start/a%20profile%2F%E2%9C%93");
  assert.equal(calls[0].options.method, "GET");
});

test("start and stop use exact GET paths with configurable API prefixes", async () => {
  const calls = [];
  const lifecycle = new GpmProfileLifecycle({ endpointCandidates: ["http://localhost:1", "http://localhost:2"], apiPrefix: "/v2", fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ data: { remote_debugging_address: "127.0.0.1", remote_debugging_port: 9333 } }); } });
  assert.deepEqual(await lifecycle.start("p"), { profileId: "p", endpoint: "http://127.0.0.1:9333" });
  assert.equal(calls[0].url, "http://localhost:1/api/v2/profiles/start/p");
  assert.equal(calls[0].options.method, "GET");
  const apiLifecycle = new GpmProfileLifecycle({ endpoint: "http://localhost:1", apiPrefix: "/api/v1", fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ success: true, data: true }); } });
  await apiLifecycle.stop("p/q");
  assert.equal(calls[1].url, "http://localhost:1/api/v1/profiles/stop/p%2Fq");
  assert.equal(calls[1].options.method, "GET");
});

test("stop returns bounded acknowledgement", async () => {
  const lifecycle = new GpmProfileLifecycle({ endpoint: "http://localhost:1", fetchImpl: async () => response({ success: true, data: true }) });
  assert.deepEqual(await lifecycle.stop("p"), { profileId: "p", acknowledged: true });
});

test("rejects missing IDs, HTTP/schema/endpoint failures", async () => {
  const lifecycle = new GpmProfileLifecycle({ endpoint: "http://localhost:1", fetchImpl: async () => response({ data: {} }) });
  await errorCode(lifecycle.start(""), "PROFILE_ID_REQUIRED");
  await errorCode(lifecycle.start("p"), "SCHEMA_INVALID");
  const http = new GpmProfileLifecycle({ endpoint: "http://localhost:1", fetchImpl: async () => response({}, 500) });
  await errorCode(http.stop("p"), "HTTP_FAILURE");
  const bad = new GpmProfileLifecycle({ endpoint: "http://localhost:1", fetchImpl: async () => response({ data: { websocket_debugging_url: "http://user:pass@localhost:1" } }) });
  await errorCode(bad.start("p"), "ENDPOINT_INVALID");
});

test("one call only, malformed JSON and secret fields are rejected", async () => {
  let calls = 0;
  const lifecycle = new GpmProfileLifecycle({ endpoint: "http://localhost:1", endpointCandidates: ["http://localhost:2"], fetchImpl: async () => { calls++; return response(new SyntaxError("bad json")); } });
  await errorCode(lifecycle.start("p"), "MALFORMED_JSON");
  assert.equal(calls, 1);
  const secret = new GpmProfileLifecycle({ endpoint: "http://localhost:1", fetchImpl: async () => response({ data: { websocket_debugging_url: "ws://localhost:1", token: "secret" } }) });
  await errorCode(secret.start("p"), "SECRET_RESPONSE_FIELD");
});

test("constructor performs no I/O", () => { let calls = 0; new GpmProfileLifecycle({ endpoint: "http://localhost:1", fetchImpl: async () => { calls++; } }); assert.equal(calls, 0); });

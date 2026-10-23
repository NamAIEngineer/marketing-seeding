import test from "node:test";
import assert from "node:assert/strict";
import { discoverGpmEndpoints, probeGpmRuntime } from "../src/gpm-runtime-probe.mjs";

test("GPM endpoint discovery uses supplied candidates and never assumes port 9495", () => {
  assert.deepEqual(discoverGpmEndpoints({ endpointCandidates: ["http://127.0.0.1:17999", "http://127.0.0.1:17999"] }), ["http://127.0.0.1:17999"]);
  assert.deepEqual(discoverGpmEndpoints({}), []);
});

test("GPM probe is unavailable without a configured endpoint", async () => {
  const result = await probeGpmRuntime({});
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.code, "GPM_ENDPOINT_NOT_CONFIGURED");
});

test("GPM probe is read-only, redacts secrets and preserves bounded identity", async () => {
  const calls = [];
  const result = await probeGpmRuntime({
    endpoint: "http://user:password@127.0.0.1:18000/api?token=raw",
    profileReference: "profile-a",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { state: "READY", version: "5", cookie: "raw-cookie", profileId: "p" }; } };
    }
  });
  assert.equal(result.state, "READY");
  assert.equal(result.runtimeIdentity.endpoint, "http://127.0.0.1:18000/api?token=%5BREDACTED%5D");
  assert.equal(result.runtimeIdentity.profileReference, "profile-a");
  assert.equal(Object.hasOwn(result.api, "cookie"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
});

test("GPM probe reports unknown on endpoint failures and never mutates profiles", async () => {
  let calls = 0;
  const result = await probeGpmRuntime({ endpointCandidates: ["http://127.0.0.1:18001"], fetchImpl: async () => { calls += 1; throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); } });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.code, "GPM_ENDPOINT_UNREACHABLE");
  assert.equal(calls, 1);
  assert.equal(Object.hasOwn(result, "startedProfile"), false);
});

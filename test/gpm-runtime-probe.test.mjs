import test from "node:test";
import assert from "node:assert/strict";
import { discoverGpmEndpoints, discoverGpmProcessEndpoints, parseGpmListenerEndpoints, probeGpmRuntime } from "../src/gpm-runtime-probe.mjs";

test("GPM listener parser returns actual loopback candidates without a fixed port", () => {
  assert.deepEqual(parseGpmListenerEndpoints("GPM 1u TCP *:9495 (LISTEN)\nGPM 2u TCP 127.0.0.1:9496 (LISTEN)\nGPM 3u TCP *:0 (LISTEN)"), ["http://127.0.0.1:9495", "http://127.0.0.1:9496"]);
});

test("GPM process endpoint discovery is read-only and injectable", async () => {
  const calls = [];
  const result = await discoverGpmProcessEndpoints({ processNames: ["GPMLoginG"], execFileImpl: async (command, args) => {
    calls.push({ command, args });
    return { stdout: "GPMLoginG 1u TCP *:19495 (LISTEN)" };
  } });
  assert.deepEqual(result, { state: "DISCOVERED", code: "GPM_PROCESS_ENDPOINTS_DISCOVERED", endpoints: ["http://127.0.0.1:19495"], processNames: ["GPMLoginG"] });
  assert.deepEqual(calls, [{ command: "lsof", args: ["-nP", "-a", "-c", "GPMLoginG", "-iTCP", "-sTCP:LISTEN"] }]);
});

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

test("GPM identity-only root response exposes a bounded version without claiming readiness", async () => {
  const result = await probeGpmRuntime({
    endpoint: "http://127.0.0.1:18000",
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { success: true, data: "GPMLogin Global API", sender: "GPMLoginGlobal v5.1.2-stable" }; } })
  });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.code, "GPM_ENDPOINT_IDENTITY_ONLY");
  assert.equal(result.providerVersion, "5.1.2-stable");
  assert.equal(result.runtimeIdentity.providerVersion, "5.1.2-stable");
});

test("GPM probe reports unknown on endpoint failures and never mutates profiles", async () => {
  let calls = 0;
  const result = await probeGpmRuntime({ endpointCandidates: ["http://127.0.0.1:18001"], fetchImpl: async () => { calls += 1; throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); } });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.code, "GPM_ENDPOINT_UNREACHABLE");
  assert.equal(calls, 1);
  assert.equal(Object.hasOwn(result, "startedProfile"), false);
});

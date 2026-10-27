import test from "node:test";
import assert from "node:assert/strict";
import { BrowserRuntimeRouter, WORKLOAD_TRANSPORT_POLICY, createDefaultBrowserRuntimeRouter } from "../src/browser-runtime-router.mjs";
import { CamoufoxTransport, GpmChromeTransport } from "../src/browser-runtime-transports.mjs";

test("default policy routes authenticated and public workloads to Camoufox deterministically", () => {
  const gpm = new GpmChromeTransport({ endpoint: "http://127.0.0.1:1234", profileReference: "profile-a" });
  const camoufox = new CamoufoxTransport({ executable: "/usr/bin/camoufox", profileReference: "isolated-a" });
  const router = new BrowserRuntimeRouter({ transports: [gpm, camoufox] });
  assert.equal(router.select({ workload: "AUTHENTICATED_SOCIAL_EXECUTION" }).route, "camoufox");
  assert.equal(router.select({ workload: "PUBLIC_DISCOVERY" }).route, "camoufox");
  assert.equal(router.select({ workload: "SCREENSHOT_CAPTURE" }).transport, camoufox);
});

test("missing provider or ambiguous policy fails closed", () => {
  const router = new BrowserRuntimeRouter({ transports: [] });
  assert.throws(() => router.select({ workload: "PUBLIC_DISCOVERY" }), (error) => error.code === "ROUTE_TRANSPORT_UNAVAILABLE");
  assert.throws(() => router.select({ workload: "UNDECLARED" }), (error) => error.code === "ROUTE_WORKLOAD_UNSUPPORTED");
  const duplicate = new BrowserRuntimeRouter({ transports: [new CamoufoxTransport({ profileReference: "a" }), new CamoufoxTransport({ profileReference: "b" })] });
  assert.throws(() => duplicate.select({ workload: "AUTHENTICATED_SOCIAL_EXECUTION" }), (error) => error.code === "ROUTE_POLICY_AMBIGUOUS");
});

test("construction never claims readiness and preserves only bounded references", async () => {
  const transport = new GpmChromeTransport({ endpoint: "https://user:pass@example.test/api?token=secret", profileReference: "p" });
  assert.equal((await transport.health()).state, "UNKNOWN");
  const id = transport.runtimeIdentity();
  assert.equal(id.endpoint, "https://example.test/api?token=%5BREDACTED%5D");
  await assert.rejects(() => transport.snapshot("page"), (error) => error.code === "TRANSPORT_CAPABILITY_UNSUPPORTED");
  const unavailable = new CamoufoxTransport();
  assert.equal((await unavailable.health()).state, "UNAVAILABLE");
});

test("GPM endpoint candidates are projected from the discovered listener without profile readiness", async () => {
  const transport = new GpmChromeTransport({ endpointCandidates: ["http://127.0.0.1:19495"], profileReference: null, probe: async () => ({ state: "READY", providerVersion: "5.1.2-stable", observedProviderVersion: "5.1.2-stable", profileCatalog: { state: "OBSERVED", count: 1, profiles: [{ profileId: "p-1", name: "Demo", storage_path: "drop" }] } }) });
  assert.equal(transport.runtimeIdentity().endpoint, "http://127.0.0.1:19495/");
  assert.deepEqual(transport.runtimeIdentity().endpointCandidates, ["http://127.0.0.1:19495/"]);
  const health = await transport.health();
  assert.equal(health.state, "UNKNOWN");
  assert.equal(health.reason, "GPM_PROFILE_REFERENCE_NOT_BOUND");
  assert.equal(health.profileBindingRequired, true);
  assert.equal(health.observedProviderVersion, "5.1.2-stable");
});

test("generic runtime click requires validation before provider input", async () => {
  const calls = [];
  const transport = new GpmChromeTransport({
    endpoint: "http://127.0.0.1:1234",
    profileReference: "profile-a",
    client: {
      async click(target) { calls.push(target); return { status: "COMMAND_COMPLETED" }; }
    }
  });
  await assert.rejects(() => transport.click("post"), (error) => error.code === "TRANSPORT_VALIDATION_REQUIRED");
  const receipt = await transport.click("safe-toggle", { validate: async () => ({ checked: true }) });
  assert.deepEqual(calls, ["safe-toggle"]);
  assert.deepEqual(receipt.preflight, { checked: true });
});

test("route decision is bound before irreversible intent and cannot silently switch", () => {
  const router = createDefaultBrowserRuntimeRouter({ gpm: { endpoint: "http://localhost:1", profileReference: "p" }, camoufox: { executable: "/bin/camoufox", profileReference: "p2" }, policy: { ...WORKLOAD_TRANSPORT_POLICY, PUBLIC_DISCOVERY: "gpm" } });
  const first = router.select({ workload: "AUTHENTICATED_SOCIAL_EXECUTION" });
  assert.equal(first.selectedBeforeIrreversibleIntent, true);
  assert.throws(() => router.select({ workload: "PUBLIC_DISCOVERY", intentPersisted: true, selectedTransport: first.transport }), /cannot change/i);
});

test("default router does not register legacy GPM unless explicitly supplied", () => {
  const router = createDefaultBrowserRuntimeRouter({ camoufox: { executable: "/bin/camoufox", profileReference: "p" } });
  assert.equal(router.transports.some((transport) => transport.runtimeIdentity().provider === "gpm-chrome"), false);
  assert.equal(router.select({ workload: "PUBLIC_DISCOVERY" }).route, "camoufox");
});

test("policy remains explicit and provider-neutral", () => {
  assert.equal(WORKLOAD_TRANSPORT_POLICY.AUTHENTICATED_SOCIAL_EXECUTION, "camoufox");
  assert.equal(WORKLOAD_TRANSPORT_POLICY.INDEPENDENT_PUBLICATION_VERIFY, "camoufox");
  assert.equal(WORKLOAD_TRANSPORT_POLICY.HOST_SESSION_SPECIAL_CASE, "orca-accessibility");
});

test("host-session route chooses its explicit ORCA accessibility policy", () => {
  const accessibility = { runtimeIdentity: () => ({ transport: "orca-accessibility", provider: "orca", providerVersion: "1" }) };
  const pointer = { runtimeIdentity: () => ({ transport: "orca-pointer", provider: "orca", providerVersion: "1" }) };
  const selected = new BrowserRuntimeRouter({ transports: [pointer, accessibility] }).select({ workload: "HOST_SESSION_SPECIAL_CASE" });
  assert.equal(selected.transport, accessibility);
  assert.equal(selected.route, "orca-accessibility");
});


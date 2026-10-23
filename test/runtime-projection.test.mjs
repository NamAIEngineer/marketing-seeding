import test from "node:test";
import assert from "node:assert/strict";
import { projectBrowserRuntime } from "../src/runtime-projection.mjs";

test("runtime projection is deterministic, read-only and bounded", async () => {
  const router = { async selectWithHealth({ workload }) { return { route: "gpm", transportId: "gpm-chrome", runtimeIdentity: { transport: "gpm-chrome", provider: "gpm", providerVersion: "5", endpoint: "http://127.0.0.1:1", secret: "drop" }, health: { state: "UNKNOWN", reason: "PROBE_NOT_CONFIGURED" }, reason: `${workload} route` }; } };
  const projection = await projectBrowserRuntime(router, { workloads: ["PUBLIC_DISCOVERY", "AUTHENTICATED_SOCIAL_EXECUTION"] });
  assert.equal(projection.readOnly, true);
  assert.deepEqual(projection.routes.map((row) => row.workload), ["AUTHENTICATED_SOCIAL_EXECUTION", "PUBLIC_DISCOVERY"]);
  assert.equal(projection.routes[0].runtimeIdentity.secret, undefined);
  assert.equal(projection.routes[0].health.state, "UNKNOWN");
});

test("runtime projection reports missing or ambiguous routes without fallback", async () => {
  const projection = await projectBrowserRuntime(null, { workloads: ["PUBLIC_DISCOVERY"] });
  assert.equal(projection.routes[0].status, "UNAVAILABLE");
  assert.equal(projection.routes[0].health.reason, "ROUTER_NOT_CONFIGURED");
  const ambiguous = await projectBrowserRuntime({ async selectWithHealth() { throw Object.assign(new Error("ambiguous"), { code: "ROUTE_POLICY_AMBIGUOUS" }); } }, { workloads: ["HOST_SESSION_SPECIAL_CASE"] });
  assert.equal(ambiguous.routes[0].health.reason, "ROUTE_POLICY_AMBIGUOUS");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectBrowserRuntime } from "../src/runtime-projection.mjs";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";

test("runtime projection is deterministic, read-only and bounded", async () => {
  const router = { async selectWithHealth({ workload }) { return { route: "gpm", transportId: "gpm-chrome", runtimeIdentity: { transport: "gpm-chrome", provider: "gpm", providerVersion: "5", endpoint: "http://127.0.0.1:1/?token=raw", secret: "drop" }, health: { state: "UNKNOWN", reason: "PROBE_NOT_CONFIGURED", observedProviderVersion: "5.1.2" }, reason: `${workload} route` }; } };
  const projection = await projectBrowserRuntime(router, { workloads: ["PUBLIC_DISCOVERY", "AUTHENTICATED_SOCIAL_EXECUTION"] });
  assert.equal(projection.readOnly, true);
  assert.deepEqual(projection.routes.map((row) => row.workload), ["AUTHENTICATED_SOCIAL_EXECUTION", "PUBLIC_DISCOVERY"]);
  assert.equal(projection.routes[0].runtimeIdentity.secret, undefined);
  assert.equal(projection.routes[0].runtimeIdentity.endpoint, "http://127.0.0.1:1/?token=%5BREDACTED%5D");
  assert.equal(projection.routes[0].health.observedProviderVersion, "5.1.2");
  assert.equal(projection.routes[0].health.state, "UNKNOWN");
});

test("runtime projection reports missing or ambiguous routes without fallback", async () => {
  const projection = await projectBrowserRuntime(null, { workloads: ["PUBLIC_DISCOVERY"] });
  assert.equal(projection.routes[0].status, "UNAVAILABLE");
  assert.equal(projection.routes[0].health.reason, "ROUTER_NOT_CONFIGURED");
  const ambiguous = await projectBrowserRuntime({ async selectWithHealth() { throw Object.assign(new Error("ambiguous"), { code: "ROUTE_POLICY_AMBIGUOUS" }); } }, { workloads: ["HOST_SESSION_SPECIAL_CASE"] });
  assert.equal(ambiguous.routes[0].health.reason, "ROUTE_POLICY_AMBIGUOUS");
});

test("service dashboard exposes runtime projection without creating execution state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runtime-projection-dashboard-"));
  const service = new SeedingService(new JsonStore(path.join(directory, "state.json")), {
    browserRuntimeRouter: {
      async selectWithHealth({ workload }) {
        return {
          workload,
          route: "gpm",
          transportId: "gpm-chrome",
          runtimeIdentity: { transport: "gpm-chrome", provider: "gpm", providerVersion: "unknown" },
          health: { state: "UNAVAILABLE", code: "GPM_ENDPOINT_NOT_CONFIGURED", profileBindingRequired: false },
          reason: "probe unavailable"
        };
      }
    }
  });
  await service.init();
  const before = (await service.snapshot()).revision;
  const dashboard = await service.dashboard();
  assert.equal(dashboard.browserRuntime.readOnly, true);
  assert.equal(dashboard.browserRuntime.routes.length, 7);
  assert.equal(dashboard.browserRuntime.routes[0].health.state, "UNAVAILABLE");
  assert.equal(dashboard.browserRuntime.routes[0].health.profileBindingRequired, false);
  assert.equal((await service.snapshot()).revision, before);
});

test("service dashboard exposes injected GPM catalog as read-only projection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gpm-catalog-dashboard-"));
  const service = new SeedingService(new JsonStore(path.join(directory, "state.json")), {
    gpmAccountCatalogObservation: {
      state: "OBSERVED",
      code: "GPM_PROFILE_CATALOG_OBSERVED",
      profiles: [{ profileId: "profile-a", name: "Alpha", browser: { name: "Chrome", version: "1" }, secret: "drop" }]
    }
  });
  await service.init();
  const before = (await service.snapshot()).revision;
  const dashboard = await service.dashboard();
  assert.equal(dashboard.gpmAccountCatalog.readOnly, true);
  assert.equal(dashboard.gpmAccountCatalog.catalog.state, "OBSERVED");
  assert.equal(JSON.stringify(dashboard).includes("profile-a"), false);
  assert.equal(JSON.stringify(dashboard).includes("drop"), false);
  assert.equal((await service.snapshot()).revision, before);
  const restarted = new SeedingService(new JsonStore(path.join(directory, "state.json")));
  await restarted.init();
  const unknown = await restarted.dashboard();
  assert.equal(unknown.gpmAccountCatalog.catalog.state, "UNKNOWN");
  assert.equal(unknown.gpmAccountCatalog.accounts.length, 0);
  assert.equal((await restarted.snapshot()).revision, before);
});

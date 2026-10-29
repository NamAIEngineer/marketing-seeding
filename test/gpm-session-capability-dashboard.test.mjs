import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";

const available = {
  configured: true,
  provider: "gpm",
  runtimeIdentity: { provider: "gpm", transport: "gpm-chrome", providerVersion: "5.1" },
  health: { state: "READY" },
  sessions: [{ profileFingerprint: "fp-a", health: "READY", profileId: "raw-profile" }]
};

async function serviceWith(observation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gpm-capability-dashboard-"));
  const service = new SeedingService(new JsonStore(path.join(directory, "state.json")), { gpmSessionCapabilityObservation: observation });
  await service.init();
  return service;
}

test("dashboard exposes AVAILABLE capability without state mutation or raw profile material", async () => {
  const service = await serviceWith(async () => available);
  const before = (await service.snapshot()).revision;
  const dashboard = await service.dashboard();
  assert.equal(dashboard.gpmSessionCapability.status, "AVAILABLE");
  assert.equal(dashboard.gpmSessionCapability.executionEligible, true);
  assert.equal(dashboard.gpmSessionCapability.readOnly, true);
  assert.equal(JSON.stringify(dashboard).includes("raw-profile"), false);
  assert.equal((await service.snapshot()).revision, before);
});

test("dashboard resolves failed observation to UNKNOWN or unavailable without side effects", async () => {
  let calls = 0;
  const service = await serviceWith(async () => { calls += 1; throw Object.assign(new Error("offline"), { code: "OFFLINE" }); });
  const before = (await service.snapshot()).revision;
  const dashboard = await service.dashboard();
  assert.equal(calls, 1);
  assert.equal(dashboard.gpmSessionCapability.executionEligible, false);
  assert.notEqual(dashboard.gpmSessionCapability.status, "AVAILABLE");
  assert.equal((await service.snapshot()).revision, before);
});

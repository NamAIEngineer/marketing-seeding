import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "account-agent-dashboard-"));
  const store = new JsonStore(path.join(directory, "state.json"));
  const service = new SeedingService(store);
  await service.init();
  await store.mutate("fixture", "account_agent_dashboard_fixture", (state) => {
    state.executionAccounts.push(
      {
        id: "linkedin:healthy",
        platform: "linkedin",
        accountId: "healthy",
        provider: "camoufox",
        providerProfileId: "profile-healthy",
        profileId: "profile-healthy",
        identityReference: "https://www.linkedin.com/in/healthy",
        health: "healthy",
        status: "enabled",
        secretToken: "must-not-project"
      },
      {
        id: "linkedin:challenge",
        platform: "linkedin",
        accountId: "challenge",
        provider: "camoufox",
        providerProfileId: "profile-challenge",
        profileId: "profile-challenge",
        identityReference: "https://www.linkedin.com/in/challenge",
        health: "human_required",
        status: "enabled"
      }
    );
  });
  return { directory, service };
}

test("dashboard exposes deterministic read-only Account Agent projection", async () => {
  const { directory, service } = await fixture();
  const before = await readFile(path.join(directory, "state.json"), "utf8");
  const first = await service.dashboard();
  const second = await service.dashboard();
  assert.deepEqual(first.accountAgents, second.accountAgents);
  assert.equal(first.accountAgents.readOnly, true);
  assert.equal(first.accountAgents.selection.status, "SELECTED");
  assert.equal(first.accountAgents.selection.selectedAccountId, "healthy");
  assert.equal(first.accountAgents.agents.find((item) => item.accountId === "challenge").eligibilityState, "QUARANTINED");
  assert.equal(JSON.stringify(first.accountAgents).includes("must-not-project"), false);
  assert.equal(JSON.stringify(first.accountAgents).includes("profile-healthy"), true);
  const after = await readFile(path.join(directory, "state.json"), "utf8");
  assert.equal(after, before);
});

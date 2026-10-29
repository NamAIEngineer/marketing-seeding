import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";

test("All Social fan-out isolates ready and blocked Camoufox account agents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-fanout-"));
  const repo = path.join(root, "repo"); await mkdir(repo); await writeFile(path.join(repo, "README.md"), "fixture\n");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Fanout", objective: "fixture", productRepo: repo });
  const identityA = "https://www.linkedin.com/in/fanout-a";
  const identityB = "https://www.linkedin.com/in/fanout-b";
  await service.registerExecutionAccount({ platform: "linkedin", accountId: "a", provider: "camoufox", providerProfileId: "profile-a", profileId: "profile-a", identityReference: identityA, status: "enabled", health: "healthy" });
  await service.registerExecutionAccount({ platform: "linkedin", accountId: "b", provider: "camoufox", providerProfileId: "profile-b", profileId: "profile-b", identityReference: identityB, status: "enabled", health: "healthy" });
  const checkedAt = new Date().toISOString();
  const targetA = await service.createTarget({ channel: "linkedin", name: "A", url: "https://www.linkedin.com/company/a", accountId: "a", profileId: "profile-a", provider: "camoufox", providerProfileId: "profile-a", identityReference: identityA, status: "active", readiness: { state: "ready", checkedAt, checks: { sessionValid: true, composerCapable: true, platformAvailable: true } } });
  const targetB = await service.createTarget({ channel: "linkedin", name: "B", url: "https://www.linkedin.com/company/b", accountId: "b", profileId: "profile-b", provider: "camoufox", providerProfileId: "profile-b", identityReference: identityB, status: "active", readiness: { state: "ready", checkedAt, checks: { sessionValid: true, composerCapable: true, platformAvailable: true } } });
  await service.store.mutate("fixture", "set_agent_state", (state) => {
    const accountA = state.executionAccounts.find((item) => item.accountId === "a");
    const accountB = state.executionAccounts.find((item) => item.accountId === "b");
    Object.assign(accountA, { agentStatus: "READY", loginStatus: "READY" });
    Object.assign(accountB, { agentStatus: "BLOCKED", loginStatus: "BLOCKED", lastFailureCode: "ACCOUNT_SECURITY_CHALLENGE" });
    state.campaignAuthorizations = [{ id: "auth-fanout", campaignId: campaign.id, status: "active", executionMode: "standing_autonomous", allowLiveExecution: true, destinations: [
      { platform: "linkedin", accountId: "a", targetId: targetA.id, profileId: "profile-a", provider: "camoufox", providerProfileId: "profile-a", identityReference: identityA },
      { platform: "linkedin", accountId: "b", targetId: targetB.id, profileId: "profile-b", provider: "camoufox", providerProfileId: "profile-b", identityReference: identityB }
    ] }];
  });
  const plan = await service.planCampaignFanout(campaign.id, { allSocial: true });
  assert.equal(plan.channels.includes("linkedin"), true);
  assert.equal(plan.channels.includes("email"), false);
  assert.equal(plan.ready, 1);
  assert.equal(plan.blocked, 1);
  assert.equal(plan.rows.find((row) => row.accountId === "a").status, "READY");
  assert.ok(plan.rows.find((row) => row.accountId === "b").reasons.includes("account_session_blocked"));
  const dashboard = await service.dashboard();
  assert.equal(dashboard.fanoutPlans[0].rows.length, 2);
});

test("All Social execute delegates only READY targets to the guarded queue", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-fanout-execute-"));
  const repo = path.join(root, "repo"); await mkdir(repo); await writeFile(path.join(repo, "README.md"), "fixture\n");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Fanout execute", objective: "fixture", productRepo: repo });
  const identity = "https://www.linkedin.com/in/fanout-execute";
  await service.registerExecutionAccount({ platform: "linkedin", accountId: "execute", provider: "camoufox", providerProfileId: "profile-execute", profileId: "profile-execute", identityReference: identity, status: "enabled", health: "healthy" });
  const checkedAt = new Date().toISOString();
  const target = await service.createTarget({ channel: "linkedin", name: "Execute", url: "https://www.linkedin.com/company/execute", accountId: "execute", profileId: "profile-execute", provider: "camoufox", providerProfileId: "profile-execute", identityReference: identity, status: "active", readiness: { state: "ready", checkedAt, expiresAt: new Date(Date.now() + 60_000).toISOString(), checks: { sessionValid: true, composerCapable: true, platformAvailable: true } } });
  await service.store.mutate("fixture", "set_execute_authority", (state) => {
    const account = state.executionAccounts.find((item) => item.accountId === "execute");
    Object.assign(account, { agentStatus: "READY", loginStatus: "READY" });
    state.campaignAuthorizations = [{ id: "auth-execute", campaignId: campaign.id, status: "active", executionMode: "standing_autonomous", allowLiveExecution: true, destinations: [{ platform: "linkedin", accountId: "execute", targetId: target.id, profileId: "profile-execute", provider: "camoufox", providerProfileId: "profile-execute", identityReference: identity }] }];
    return state;
  });
  const calls = [];
  service.materializeAuthorizedContentCandidates = async (...args) => { calls.push(["materialize", args]); return { materialized: [{ postId: "post-execute" }] }; };
  service.queueAuthorizedCampaignJobs = async (...args) => { calls.push(["queue", args]); return [{ postId: "post-execute", status: "queued" }]; };
  const plan = await service.planCampaignFanout(campaign.id, { allSocial: true, execute: true }, "local-human-operator");
  assert.equal(plan.ready, 1);
  assert.deepEqual(plan.execution.targetIds, [target.id]);
  assert.deepEqual(calls.map(([name]) => name), ["materialize", "queue"]);
  assert.deepEqual(calls[0][1][2], { targetIds: [target.id] });
  assert.deepEqual(calls[1][1][2], { targetIds: [target.id] });
});

test("All Social honors an explicit one-or-many account selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-fanout-selection-"));
  const repo = path.join(root, "repo"); await mkdir(repo); await writeFile(path.join(repo, "README.md"), "fixture\n");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Fanout selection", objective: "fixture", productRepo: repo });
  const accounts = ["one", "two"].map((accountId) => ({ platform: "linkedin", accountId, provider: "camoufox", providerProfileId: `profile-${accountId}`, profileId: `profile-${accountId}`, identityReference: `https://www.linkedin.com/in/${accountId}`, status: "enabled", health: "healthy" }));
  for (const account of accounts) await service.registerExecutionAccount(account);
  const checkedAt = new Date().toISOString();
  const targets = [];
  for (const account of accounts) targets.push(await service.createTarget({ channel: "linkedin", name: account.accountId, url: `https://www.linkedin.com/company/${account.accountId}`, accountId: account.accountId, profileId: account.profileId, provider: "camoufox", providerProfileId: account.providerProfileId, identityReference: account.identityReference, status: "active", readiness: { state: "ready", checkedAt, expiresAt: new Date(Date.now() + 60_000).toISOString(), checks: { sessionValid: true, composerCapable: true, platformAvailable: true } } }));
  await service.store.mutate("fixture", "set_selection_authority", (state) => {
    for (const account of state.executionAccounts) Object.assign(account, { agentStatus: "READY", loginStatus: "READY" });
    state.campaignAuthorizations = [{ id: "auth-selection", campaignId: campaign.id, status: "active", executionMode: "standing_autonomous", allowLiveExecution: true, destinations: targets.map((target) => ({ platform: "linkedin", accountId: target.accountId, targetId: target.id, profileId: target.profileId, provider: "camoufox", providerProfileId: target.providerProfileId, identityReference: target.identityReference })) }];
    return state;
  });
  const plan = await service.planCampaignFanout(campaign.id, { allSocial: true, accountIds: ["two"] });
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].accountId, "two");
  assert.equal(plan.requestedAccountIds[0], "two");
});


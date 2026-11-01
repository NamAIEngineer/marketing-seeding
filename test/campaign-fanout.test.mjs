import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";

test("All Social fan-out isolates ready and blocked Camoufox account agents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-fanout-"));
  const repo = path.join(root, "repo"); await mkdir(repo); await writeFile(path.join(repo, "README.md"), [
    "Threads fixture is a local-first distribution runtime.",
    "It solves slow browser workflows by keeping evidence local.",
    "Deterministic rendering and verified evidence make it useful for design teams.",
    "Designers and developers need a local workflow."
  ].join(" "));
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

test("All Social uses a ready later destination when the first selected account is blocked", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-fanout-blocked-first-"));
  const repo = path.join(root, "repo"); await mkdir(repo); await writeFile(path.join(repo, "README.md"), [
    "Threads fixture is a local-first distribution runtime.",
    "It solves slow browser workflows by keeping evidence local.",
    "Deterministic rendering and verified evidence make it useful for design teams.",
    "Designers and developers need a local workflow."
  ].join(" "));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), { productRepoRoots: [root] });
  await service.init();
  const campaign = await service.createCampaign({ name: "Fanout blocked first", objective: "fixture", productRepo: repo });
  const checkedAt = new Date().toISOString();
  const rows = [
    { accountId: "blocked-first", profileId: "profile-blocked-first", identity: "https://threads.net/@blockedfirst", health: "human_required", loginStatus: "BLOCKED" },
    { accountId: "ready-second", profileId: "profile-ready-second", identity: "https://threads.net/@readysecond", health: "healthy", loginStatus: "READY" }
  ];
  const targets = [];
  for (const row of rows) {
    await service.registerExecutionAccount({ platform: "threads", accountId: row.accountId, provider: "camoufox", providerProfileId: row.profileId, profileId: row.profileId, identityReference: row.identity, status: "enabled", health: row.health, loginStatus: row.loginStatus });
    await service.store.mutate("fixture", "set_fanout_account_state", (state) => {
      const account = state.executionAccounts.find((item) => item.accountId === row.accountId);
      Object.assign(account, { health: row.health, loginStatus: row.loginStatus, agentStatus: row.loginStatus });
      return account;
    });
    targets.push(await service.createTarget({
      channel: "threads", name: row.accountId, url: row.identity, accountId: row.accountId, profileId: row.profileId,
      provider: "camoufox", providerProfileId: row.profileId, identityReference: row.identity, status: "active",
      readiness: { state: "ready", checkedAt, expiresAt: new Date(Date.now() + 180_000).toISOString(), checks: { sessionValid: true, composerCapable: true, platformAvailable: true } }
    }));
  }
  const calls = [];
  service.materializeAuthorizedContentCandidates = async (_campaignId, _actor, options) => { calls.push(["materialize", options]); return { materialized: [{ postId: "ready-second-post" }] }; };
  service.queueAuthorizedCampaignJobs = async (_campaignId, _actor, options) => { calls.push(["queue", options]); return [{ postId: "ready-second-post", status: "queued" }]; };
  const result = await service.bootstrapAutonomousCampaignFanout({ productRepo: repo, name: campaign.name, objective: campaign.objective, audience: ["builders"], targetIds: targets.map((item) => item.id), authorizationReference: "fanout-blocked-first", timezone: "UTC", validityHours: 24, quota: 1, concurrency: 1 }, "local-human-operator");
  assert.equal(result.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.deepEqual(result.fanout.ready, [{ targetId: targets[1].id, accountId: "ready-second", platform: "threads" }]);
  assert.equal(result.fanout.blocked[0].targetId, targets[0].id);
  assert.equal(result.fanout.blocked[0].reason, "account_human_required");
  assert.deepEqual(calls.at(-2)[1], { targetIds: [targets[1].id] });
  assert.deepEqual(calls.at(-1)[1], { targetIds: [targets[1].id] });
});


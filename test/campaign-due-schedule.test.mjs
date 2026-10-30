import test from "node:test";
import assert from "node:assert/strict";
import {
  DUE_SCHEDULE_CODES,
  DUE_SCHEDULE_STATUSES,
  evaluateDueSchedule,
  evaluateDueSchedules,
  scheduleWindowKey
} from "../src/campaign-due-schedule.mjs";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function schedule(overrides = {}) {
  return {
    id: "schedule-1",
    campaignId: "campaign-1",
    cadence: "daily",
    localTime: "09:30",
    timezone: "UTC",
    status: "active",
    ...overrides
  };
}

test("daily schedule is not due before local time and due at the boundary", () => {
  const item = schedule();
  const before = evaluateDueSchedule(item, [], "2026-10-30T09:29:59.999Z");
  assert.equal(before.status, DUE_SCHEDULE_STATUSES.NOT_DUE);
  assert.equal(before.code, DUE_SCHEDULE_CODES.NOT_DUE);
  const at = evaluateDueSchedule(item, [], "2026-10-30T09:30:00.000Z");
  assert.equal(at.status, DUE_SCHEDULE_STATUSES.DUE);
  assert.equal(at.due, true);
  assert.equal(at.windowKey, scheduleWindowKey(item, "2026-10-30"));
});

test("recorded window is idempotent, including legacy recordedAt-only runs", () => {
  const item = schedule();
  const expectedKey = scheduleWindowKey(item, "2026-10-30");
  const explicit = evaluateDueSchedule(item, [{ scheduleId: item.id, windowKey: expectedKey, status: "running" }], "2026-10-30T18:00:00Z");
  assert.equal(explicit.status, DUE_SCHEDULE_STATUSES.RECORDED);
  assert.equal(explicit.recorded, true);
  const legacy = evaluateDueSchedule(item, [{ scheduleId: item.id, status: "succeeded", recordedAt: "2026-10-30T11:00:00Z" }], "2026-10-30T18:00:00Z");
  assert.equal(legacy.status, DUE_SCHEDULE_STATUSES.RECORDED);
  const priorDay = evaluateDueSchedule(item, [{ scheduleId: item.id, status: "succeeded", recordedAt: "2026-10-29T11:00:00Z" }], "2026-10-30T18:00:00Z");
  assert.equal(priorDay.status, DUE_SCHEDULE_STATUSES.DUE);
});

test("timezone conversion uses local calendar date and DST-safe local clock", () => {
  const item = schedule({ timezone: "America/New_York", localTime: "09:30" });
  const due = evaluateDueSchedule(item, [], "2026-03-08T14:30:00Z");
  assert.equal(due.localDate, "2026-03-08");
  assert.equal(due.status, DUE_SCHEDULE_STATUSES.DUE);
  const firstFallBack = evaluateDueSchedule({ ...item, localTime: "01:30" }, [], "2026-11-01T05:30:00Z");
  const secondFallBack = evaluateDueSchedule({ ...item, localTime: "01:30" }, [], "2026-11-01T06:30:00Z");
  assert.equal(firstFallBack.localDate, "2026-11-01");
  assert.equal(firstFallBack.windowKey, secondFallBack.windowKey);
});

test("disabled and malformed schedules fail closed with explicit statuses", () => {
  const disabled = evaluateDueSchedule(schedule({ status: "paused" }), [], "2026-10-30T18:00:00Z");
  assert.equal(disabled.status, DUE_SCHEDULE_STATUSES.BLOCKED);
  assert.equal(disabled.code, DUE_SCHEDULE_CODES.DISABLED);
  const malformedTime = evaluateDueSchedule(schedule({ localTime: "9:30" }), [], "2026-10-30T18:00:00Z");
  assert.equal(malformedTime.status, DUE_SCHEDULE_STATUSES.INVALID);
  assert.equal(malformedTime.code, DUE_SCHEDULE_CODES.INVALID_LOCAL_TIME);
  const malformedZone = evaluateDueSchedule(schedule({ timezone: "Not/An_Zone" }), [], "2026-10-30T18:00:00Z");
  assert.equal(malformedZone.status, DUE_SCHEDULE_STATUSES.INVALID);
  assert.equal(malformedZone.code, DUE_SCHEDULE_CODES.INVALID_TIMEZONE);
});

test("summary partitions decisions without granting execution authority", () => {
  const result = evaluateDueSchedules({
    now: "2026-10-30T18:00:00Z",
    schedules: [schedule(), schedule({ id: "schedule-2", status: "paused" }), schedule({ id: "schedule-3", localTime: "25:00" })],
    scheduleRuns: []
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.decisions.length, 3);
  assert.equal(result.due.length, 1);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.due[0].published, undefined);
  assert.equal(result.due[0].authorized, undefined);
});

test("service schedule consumer records due window and does not claim publication", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-schedule-consumer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "product");
  await mkdir(repo);
  await writeFile(path.join(repo, "README.md"), "fixture product evidence\n");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), { productRepoRoots: [root] });
  await service.init();
  const campaign = await service.createCampaign({ name: "Scheduled fixture", objective: "Exercise due consumer", productRepo: repo });
  const scheduleRow = await service.createSchedule(campaign.id, { name: "Due", localTime: "00:00", timezone: "UTC", channels: ["threads"], mode: "draft_only" });
  const result = await service.queueDueSchedules("test-schedule-consumer");
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].status, "blocked");
  assert.equal(result.due[0].reason, "standing_autonomous_authorization_not_uniquely_active");
  assert.equal(result.due[0].publicationVerified, undefined);
  const state = await service.snapshot();
  const runs = state.scheduleRuns.filter((item) => item.scheduleId === scheduleRow.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "blocked");
  assert.equal(runs[0].externalSideEffects, false);
  assert.equal(runs[0].windowKey, scheduleWindowKey(scheduleRow, runs[0].localDate));
});

test("concurrent due consumers reserve one window exactly once", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-schedule-concurrency-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "product");
  await mkdir(repo);
  await writeFile(path.join(repo, "README.md"), "fixture product evidence\n");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), { productRepoRoots: [root] });
  await service.init();
  const campaign = await service.createCampaign({ name: "Concurrent fixture", objective: "Exercise reservation", productRepo: repo });
  const scheduleRow = await service.createSchedule(campaign.id, { name: "Due", localTime: "00:00", timezone: "UTC", channels: ["threads"], mode: "draft_only" });
  const [first, second] = await Promise.all([
    service.queueDueSchedules("scheduler-a"),
    service.queueDueSchedules("scheduler-b")
  ]);
  const state = await service.snapshot();
  const runs = state.scheduleRuns.filter((item) => item.scheduleId === scheduleRow.id);
  assert.equal(runs.length, 1);
  assert.equal(first.due.length + second.due.length, 2);
  assert.ok([first.due[0].status, second.due[0].status].includes("recorded"));
});

test("dashboard projects blocked schedule runs separately from publication evidence", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-schedule-dashboard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "product");
  await mkdir(repo);
  await writeFile(path.join(repo, "README.md"), "fixture product evidence\n");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), { productRepoRoots: [root] });
  await service.init();
  const campaign = await service.createCampaign({ name: "Dashboard fixture", objective: "Exercise projection", productRepo: repo });
  const scheduleRow = await service.createSchedule(campaign.id, { name: "Due", localTime: "00:00", timezone: "UTC", channels: ["threads"], mode: "draft_only" });
  await service.queueDueSchedules("dashboard-scheduler");
  const dashboard = await service.dashboard();
  const run = dashboard.recentScheduleRuns.find((item) => item.scheduleId === scheduleRow.id);
  assert.equal(run.status, "blocked");
  assert.equal(run.externalSideEffects, false);
  assert.equal(dashboard.posts.some((post) => post.status === "published"), false);
});

test("due consumer queues only exact ready destinations and records blocked accounts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-schedule-target-gates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "product");
  await mkdir(repo);
  await writeFile(path.join(repo, "README.md"), "fixture product evidence\n");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), { productRepoRoots: [root] });
  await service.init();
  const campaign = await service.createCampaign({ name: "Target gates", objective: "Exercise per-account schedule gates", productRepo: repo });
  const checkedAt = new Date().toISOString();
  const accounts = [
    { id: "healthy", identity: "https://threads.net/@healthy", health: "healthy", loginStatus: "READY" },
    { id: "blocked", identity: "https://threads.net/@blocked", health: "human_required", loginStatus: "BLOCKED" }
  ];
  const targets = [];
  for (const item of accounts) {
    const profileId = `profile-${item.id}`;
    await service.registerExecutionAccount({ platform: "threads", accountId: item.id, provider: "camoufox", providerProfileId: profileId, profileId, identityReference: item.identity, status: "enabled", health: item.health });
    await service.store.mutate("fixture", "set_schedule_agent_state", (state) => {
      const account = state.executionAccounts.find((row) => row.accountId === item.id);
      Object.assign(account, { health: item.health, loginStatus: item.loginStatus, agentStatus: item.loginStatus });
      return account;
    });
    targets.push(await service.createTarget({
      channel: "threads", name: item.id, url: item.identity, accountId: item.id, profileId,
      provider: "camoufox", providerProfileId: profileId, identityReference: item.identity, status: "active",
      readiness: { state: "ready", checkedAt, expiresAt: new Date(Date.now() + 180_000).toISOString(), checks: { sessionValid: true, composerCapable: true, platformAvailable: true } }
    }));
  }
  await service.store.mutate("fixture", "set_schedule_authority", (state) => {
    state.campaignAuthorizations = [{
      id: "schedule-target-gates-auth", campaignId: campaign.id, status: "active", executionMode: "standing_autonomous", allowLiveExecution: true,
      destinations: targets.map((target) => ({ platform: target.channel, accountId: target.accountId, targetId: target.id, targetUrl: target.url, profileId: target.profileId, provider: "camoufox", providerProfileId: target.providerProfileId, identityReference: target.identityReference }))
    }];
    return state.campaignAuthorizations[0];
  });
  const scheduleRow = await service.createSchedule(campaign.id, { name: "Due target gates", localTime: "00:00", timezone: "UTC", channels: ["threads"] });
  const calls = [];
  service.materializeAuthorizedContentCandidates = async (_campaignId, _actor, options) => { calls.push(["materialize", options]); return { results: [], materialized: [{ postId: "ready-post" }] }; };
  service.queueAuthorizedCampaignJobs = async (_campaignId, _actor, options) => { calls.push(["queue", options]); return [{ postId: "ready-post", status: "queued" }]; };
  const result = await service.queueDueSchedules("schedule-target-gates");
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].status, "blocked");
  assert.equal(result.due[0].reason, "one_or_more_schedule_targets_blocked");
  assert.deepEqual(result.due[0].targetIds, [targets[0].id]);
  assert.equal(result.due[0].blockedTargets.length, 1);
  assert.equal(result.due[0].blockedTargets[0].targetId, targets[1].id);
  assert.equal(result.due[0].blockedTargets[0].reason, "account_human_required");
  assert.deepEqual(calls.map(([name]) => name), ["materialize", "queue"]);
  assert.deepEqual(calls[0][1], { targetIds: [targets[0].id] });
  const state = await service.snapshot();
  const run = state.scheduleRuns.find((item) => item.scheduleId === scheduleRow.id);
  assert.equal(run.status, "blocked");
  assert.equal(run.blockedTargets[0].reason, "account_human_required");
  assert.equal(run.externalSideEffects, false);
});


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
import { campaignContentHash } from "../src/campaign-authorization.mjs";
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

test("real standing schedule queue is idempotent and creates one guarded execution set", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-schedule-standing-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "product");
  await mkdir(repo);
  await writeFile(path.join(repo, "README.md"), "Durable schedule integration fixture evidence.\n");

  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), { productRepoRoots: [root] });
  await service.init();
  const campaign = await service.createCampaign({
    name: "Standing schedule integration",
    objective: "Prove one durable queue window",
    productRepo: repo
  }, "operator");
  const now = new Date();
  const accountId = "threads-schedule-integration";
  const profileId = "threads-schedule-integration-profile";
  await service.registerExecutionAccount({
    platform: "threads",
    accountId,
    profileId,
    status: "enabled",
    health: "healthy"
  }, "operator");
  const target = await service.createTarget({
    channel: "threads",
    name: "Standing schedule target",
    url: "https://www.threads.net/@schedule-integration",
    accountId,
    profileId,
    status: "active",
    readiness: {
      state: "ready",
      checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      checks: { sessionValid: true, composerCapable: true, platformAvailable: true }
    }
  }, "operator");
  const content = "Durable queue fixture copy.";
  const authorization = await service.authorizeCampaign(campaign.id, {
    id: "standing-schedule-integration-authorization",
    validFrom: new Date(now.getTime() - 60_000).toISOString(),
    validUntil: new Date(now.getTime() + 60 * 60_000).toISOString(),
    destinations: [{ platform: "threads", accountId, profileId, targetId: target.id }],
    approvedAssets: [],
    contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash(content)] },
    audienceRules: { allowedAudiences: ["operators"] },
    publicationVisibilityRules: { allowedVisibilities: ["PUBLIC"] },
    schedule: {
      timezone: "UTC",
      weekdays: [now.getUTCDay()],
      startLocal: "00:00",
      endLocal: "23:59"
    },
    rateLimits: { maxJobsPerAccountPerDay: 3, maxJobsPerCampaignPerDay: 3, maxConcurrency: 1, minIntervalMinutes: 0 },
    allowLiveExecution: true,
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "standing-schedule-integration-reference"
  }, "operator");
  assert.equal(authorization.status, "active");

  // The post is created through the normal authorized service path, then the
  // pre-submit controls are removed to model a restart before the scheduler
  // tick. queueDueSchedules must derive them exactly once from standing
  // authority/readiness; no adapter or external click is invoked here.
  const post = await service.createPost({
    campaignId: campaign.id,
    targetId: target.id,
    content,
    audience: "operators"
  }, "operator");
  const scheduleRow = await service.createSchedule(campaign.id, {
    name: "Standing due window",
    localTime: "00:00",
    timezone: "UTC",
    channels: ["threads"]
  }, "operator");
  await service.store.mutate("schedule-integration-fixture", "reset_pre_submit_controls", (state) => {
    const currentPost = state.posts.find((item) => item.id === post.id);
    currentPost.status = "queued";
    currentPost.executionState = null;
    currentPost.executionId = null;
    state.executionRequests = state.executionRequests.filter((item) => item.jobId !== post.id);
    state.executionLeases = state.executionLeases.filter((item) => item.jobId !== post.id);
    state.executionReceipts = state.executionReceipts.filter((item) => item.jobId !== post.id);
    state.oneTimeExecutionWindows = state.oneTimeExecutionWindows.filter((item) => item.jobId !== post.id);
    state.liveExecutionGrants = state.liveExecutionGrants.filter((item) => item.jobId !== post.id);
    state.publicationAttempts = state.publicationAttempts.filter((item) => item.postId !== post.id);
    state.scheduleRuns = state.scheduleRuns.filter((item) => item.scheduleId !== scheduleRow.id);
    return state;
  });

  const first = await service.queueDueSchedules("standing-schedule-queue");
  const afterFirst = await service.snapshot();
  const firstRun = afterFirst.scheduleRuns.filter((item) => item.scheduleId === scheduleRow.id);
  const firstRequests = afterFirst.executionRequests.filter((item) => item.jobId === post.id && item.request?.dryRun !== true);
  const firstWindows = afterFirst.oneTimeExecutionWindows.filter((item) => item.jobId === post.id);
  const firstGrants = afterFirst.liveExecutionGrants.filter((item) => item.jobId === post.id);
  assert.equal(first.due.length, 1);
  assert.equal(first.due[0].status, "succeeded");
  assert.equal(first.due[0].publicationVerified, false);
  assert.equal(first.due[0].externalSideEffects, false);
  assert.equal(firstRun.length, 1);
  assert.match(firstRun[0].windowKey, /^daily:/);
  assert.equal(firstRequests.length, 1);
  assert.equal(firstRequests[0].state, "REQUEST_READY");
  assert.equal(firstRequests[0].submitState, "NOT_STARTED");
  assert.equal(firstWindows.length, 1);
  assert.equal(firstWindows[0].status, "RESERVED");
  assert.equal(firstWindows[0].reservedExecutionId, firstRequests[0].executionId);
  assert.equal(firstGrants.length, 1);
  assert.equal(firstGrants[0].status, "ACTIVE");
  assert.equal(firstGrants[0].boundExecutionId, firstRequests[0].executionId);
  assert.equal(afterFirst.publicationAttempts.length, 0);
  assert.equal(afterFirst.executionReceipts.length, 0);
  assert.equal(afterFirst.posts.find((item) => item.id === post.id).status, "queued");
  const dashboardAfterFirst = await service.dashboard();
  const dashboardRun = dashboardAfterFirst.recentScheduleRuns.find((item) => item.scheduleId === scheduleRow.id);
  assert.equal(dashboardRun.executionControls.length, 1);
  assert.equal(dashboardRun.executionControls[0].requestState, "REQUEST_READY");
  assert.equal(dashboardRun.executionControls[0].windowStatus, "RESERVED");
  assert.equal(dashboardRun.executionControls[0].grantStatus, "ACTIVE");
  assert.equal(dashboardRun.executionControls[0].publicationStatus, "NOT_VERIFIED");

  // The persisted schedule row is a queue-time audit record. Once an
  // independent receipt arrives, Overview must reproject the current
  // execution outcome instead of leaving REQUEST_READY/NOT_VERIFIED stale.
  const execution = firstRequests[0];
  const publicationUrl = "https://threads.net/@fixture/post/schedule-verified";
  await service.store.mutate("fixture-verifier", "schedule_receipt_fixture", (state) => {
    const request = state.executionRequests.find((item) => item.executionId === execution.executionId);
    request.state = "CONFIRMED";
    request.submitState = "CONFIRMED";
    state.executionReceipts.push({
      id: "schedule-verified-receipt",
      executionId: execution.executionId,
      jobId: post.id,
      attempt: execution.attempt,
      receivedAt: new Date().toISOString(),
      receipt: {
        submitState: "CONFIRMED",
        publicationUrl,
        publicationEvidence: {
          verifiedAt: new Date().toISOString(),
          verificationMethod: "fixture-independent-readback",
          accountMatched: true,
          targetMatched: true,
          contentHashMatched: true,
          verificationDetails: {
            authorIdentity: { matched: true },
            contentMatch: { matched: true },
            candidate: {
              postId: "schedule-verified",
              permalink: publicationUrl,
              timestamp: new Date().toISOString(),
              timestampMatched: true
            }
          }
        }
      }
    });
    return state;
  });
  const dashboardAfterVerification = await service.dashboard();
  const verifiedRun = dashboardAfterVerification.recentScheduleRuns.find((item) => item.scheduleId === scheduleRow.id);
  assert.equal(verifiedRun.executionControls[0].requestState, "CONFIRMED");
  assert.equal(verifiedRun.executionControls[0].submitState, "CONFIRMED");
  assert.equal(verifiedRun.executionControls[0].publicationStatus, "VERIFIED");
  assert.equal(verifiedRun.executionControls[0].reason, "independent_publication_receipt_verified");

  const second = await service.queueDueSchedules("standing-schedule-queue-repeat");
  const afterSecond = await service.snapshot();
  assert.equal(second.due.length, 0);
  assert.equal(second.decisions.find((item) => item.scheduleId === scheduleRow.id)?.status, "RECORDED");
  assert.equal(afterSecond.scheduleRuns.filter((item) => item.scheduleId === scheduleRow.id).length, 1);
  assert.equal(afterSecond.executionRequests.filter((item) => item.jobId === post.id && item.request?.dryRun !== true).length, 1);
  assert.equal(afterSecond.oneTimeExecutionWindows.filter((item) => item.jobId === post.id).length, 1);
  assert.equal(afterSecond.liveExecutionGrants.filter((item) => item.jobId === post.id).length, 1);
  assert.equal(afterSecond.publicationAttempts.length, 0);
  // The fixture verifier intentionally records one independent receipt above;
  // the repeated scheduler tick must not create another one.
  assert.equal(afterSecond.executionReceipts.length, 1);
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


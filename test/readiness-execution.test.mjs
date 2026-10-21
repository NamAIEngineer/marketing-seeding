import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { campaignContentHash } from "../src/campaign-authorization.mjs";
import { contentSha256, validateExecutionReceiptV1, validateExecutionRequestV1 } from "../src/execution-contracts.mjs";
import { isReadinessFresh, normalizeReadinessResult } from "../src/readiness.mjs";
import { classifyLinkedInComposerState, LinkedInReadinessProvider, linkedInReadinessExpressions } from "../src/linkedin-readiness.mjs";
import { evaluateQueue } from "../src/guards.mjs";
import { JevExecutionWorker } from "../src/jev-execution-worker.mjs";
import { PlatformAdapterRegistry, PLATFORM_CAPABILITIES } from "../src/platform-registries.mjs";

async function fixture({ platform = "threads", provider, readinessAgeMs = 10_000, readinessTtlMs = 5_000, maxReadinessAttempts = 2, schedule, maxConcurrency = 2, allowLiveExecution = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pr2-readiness-test-"));
  const productRepo = path.join(directory, "product");
  await mkdir(productRepo);
  await writeFile(path.join(productRepo, "README.md"), "Isolated test evidence\n", "utf8");
  const service = new SeedingService(new JsonStore(path.join(directory, "state.json")), {
    readinessTtlMs, maxReadinessAttempts,
    readinessProviders: provider ? { [platform]: provider } : {}
  });
  await service.init();
  const campaign = await service.createCampaign({ name: "PR2 test", objective: "Exercise readiness", productRepo }, "operator");
  await service.updateCampaign(campaign.id, { status: "active" }, "operator");
  const accountId = `${platform}-account-1`;
  const profileId = platform === "linkedin" ? "1fe88615-ddcc-4d71-9cf6-821cf67b3b01" : "threads-profile-1";
  await service.registerExecutionAccount({
    platform, accountId, profileId,
    identityReference: platform === "linkedin" ? "https://www.linkedin.com/in/test-owner" : undefined
  }, "operator");
  const checkedAt = new Date(Date.now() - readinessAgeMs).toISOString();
  const target = await service.createTarget({
    channel: platform, name: "Test target", url: platform === "linkedin" ? "https://www.linkedin.com/feed/" : platform === "reddit" ? "https://www.reddit.com/r/owner" : "https://www.threads.net/@owner", accountId, profileId,
    status: "active",
    readiness: { state: "ready", checkedAt, checks: { sessionValid: true, composerCapable: true, platformAvailable: true } }
  }, "operator");
  const content = "PR2 approved test content";
  const post = await service.createPost({ campaignId: campaign.id, targetId: target.id, content, audience: "public" }, "producer");
  await service.authorizeCampaign(campaign.id, {
    id: "pr2-test-auth",
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    destinations: [{ platform, accountId, profileId, targetId: target.id }],
    approvedAssets: [],
    contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash(content)] },
    audienceRules: { allowedAudiences: ["public"] },
    schedule: schedule || { timezone: "UTC", weekdays: [new Date().getUTCDay()], startLocal: "00:00", endLocal: "23:59" },
    rateLimits: { maxJobsPerAccountPerDay: 10, maxJobsPerCampaignPerDay: 10, maxConcurrency, minIntervalMinutes: 0 },
    allowLiveExecution
  }, "operator");
  return { directory, service, campaign, target, post, accountId, profileId, content };
}

const ready = () => ({
  state: "READY", reasonCode: "test_ready", retryable: false, recoveryClassification: "NONE",
  capabilities: { sessionAuthenticated: true, identityVerified: true, feedReachable: true, composerAvailable: true }
});

test("stale readiness refreshes automatically and prepares one versioned execution request", async () => {
  let calls = 0;
  const contextSeen = [];
  const { service, post, target, campaign } = await fixture({
    readinessAgeMs: 10_000, readinessTtlMs: 5_000,
    provider: { async checkReadiness(context) { calls += 1; contextSeen.push(context); return ready(); } }
  });
  const state = await service.snapshot();
  const job = state.posts.find((item) => item.id === post.id);
  assert.equal(calls, 1);
  assert.equal(contextSeen[0].jobId, post.id);
  assert.equal(contextSeen[0].campaignId, campaign.id);
  assert.equal(job.status, "queued");
  assert.equal(job.readinessState, "READY");
  assert.equal(job.executionState, "REQUEST_READY");
  assert.equal(state.executionRequests.length, 1);
  assert.equal(state.executionRequests[0].request.schemaVersion, 1);
  assert.equal(state.executionRequests[0].request.profileId, target.profileId);
  assert.equal(state.executionRequests[0].request.audience, "public");
  assert.equal(state.executionRequests[0].request.readiness.state, "READY");
  assert.equal((await service.readyExecutionRequests()).length, 0); // Request exists; live dispatch still requires a job grant.
});

test("autonomous dry-run readiness selects only safe dry-run rows and never live rows", async (context) => {
  const fixtureState = await fixture({ platform: "linkedin", provider: { async checkReadiness() { return ready(); } } });
  context.after(() => rm(fixtureState.directory, { recursive: true, force: true }));
  await fixtureState.service.refreshCampaignJobReadiness(fixtureState.post.id, "operator", { force: true });
  await fixtureState.service.store.mutate("test", "mark_isolated_fixture_dry_run", (state) => {
    const row = state.executionRequests.find((item) => item.jobId === fixtureState.post.id);
    row.request.dryRun = true;
  });
  const dry = (await fixtureState.service.snapshot()).executionRequests[0];
  assert.equal((await fixtureState.service.readyDryRunExecutionRequests()).length, 0, "nested dry-run flag cannot promote a top-level live row");
  await fixtureState.service.store.mutate("test", "mark_fixture_dry_run", (state) => {
    const row = state.executionRequests.find((item) => item.executionId === dry.executionId);
    row.dryRun = true;
  });
  const selected = await fixtureState.service.readyDryRunExecutionRequests();
  assert.deepEqual(selected.map((item) => item.executionId), [dry.executionId]);
  assert.equal((await fixtureState.service.readyExecutionRequests()).some((item) => item.executionId === dry.executionId), false);
  const registry = new PlatformAdapterRegistry();
  registry.register("linkedin", {
    contractVersion: 1,
    capabilities: Object.fromEntries(PLATFORM_CAPABILITIES.map((capability) => [capability, false])),
    async execute() {
      return { submitState: "NOT_STARTED", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), gates: { all: true } };
    },
    async reconcile() { throw new Error("not used"); }
  });
  const worker = new JevExecutionWorker({ service: fixtureState.service, adapterRegistry: registry, workerId: "autonomous-dry-run-test", env: {} });
  const first = await worker.runReadyDryRunOnce();
  assert.equal(first.length, 1);
  assert.equal(first[0].status, "DRY_RUN_COMPLETE");
  assert.equal((await worker.runReadyDryRunOnce()).length, 0);
  const state = await fixtureState.service.snapshot();
  assert.equal(state.executionReceipts.length, 1);
  assert.equal(state.executionReceipts[0].receipt.dryRun, true);
  assert.equal(state.executionReceipts[0].receipt.submitState, "NOT_STARTED");
  assert.equal(state.executionReceipts[0].receipt.publicationUrl, null);
  assert.equal(state.liveExecutionGrants.length, 0);
  assert.equal(state.oneTimeExecutionWindows.length, 0);
});

test("queued request refreshes stale readiness without changing execution identity", async () => {
  let calls = 0;
  const { service, post } = await fixture({ provider: { async checkReadiness() { calls += 1; return ready(); } } });
  const before = await service.snapshot();
  const executionId = before.executionRequests[0].executionId;
  await service.store.mutate("test", "expire_readiness", (state) => {
    const target = state.targets.find((item) => item.id === post.targetId);
    target.readiness.checkedAt = new Date(Date.now() - 10_000).toISOString();
    target.readiness.expiresAt = new Date(Date.now() - 1_000).toISOString();
  });
  const evaluated = await service.queueDueCampaignJobs("test-scheduler");
  const after = await service.snapshot();
  assert.equal(evaluated.length, 1);
  assert.equal(calls, 2);
  assert.equal(after.executionRequests.length, 1);
  assert.equal(after.executionRequests[0].executionId, executionId);
  assert.ok(after.executionRequests[0].lastRefreshedAt);
  assert.equal((await service.readyExecutionRequests()).length, 0); // Readiness does not mint live permission.
});

test("successful readiness resets the consecutive retry budget before the next freshness epoch", async () => {
  let calls = 0;
  const { service, post } = await fixture({
    readinessAgeMs: 10_000,
    readinessTtlMs: 5_000,
    maxReadinessAttempts: 1,
    provider: { async checkReadiness() { calls += 1; return ready(); } }
  });
  let state = await service.snapshot();
  assert.equal(calls, 1);
  assert.equal(state.posts.find((item) => item.id === post.id).readinessAttempts, 0);

  await service.store.mutate("test", "expire_readiness_after_successful_epoch", (current) => {
    const target = current.targets.find((item) => item.id === post.targetId);
    target.readiness.checkedAt = new Date(Date.now() - 10_000).toISOString();
    target.readiness.expiresAt = new Date(Date.now() - 1_000).toISOString();
  });
  await service.queueDueCampaignJobs("test-scheduler");
  state = await service.snapshot();
  assert.equal(calls, 2);
  assert.equal(state.posts.find((item) => item.id === post.id).readinessState, "READY");
  assert.equal(state.posts.find((item) => item.id === post.id).readinessAttempts, 0);
  assert.equal(state.posts.find((item) => item.id === post.id).readinessReasonCode, "test_ready");
});

test("retryable readiness failure is bounded and scheduler reevaluates automatically", async () => {
  let calls = 0;
  const { service, post } = await fixture({ provider: { async checkReadiness() {
    calls += 1;
    return calls === 1
      ? { state: "UNKNOWN", reasonCode: "network_error", retryable: true, recoveryClassification: "RECOVERABLE" }
      : ready();
  } } });
  let state = await service.snapshot();
  assert.equal(state.posts.find((item) => item.id === post.id).readinessState, "UNKNOWN");
  assert.equal(state.executionRequests.length, 0);
  await service.store.mutate("test", "make_retry_due", (current) => {
    current.posts.find((item) => item.id === post.id).readinessRetryAt = new Date(Date.now() - 1).toISOString();
  });
  await service.queueDueCampaignJobs("test-scheduler");
  state = await service.snapshot();
  assert.equal(calls, 2);
  assert.equal(state.posts.find((item) => item.id === post.id).status, "queued");
  assert.equal(state.executionRequests.length, 1);
});

test("human-required readiness is isolated and not automatically retried", async () => {
  let calls = 0;
  const { service, post } = await fixture({ provider: { async checkReadiness() {
    calls += 1;
    return { state: "HUMAN_REQUIRED", reasonCode: "passkey_required", retryable: false, recoveryClassification: "HUMAN_REQUIRED" };
  } } });
  const before = await service.snapshot();
  assert.equal(before.posts.find((item) => item.id === post.id).readinessState, "HUMAN_REQUIRED");
  await service.queueDueCampaignJobs("test-scheduler");
  await service.refreshCampaignJobReadiness(post.id, "forced-worker", { force: true });
  assert.equal(calls, 1);
  assert.equal((await service.readyExecutionRequests()).length, 0);
});

test("expected_profile_missing can be rechecked only for a canonical bound LinkedIn ORCA profile", async () => {
  let calls = 0;
  const { service, post } = await fixture({ platform: "linkedin", provider: { async checkReadiness() {
    calls += 1;
    return calls === 1
      ? { state: "HUMAN_REQUIRED", reasonCode: "expected_profile_missing", retryable: false, recoveryClassification: "HUMAN_REQUIRED" }
      : ready();
  } } });
  const first = await service.snapshot();
  assert.equal(first.posts.find((item) => item.id === post.id).readinessState, "HUMAN_REQUIRED");
  assert.equal(first.executionAccounts[0].health, "human_required");

  const results = await service.queueAuthorizedCampaignJobs(post.campaignId, "operator");
  assert.equal(calls, 2, JSON.stringify(results));
  assert.equal(results[0].readinessState, "READY");
  assert.equal((await service.readyExecutionRequests()).length, 0); // A live grant is still absent.
});

test("readiness runs outside the publish schedule but schedule still blocks queueing", async () => {
  let calls = 0;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60_000).getUTCDay();
  const { service, post } = await fixture({
    schedule: { timezone: "UTC", weekdays: [tomorrow], startLocal: "00:00", endLocal: "23:59" },
    provider: { async checkReadiness() { calls += 1; return ready(); } }
  });
  const state = await service.snapshot();
  const stored = state.posts.find((item) => item.id === post.id);
  assert.equal(calls, 1);
  assert.equal(stored.readinessState, "READY");
  assert.equal(stored.status, "blocked");
  assert.ok(stored.authorizationDecision.reasons.includes("schedule_outside_allowed_window"));
  assert.equal(state.executionRequests.length, 0);
});

test("readiness runs at campaign concurrency limit but concurrency still blocks queueing", async () => {
  let calls = 0;
  const { service, post } = await fixture({
    maxConcurrency: 1,
    allowLiveExecution: false,
    provider: { async checkReadiness() { calls += 1; return ready(); } }
  });
  await service.store.mutate("test", "occupy_campaign_execution_slot", (state) => {
    const original = state.posts.find((item) => item.id === post.id);
    state.posts.push({ ...original, id: "other-inflight-job", idempotencyKey: "other-inflight-publication", status: "publishing", executionState: "SUBMIT_SENT" });
    const target = state.targets.find((item) => item.id === post.targetId);
    target.readiness.checkedAt = new Date(Date.now() - 60_000).toISOString();
    target.readiness.expiresAt = new Date(Date.now() - 1).toISOString();
  });
  calls = 0;
  await service.refreshCampaignJobReadiness(post.id, "test-scheduler", { force: true });
  const state = await service.snapshot();
  const stored = state.posts.find((item) => item.id === post.id);
  assert.equal(calls, 1);
  assert.equal(stored.readinessState, "READY");
  assert.equal(stored.status, "blocked");
  assert.ok(stored.authorizationDecision.reasons.includes("campaign_concurrency_limit_reached"));
  assert.equal(state.executionRequests.length, 0);
});

test("allowLiveExecution=false permits readiness but never queues or prepares execution", async () => {
  let calls = 0;
  const { service, post } = await fixture({
    allowLiveExecution: false,
    provider: { async checkReadiness() { calls += 1; return ready(); } }
  });
  const state = await service.snapshot();
  const stored = state.posts.find((item) => item.id === post.id);
  assert.equal(calls, 1);
  assert.equal(stored.readinessState, "READY");
  assert.equal(stored.status, "blocked");
  assert.ok(stored.authorizationDecision.reasons.includes("live_execution_not_authorized"));
  assert.equal(state.executionRequests.length, 0);
});

test("operator DRY-RUN traverses the worker while live schedule, concurrency and publish gates remain blocked", async (context) => {
  const otherWeekday = (new Date().getUTCDay() + 1) % 7;
  let providerCalls = 0;
  const fixtureState = await fixture({
    platform: "linkedin",
    allowLiveExecution: false,
    maxConcurrency: 1,
    schedule: { timezone: "UTC", weekdays: [otherWeekday], startLocal: "20:00", endLocal: "20:30" },
    provider: { async checkReadiness() { providerCalls += 1; return ready(); } }
  });
  context.after(() => rm(fixtureState.directory, { recursive: true, force: true }));
  await fixtureState.service.store.mutate("test", "set_dry_run_preconditions", (state) => {
    const target = state.targets.find((item) => item.id === fixtureState.post.targetId);
    target.status = "needs_review";
    const source = state.posts.find((item) => item.id === fixtureState.post.id);
    state.posts.push({
      ...source,
      id: "other-inflight-campaign-job",
      content: "An unrelated in-flight campaign job",
      contentId: "other-inflight-content",
      idempotencyKey: "other-inflight-idempotency",
      status: "publishing",
      publishingAt: new Date().toISOString()
    });
  });
  const preflight = await fixtureState.service.refreshCampaignJobReadiness(fixtureState.post.id, "operator", { force: true });
  assert.equal(preflight.readinessState, "READY");
  const before = await fixtureState.service.snapshot();
  const job = before.posts.find((item) => item.id === fixtureState.post.id);
  const liveDecision = evaluateQueue(job, before);
  for (const reason of ["schedule_outside_allowed_window", "campaign_concurrency_limit_reached", "live_execution_not_authorized", "target_not_active"]) {
    assert.ok(liveDecision.reasons.includes(reason), JSON.stringify(liveDecision.reasons));
  }
  assert.equal(liveDecision.allowed, false);

  const requestRow = await fixtureState.service.prepareExecutionRequest(fixtureState.post.id, "local-human-operator", { dryRun: true });
  assert.equal(requestRow.state, "REQUEST_READY");
  assert.equal(requestRow.request.dryRun, true);
  assert.equal(requestRow.request.profileId, fixtureState.profileId);
  assert.equal(requestRow.request.audience, "public");
  await assert.rejects(() => fixtureState.service.prepareExecutionRequest(fixtureState.post.id, "operator"), /queued job/);

  let submitIntentCalls = 0;
  const registry = new PlatformAdapterRegistry();
  registry.register("linkedin", {
    contractVersion: 1,
    capabilities: Object.fromEntries(PLATFORM_CAPABILITIES.map((capability) => [capability, false])),
    async execute(request, options) {
      assert.equal(request.dryRun, true);
      assert.equal(options.dryRun, true);
      assert.equal(options.liveEnabled, false);
      const gates = Object.fromEntries(["authorizationValid", "readinessFresh", "accountMatch", "profileMatch", "targetMatch", "contentHashMatch", "mediaHashMatch", "audienceMatch", "composerConfirmed", "mediaPreviewConfirmed", "noDuplicateReceipt", "noExistingConfirmedPublication"].map((key) => [key, true]));
      return { submitState: "NOT_STARTED", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), gates, durationMs: 1, browserCommands: 7, computerUseCalls: 0, retries: 0 };
    },
    async reconcile() { throw new Error("not used in dry-run"); }
  });
  const worker = new JevExecutionWorker({ service: fixtureState.service, adapterRegistry: registry, workerId: "dry-run-test", env: {} });
  const providerCallsBeforeWorker = providerCalls;
  const result = await worker.run(requestRow.executionId, { dryRun: true });
  assert.equal(providerCalls, providerCallsBeforeWorker, "fresh readiness is reused instead of launching a duplicate browser probe");
  assert.equal(result.status, "DRY_RUN_COMPLETE");
  assert.equal(result.receipt.dryRun, true);
  assert.equal(result.receipt.submitState, "NOT_STARTED");
  assert.equal(result.receipt.publicationUrl, null);
  assert.equal(result.receipt.telemetry.browserCommands, 7);
  assert.equal(result.receipt.verificationGates.noExistingConfirmedPublication, true);
  assert.equal(submitIntentCalls, 0);
  const after = await fixtureState.service.snapshot();
  const persistedRequest = after.executionRequests.find((item) => item.executionId === requestRow.executionId);
  const persistedPost = after.posts.find((item) => item.id === fixtureState.post.id);
  assert.equal(persistedRequest.state, "DRY_RUN_COMPLETE");
  assert.equal(persistedRequest.submitState, "NOT_STARTED");
  assert.equal(after.executionReceipts[0].receipt.dryRun, true);
  assert.equal(persistedPost.status, "blocked");
  assert.equal(persistedPost.executionState, undefined);
  assert.equal(after.publicationAttempts.length, 0);
  assert.equal(after.executionLeases.length, 0);
  assert.equal((await fixtureState.service.readyExecutionRequests()).length, 0);
});

test("failed no-submit dry-run stays distinct and can be explicitly retried as a new attempt", async (context) => {
  const fixtureState = await fixture({ platform: "linkedin", allowLiveExecution: false, provider: { async checkReadiness() { return ready(); } } });
  context.after(() => rm(fixtureState.directory, { recursive: true, force: true }));
  await fixtureState.service.refreshCampaignJobReadiness(fixtureState.post.id, "operator", { force: true });
  const first = await fixtureState.service.prepareExecutionRequest(fixtureState.post.id, "operator", { dryRun: true });
  const at = new Date().toISOString();
  await fixtureState.service.recordExecutionReceipt(first.executionId, {
    schemaVersion: 1,
    executionId: first.executionId,
    jobId: fixtureState.post.id,
    attempt: first.attempt,
    startedAt: at,
    finishedAt: at,
    readinessResult: { state: "READY", checkedAt: at },
    submitState: "NOT_STARTED",
    dryRun: true,
    errorClassification: "AUTH_REQUIRED",
    recoveryClassification: "HUMAN_REQUIRED",
    telemetry: { durationMs: 10, browserCommands: 1, computerUseCalls: 0, retries: 0 },
    verificationGates: { passed: false }
  }, "operator");
  let state = await fixtureState.service.snapshot();
  assert.equal(state.executionRequests.find((item) => item.executionId === first.executionId).state, "DRY_RUN_FAILED");

  const second = await fixtureState.service.prepareExecutionRequest(fixtureState.post.id, "operator", { dryRun: true });
  assert.notEqual(second.executionId, first.executionId);
  assert.equal(second.attempt, first.attempt + 1);
  assert.equal(second.request.dryRun, true);
  assert.equal(second.submitState, "NOT_STARTED");
  state = await fixtureState.service.snapshot();
  assert.equal(state.executionRequests.find((item) => item.executionId === first.executionId).state, "DRY_RUN_FAILED");
  assert.equal(state.posts.find((item) => item.id === fixtureState.post.id).executionState, undefined);
});

test("stale readiness refreshes while schedule still blocks execution", async () => {
  let calls = 0;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60_000).getUTCDay();
  const { service, post } = await fixture({
    readinessTtlMs: 1_000,
    schedule: { timezone: "UTC", weekdays: [tomorrow], startLocal: "00:00", endLocal: "23:59" },
    provider: { async checkReadiness() { calls += 1; return ready(); } }
  });
  await service.store.mutate("test", "expire_preflight_readiness", (state) => {
    const target = state.targets.find((item) => item.id === post.targetId);
    target.readiness.checkedAt = new Date(Date.now() - 10_000).toISOString();
    target.readiness.expiresAt = new Date(Date.now() - 1).toISOString();
  });
  await service.queueDueCampaignJobs("test-scheduler");
  const state = await service.snapshot();
  const stored = state.posts.find((item) => item.id === post.id);
  assert.equal(calls, 2);
  assert.equal(stored.readinessState, "READY");
  assert.equal(stored.status, "blocked");
  assert.ok(stored.authorizationDecision.reasons.includes("schedule_outside_allowed_window"));
  assert.equal(state.executionRequests.length, 0);
});

test("non-retryable BLOCKED and exhausted UNKNOWN readiness are not polled repeatedly", async () => {
  let blockedCalls = 0;
  const blocked = await fixture({ provider: { async checkReadiness() {
    blockedCalls += 1;
    return { state: "BLOCKED", reasonCode: "composer_unavailable", retryable: false, recoveryClassification: "NONE" };
  } } });
  await blocked.service.queueDueCampaignJobs("test-scheduler");
  assert.equal(blockedCalls, 1);

  let unknownCalls = 0;
  const unknown = await fixture({ provider: { async checkReadiness() {
    unknownCalls += 1;
    return { state: "UNKNOWN", reasonCode: "provider_unavailable", retryable: false, recoveryClassification: "UNKNOWN" };
  } } });
  await unknown.service.queueDueCampaignJobs("test-scheduler");
  assert.equal(unknownCalls, 1);
});

test("execution account profile collisions and readiness binding mismatches fail closed", async () => {
  const { service, post, target } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  await assert.rejects(service.registerExecutionAccount({ platform: "threads", accountId: "other-account", profileId: target.profileId }, "operator"), /already bound/);
  const state = await service.snapshot();
  const currentTarget = state.targets.find((item) => item.id === post.targetId);
  currentTarget.readiness.accountId = "other-account";
  assert.equal(isReadinessFresh(currentTarget.readiness, {
    platform: currentTarget.channel, accountId: currentTarget.accountId, profileId: currentTarget.profileId, targetId: currentTarget.id
  }), false);
});

test("ExecutionRequestV1 and ExecutionReceiptV1 validate hashes, versions, and uncertain submit states", () => {
  assert.equal(contentSha256("payload").length, 64);
  assert.throws(() => validateExecutionRequestV1({ schemaVersion: 9 }), /schemaVersion/);
  assert.throws(() => normalizeReadinessResult({ state: "READY", cookie: "never" }, {
    platform: "threads", accountId: "a", profileId: "p", targetId: "t"
  }), /secret-like field/);
  const receipt = validateExecutionReceiptV1({
    schemaVersion: 1, executionId: "exec-1", jobId: "job-1", attempt: 1,
    startedAt: "2026-10-13T00:00:00.000Z", finishedAt: "2026-10-13T00:00:01.000Z",
    readinessResult: { state: "READY", checkedAt: "2026-10-13T00:00:00.000Z" },
    submitState: "SUBMIT_SENT", recoveryClassification: "UNKNOWN",
    telemetry: { durationMs: 1000, browserCommands: 1, computerUseCalls: 0, retries: 0 }
  });
  assert.equal(receipt.submitState, "SUBMIT_SENT");
  assert.equal(receipt.submitAcceptanceEvidence, null, "older receipt v1 rows remain valid without post-click evidence");
  assert.throws(() => validateExecutionReceiptV1({
    ...receipt, recoveryClassification: "RECOVERABLE"
  }), /possibly submitted/);
  assert.throws(() => validateExecutionReceiptV1({
    ...receipt,
    submitAcceptanceEvidence: { clickStatus: "CLICK_EMITTED", clickEmittedAt: "2026-10-13T00:00:00.000Z", platformAcceptance: "ACCEPTED", acceptanceSource: "NONE" }
  }), /explicit success confirmation or strong publication identity/);
  const acceptedReceipt = validateExecutionReceiptV1({
    ...receipt,
    submitAcceptanceEvidence: {
      clickStatus: "CLICK_EMITTED", clickEmittedAt: "2026-10-13T00:00:00.000Z", observedAt: "2026-10-13T00:00:01.000Z",
      platformAcceptance: "ACCEPTED", acceptanceSource: "SUCCESS_CONFIRMATION", confirmationState: "SUCCESS",
      confirmationText: "Your post was shared", composerState: "CLOSED", postButtonState: "DISAPPEARED"
    }
  });
  assert.equal(acceptedReceipt.submitAcceptanceEvidence.platformAcceptance, "ACCEPTED");
});

test("SUBMIT_SENT receipt is terminal for dispatch and never creates a replacement request", async () => {
  const { service, post } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  const before = await service.snapshot();
  const request = before.executionRequests[0];
  await service.store.mutate("test", "simulate_durable_submit_intent", (state) => {
    const storedRequest = state.executionRequests.find((item) => item.executionId === request.executionId);
    storedRequest.state = "SUBMIT_SENT_INTENT";
    storedRequest.submitIntentAt = new Date().toISOString();
    const storedPost = state.posts.find((item) => item.id === post.id);
    storedPost.status = "publishing";
    storedPost.executionState = "SUBMIT_SENT_INTENT";
    storedPost.publicationAttemptId = "attempt-test";
    state.publicationAttempts.push({ id: "attempt-test", postId: post.id, targetId: storedPost.targetId, status: "prepared", executionId: request.executionId, contentSha256: contentSha256(storedPost.content) });
  });
  await service.recordExecutionReceipt(request.executionId, {
    schemaVersion: 1, executionId: request.executionId, jobId: post.id, attempt: 1,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    readinessResult: { state: "READY", checkedAt: new Date().toISOString() },
    submitState: "SUBMIT_SENT", recoveryClassification: "UNKNOWN",
    telemetry: { durationMs: 1, browserCommands: 1, computerUseCalls: 0, retries: 0 }
  });
  const terminal = await service.prepareExecutionRequest(post.id);
  const after = await service.snapshot();
  assert.equal(terminal.executionId, request.executionId);
  assert.equal(terminal.state, "SUBMIT_SENT");
  assert.equal(after.executionRequests.length, 1);
  assert.equal((await service.readyExecutionRequests()).length, 0);
});

test("execution lease serializes duplicate/profile work and releases for the next safe owner", async () => {
  const { service } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  const initial = (await service.snapshot()).executionRequests[0];
  const request = initial;
  const otherExecutionId = "second-execution-same-profile";
  await service.store.mutate("test", "add_second_job_same_profile", (state) => {
    const originalPost = state.posts.find((item) => item.id === initial.jobId);
    state.posts.push({ ...originalPost, id: "second-job-same-profile", contentId: "second-content", content: "separate child job", idempotencyKey: "different-publication-identity" });
    state.executionRequests.push({
      executionId: otherExecutionId, jobId: "second-job-same-profile", attempt: 1, state: "REQUEST_READY", submitState: "NOT_STARTED",
      request: { ...initial.request, executionId: otherExecutionId, jobId: "second-job-same-profile", idempotencyKey: "different-publication-identity" }
    });
  });
  const first = await service.acquireExecutionLease(request.executionId, "worker-one");
  assert.equal(first.acquired, true);
  const second = await service.acquireExecutionLease(otherExecutionId, "worker-two");
  assert.deepEqual(second, { acquired: false, reason: "execution_lease_held" });
  assert.equal(await service.releaseExecutionLease(first.lease.id, first.lease.token), true);
  const secondLease = await service.acquireExecutionLease(otherExecutionId, "worker-two");
  assert.equal(secondLease.acquired, true);
  assert.equal(await service.releaseExecutionLease(secondLease.lease.id, secondLease.lease.token), true);
});

test("dry-run receipt is auditable but does not consume or change the live execution state", async () => {
  const { service, post } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  const request = (await service.snapshot()).executionRequests[0];
  const timestamp = new Date().toISOString();
  const receipt = {
    schemaVersion: 1, executionId: request.executionId, jobId: post.id, attempt: request.attempt,
    startedAt: timestamp, finishedAt: timestamp,
    readinessResult: { state: "READY", checkedAt: timestamp },
    submitState: "NOT_STARTED", dryRun: true,
    telemetry: { durationMs: 0, browserCommands: 1, computerUseCalls: 0, retries: 0 }
  };
  await service.recordExecutionReceipt(request.executionId, receipt);
  const after = await service.snapshot();
  assert.equal(after.executionRequests[0].state, "REQUEST_READY");
  assert.equal(after.executionRequests[0].submitState, "NOT_STARTED");
  assert.equal((await service.readyExecutionRequests()).length, 0); // Dry-run receipt does not create a live grant.
  assert.equal(after.executionReceipts[0].receipt.dryRun, true);
  assert.equal((await service.prepareExecutionRequest(post.id)).executionId, request.executionId);
});

test("verified confirmation receipt reconciles an intent to PUBLISHED and VERIFIED", async () => {
  const { service, post, target, profileId, accountId, content } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  const request = (await service.snapshot()).executionRequests[0];
  const startedAt = new Date().toISOString();
  await service.store.mutate("test", "simulate_sent_intent", (state) => {
    const storedRequest = state.executionRequests.find((item) => item.executionId === request.executionId);
    storedRequest.state = "SUBMIT_SENT_INTENT";
    storedRequest.submitIntentAt = startedAt;
    const storedPost = state.posts.find((item) => item.id === post.id);
    storedPost.status = "publishing";
    storedPost.executionState = "SUBMIT_SENT_INTENT";
    storedPost.publicationAttemptId = "attempt-verified";
    state.publicationAttempts.push({ id: "attempt-verified", postId: post.id, targetId: target.id, status: "prepared", executionId: request.executionId, contentSha256: contentSha256(content) });
  });
  const verifiedAt = new Date().toISOString();
  const confirmedReceipt = {
    schemaVersion: 1, executionId: request.executionId, jobId: post.id, attempt: 1,
    startedAt, finishedAt: verifiedAt, readinessResult: { state: "READY", checkedAt: startedAt },
    submitState: "CONFIRMED", publicationUrl: "https://www.threads.net/@owner/post/verified", publicationReference: "verified-post",
    publicationEvidence: {
      verifiedAt, accountMatched: true, targetMatched: true, contentHashMatched: true, mediaHashMatched: true,
      accountId, profileId, targetId: target.id, contentHash: contentSha256(content), mediaHash: null,
      verificationMethod: "isolated_test", evidenceReference: "test-evidence"
    },
    telemetry: { durationMs: 100, browserCommands: 2, computerUseCalls: 0, retries: 0 }
  };
  await assert.rejects(service.recordExecutionReceipt(request.executionId, confirmedReceipt, "automation"), /in-process JEV verifier/);
  await service.recordExecutionReceipt(request.executionId, confirmedReceipt, "jev-worker:test");
  const after = await service.snapshot();
  assert.equal(after.posts.find((item) => item.id === post.id).status, "published");
  assert.equal(after.executionRequests[0].state, "CONFIRMED");
  assert.ok(after.posts.find((item) => item.id === post.id).jobLifecycle.some((item) => item.state === "VERIFIED"));
});

async function prepareMediaSubmitIntent(service, post, requestRow, target, { artifactId = "artifact-video", sha256 = "a".repeat(64), mimeType = "video/mp4" } = {}) {
  const submittedAt = new Date(Date.now() - 10_000).toISOString();
  const attemptId = `attempt-${artifactId}`;
  await service.store.mutate("test", "simulate_media_submit_intent", (state) => {
    const artifact = { id: artifactId, path: "/tmp/canonical-video.mp4", sha256, mimeType, mediaType: mimeType, createdAt: submittedAt };
    state.artifacts.push(artifact);
    const storedPost = state.posts.find((item) => item.id === post.id);
    storedPost.artifactId = artifactId;
    storedPost.status = "publishing";
    storedPost.executionState = "SUBMIT_SENT_INTENT";
    storedPost.publicationAttemptId = attemptId;
    const storedRequest = state.executionRequests.find((item) => item.executionId === requestRow.executionId);
    storedRequest.state = "SUBMIT_SENT_INTENT";
    storedRequest.submitIntentAt = submittedAt;
    storedRequest.request.media = [{ artifactId, reference: artifact.path, sha256, type: mimeType }];
    state.publicationAttempts.push({ id: attemptId, postId: post.id, targetId: target.id, status: "prepared", executionId: requestRow.executionId, contentSha256: contentSha256(post.content) });
  });
  return { submittedAt, artifactId, sha256, mimeType };
}

function mediaVerificationReceipt({ platform = "linkedin", executionId, jobId, attempt, accountId, profileId, targetId, content, submittedAt, artifactId, sha256, mimeType, localFileSha256 = sha256, hashStatus = "NOT_VERIFIABLE", mediaHashMatched = false, mediaHash = null, mediaType = "video", mediaPresent = true } = {}) {
  const verifiedAt = new Date().toISOString();
  const permalink = platform === "linkedin" ? "https://www.linkedin.com/feed/update/urn:li:activity:987654321/" : "https://www.threads.net/@owner/post/verified";
  return {
    schemaVersion: 1, executionId, jobId, attempt,
    startedAt: submittedAt, finishedAt: verifiedAt,
    readinessResult: { state: "READY", checkedAt: submittedAt },
    submitState: "CONFIRMED", publicationUrl: permalink, publicationReference: "urn:li:activity:987654321",
    publicationEvidence: {
      verifiedAt, accountMatched: true, targetMatched: true, contentHashMatched: true, mediaHashMatched,
      accountId, profileId, targetId, contentHash: contentSha256(content), mediaHash,
      verificationMethod: "linkedin_read_only_activity_dom", evidenceReference: permalink,
      preSubmitMediaIntegrity: { artifactId, expectedSha256: sha256, localFileSha256, mediaType: mimeType, attached: true, previewReady: true },
      verificationDetails: {
        executionId, submittedAt, observedAt: verifiedAt,
        authorIdentity: { expectedPath: "/in/test-owner", observedPath: "/in/test-owner", matched: true },
        contentMatch: { expectedSha256: contentSha256(content), matched: true },
        candidate: { surface: "feed", activityUrn: "urn:li:activity:987654321", postId: "987654321", permalink, timestamp: new Date(Date.parse(submittedAt) + 2_000).toISOString(), timestampMatched: true },
        media: { present: mediaPresent, type: mediaType, hashStatus }
      }
    }, telemetry: {}
  };
}

test("LinkedIn can verify a media publication with unavailable post hash when exact upload integrity and strong identity are proven", async (context) => {
  const { directory, service, post, target } = await fixture({ platform: "linkedin", provider: { async checkReadiness() { return ready(); } } });
  context.after(() => rm(directory, { recursive: true, force: true }));
  const requestRow = (await service.snapshot()).executionRequests[0];
  const media = await prepareMediaSubmitIntent(service, post, requestRow, target);
  const receipt = mediaVerificationReceipt({
    executionId: requestRow.executionId, jobId: post.id, attempt: 1, accountId: target.accountId,
    profileId: target.profileId, targetId: target.id, content: post.content, submittedAt: media.submittedAt, ...media
  });
  await service.recordExecutionReceipt(requestRow.executionId, receipt, "jev-worker:test");
  const after = await service.snapshot();
  assert.equal(after.posts.find((item) => item.id === post.id).status, "published");
  assert.equal(after.executionRequests[0].executionPhase, "VERIFIED");
  assert.equal(after.executionReceipts[0].receipt.publicationEvidence.mediaHashMatched, false);
  assert.equal(after.executionReceipts[0].receipt.publicationEvidence.verificationDetails.media.hashStatus, "NOT_VERIFIABLE");
});

test("NOT_VERIFIABLE publication media is rejected when pre-submit local artifact hash differs", async (context) => {
  const { directory, service, post, target } = await fixture({ platform: "linkedin", provider: { async checkReadiness() { return ready(); } } });
  context.after(() => rm(directory, { recursive: true, force: true }));
  const requestRow = (await service.snapshot()).executionRequests[0];
  const media = await prepareMediaSubmitIntent(service, post, requestRow, target);
  const receipt = mediaVerificationReceipt({
    executionId: requestRow.executionId, jobId: post.id, attempt: 1, accountId: target.accountId,
    profileId: target.profileId, targetId: target.id, content: post.content, submittedAt: media.submittedAt,
    ...media, localFileSha256: "0".repeat(64)
  });
  await assert.rejects(service.recordExecutionReceipt(requestRow.executionId, receipt, "jev-worker:test"), /pre-submit artifact integrity/);
});

test("MISMATCHED media and verifiable hash mismatch cannot reach VERIFIED", async (context) => {
  const { directory, service, post, target } = await fixture({ platform: "linkedin", provider: { async checkReadiness() { return ready(); } } });
  context.after(() => rm(directory, { recursive: true, force: true }));
  const requestRow = (await service.snapshot()).executionRequests[0];
  const media = await prepareMediaSubmitIntent(service, post, requestRow, target);
  const common = {
    executionId: requestRow.executionId, jobId: post.id, attempt: 1, accountId: target.accountId,
    profileId: target.profileId, targetId: target.id, content: post.content, submittedAt: media.submittedAt, ...media
  };
  await assert.rejects(service.recordExecutionReceipt(requestRow.executionId, mediaVerificationReceipt({ ...common, hashStatus: "MISMATCHED" }), "jev-worker:test"), /MISMATCHED publication media/);
  await assert.rejects(service.recordExecutionReceipt(requestRow.executionId, mediaVerificationReceipt({ ...common, hashStatus: "MATCHED", mediaHashMatched: true, mediaHash: "f".repeat(64) }), "jev-worker:test"), /hash does not match/);
});

test("hash-verifiable platform policy continues to require a matching post-publication media hash", async (context) => {
  const { directory, service, post, target } = await fixture({ platform: "threads", provider: { async checkReadiness() { return ready(); } } });
  context.after(() => rm(directory, { recursive: true, force: true }));
  const requestRow = (await service.snapshot()).executionRequests[0];
  const media = await prepareMediaSubmitIntent(service, post, requestRow, target);
  const common = {
    platform: "threads", executionId: requestRow.executionId, jobId: post.id, attempt: 1,
    accountId: target.accountId, profileId: target.profileId, targetId: target.id,
    content: post.content, submittedAt: media.submittedAt, ...media
  };
  await assert.rejects(service.recordExecutionReceipt(requestRow.executionId, mediaVerificationReceipt({ ...common, hashStatus: "NOT_VERIFIABLE" }), "jev-worker:test"), /matching platform capability/);
  await service.recordExecutionReceipt(requestRow.executionId, mediaVerificationReceipt({
    ...common, hashStatus: "MATCHED", mediaHashMatched: true, mediaHash: media.sha256
  }), "jev-worker:test");
  const after = await service.snapshot();
  assert.equal(after.posts.find((item) => item.id === post.id).status, "published");
  assert.equal(after.executionReceipts.at(-1).receipt.publicationEvidence.mediaHashMatched, true);
});

test("uncertain LinkedIn submissions enter rate-limited reconciliation without becoming dispatchable", async () => {
  const { service } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  const request = (await service.snapshot()).executionRequests[0];
  await service.store.mutate("test", "simulate_unknown_submit", (state) => {
    const row = state.executionRequests.find((item) => item.executionId === request.executionId);
    row.request.platform = "linkedin";
    row.state = "SUBMIT_RESULT_UNKNOWN";
    row.submitState = "UNKNOWN";
  });
  assert.equal((await service.pendingExecutionReconciliations()).length, 1);
  await service.markExecutionReconciliationAttempt(request.executionId);
  assert.equal((await service.pendingExecutionReconciliations()).length, 0);
  assert.equal((await service.pendingExecutionReconciliations({ now: Date.now() + 60_001 })).length, 1);
  await service.store.mutate("test", "exhaust_auto_reconciliation", (state) => {
    state.executionRequests.find((item) => item.executionId === request.executionId).reconciliationAttempts = 10;
  });
  assert.equal((await service.pendingExecutionReconciliations({ now: Date.now() + 60_001 })).length, 0);
  assert.equal((await service.readyExecutionRequests()).length, 0);
});

test("legacy unknown submission quarantine supports Reddit attempts without executionId and requires evidence to resolve", async () => {
  const { service, post, target } = await fixture({ platform: "reddit", provider: { async checkReadiness() { return ready(); } } });
  const attemptId = "legacy-reddit-attempt";
  await service.store.mutate("test", "prepare_legacy_unknown_fixture", (state) => {
    state.executionRequests = state.executionRequests.filter((item) => item.jobId !== post.id);
    const current = state.posts.find((item) => item.id === post.id);
    current.status = "publishing";
    current.publishingAt = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    current.publicationAttemptId = attemptId;
    state.publicationAttempts.push({ id: attemptId, postId: post.id, targetId: target.id, contentSha256: contentSha256(current.content), status: "prepared", preparedAt: current.publishingAt, expiresAt: new Date(Date.now() - 60_000).toISOString() });
  });
  const refs = ["legacy-investigation:reddit-attempt-log"];
  const uncertainty = await service.quarantineLegacySubmission(post.id, { operatorConfirmedNoWorker: true, evidenceReferences: refs }, "operator");
  assert.equal(uncertainty.executionId, null);
  assert.equal(uncertainty.publicationAttemptId, attemptId);
  assert.equal(uncertainty.platform, "reddit");
  assert.equal(uncertainty.status, "UNKNOWN");
  assert.deepEqual(uncertainty.evidenceReferences, refs);
  assert.equal((await service.snapshot()).posts.find((item) => item.id === post.id).status, "submit_result_unknown");
  await assert.rejects(service.prepareExecutionRequest(post.id, "operator"), /SUBMISSION_UNCERTAIN/);
  await assert.rejects(service.createLiveExecutionGrant({ jobId: post.id, validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString(), operatorAuthorizationReference: "test" }, "operator"), /unresolved submission/);
  await service.store.mutate("test", "create_same_identity_sibling", (state) => {
    const source = state.posts.find((item) => item.id === post.id);
    state.posts.push({ ...source, id: "same-identity-sibling", status: "blocked", jobLifecycle: [...(source.jobLifecycle || [])] });
  });
  await assert.rejects(service.createLiveExecutionGrant({ jobId: "same-identity-sibling", validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString(), operatorAuthorizationReference: "test" }, "operator"), /unresolved submission/);
  await assert.rejects(service.reconcileSubmissionUncertainty(uncertainty.id, { outcome: "PROVEN_FAILED", evidence: { evidenceReference: "weak", verificationMethod: "manual" } }, "operator"), /proof that submit never occurred/);
  const verifiedAt = new Date().toISOString();
  const reconciled = await service.reconcileSubmissionUncertainty(uncertainty.id, {
    outcome: "CONFIRMED",
    evidence: {
      evidenceReference: "reddit-readonly-verification:post-123", verificationMethod: "account-history-and-target-post-match",
      accountId: target.accountId, profileId: target.profileId, targetId: target.id, contentSha256: contentSha256(post.content), mediaSha256: null,
      publicationUrl: "https://www.reddit.com/r/owner/comments/post123", publicationReference: "post123", verifiedAt
    }
  }, "operator");
  assert.equal(reconciled.status, "CONFIRMED");
  const after = await service.snapshot();
  assert.equal(after.posts.find((item) => item.id === post.id).status, "published");
  assert.equal(after.publicationAttempts.find((item) => item.id === attemptId).status, "verified");
});

test("legacy quarantine refuses a live lease or active worker and proven failure requires explicit proof", async () => {
  for (const activeKind of ["lease", "worker"]) {
    const { service, post, target } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
    const attemptId = `legacy-${activeKind}-attempt`;
    await service.store.mutate("test", "prepare_active_legacy_fixture", (state) => {
      const current = state.posts.find((item) => item.id === post.id);
      current.status = "publishing";
      current.publicationAttemptId = attemptId;
      state.executionRequests = state.executionRequests.filter((item) => item.jobId !== post.id);
      if (activeKind === "worker") state.executionRequests.push({ executionId: "worker-execution", jobId: post.id, state: "EXECUTING" });
      else state.executionLeases.push({ id: "active-lease", jobId: post.id, executionId: "lease-execution", expiresAt: new Date(Date.now() + 60_000).toISOString() });
      state.publicationAttempts.push({ id: attemptId, postId: post.id, targetId: target.id, status: "prepared", expiresAt: new Date(Date.now() - 1).toISOString() });
    });
    await assert.rejects(service.quarantineLegacySubmission(post.id, { operatorConfirmedNoWorker: true, evidenceReferences: ["case-ref"] }, "operator"), /Active execution|Related execution/);
  }
  const { service, post, target } = await fixture({ platform: "threads", provider: { async checkReadiness() { return ready(); } } });
  const attemptId = "legacy-proven-failure";
  await service.store.mutate("test", "prepare_proven_failure_fixture", (state) => {
    state.executionRequests = state.executionRequests.filter((item) => item.jobId !== post.id);
    const current = state.posts.find((item) => item.id === post.id);
    current.status = "publishing"; current.publicationAttemptId = attemptId;
    state.publicationAttempts.push({ id: attemptId, postId: post.id, targetId: target.id, status: "prepared", expiresAt: new Date(Date.now() - 1).toISOString() });
  });
  const unknown = await service.quarantineLegacySubmission(post.id, { operatorConfirmedNoWorker: true, evidenceReferences: ["pre-submit-trace"] }, "operator");
  const failed = await service.reconcileSubmissionUncertainty(unknown.id, { outcome: "PROVEN_FAILED", evidence: { evidenceReference: "pre-submit-trace", verificationMethod: "durable-browser-trace", proofType: "PRE_SUBMIT_ABORT_TRACE", provesSubmitNeverOccurred: true } }, "operator");
  assert.equal(failed.status, "PROVEN_FAILED");
  assert.equal((await service.snapshot()).posts.find((item) => item.id === post.id).status, "failed");
});

test("modern UNKNOWN receipt preserves visible LinkedIn rejection reason in its durable quarantine", async () => {
  const { service, post } = await fixture({ platform: "linkedin", provider: { async checkReadiness() { return ready(); } } });
  const request = (await service.snapshot()).executionRequests[0];
  const at = new Date().toISOString();
  await service.store.mutate("test", "prepare_modern_unknown_fixture", (state) => {
    const row = state.executionRequests.find((item) => item.executionId === request.executionId);
    row.state = "SUBMIT_SENT"; row.submitState = "SUBMIT_SENT";
    const current = state.posts.find((item) => item.id === post.id);
    current.status = "publishing"; current.publicationAttemptId = "modern-attempt";
    state.publicationAttempts.push({ id: "modern-attempt", postId: post.id, targetId: current.targetId, executionId: request.executionId, contentSha256: contentSha256(current.content), status: "prepared", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });
  await service.recordExecutionReceipt(request.executionId, {
    schemaVersion: 1, executionId: request.executionId, jobId: post.id, attempt: request.attempt,
    startedAt: at, finishedAt: at, readinessResult: { state: "READY", checkedAt: at }, submitState: "UNKNOWN",
    reasonCode: "linkedin_media_processing_error", errorClassification: "PLATFORM_ERROR", recoveryClassification: "UNKNOWN",
    submitAcceptanceEvidence: {
      clickStatus: "CLICK_EMITTED", clickEmittedAt: at, observedAt: at,
      platformAcceptance: "REJECTED", acceptanceSource: "VISIBLE_PLATFORM_ERROR", confirmationState: "ERROR",
      errorReasonCode: "linkedin_media_processing_error", errorText: "Unable to publish this video"
    },
    telemetry: { durationMs: 100, browserCommands: 1, computerUseCalls: 0, retries: 0 }
  });
  const after = await service.snapshot();
  assert.equal(after.posts.find((item) => item.id === post.id).status, "submit_result_unknown");
  assert.equal(after.executionRequests[0].state, "SUBMIT_RESULT_UNKNOWN");
  assert.equal(after.submissionUncertainties[0].executionId, request.executionId);
  assert.equal(after.submissionUncertainties[0].reasonCode, "linkedin_media_processing_error");
  assert.equal((await service.readyExecutionRequests()).length, 0);
  await assert.rejects(service.prepareExecutionRequest(post.id, "operator"), /SUBMISSION_UNCERTAIN/);
  const proven = await service.reconcileSubmissionUncertainty(after.submissionUncertainties[0].id, {
    outcome: "PROVEN_FAILED", evidence: { evidenceReference: "worker-trace-no-click", verificationMethod: "durable-browser-action-trace", proofType: "PRE_SUBMIT_ABORT_TRACE", provesSubmitNeverOccurred: true }
  }, "operator");
  assert.equal(proven.status, "PROVEN_FAILED");
  const resolved = await service.snapshot();
  assert.equal(resolved.executionRequests[0].state, "PROVEN_FAILED");
  assert.equal(resolved.posts.find((item) => item.id === post.id).status, "failed");
  await service.transitionPost(post.id, { status: "needs_review" }, "operator");
  await service.approvePost(post.id, "operator");
  await service.transitionPost(post.id, { status: "queued" }, "operator");
  await service.createLiveExecutionGrant({ jobId: post.id, validFrom: new Date(Date.now() - 1_000).toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString(), operatorAuthorizationReference: "fresh-retry-authorization" }, "operator");
  const retry = await service.prepareExecutionRequest(post.id, "operator");
  assert.equal(retry.attempt, 2);
  assert.notEqual(retry.executionId, request.executionId);
});

test("recoverable pre-submit adapter failures get bounded automatic retries under a new execution identity", async () => {
  const { service, post } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  const before = (await service.snapshot()).executionRequests[0];
  const timestamp = new Date().toISOString();
  await service.recordExecutionReceipt(before.executionId, {
    schemaVersion: 1, executionId: before.executionId, jobId: post.id, attempt: before.attempt,
    startedAt: timestamp, finishedAt: timestamp, readinessResult: { state: "READY", checkedAt: timestamp },
    submitState: "FAILED", errorClassification: "TIMEOUT", recoveryClassification: "RECOVERABLE",
    telemetry: { durationMs: 100, browserCommands: 2, computerUseCalls: 0, retries: 0 }
  });
  await service.queueDueCampaignJobs("retry-scheduler");
  const after = await service.snapshot();
  assert.equal(after.executionRequests.length, 2);
  assert.equal(after.executionRequests[1].state, "REQUEST_READY");
  assert.equal(after.executionRequests[1].attempt, 2);
  assert.notEqual(after.executionRequests[1].executionId, before.executionId);
  const second = after.executionRequests[1];
  const retryAt = new Date().toISOString();
  await service.recordExecutionReceipt(second.executionId, {
    schemaVersion: 1, executionId: second.executionId, jobId: post.id, attempt: 2,
    startedAt: retryAt, finishedAt: retryAt, readinessResult: { state: "READY", checkedAt: retryAt },
    submitState: "FAILED", errorClassification: "TIMEOUT", recoveryClassification: "RECOVERABLE",
    telemetry: { durationMs: 100, browserCommands: 2, computerUseCalls: 0, retries: 0 }
  });
  await service.queueDueCampaignJobs("retry-scheduler");
  const thirdAttempt = (await service.snapshot()).executionRequests[2];
  assert.equal(thirdAttempt.attempt, 3);
  const thirdAt = new Date().toISOString();
  await service.recordExecutionReceipt(thirdAttempt.executionId, {
    schemaVersion: 1, executionId: thirdAttempt.executionId, jobId: post.id, attempt: 3,
    startedAt: thirdAt, finishedAt: thirdAt, readinessResult: { state: "READY", checkedAt: thirdAt },
    submitState: "FAILED", errorClassification: "TIMEOUT", recoveryClassification: "RECOVERABLE",
    telemetry: { durationMs: 100, browserCommands: 2, computerUseCalls: 0, retries: 0 }
  });
  await service.queueDueCampaignJobs("retry-scheduler");
  assert.equal((await service.snapshot()).executionRequests.length, 3);
});

test("only a durably proven pre-submit failure can renew a failed execution", async (t) => {
  async function failedPreSubmitFixture() {
    const fixtureState = await fixture({ provider: { async checkReadiness() { return ready(); } } });
    const { service, post } = fixtureState;
    const previous = (await service.snapshot()).executionRequests[0];
    const at = new Date().toISOString();
    await service.recordExecutionReceipt(previous.executionId, {
      schemaVersion: 1,
      executionId: previous.executionId,
      jobId: post.id,
      attempt: previous.attempt,
      startedAt: at,
      finishedAt: at,
      readinessResult: { state: "READY", checkedAt: at },
      submitState: "FAILED",
      errorClassification: "TIMEOUT",
      recoveryClassification: "NONE",
      preSubmitFailure: {
        reasonCode: "READINESS_REFRESH_FAILED",
        stage: "readiness_refresh",
        gate: "readinessFresh",
        gateStatus: false
      },
      telemetry: { durationMs: 100, browserCommands: 1, computerUseCalls: 0, retries: 0 }
    });
    // A failed receipt blocks the post projection. Requeue through the normal
    // review boundary before asking the router for a fresh execution.
    await service.transitionPost(post.id, { status: "needs_review" }, "operator");
    await service.approvePost(post.id, "operator");
    await service.transitionPost(post.id, { status: "queued" }, "operator");
    await service.refreshCampaignJobReadiness(post.id, "operator", { force: true });
    return { ...fixtureState, previous };
  }

  const renewed = await failedPreSubmitFixture();
  t.after(() => rm(renewed.directory, { recursive: true, force: true }));
  const fresh = await renewed.service.prepareExecutionRequest(renewed.post.id, "operator");
  assert.equal(fresh.attempt, renewed.previous.attempt + 1);
  assert.notEqual(fresh.executionId, renewed.previous.executionId);
  assert.equal((await renewed.service.snapshot()).executionRequests.length, 2);

  for (const [label, mutate] of [
    ["durable submit intent", (state, request) => { request.submitIntentAt = new Date().toISOString(); }],
    ["click evidence", (state, request) => { request.clickEmittedAt = new Date().toISOString(); }],
    ["publication attempt", (state, request) => { state.publicationAttempts.push({ executionId: request.executionId }); }],
    ["submission uncertainty", (state, request) => { state.submissionUncertainties.push({ executionId: request.executionId, status: "UNKNOWN" }); }],
    ["acceptance evidence", (state, request) => {
      const receipt = state.executionReceipts.find((item) => item.executionId === request.executionId);
      receipt.receipt.submitAcceptanceEvidence = {};
    }]
  ]) {
    const blocked = await failedPreSubmitFixture();
    t.after(() => rm(blocked.directory, { recursive: true, force: true }));
    await blocked.service.store.mutate("test", `mark_${label.replaceAll(" ", "_")}`, (state) => {
      const request = state.executionRequests.find((item) => item.executionId === blocked.previous.executionId);
      mutate(state, request);
    });
    await assert.rejects(
      blocked.service.prepareExecutionRequest(blocked.post.id, "operator"),
      /Execution cannot be redispatched after SUBMIT_SENT or an unresolved result/
    );
    const after = await blocked.service.snapshot();
    assert.equal(after.executionRequests.length, 1, `${label} must not create a replacement execution`);
  }
});

test("human-required pre-submit adapter failures pause only the affected job and account", async () => {
  const { service, post, accountId } = await fixture({ provider: { async checkReadiness() { return ready(); } } });
  const request = (await service.snapshot()).executionRequests[0];
  const timestamp = new Date().toISOString();
  await service.recordExecutionReceipt(request.executionId, {
    schemaVersion: 1, executionId: request.executionId, jobId: post.id, attempt: request.attempt,
    startedAt: timestamp, finishedAt: timestamp, readinessResult: { state: "READY", checkedAt: timestamp },
    submitState: "FAILED", errorClassification: "AUTH_REQUIRED", recoveryClassification: "HUMAN_REQUIRED",
    telemetry: { durationMs: 100, browserCommands: 1, computerUseCalls: 0, retries: 0 }
  });
  const state = await service.snapshot();
  assert.equal(state.posts.find((item) => item.id === post.id).status, "blocked");
  assert.equal(state.posts.find((item) => item.id === post.id).readinessState, "HUMAN_REQUIRED");
  assert.equal(state.executionAccounts.find((item) => item.accountId === accountId).health, "human_required");
  assert.equal((await service.readyExecutionRequests()).length, 0);
});

test("LinkedIn readiness uses the bound ORCA profile and stops before content or submission", async () => {
  const calls = [];
  const browser = {
    async listProfiles() { calls.push("profiles"); return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { calls.push("tabs"); return [{ id: "page-1", pageId: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { calls.push(`show:${id}`); return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async navigate(id, url) { calls.push(`navigate:${id}:${url}`); },
    async waitForFeed() { calls.push("wait"); },
    async evaluate(_id, expression) {
      calls.push(expression.includes("const expectedPath") ? "context" : expression.includes("candidates[0].click()") ? "composer-trigger-dom" : expression.includes("const cancelButtons") ? "composer-safe-close" : "composer");
      if (expression.includes("const expectedPath")) return {
        linkedinDomain: true, loginRequired: false, securityChallenge: false,
        sessionAuthenticated: true, identityVerified: true, feedReachable: true
      };
      if (expression.includes("candidates[0].click()")) return { clicked: true };
      if (expression.includes("const cancelButtons")) return { closed: true };
      return { linkedinDomain: true, route: true, dialogCount: 1, editorCount: 1, audience: true, postButton: true, mediaControl: true, advertisingControls: 0 };
    },
    async snapshot() { calls.push("snapshot"); return '- button "Start a post" [ref=e10]'; },
    async click(_id, element) { calls.push(`click:${element}`); },
    async pressEscape() { calls.push("escape"); }
  };
  const provider = new LinkedInReadinessProvider(browser);
  const result = await provider.checkReadiness({
    jobId: "job-1", campaignId: "campaign-1", platform: "linkedin", accountId: "account-1",
    profileId: "linkedin-profile-1", targetId: "target-1", expectedIdentityUrl: "https://www.linkedin.com/in/owner"
  });
  assert.equal(result.state, "READY");
  assert.equal(result.capabilities.composerAvailable, true);
  assert.equal(calls.filter((call) => call === "composer-trigger-dom").length, 1);
  assert.equal(calls.filter((call) => call.startsWith("click:")).length, 0);
  assert.equal(calls.filter((call) => call === "composer-safe-close").length, 1);
  assert.equal(calls.includes("escape"), false);
  assert.equal(calls.includes("wait"), false, "closing the composer should use the bounded feed-state check, not a 10-second URL wait");
  assert.equal(calls.some((call) => call === "fill" || call === "submit"), false);
});

test("LinkedIn readiness uses the owned React trigger handler when ORCA DOM click is acknowledged without activation", async () => {
  let phase = "feed";
  let handlerActivations = 0;
  const browser = {
    async listProfiles() { return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { return [{ id: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async evaluate(_id, expression) {
      if (expression.includes("const expectedPath")) return {
        linkedinDomain: true, loginRequired: false, securityChallenge: false,
        sessionAuthenticated: true, identityVerified: true, feedReachable: true
      };
      if (expression.includes("const fiberKey") && expression.includes("owned_react_handler")) {
        handlerActivations += 1;
        phase = "composer";
        return { clicked: true, activationMethod: "owned_react_handler" };
      }
      if (expression.includes("const cancelButtons")) { phase = "feed"; return { closed: true }; }
      return phase === "composer"
        ? { linkedinDomain: true, route: false, routeCompatible: true, dialogCount: 1, editorCount: 1, audience: true, postButton: true, mediaControl: true, closeControl: true, advertisingControls: 0, confirmed: true }
        : { linkedinDomain: true, route: false, routeCompatible: false, dialogCount: 0, editorCount: 0, audience: false, postButton: false, mediaControl: false, closeControl: false, advertisingControls: 0, confirmed: false };
    },
    async snapshot() { return phase === "feed" ? '- button "Start a post" [ref=e10]' : '- textbox "Post editor" [ref=e11]'; },
    async navigate() {}, async waitForFeed() {}, async pressEscape() { assert.fail("verified readiness must close through the owned empty-composer control"); }
  };
  const result = await new LinkedInReadinessProvider(browser).checkReadiness({
    platform: "linkedin", profileId: "linkedin-profile-1", expectedIdentityUrl: "https://www.linkedin.com/in/test-owner"
  });
  assert.equal(result.state, "READY");
  assert.equal(handlerActivations, 1);
});

test("LinkedIn readiness verifies composer close with a bounded feed-state wait", async () => {
  let escaped = false;
  let closeChecks = 0;
  const browser = {
    async listProfiles() { return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { return [{ id: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async evaluate(_id, expression) {
      if (expression.includes("const expectedPath")) {
        if (escaped) closeChecks += 1;
        const feedReady = !escaped || closeChecks >= 2;
        return { linkedinDomain: true, loginRequired: false, securityChallenge: false, sessionAuthenticated: feedReady, identityVerified: feedReady, feedReachable: feedReady };
      }
      if (expression.includes("candidates[0].click()")) return { clicked: true };
      if (expression.includes("const cancelButtons")) { escaped = true; return { closed: true }; }
      return { linkedinDomain: true, route: true, dialogCount: 1, editorCount: 1, audience: true, postButton: true, mediaControl: true, advertisingControls: 0, confirmed: true };
    },
    async pressEscape() { assert.fail("verified readiness cleanup should use the empty-composer cancel control"); },
    async waitForFeed() { assert.fail("already-on-feed composer close must not use a URL wait"); }
  };
  const result = await new LinkedInReadinessProvider(browser).checkReadiness({
    platform: "linkedin", profileId: "linkedin-profile-1", expectedIdentityUrl: "https://www.linkedin.com/in/test-owner"
  });
  assert.equal(result.state, "READY");
  assert.equal(closeChecks, 2);
});

test("LinkedIn readiness closes the empty dialog composer when LinkedIn keeps it on /feed", async () => {
  let phase = "feed";
  let closeRouteAccepted = false;
  const browser = {
    async listProfiles() { return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { return [{ id: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async evaluate(_id, expression) {
      if (expression.includes("const expectedPath")) return {
        linkedinDomain: true, loginRequired: false, securityChallenge: false,
        sessionAuthenticated: true, identityVerified: true, feedReachable: true
      };
      if (expression.includes("candidates[0].click()")) { phase = "composer"; return { clicked: true }; }
      if (expression.includes("const cancelButtons")) {
        closeRouteAccepted = expression.includes("'/feed'");
        phase = "feed";
        return closeRouteAccepted ? { closed: true } : { closed: false, reason: "composer_identity_mismatch" };
      }
      return phase === "composer"
        ? { linkedinDomain: true, route: false, routeCompatible: true, dialogCount: 1, editorCount: 1, audience: true, postButton: true, mediaControl: true, closeControl: true, advertisingControls: 0, confirmed: true }
        : { linkedinDomain: true, route: false, routeCompatible: false, dialogCount: 0, editorCount: 0, audience: false, postButton: false, mediaControl: false, closeControl: false, advertisingControls: 0, confirmed: false };
    },
    async snapshot() { return phase === "feed" ? '- button "Start a post" [ref=e10]' : '- textbox "Post editor" [ref=e11]'; },
    async navigate() {},
    async waitForFeed() {},
    async pressEscape() { assert.fail("verified readiness cleanup should use the owned empty-composer control"); }
  };
  const result = await new LinkedInReadinessProvider(browser).checkReadiness({
    platform: "linkedin", profileId: "linkedin-profile-1", expectedIdentityUrl: "https://www.linkedin.com/in/test-owner"
  });
  assert.equal(result.state, "READY");
  assert.equal(closeRouteAccepted, true);
});

test("LinkedIn readiness recovers once from the explicit composer load error and rechecks identity", async () => {
  let phase = "feed";
  let activations = 0;
  let feedNavigations = 0;
  const browser = {
    async listProfiles() { return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { return [{ id: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async navigate(_id, url) { assert.match(url, /linkedin\.com\/feed\/$/); feedNavigations += 1; phase = "feed"; },
    async waitForFeed() {},
    async evaluate(_id, expression) {
      if (expression.includes("const expectedPath")) return { linkedinDomain: true, loginRequired: false, securityChallenge: false, sessionAuthenticated: true, identityVerified: true, feedReachable: true };
      if (expression.includes("candidates[0].click()")) {
        activations += 1;
        phase = activations === 1 ? "error" : "composer";
        return { clicked: true };
      }
      if (expression.includes("const cancelButtons")) { phase = "feed"; return { closed: true }; }
      if (phase === "error") return { linkedinDomain: true, route: true, routeCompatible: true, dialogCount: 1, editorCount: 0, transientLoadError: true, advertisingControls: 0, confirmed: false };
      return { linkedinDomain: true, route: true, routeCompatible: true, dialogCount: 1, editorCount: 1, audience: true, postButton: true, mediaControl: true, closeControl: true, advertisingControls: 0, confirmed: true };
    },
    async pressEscape() { assert.fail("verified readiness cleanup should use the empty-composer cancel control"); }
  };
  const result = await new LinkedInReadinessProvider(browser).checkReadiness({
    platform: "linkedin", profileId: "linkedin-profile-1", expectedIdentityUrl: "https://www.linkedin.com/in/test-owner"
  });
  assert.equal(result.state, "READY");
  assert.equal(activations, 2);
  assert.equal(feedNavigations, 1);
});

function evaluateLinkedInContext({ path = "/feed/", navigation = true, main = true, composer = true, loginForm = false, pageText = "", locale = "en" } = {}) {
  const visible = { getClientRects: () => [{}] };
  const anchor = { href: "https://www.linkedin.com/in/test-owner" };
  const postButton = {
    ...visible,
    innerText: locale === "vi" ? "B\u1eaft \u0111\u1ea7u b\u00e0i \u0111\u0103ng" : "Start a post",
    getAttribute(name) { return name === "aria-label" ? "" : null; }
  };
  const sessionInput = { ...visible };
  const document = {
    body: { innerText: pageText },
    querySelector(selector) { return selector === "main,#main-content" && main ? visible : null; },
    querySelectorAll(selector) {
      if (selector === "a[href]") return [anchor];
      if (selector === 'input[name="session_key"], input[name="session_password"]') return loginForm ? [sessionInput] : [];
      if (selector === 'nav,[role="navigation"]') return navigation ? [visible] : [];
      if (selector === "main,#main-content") return main ? [visible] : [];
      if (selector === 'button,[role="button"]') return composer ? [postButton] : [];
      return [];
    }
  };
  const expression = linkedInReadinessExpressions().context("/in/test-owner");
  return runInNewContext(expression, {
    URL,
    location: { hostname: "www.linkedin.com", pathname: path, href: `https://www.linkedin.com${path}` },
    document
  });
}

test("LinkedIn auth detector accepts an authenticated feed shell without legacy global-nav selectors", () => {
  const state = evaluateLinkedInContext();
  assert.equal(state.loginRequired, false);
  assert.equal(state.feedReachable, true);
  assert.equal(state.authenticatedNavigation, true);
  assert.equal(state.composerTrigger, true);
  assert.equal(state.sessionAuthenticated, true);
  assert.equal(state.identityVerified, true);
});

test("LinkedIn auth detector recognizes the Vietnamese composer trigger", () => {
  const state = evaluateLinkedInContext({ locale: "vi" });
  assert.equal(state.composerTrigger, true);
  assert.equal(state.sessionAuthenticated, true);
});

test("LinkedIn auth detector requires explicit login evidence and recognizes security challenges", () => {
  const login = evaluateLinkedInContext({ path: "/login/", navigation: false, main: false, composer: false });
  assert.equal(login.loginRequired, true);
  assert.equal(login.sessionAuthenticated, false);
  const challenge = evaluateLinkedInContext({ path: "/checkpoint/challenge/", navigation: false, main: false, composer: false });
  assert.equal(challenge.securityChallenge, true);
});

function evaluateLinkedInComposer({ dialog = false, editor = false, audience = false, post = false, media = false, close = false, errorText = "", retry = false, path = "/feed/", locale = "en" } = {}) {
  const visible = { getClientRects: () => [{}] };
  const makeControl = (tagName, text, ariaLabel = "") => ({
    ...visible, tagName,
    innerText: text,
    getAttribute(name) { return name === "aria-label" ? ariaLabel : null; }
  });
  const controls = [
    ...(audience ? [makeControl("BUTTON", locale === "vi" ? "\u0110\u0103ng cho M\u1ecdi ng\u01b0\u1eddi" : "Everyone")] : []),
    ...(post ? [makeControl("BUTTON", locale === "vi" ? "\u0110\u0103ng b\u00e0i" : "Post")] : []),
    ...(media ? [makeControl("BUTTON", locale === "vi" ? "Ph\u01b0\u01a1ng ti\u1ec7n truy\u1ec1n th\u00f4ng" : "Add media")] : []),
    ...(close ? [makeControl("BUTTON", "", locale === "vi" ? "H\u1ee7y b\u1ecf" : "Close") ] : []),
    ...(retry ? [makeControl("BUTTON", "Làm mới")] : [])
  ];
  const editorNode = { ...visible };
  const dialogNode = {
    ...visible,
    innerText: errorText,
    querySelectorAll(selector) {
      if (selector === '[contenteditable="true"],[role="textbox"]') return editor ? [editorNode] : [];
      if (selector === 'button,[role="button"],input,[role="combobox"]') return controls;
      return [];
    }
  };
  const document = {
    querySelectorAll(selector) {
      return selector === 'dialog,[role="dialog"]' && dialog ? [dialogNode] : [];
    }
  };
  return runInNewContext(linkedInReadinessExpressions().composer, {
    document,
    location: { hostname: "www.linkedin.com", pathname: path }
  });
}

test("LinkedIn composer classifier confirms the real structural composer signals", () => {
  const state = evaluateLinkedInComposer({ dialog: true, editor: true, audience: true, post: true, media: true, close: true });
  assert.equal(state.confirmed, true);
  assert.equal(state.routeCompatible, true);
  assert.equal(classifyLinkedInComposerState(state), "CONFIRMED");
});

test("LinkedIn composer classifier recognizes the real Vietnamese composer controls", () => {
  const state = evaluateLinkedInComposer({ dialog: true, editor: true, audience: true, post: true, media: true, close: true, locale: "vi", path: "/sharing/compose" });
  assert.equal(state.audience, true);
  assert.equal(state.postButton, true);
  assert.equal(state.mediaControl, true);
  assert.equal(state.closeControl, true);
  assert.equal(state.confirmed, true);
  assert.equal(classifyLinkedInComposerState(state), "CONFIRMED");
});

test("LinkedIn feed without an open composer is not classified as a composer", () => {
  const state = evaluateLinkedInComposer();
  assert.equal(state.confirmed, false);
  assert.equal(classifyLinkedInComposerState(state), "NOT_COMPOSER");
});

test("an unrelated LinkedIn dialog is not classified as the post composer", () => {
  const state = evaluateLinkedInComposer({ dialog: true, close: true });
  assert.equal(state.confirmed, false);
  assert.equal(classifyLinkedInComposerState(state), "NOT_COMPOSER");
});

test("LinkedIn composer classifier identifies only the explicit retryable load-error structure", () => {
  const state = evaluateLinkedInComposer({ dialog: true, retry: true, errorText: "Đã xảy ra sự cố ở phía chúng tôi. Hãy thử làm mới trang." });
  assert.equal(state.transientLoadError, true);
  assert.equal(state.confirmed, false);
  assert.equal(classifyLinkedInComposerState(state), "NOT_COMPOSER");
});

test("a partially loaded LinkedIn composer remains UNKNOWN until structural signals arrive", () => {
  const state = evaluateLinkedInComposer({ dialog: true, editor: true, close: true });
  assert.equal(state.confirmed, false);
  assert.equal(classifyLinkedInComposerState(state), "UNKNOWN");
});

test("LinkedIn composer confirmation accepts contenteditable plus audience and submit controls", () => {
  const state = evaluateLinkedInComposer({ dialog: true, editor: true, audience: true, post: true });
  assert.equal(state.mediaControl, false);
  assert.equal(state.confirmed, true);
  assert.equal(classifyLinkedInComposerState(state), "CONFIRMED");
});

test("LinkedIn readiness waits for an asynchronously mounted composer before classifying it", async () => {
  let phase = "feed";
  let composerChecks = 0;
  let triggerActivations = 0;
  const browser = {
    async listProfiles() { return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { return [{ id: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async evaluate(_id, expression) {
      if (expression.includes("const expectedPath")) return {
        linkedinDomain: true, loginRequired: false, securityChallenge: false,
        sessionAuthenticated: true, identityVerified: true, feedReachable: true
      };
      if (expression.includes("candidates[0].click()")) { triggerActivations += 1; phase = "loading"; return { clicked: true }; }
      if (expression.includes("const cancelButtons")) { phase = "feed"; return { closed: true }; }
      composerChecks += 1;
      if (phase === "loading" && composerChecks >= 2) phase = "composer";
      return phase === "composer"
        ? { linkedinDomain: true, route: false, routeCompatible: true, dialogCount: 1, editorCount: 1, audience: true, postButton: true, mediaControl: true, closeControl: true, advertisingControls: 0, confirmed: true }
        : { linkedinDomain: true, route: false, routeCompatible: false, dialogCount: 1, editorCount: 0, audience: false, postButton: false, mediaControl: false, closeControl: true, advertisingControls: 0, confirmed: false };
    },
    async snapshot() { return '- button "Start a post" [ref=e10]'; },
    async click() { assert.fail("composer trigger should use the verified direct DOM activation"); },
    async pressEscape() { assert.fail("verified readiness cleanup should use the empty-composer cancel control"); },
    async waitForFeed() {}
  };
  const result = await new LinkedInReadinessProvider(browser).checkReadiness({
    platform: "linkedin", profileId: "linkedin-profile-1", expectedIdentityUrl: "https://www.linkedin.com/in/test-owner"
  });
  assert.equal(result.state, "READY");
  assert.equal(triggerActivations, 1);
  assert.ok(composerChecks >= 2);
});

test("LinkedIn readiness reports UNKNOWN for a partially loaded composer after bounded wait", async () => {
  const browser = {
    async listProfiles() { return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { return [{ id: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async evaluate(_id, expression) {
      if (expression.includes("const expectedPath")) return {
        linkedinDomain: true, loginRequired: false, securityChallenge: false,
        sessionAuthenticated: true, identityVerified: true, feedReachable: true
      };
      if (expression.includes("candidates[0].click()")) return { clicked: true };
      return { linkedinDomain: true, route: false, routeCompatible: false, dialogCount: 1, editorCount: 1, audience: false, postButton: false, mediaControl: false, closeControl: true, advertisingControls: 0, confirmed: false };
    },
    async snapshot() { return '- button "Start a post" [ref=e10]'; },
    async click() {},
    async waitForExpression() { throw Object.assign(new Error("bounded wait timed out"), { code: "ORCA_COMMAND_FAILED" }); },
    async pressEscape() {},
    async waitForFeed() {}
  };
  const result = await new LinkedInReadinessProvider(browser).checkReadiness({
    platform: "linkedin", profileId: "linkedin-profile-1", expectedIdentityUrl: "https://www.linkedin.com/in/test-owner"
  });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.reasonCode, "composer_state_incomplete");
  assert.equal(result.retryable, true);
});

test("partially loaded LinkedIn page does not become authentication_required", async () => {
  const browser = {
    async listProfiles() { return [{ id: "linkedin-profile-1" }]; },
    async listTabs() { return [{ id: "page-1", profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }]; },
    async showTab(id) { return { pageId: id, profileId: "linkedin-profile-1", url: "https://www.linkedin.com/feed/" }; },
    async evaluate() { return { linkedinDomain: true, loginRequired: false, securityChallenge: false, sessionAuthenticated: false, identityVerified: false, feedReachable: true }; }
  };
  const result = await new LinkedInReadinessProvider(browser).checkReadiness({
    profileId: "linkedin-profile-1", expectedIdentityUrl: "https://www.linkedin.com/in/test-owner"
  });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.reasonCode, "linkedin_auth_state_ambiguous");
  assert.equal(result.recoveryClassification, "RECOVERABLE");
});

test("operator can force a fresh LinkedIn auth-detection check after a prior false-negative result", async () => {
  let calls = 0;
  const { service, post, accountId } = await fixture({ platform: "linkedin", provider: {
    async checkReadiness() {
      calls += 1;
      return calls === 1
        ? { state: "HUMAN_REQUIRED", reasonCode: "authentication_required", retryable: false, recoveryClassification: "HUMAN_REQUIRED" }
        : ready();
    }
  } });
  const before = await service.snapshot();
  assert.equal(calls, 1);
  assert.equal(before.executionAccounts.find((item) => item.accountId === accountId).health, "human_required");
  const result = await service.refreshCampaignJobReadiness(post.id, "operator", { force: true });
  const after = await service.snapshot();
  assert.equal(calls, 2);
  assert.equal(result.readinessState, "READY");
  assert.equal(after.posts.find((item) => item.id === post.id).readinessState, "READY");
  assert.equal(after.executionAccounts.find((item) => item.accountId === accountId).health, "healthy");
});

test("pending reconciliation selection includes registered and unregistered platforms", async () => {
  const { directory, service } = await fixture();
  try {
    await service.store.mutate("test", "mixed_platform_reconciliation_fixture", (state) => {
      state.executionRequests.push(
        { executionId: "exec-test-social", state: "SUBMIT_RESULT_UNKNOWN", reconciliationAttempts: 0, request: { platform: "test_social" } },
        { executionId: "exec-linkedin", state: "SUBMIT_SENT", reconciliationAttempts: 0, request: { platform: "linkedin" } },
        { executionId: "exec-done", state: "CONFIRMED", reconciliationAttempts: 0, request: { platform: "test_social" } }
      );
    });
    const pending = await service.pendingExecutionReconciliations({ minIntervalMs: 0 });
    assert.deepEqual(pending.map((item) => item.executionId).sort(), ["exec-linkedin", "exec-test-social"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

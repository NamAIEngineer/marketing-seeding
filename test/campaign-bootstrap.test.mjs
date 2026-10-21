import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { contentSha256 } from "../src/execution-contracts.mjs";
import { deriveBootstrapSchedule } from "../src/campaign-bootstrap.mjs";

async function fixture(t, { accountCount = 1, freshReadiness = true, readinessProvider = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const productRepo = path.join(root, "design-os-studio");
  await mkdir(productRepo);
  await writeFile(path.join(productRepo, "README.md"), [
    "Design OS Studio is a local-first design application.",
    "It solves slow browser design workflows by keeping the design file local.",
    "Native deterministic rendering and verified evidence make it useful for design teams.",
    "Designers and Figma users need a local design workflow."
  ].join(" "), "utf8");
  const now = new Date();
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), {
    readinessTtlMs: 300_000,
    productRepoRoots: [root],
    ...(readinessProvider ? {
      readinessProviders: {
        linkedin: {
          async checkReadiness(context) {
            const checkedAt = new Date().toISOString();
            return {
              state: "READY",
              checkedAt,
              expiresAt: new Date(Date.now() + 240_000).toISOString(),
              capabilities: { sessionAuthenticated: true, identityVerified: true, feedReachable: true, composerAvailable: true },
              evidenceReference: `fixture-readiness:${context.targetId}`
            };
          }
        }
      }
    } : {})
  });
  await service.init();
  const profiles = [];
  for (let index = 0; index < accountCount; index += 1) {
    const accountId = `linkedin-bootstrap-${index}`;
    const profileId = `11111111-2222-4333-8444-55555555555${index}`;
    profiles.push({ accountId, profileId });
    await service.registerExecutionAccount({
      platform: "linkedin", accountId, profileId, health: "healthy",
      identityReference: `https://www.linkedin.com/in/bootstrap-${index}`
    }, "operator");
    const readiness = freshReadiness ? {
      state: "ready", checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 240_000).toISOString(),
      checks: { sessionValid: true, composerCapable: true, platformAvailable: true }
    } : {
      state: "ready", checkedAt: new Date(now.getTime() - 600_000).toISOString(),
      expiresAt: new Date(now.getTime() - 300_000).toISOString(),
      checks: { sessionValid: true, composerCapable: true, platformAvailable: true }
    };
    await service.createTarget({
      channel: "linkedin", name: `Bootstrap feed ${index}`,
      url: "https://www.linkedin.com/feed/", accountId, profileId,
      status: "active", readiness
    }, "operator");
  }
  return { service, productRepo, now, profiles };
}

function brief(productRepo, now, extra = {}) {
  return {
    productRepo,
    name: "Design OS Studio launch",
    objective: "Introduce Design OS Studio to an authorized design audience",
    audience: ["UI/UX designers", "Figma users", "design engineers"],
    authorizationReference: "design-os-studio-bootstrap-test",
    callToAction: "Explore the local workflow and inspect the repository evidence.",
    now,
    ...extra
  };
}

test("zero-touch bootstrap derives exact authority and is idempotent", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.equal(first.readinessFresh, true);
  assert.equal(first.audienceSerialization, JSON.stringify(["design engineers", "figma users", "ui/ux designers"]));
  assert.equal(first.content.media.length, 0);
  assert.equal(first.content.payloadSha256, contentSha256((await service.snapshot()).posts[0].content));
  assert.ok(first.executionId);
  assert.ok(first.oneTimeWindowId);
  assert.ok(first.liveGrantId);

  const before = await service.snapshot();
  const second = await service.bootstrapAutonomousCampaign(brief(productRepo, new Date(now.getTime() + 120_000)));
  const after = await service.snapshot();
  assert.equal(second.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.equal(second.campaignId, first.campaignId);
  assert.equal(second.authorizationId, first.authorizationId);
  assert.equal(second.executionId, first.executionId);
  assert.equal(after.campaigns.length, before.campaigns.length);
  assert.equal(after.campaignAuthorizations.length, before.campaignAuthorizations.length);
  assert.equal(after.posts.length, before.posts.length);
  assert.equal(after.executionRequests.length, before.executionRequests.length);
  assert.equal(after.oneTimeExecutionWindows.length, before.oneTimeExecutionWindows.length);
  assert.equal(after.liveExecutionGrants.length, before.liveExecutionGrants.length);
  assert.equal(after.submissionUncertainties.length, before.submissionUncertainties.length);
});

test("zero-touch bootstrap derives a new content identity when high-level story policy changes", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now, {
    callToAction: "Review the verified repository evidence."
  }));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  const before = await service.snapshot();
  const firstRequest = before.executionRequests.find((item) => item.executionId === first.executionId);

  const second = await service.bootstrapAutonomousCampaign(brief(productRepo, new Date(now.getTime() + 60_000), {
    callToAction: "Inspect the local design workflow evidence."
  }));
  assert.equal(second.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.notEqual(second.authorizationId, first.authorizationId);
  assert.notEqual(second.content.contentHash, first.content.contentHash);

  const after = await service.snapshot();
  assert.equal(after.executionRequests.find((item) => item.executionId === first.executionId).executionId, firstRequest.executionId);
  assert.equal(after.stories.filter((item) => item.campaignId === first.campaignId).length, 2);
  assert.equal(after.submissionUncertainties.length, 0);
  assert.equal(after.executionRequests.filter((item) => item.jobId === second.postId && item.request?.dryRun !== true).length, 1);
});

test("zero-touch bootstrap resolves a product-only brief from a bounded repository root", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const result = await service.bootstrapAutonomousCampaign({
    product: "design-os-studio",
    name: "Design OS Studio launch",
    objective: "Introduce Design OS Studio to an authorized design audience",
    audience: ["UI/UX designers", "Figma users", "design engineers"],
    authorizationReference: "design-os-studio-product-only-test",
    now
  });
  assert.equal(result.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.equal((await service.snapshot()).campaigns[0].productRepo, await realpath(productRepo));
});

test("product-only bootstrap fails closed when the bounded repository match is ambiguous", async (t) => {
  const { now } = await fixture(t);
  // Use a separate root with two exact product directory matches and a fresh
  // runtime registry; no campaign or authority is written before resolution.
  const root = await mkdtemp(path.join(os.tmpdir(), "campaign-bootstrap-ambiguous-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const suffix of ["one", "two"]) {
    const repo = path.join(root, suffix, "design-os-studio");
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, "README.md"), "Design OS Studio evidence.", "utf8");
  }
  const ambiguous = new SeedingService(new JsonStore(path.join(root, "state.json")), { productRepoRoots: [path.join(root, "one"), path.join(root, "two")] });
  await ambiguous.init();
  const result = await ambiguous.bootstrapAutonomousCampaign({ productId: "design-os-studio", audience: ["designers"], authorizationReference: "ambiguous-test", now });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "PRODUCT_REPOSITORY_AMBIGUOUS");
  assert.equal((await ambiguous.snapshot()).campaigns.length, 0);
});

test("zero-touch bootstrap fails closed when account or target authority is missing or ambiguous", async (t) => {
  const missing = await fixture(t, { accountCount: 0 });
  const missingResult = await missing.service.bootstrapAutonomousCampaign(brief(missing.productRepo, missing.now));
  assert.equal(missingResult.status, "BLOCKED");
  assert.equal(missingResult.code, "AUTHORIZED_LINKEDIN_TARGET_MISSING");
  assert.equal(missingResult.blockers[0].classification, "EXTERNAL_HARD_BLOCKER");
  assert.equal((await missing.service.snapshot()).campaigns.length, 0);

  const ambiguous = await fixture(t, { accountCount: 2 });
  const ambiguousResult = await ambiguous.service.bootstrapAutonomousCampaign(brief(ambiguous.productRepo, ambiguous.now));
  assert.equal(ambiguousResult.status, "BLOCKED");
  assert.equal(ambiguousResult.code, "AUTHORIZED_LINKEDIN_TARGET_AMBIGUOUS");
  assert.equal(ambiguousResult.blockers[0].classification, "ACCOUNT_BLOCKER");
  assert.equal((await ambiguous.service.snapshot()).campaigns.length, 0);
});

test("bootstrap reports authorization quota blockers instead of readiness reason", async (t) => {
  const { service, productRepo, now } = await fixture(t, { readinessProvider: true });
  await service.store.mutate("quota-fixture", "install_same_day_account_activity", (state) => {
    const target = state.targets.find((item) => item.channel === "linkedin");
    state.posts.push({
      id: "quota-fixture-post",
      campaignId: "quota-fixture-campaign",
      targetId: target.id,
      status: "published",
      publishedAt: now.toISOString(),
      createdAt: now.toISOString()
    });
  });

  const result = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockers[0].code, "account_daily_limit_reached");
  assert.equal(result.blockers[0].classification, "AUTHORIZATION_BLOCKER");
  assert.match(result.blockers[0].message, /account daily post quota/i);

  const state = await service.snapshot();
  const post = state.posts.find((item) => item.id === result.postId);
  assert.ok(post);
  assert.ok(post.authorizationDecision.reasons.includes("account_daily_limit_reached"));
  assert.equal(state.posts.find((item) => item.id === "quota-fixture-post").status, "published");
});

test("stale readiness never produces live execution controls", async (t) => {
  const { service, productRepo, now } = await fixture(t, { freshReadiness: false });
  const result = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockers[0].classification, "RUNTIME_BLOCKER");
  const state = await service.snapshot();
  assert.equal(state.executionRequests.length, 0);
  assert.equal(state.oneTimeExecutionWindows.length, 0);
  assert.equal(state.liveExecutionGrants.length, 0);
  assert.equal(state.submissionUncertainties.length, 0);
});

test("expired bootstrap schedule renews exact authority without mutating historical execution", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  const before = await service.snapshot();
  const oldAuthorization = before.campaignAuthorizations.find((item) => item.id === first.authorizationId);
  const oldRequest = before.executionRequests.find((item) => item.executionId === first.executionId);
  await service.store.mutate("test", "test_expire_bootstrap_schedule", (state) => {
    const campaign = state.campaigns.find((item) => item.id === first.campaignId);
    campaign.autonomousBootstrap.schedule.validUntil = new Date(now.getTime() - 60_000).toISOString();
  });
  const renewed = await service.bootstrapAutonomousCampaign(brief(productRepo, now, { validityHours: 1 }));
  assert.equal(renewed.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.notEqual(renewed.authorizationId, first.authorizationId);
  assert.notEqual(renewed.executionId, first.executionId);
  const after = await service.snapshot();
  const historicalAuthorization = after.campaignAuthorizations.find((item) => item.id === first.authorizationId);
  assert.equal(historicalAuthorization.id, oldAuthorization.id);
  assert.equal(historicalAuthorization.validFrom, oldAuthorization.validFrom);
  assert.equal(historicalAuthorization.validUntil, oldAuthorization.validUntil);
  const historicalRequest = after.executionRequests.find((item) => item.executionId === first.executionId);
  assert.equal(historicalRequest.executionId, oldRequest.executionId);
  assert.equal(historicalRequest.request.authorization.authorizationId, oldRequest.request.authorization.authorizationId);
  assert.equal(after.campaignAuthorizations.filter((item) => item.campaignId === first.campaignId).length, 2);
  const campaign = after.campaigns.find((item) => item.id === first.campaignId);
  assert.equal(campaign.autonomousBootstrap.schedule.identity, renewed.schedule.identity);
  assert.ok(Date.parse(campaign.autonomousBootstrap.schedule.validUntil) > now.getTime());
  assert.equal(after.executionRequests.filter((item) => item.jobId === renewed.postId && item.request?.dryRun !== true).length, 2);
});

test("scheduler renews persisted bootstrap policy without a per-post brief", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  const before = await service.snapshot();
  const oldAuthorization = structuredClone(before.campaignAuthorizations.find((item) => item.id === first.authorizationId));

  // Model an expired pre-dispatch queue row. The historical authority remains
  // terminal and all old controls are removed only because no submit intent
  // ever existed; the scheduler must derive a new exact package from the
  // persisted high-level bootstrap policy.
  await service.store.mutate("test", "expire_pre_dispatch_bootstrap_policy", (state) => {
    const campaign = state.campaigns.find((item) => item.id === first.campaignId);
    const expiredSchedule = deriveBootstrapSchedule({ now: new Date(now.getTime() - 25 * 60 * 60_000), validityHours: 24, timezone: "UTC", quota: 1, concurrency: 1 });
    campaign.autonomousBootstrap.schedule = expiredSchedule;
    const authorization = state.campaignAuthorizations.find((item) => item.id === first.authorizationId);
    authorization.validUntil = expiredSchedule.validUntil;
    const post = state.posts.find((item) => item.id === first.postId);
    post.status = "blocked";
    post.executionState = null;
    post.authorizationDecision = { evaluatedAt: now.toISOString(), allowed: false, reasons: ["campaign_authorization_expired"] };
    state.executionRequests = state.executionRequests.filter((item) => item.jobId !== post.id);
    state.executionLeases = state.executionLeases.filter((item) => item.jobId !== post.id);
    state.oneTimeExecutionWindows = state.oneTimeExecutionWindows.filter((item) => item.jobId !== post.id);
    state.liveExecutionGrants = state.liveExecutionGrants.filter((item) => item.jobId !== post.id);
    state.executionReceipts = state.executionReceipts.filter((item) => item.jobId !== post.id);
    state.publicationAttempts = state.publicationAttempts.filter((item) => item.postId !== post.id);
    return state;
  });

  await service.queueDueCampaignJobs("campaign-queue-scheduler");
  const after = await service.snapshot();
  const renewed = after.campaigns.find((item) => item.id === first.campaignId).autonomousBootstrap.schedule;
  const active = after.campaignAuthorizations.filter((item) => item.campaignId === first.campaignId && item.status === "active");
  const post = after.posts.find((item) => item.id === first.postId);
  // The fixture and scheduler tick can fall in the same UTC minute, so the
  // deterministic schedule identity may remain stable while its expired
  // validity is renewed. The authority identity still changes and the new
  // bounded window must be in the future.
  assert.ok(Date.parse(renewed.validUntil) > Date.now());
  assert.equal(active.length, 1);
  assert.notEqual(active[0].id, oldAuthorization.id);
  assert.equal(post.campaignAuthorizationId, active[0].id);
  assert.equal(post.status, "queued");
  assert.equal(after.executionRequests.filter((item) => item.jobId === post.id && item.request?.dryRun !== true).length, 1);
  assert.equal(after.oneTimeExecutionWindows.filter((item) => item.jobId === post.id).length, 1);
  assert.equal(after.liveExecutionGrants.filter((item) => item.jobId === post.id).length, 1);
  const historical = after.campaignAuthorizations.find((item) => item.id === oldAuthorization.id);
  assert.equal(historical.status, "expired");
  assert.ok(Date.parse(historical.validUntil) < Date.now());

  const counts = {
    authorizations: after.campaignAuthorizations.length,
    posts: after.posts.length,
    executions: after.executionRequests.length,
    windows: after.oneTimeExecutionWindows.length,
    grants: after.liveExecutionGrants.length
  };
  await service.queueDueCampaignJobs("campaign-queue-scheduler-repeat");
  const repeated = await service.snapshot();
  assert.deepEqual({
    authorizations: repeated.campaignAuthorizations.length,
    posts: repeated.posts.length,
    executions: repeated.executionRequests.length,
    windows: repeated.oneTimeExecutionWindows.length,
    grants: repeated.liveExecutionGrants.length
  }, counts);
});

test("scheduler fails closed when persisted bootstrap account or target binding drifts", async (t) => {
  for (const mode of ["account", "target"]) {
    const { service, productRepo, now } = await fixture(t);
    const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
    assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
    await service.store.mutate("test", `expire_bootstrap_${mode}_binding`, (state) => {
      const campaign = state.campaigns.find((item) => item.id === first.campaignId);
      const expiredSchedule = deriveBootstrapSchedule({ now: new Date(now.getTime() - 25 * 60 * 60_000), validityHours: 24, timezone: "UTC", quota: 1, concurrency: 1 });
      campaign.autonomousBootstrap.schedule = expiredSchedule;
      const authorization = state.campaignAuthorizations.find((item) => item.id === first.authorizationId);
      authorization.validUntil = expiredSchedule.validUntil;
      if (mode === "account") {
        state.executionAccounts.find((item) => item.accountId === authorization.destinations[0].accountId).health = "quarantined";
      } else {
        state.targets.find((item) => item.id === campaign.autonomousBootstrap.targetId).url = "https://www.linkedin.com/feed/?drifted=1";
      }
      return state;
    });
    const before = await service.snapshot();
    await service.queueDueCampaignJobs(`campaign-queue-scheduler-${mode}`);
    const after = await service.snapshot();
    assert.equal(after.campaignAuthorizations.filter((item) => item.campaignId === first.campaignId && item.status === "active").length, 0, mode);
    assert.equal(after.executionRequests.length, before.executionRequests.length, mode);
    assert.equal(after.oneTimeExecutionWindows.length, before.oneTimeExecutionWindows.length, mode);
    assert.equal(after.liveExecutionGrants.length, before.liveExecutionGrants.length, mode);
  }
});

test("scheduler does not renew persisted bootstrap policy across an immutable UNKNOWN", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  await service.store.mutate("test", "expire_unknown_bootstrap_policy", (state) => {
    const campaign = state.campaigns.find((item) => item.id === first.campaignId);
    const expiredSchedule = deriveBootstrapSchedule({ now: new Date(now.getTime() - 25 * 60 * 60_000), validityHours: 24, timezone: "UTC", quota: 1, concurrency: 1 });
    campaign.autonomousBootstrap.schedule = expiredSchedule;
    const authorization = state.campaignAuthorizations.find((item) => item.id === first.authorizationId);
    authorization.validUntil = expiredSchedule.validUntil;
    const post = state.posts.find((item) => item.id === first.postId);
    post.status = "submit_result_unknown";
    post.executionState = "SUBMIT_RESULT_UNKNOWN";
    const execution = state.executionRequests.find((item) => item.executionId === first.executionId);
    execution.state = "SUBMIT_RESULT_UNKNOWN";
    execution.submitState = "UNKNOWN";
    state.submissionUncertainties.push({
      id: "scheduler-immutable-unknown", status: "UNKNOWN", jobId: post.id,
      campaignId: post.campaignId, executionId: first.executionId,
      platform: "linkedin", accountId: "linkedin-bootstrap-0", targetId: post.targetId,
      idempotencyKeys: [post.idempotencyKey], contentSha256: post.contentHash,
      detectedAt: now.toISOString(), reasonCode: "transport_ambiguous"
    });
    return state;
  });
  const before = await service.snapshot();
  await service.queueDueCampaignJobs("campaign-queue-scheduler");
  const after = await service.snapshot();
  assert.equal(after.campaignAuthorizations.filter((item) => item.campaignId === first.campaignId && item.status === "active").length, 0);
  assert.equal(after.executionRequests.length, before.executionRequests.length);
  assert.equal(after.submissionUncertainties.length, before.submissionUncertainties.length);
  assert.equal(after.submissionUncertainties[0].status, "UNKNOWN");
});

test("terminal bootstrap authorization renews from high-level input when the candidate never crossed dispatch", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  await service.store.mutate("test", "terminalize_bootstrap_authorization_without_submission", (state) => {
    const authorization = state.campaignAuthorizations.find((item) => item.id === first.authorizationId);
    authorization.status = "expired";
    authorization.expiredAt = now.toISOString();
    const post = state.posts.find((item) => item.id === first.postId);
    post.status = "blocked";
    post.executionState = null;
    post.authorizationDecision = { evaluatedAt: now.toISOString(), allowed: false, reasons: ["campaign_authorization_expired"] };
    state.executionRequests = state.executionRequests.filter((item) => item.jobId !== post.id);
    state.executionLeases = state.executionLeases.filter((item) => item.jobId !== post.id);
    state.oneTimeExecutionWindows = state.oneTimeExecutionWindows.filter((item) => item.jobId !== post.id);
    state.liveExecutionGrants = state.liveExecutionGrants.filter((item) => item.jobId !== post.id);
    state.executionReceipts = state.executionReceipts.filter((item) => item.jobId !== post.id);
    state.publicationAttempts = state.publicationAttempts.filter((item) => item.postId !== post.id);
  });

  const renewed = await service.bootstrapAutonomousCampaign(brief(productRepo, new Date()));
  assert.equal(renewed.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.notEqual(renewed.authorizationId, first.authorizationId);
  assert.notEqual(renewed.executionId, first.executionId);
  const after = await service.snapshot();
  const historical = after.campaignAuthorizations.find((item) => item.id === first.authorizationId);
  assert.equal(historical.status, "expired");
  const post = after.posts.find((item) => item.id === first.postId);
  assert.equal(post.campaignAuthorizationId, renewed.authorizationId);
  assert.equal(after.executionRequests.filter((item) => item.jobId === post.id && item.request?.dryRun !== true).length, 1);
});

test("terminal bootstrap authorization cannot renew a candidate with durable execution history", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  await service.store.mutate("test", "terminalize_bootstrap_authorization_with_request_history", (state) => {
    const authorization = state.campaignAuthorizations.find((item) => item.id === first.authorizationId);
    authorization.status = "expired";
    const post = state.posts.find((item) => item.id === first.postId);
    post.status = "blocked";
  });
  const result = await service.bootstrapAutonomousCampaign(brief(productRepo, new Date(now.getTime() + 60_000)));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "HISTORICAL_AUTHORIZATION_NOT_REUSED");
  const after = await service.snapshot();
  assert.equal(after.campaignAuthorizations.filter((item) => item.campaignId === first.campaignId).length, 1);
  assert.equal(after.executionRequests.filter((item) => item.executionId === first.executionId).length, 1);
});

test("bootstrap surfaces immutable historical UNKNOWN as a content identity blocker", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  await service.store.mutate("test", "mark_bootstrap_content_unknown", (state) => {
    const post = state.posts.find((item) => item.id === first.postId);
    post.status = "blocked";
    post.executionState = "SUBMIT_RESULT_UNKNOWN";
    const execution = state.executionRequests.find((item) => item.executionId === first.executionId);
    execution.state = "SUBMIT_RESULT_UNKNOWN";
    execution.submitState = "UNKNOWN";
    state.submissionUncertainties.push({
      id: "bootstrap-immutable-unknown",
      status: "UNKNOWN",
      jobId: post.id,
      campaignId: post.campaignId,
      executionId: first.executionId,
      platform: "linkedin",
      accountId: "linkedin-bootstrap-0",
      targetId: post.targetId,
      idempotencyKeys: [post.idempotencyKey],
      contentSha256: post.contentHash,
      detectedAt: now.toISOString(),
      reasonCode: "transport_ambiguous"
    });
  });
  const result = await service.bootstrapAutonomousCampaign(brief(productRepo, new Date(now.getTime() + 60_000)));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.blockers[0].code, "HISTORICAL_SUBMISSION_UNCERTAIN");
  assert.equal(result.blockers[0].classification, "STATE_BLOCKER");
  assert.equal(result.blockers[0].historicalExecutionId, first.executionId);
  const after = await service.snapshot();
  assert.equal(after.submissionUncertainties.filter((item) => item.status === "UNKNOWN").length, 1);
  assert.equal(after.executionRequests.filter((item) => item.executionId === first.executionId).length, 1);
});

test("bootstrap never reuses a cancelled request or its terminal controls", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  const before = await service.snapshot();
  const oldRequest = structuredClone(before.executionRequests.find((item) => item.executionId === first.executionId));
  const oldWindow = structuredClone(before.oneTimeExecutionWindows.find((item) => item.windowId === first.oneTimeWindowId));
  const oldGrant = structuredClone(before.liveExecutionGrants.find((item) => item.grantId === first.liveGrantId));

  const cancelled = await service.cancelExecutionRequest(first.executionId, {
    reason: "bootstrap regression fixture cancellation",
    operatorAuthorizationReference: "bootstrap-regression-fixture"
  }, "operator");
  assert.equal(cancelled.state, "CANCELLED_PRE_SUBMIT");
  await service.store.mutate("test", "expire_cancelled_bootstrap_controls", (state) => {
    const window = state.oneTimeExecutionWindows.find((item) => item.windowId === first.oneTimeWindowId);
    if (window) {
      window.status = "EXPIRED";
      window.expiredAt = new Date().toISOString();
    }
    const grant = state.liveExecutionGrants.find((item) => item.grantId === first.liveGrantId);
    if (grant) {
      grant.status = "EXPIRED";
      grant.expiredAt = new Date().toISOString();
    }
  });

  const renewed = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(renewed.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.notEqual(renewed.executionId, first.executionId);
  assert.notEqual(renewed.oneTimeWindowId, first.oneTimeWindowId);
  assert.notEqual(renewed.liveGrantId, first.liveGrantId);
  assert.equal(renewed.readinessFresh, true);

  const after = await service.snapshot();
  const historicalRequest = after.executionRequests.find((item) => item.executionId === first.executionId);
  const historicalWindow = after.oneTimeExecutionWindows.find((item) => item.windowId === first.oneTimeWindowId);
  const historicalGrant = after.liveExecutionGrants.find((item) => item.grantId === first.liveGrantId);
  assert.deepEqual(historicalRequest, { ...oldRequest, state: "CANCELLED_PRE_SUBMIT", executionPhase: "CANCELLED_PRE_SUBMIT", cancelledAt: historicalRequest.cancelledAt, cancelledBy: "operator", cancellationReason: "bootstrap regression fixture cancellation", operatorAuthorizationReference: "bootstrap-regression-fixture" });
  assert.equal(historicalWindow.status, "EXPIRED");
  assert.equal(historicalGrant.status, "EXPIRED");
  assert.equal(historicalWindow.binding, oldWindow.binding);
  assert.equal(historicalGrant.grantId, oldGrant.grantId);
  assert.equal(after.executionRequests.filter((item) => item.jobId === renewed.postId && item.request?.dryRun !== true).length, 2);
});

test("bootstrap renews a stale REQUEST_READY control package without mutating its historical request", async (t) => {
  const { service, productRepo, now } = await fixture(t, { readinessProvider: true });
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  const before = await service.snapshot();
  const oldRequest = structuredClone(before.executionRequests.find((item) => item.executionId === first.executionId));
  await service.store.mutate("test", "expire_stale_bootstrap_controls", (state) => {
    const request = state.executionRequests.find((item) => item.executionId === first.executionId);
    // Expire only the persisted control package's copy; the historical row is
    // expected to remain immutable even when its controls are stale.
    const window = state.oneTimeExecutionWindows.find((item) => item.windowId === first.oneTimeWindowId);
    window.status = "EXPIRED";
    window.expiredAt = new Date(now.getTime() - 500).toISOString();
    const grant = state.liveExecutionGrants.find((item) => item.grantId === first.liveGrantId);
    grant.status = "EXPIRED";
    grant.expiredAt = new Date(now.getTime() - 500).toISOString();
  });

  const renewed = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(renewed.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  assert.notEqual(renewed.executionId, first.executionId);
  assert.notEqual(renewed.oneTimeWindowId, first.oneTimeWindowId);
  assert.notEqual(renewed.liveGrantId, first.liveGrantId);
  const after = await service.snapshot();
  const historical = after.executionRequests.find((item) => item.executionId === first.executionId);
  assert.equal(historical.executionId, oldRequest.executionId);
  assert.equal(historical.createdAt, oldRequest.createdAt);
  assert.equal(historical.request.oneTimeWindow.windowId, oldRequest.request.oneTimeWindow.windowId);
  assert.equal(historical.request.liveGrant.grantId, oldRequest.request.liveGrant.grantId);
  assert.equal(historical.request.readiness.expiresAt, oldRequest.request.readiness.expiresAt);
  assert.equal(after.executionRequests.filter((item) => item.jobId === renewed.postId && item.request?.dryRun !== true).length, 2);
});

test("queue repairs a REQUEST_READY row whose live grant reference was lost", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  await service.store.mutate("test", "drop_bootstrap_grant_reference", (state) => {
    const row = state.executionRequests.find((item) => item.executionId === first.executionId);
    row.request.liveGrant = null;
    row.liveGrantId = null;
    state.liveExecutionGrants = state.liveExecutionGrants.filter((item) => item.grantId !== first.liveGrantId);
  });
  const before = await service.snapshot();
  const decisions = await service.queueAuthorizedCampaignJobs(first.campaignId, "scheduler");
  const after = await service.snapshot();
  const rows = after.executionRequests.filter((item) => item.jobId === first.postId && item.request?.dryRun !== true);
  assert.equal(decisions[0].status, "queued");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].executionId, first.executionId);
  assert.ok(rows[0].request.liveGrant?.grantId);
  assert.equal(after.liveExecutionGrants.filter((item) => item.jobId === first.postId && item.status === "ACTIVE").length, 1);
  assert.equal(after.oneTimeExecutionWindows.filter((item) => item.jobId === first.postId).length, before.oneTimeExecutionWindows.filter((item) => item.jobId === first.postId).length);
});

test("queue renews controls when the pending request window is stale", async (t) => {
  const { service, productRepo, now } = await fixture(t);
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  await service.store.mutate("test", "stale_bootstrap_window", (state) => {
    const window = state.oneTimeExecutionWindows.find((item) => item.windowId === first.oneTimeWindowId);
    window.status = "EXPIRED";
    window.expiredAt = new Date(now.getTime() - 1_000).toISOString();
    state.liveExecutionGrants = state.liveExecutionGrants.filter((item) => item.grantId !== first.liveGrantId);
    const row = state.executionRequests.find((item) => item.executionId === first.executionId);
    row.request.liveGrant = null;
    row.liveGrantId = null;
  });
  const result = await service.queueAuthorizedCampaignJobs(first.campaignId, "scheduler");
  const after = await service.snapshot();
  const rows = after.executionRequests.filter((item) => item.jobId === first.postId && item.request?.dryRun !== true);
  assert.equal(result[0].status, "queued");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[1].executionId, first.executionId);
  assert.ok(rows[1].request.liveGrant?.grantId);
});

test("bootstrap reuses the exact active grant/window owner when a newer stale sibling exists", async (t) => {
  const { service, productRepo, now } = await fixture(t, { readinessProvider: true });
  const first = await service.bootstrapAutonomousCampaign(brief(productRepo, now));
  assert.equal(first.status, "READY_FOR_AUTONOMOUS_EXECUTION");
  const before = await service.snapshot();
  const owner = before.executionRequests.find((item) => item.executionId === first.executionId);
  assert.equal(owner.state, "REQUEST_READY");
  assert.equal(owner.submitState, "NOT_STARTED");
  const stale = structuredClone(owner);
  stale.executionId = "stale-pre-submit-sibling";
  stale.attempt = owner.attempt + 1;
  stale.createdAt = new Date(now.getTime() + 1_000).toISOString();
  stale.request.executionId = stale.executionId;
  stale.request.createdAt = stale.createdAt;
  stale.request.liveGrant = null;
  stale.liveGrantId = null;
  await service.store.mutate("test", "install_stale_pre_submit_sibling", (state) => {
    state.executionRequests.push(stale);
  });

  const prepared = await service.prepareExecutionRequest(first.postId, "operator");
  const after = await service.snapshot();
  const savedOwner = after.executionRequests.find((item) => item.executionId === first.executionId);
  const savedStale = after.executionRequests.find((item) => item.executionId === stale.executionId);
  assert.equal(prepared.executionId, first.executionId);
  assert.equal(savedOwner.executionId, first.executionId);
  assert.equal(savedOwner.request.liveGrant.grantId, first.liveGrantId);
  assert.equal(savedOwner.request.oneTimeWindow.windowId, first.oneTimeWindowId);
  assert.deepEqual(savedStale, stale);
  assert.equal(after.executionRequests.filter((item) => item.jobId === first.postId && item.request?.dryRun !== true).length, 2);
});

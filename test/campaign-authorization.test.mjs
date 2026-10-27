import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { campaignAuthorizationFingerprint, campaignContentHash, campaignScopeFingerprint, evaluateCampaignAuthorization } from "../src/campaign-authorization.mjs";
import { approvalFingerprint, evaluateQueue } from "../src/guards.mjs";

async function campaignFixture({ channels = ["threads"], rateLimits = {}, allowRepeatSameContent = false, providerByChannel = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "campaign-auth-test-"));
  const productRepo = path.join(directory, "product-repo");
  await mkdir(productRepo);
  await writeFile(path.join(productRepo, "README.md"), "Fixture product evidence.\n", "utf8");
  const service = new SeedingService(new JsonStore(path.join(directory, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Scoped campaign", objective: "Validate campaign authorization", productRepo }, "operator");
  await service.updateCampaign(campaign.id, { status: "active" }, "operator");
  const checkedAt = new Date().toISOString();
  const targets = [];
  for (const channel of channels) {
    const accountId = `${channel}_fixture_account`;
    const profileId = channel === "linkedin" ? "11111111-2222-4333-8444-555555555555" : `${channel}-fixture-profile`;
    await service.registerExecutionAccount({
      platform: channel,
      accountId,
      profileId,
      ...(providerByChannel[channel] ? { provider: providerByChannel[channel], providerProfileId: profileId } : {}),
      expectedIdentityUrl: channel === "linkedin" ? "https://www.linkedin.com/in/fixture-owner" : undefined
    }, "operator");
    targets.push(await service.createTarget({
      channel,
      name: `${channel} fixture target`,
      url: channel === "linkedin" ? "https://www.linkedin.com/company/fixture" : "https://www.threads.net/@fixture",
      accountId,
      profileId,
      status: "active",
      readiness: {
        state: "ready",
        checkedAt,
        checks: { sessionValid: true, composerCapable: true, platformAvailable: true }
      }
    }, "operator"));
  }
  const authorization = async (contents, overrides = {}) => service.authorizeCampaign(campaign.id, {
    id: `auth-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    destinations: targets.map((target) => ({ platform: target.channel, accountId: target.accountId, profileId: target.profileId, targetId: target.id,
      ...(target.provider ? { provider: target.provider, providerProfileId: target.providerProfileId, identityReference: target.identityReference } : {}) })),
    approvedAssets: [],
    contentBoundary: {
      mode: "approved_copy_set",
      contentHashes: [...new Set(contents.map(campaignContentHash))],
      allowRepeatSameContent
    },
    audienceRules: { allowedAudiences: ["public"] },
    schedule: {
      timezone: "UTC",
      weekdays: [new Date().getUTCDay()],
      startLocal: "00:00",
      endLocal: "23:59"
    },
    rateLimits: {
      maxJobsPerAccountPerDay: 5,
      maxJobsPerCampaignPerDay: 10,
      maxConcurrency: 2,
      minIntervalMinutes: 0,
      ...rateLimits
    },
    allowLiveExecution: true,
    ...overrides
  }, "operator");
  return { directory, service, campaign, targets, authorization };
}

test("campaign authorization inherits to existing and new jobs with independent platform fan-out", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture({ channels: ["threads", "linkedin"] });
  const copy = "One approved campaign message.";
  const drafts = [];
  for (const target of targets) drafts.push(await service.createPost({
    campaignId: campaign.id, targetId: target.id, content: copy, audience: "public"
  }, "producer"));

  const grant = await authorization([copy]);
  const inherited = await service.snapshot();
  for (const draft of drafts) {
    const job = inherited.posts.find((item) => item.id === draft.id);
    assert.equal(job.campaignAuthorizationId, grant.id);
    assert.equal(job.status, "queued");
  }

  const newJob = await service.createPost({
    campaignId: campaign.id, targetId: targets[0].id, content: "Second approved message.", audience: "public"
  }, "producer");
  assert.equal(newJob.campaignAuthorizationId, grant.id);
  assert.equal(newJob.status, "blocked");
  assert.ok(newJob.authorizationDecision.reasons.includes("content_not_in_approved_copy_set"));
});

test("target readiness failure blocks only its job and a fresh target update requeues it", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture();
  const target = targets[0];
  const copy = "Readiness-gated campaign copy.";
  const draft = await service.createPost({ campaignId: campaign.id, targetId: target.id, content: copy, audience: "public" }, "producer");
  await service.updateTarget(target.id, { readiness: {
    state: "ready",
    checkedAt: new Date().toISOString(),
    checks: { sessionValid: false, composerCapable: true, platformAvailable: true }
  } }, "operator");
  await authorization([copy]);
  let job = (await service.snapshot()).posts.find((item) => item.id === draft.id);
  assert.equal(job.status, "blocked");
  assert.ok(job.authorizationDecision.reasons.includes("session_not_verified"));

  await service.updateTarget(target.id, { readiness: {
    state: "ready",
    checkedAt: new Date().toISOString(),
    checks: { sessionValid: true, composerCapable: true, platformAvailable: true }
  } }, "readiness-collector");
  job = (await service.snapshot()).posts.find((item) => item.id === draft.id);
  assert.equal(job.status, "queued");
});

test("publication idempotency reuses a legacy job without a stored key and blocks copy repeats by default", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture();
  const copy = "A repeated campaign message.";
  await authorization([copy]);
  const first = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  await service.store.mutate("fixture", "simulate_legacy_missing_key", (state) => {
    delete state.posts.find((item) => item.id === first.id).idempotencyKey;
  });
  const duplicate = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  assert.equal(duplicate.id, first.id);

  const distinctContentId = await service.createPost({
    campaignId: campaign.id,
    targetId: targets[0].id,
    content: copy,
    contentId: "different-content-id",
    audience: "public"
  }, "producer");
  assert.notEqual(distinctContentId.id, first.id);
  assert.equal(distinctContentId.status, "blocked");
  assert.ok(distinctContentId.authorizationDecision.reasons.includes("duplicate_content_for_account"));
});

test("pre-submit cancellation does not block a new exact authorization for the same copy", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture({ channels: ["linkedin"] });
  const copy = "A harmless single-shot LinkedIn launch copy.";
  await authorization([copy], {
    id: "cancelled-copy-auth",
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "cancelled-copy-regression"
  });
  const first = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  await service.store.mutate("fixture", "mark_exact_pre_submit_cancellation", (state) => {
    const post = state.posts.find((item) => item.id === first.id);
    post.status = "blocked";
    post.executionState = "CANCELLED_PRE_SUBMIT";
    state.executionRequests.push({ executionId: "cancelled-copy-execution", jobId: post.id, state: "CANCELLED_PRE_SUBMIT", submitState: "NOT_STARTED", request: { executionId: "cancelled-copy-execution", jobId: post.id, idempotencyKey: post.idempotencyKey } });
  });

  const secondAuth = await authorization([copy], {
    id: "fresh-copy-auth",
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "fresh-copy-regression"
  });
  await service.store.mutate("fixture", "bind_fresh_copy_authorization", (state) => {
    const post = state.posts.find((item) => item.id === first.id);
    post.id = "fresh-copy-post";
    post.campaignAuthorizationId = secondAuth.id;
    post.campaignAuthorizationBinding = secondAuth.binding;
    post.idempotencyKey = "fresh-copy-idempotency";
    post.status = "draft";
    post.executionState = undefined;
  });
  const state = await service.snapshot();
  const fresh = state.posts.find((item) => item.id === "fresh-copy-post");
  const decision = evaluateCampaignAuthorization(fresh, state);
  assert.equal(decision.reasons.includes("duplicate_content_for_account"), false);
});

test("blocked pre-dispatch draft without an execution request does not block a new exact authorization", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture({ channels: ["linkedin"] });
  const copy = "A harmless bootstrap copy that never reached dispatch.";
  await authorization([copy], {
    id: "blocked-bootstrap-auth",
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "blocked-bootstrap-regression"
  });
  const first = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  await service.store.mutate("fixture", "mark_blocked_pre_dispatch_without_request", (state) => {
    const post = state.posts.find((item) => item.id === first.id);
    post.status = "blocked";
    post.executionState = undefined;
    state.executionRequests = (state.executionRequests || []).filter((item) => item.jobId !== post.id);
  });

  const secondAuth = await authorization([copy], {
    id: "blocked-bootstrap-fresh-auth",
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "blocked-bootstrap-fresh-regression"
  });
  await service.store.mutate("fixture", "bind_blocked_pre_dispatch_fresh_authorization", (state) => {
    const post = state.posts.find((item) => item.id === first.id);
    post.id = "blocked-bootstrap-fresh-post";
    post.campaignAuthorizationId = secondAuth.id;
    post.campaignAuthorizationBinding = secondAuth.binding;
    post.idempotencyKey = "blocked-bootstrap-fresh-idempotency";
    post.status = "draft";
    delete post.executionState;
  });
  const state = await service.snapshot();
  const fresh = state.posts.find((item) => item.id === "blocked-bootstrap-fresh-post");
  const decision = evaluateCampaignAuthorization(fresh, state);
  assert.equal(decision.reasons.includes("duplicate_content_for_account"), false);
});

test("same-platform/account copy duplicates are blocked across different targets", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture();
  const secondTarget = await service.createTarget({
    channel: targets[0].channel,
    name: "Second fixture target for same account",
    url: "https://www.threads.net/@fixture/second",
    accountId: targets[0].accountId,
    profileId: targets[0].profileId,
    status: "active",
    readiness: {
      state: "ready",
      checkedAt: new Date().toISOString(),
      checks: { sessionValid: true, composerCapable: true, platformAvailable: true }
    }
  }, "operator");
  targets.push(secondTarget);
  const copy = "Do not repeat this across targets on one account.";
  await authorization([copy]);
  const first = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  await service.store.mutate("fixture", "simulate_same_account_published_copy", (state) => {
    const post = state.posts.find((item) => item.id === first.id);
    post.status = "published";
    post.publishedAt = new Date().toISOString();
  });

  const repeated = await service.createPost({
    campaignId: campaign.id,
    targetId: secondTarget.id,
    content: copy,
    contentId: "different-target-identity",
    audience: "public"
  }, "producer");
  assert.equal(repeated.status, "blocked");
  assert.ok(repeated.authorizationDecision.reasons.includes("duplicate_content_for_account"));
});

test("explicit campaign scope can allow repeating the same copy", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture({ allowRepeatSameContent: true });
  const copy = "An explicitly repeat-authorized message.";
  await authorization([copy]);
  const first = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  await service.store.mutate("fixture", "seed_past_published_copy", (state) => {
    const existing = state.posts.find((item) => item.id === first.id);
    existing.status = "published";
    existing.publishedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  });
  const repeated = await service.createPost({
    campaignId: campaign.id,
    targetId: targets[0].id,
    content: copy,
    contentId: "approved-repeat-content-id",
    audience: "public"
  }, "producer");
  assert.equal(first.status, "queued");
  assert.equal(repeated.status, "queued", JSON.stringify(repeated.authorizationDecision));
});

test("live execution requires explicit campaign scope and changes the authorization binding", async () => {
  const { service, campaign, targets } = await campaignFixture({ channels: ["linkedin"] });
  const defaultAuth = await service.authorizeCampaign(campaign.id, {
    id: "live-default-deny",
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    destinations: [{ platform: "linkedin", accountId: targets[0].accountId, profileId: targets[0].profileId, targetId: targets[0].id }],
    approvedAssets: [], contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash("authorized copy")] },
    audienceRules: { allowedAudiences: ["public"] },
    schedule: { timezone: "UTC", weekdays: [new Date().getUTCDay()], startLocal: "00:00", endLocal: "23:59" },
    rateLimits: { maxJobsPerAccountPerDay: 5, maxJobsPerCampaignPerDay: 5, maxConcurrency: 1, minIntervalMinutes: 0 }
  }, "operator");
  assert.equal(defaultAuth.allowLiveExecution, false);
  const liveAuth = await service.authorizeCampaign(campaign.id, {
    id: "live-explicitly-authorized",
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    destinations: [{ platform: "linkedin", accountId: targets[0].accountId, profileId: targets[0].profileId, targetId: targets[0].id }],
    approvedAssets: [], contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash("authorized copy")] },
    audienceRules: { allowedAudiences: ["public"] },
    schedule: { timezone: "UTC", weekdays: [new Date().getUTCDay()], startLocal: "00:00", endLocal: "23:59" },
    rateLimits: { maxJobsPerAccountPerDay: 5, maxJobsPerCampaignPerDay: 5, maxConcurrency: 1, minIntervalMinutes: 0 },
    allowLiveExecution: true
  }, "operator");
  assert.equal(liveAuth.allowLiveExecution, true);
  assert.notEqual(liveAuth.binding, defaultAuth.binding);
});

test("story policy is bounded, fingerprinted, and only valid for approved templates", async () => {
  const { service, campaign, targets, authorization, directory } = await campaignFixture();
  const copy = "Story policy scope copy.";
  await assert.rejects(authorization([copy], {
    contentBoundary: {
      mode: "approved_copy_set",
      contentHashes: [campaignContentHash(copy)],
      storyPolicy: { callToAction: "Read the evidence" }
    }
  }), /storyPolicy requires approved_template_set/);

  const productRepo = path.join(directory, "product-repo");
  const sourceHash = createHash("sha256").update(await readFile(path.join(productRepo, "README.md"))).digest("hex");
  await service.store.mutate("fixture", "seed_story_policy_source", (state) => {
    const current = state.campaigns.find((item) => item.id === campaign.id);
    current.productIntelligence = { repositoryInspection: { records: [{ locator: "README.md", sha256: sourceHash }] } };
    state.stories.push({ id: "story-policy-grounding", campaignId: campaign.id, groundingSources: [{ relativePath: "README.md", sha256: sourceHash }] });
    return state;
  });
  const input = {
    id: "story-policy-auth",
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    destinations: [{ platform: targets[0].channel, accountId: targets[0].accountId, profileId: targets[0].profileId, targetId: targets[0].id }],
    approvedAssets: [],
    contentBoundary: {
      mode: "approved_template_set",
      approvedClaims: [{ id: "what", text: "A bounded runtime.", sourceRefs: [{ relativePath: "README.md", sha256: sourceHash }] }],
      templates: [{ id: "template-1", platform: targets[0].channel, template: "{{claim:what}}" }],
      storyPolicy: { callToAction: "Read the evidence", disclosure: "Evidence-grounded draft.", language: "en" }
    },
    audienceRules: { allowedAudiences: ["builders"] },
    publicationVisibilityRules: { allowedVisibilities: ["PUBLIC"] },
    schedule: { timezone: "UTC", weekdays: [new Date().getUTCDay()], startLocal: "00:00", endLocal: "23:59" },
    rateLimits: { maxJobsPerAccountPerDay: 2, maxJobsPerCampaignPerDay: 2, maxConcurrency: 1, minIntervalMinutes: 0 },
    allowLiveExecution: true,
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "story-policy-standing"
  };
  const valid = await authorization([copy], {
    id: "story-policy-valid-auth",
    contentBoundary: input.contentBoundary,
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "story-policy-standing-valid"
  });
  assert.deepEqual(valid.contentBoundary.storyPolicy, input.contentBoundary.storyPolicy);
  assert.equal(valid.binding, (await service.snapshot()).campaignAuthorizations.find((item) => item.id === valid.id).binding);
  await assert.rejects(service.authorizeCampaign(campaign.id, { ...input, contentBoundary: {
    ...input.contentBoundary,
    storyPolicy: { callToAction: "token: leaked" }
  } }, "operator"), /credential\/session/);
  await assert.rejects(service.authorizeCampaign(campaign.id, { ...input, contentBoundary: {
    ...input.contentBoundary,
    storyPolicy: { callToAction: "x".repeat(301) }
  } }, "operator"), /bounded length/);
  assert.equal((await service.snapshot()).campaignAuthorizations.filter((item) => item.id === valid.id).length, 1);
});

test("campaign authorization profile binding can be corrected without changing its other scope", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture({ channels: ["linkedin"] });
  const target = targets[0];
  const content = "Bound LinkedIn validation copy";
  const post = await service.createPost({ campaignId: campaign.id, targetId: target.id, content, audience: "public" }, "operator");
  const auth = await authorization([content]);
  const nextProfileId = "1fe88615-ddcc-4d71-9cf6-821cf67b3b01";
  const account = (await service.snapshot()).executionAccounts[0];
  await service.registerExecutionAccount({ ...account, profileId: nextProfileId }, "operator");
  await service.updateTarget(target.id, { profileId: nextProfileId }, "operator");

  const before = (await service.snapshot()).campaignAuthorizations.find((item) => item.id === auth.id);
  const priorScope = structuredClone(before);
  priorScope.destinations[0].profileId = nextProfileId;
  delete priorScope.binding;
  delete priorScope.updatedAt;
  const updated = await service.updateCampaignAuthorizationProfileBinding(campaign.id, auth.id, target.id, nextProfileId, "operator");
  const after = await service.snapshot();
  const stored = after.campaignAuthorizations.find((item) => item.id === auth.id);
  const comparable = structuredClone(stored);
  delete comparable.binding;
  delete comparable.updatedAt;

  assert.deepEqual(comparable, priorScope);
  assert.equal(stored.binding, campaignAuthorizationFingerprint(stored));
  assert.equal(updated.destinations[0].profileId, nextProfileId);
  assert.equal(after.posts.find((item) => item.id === post.id).campaignAuthorizationBinding, stored.binding);
  assert.equal(evaluateCampaignAuthorization(after.posts.find((item) => item.id === post.id), after).reasons.includes("destination_not_authorized"), false);
});

test("provider-aware authorization rebinding requires and preserves the complete GPM binding", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture({ channels: ["linkedin"], providerByChannel: { linkedin: "gpm" } });
  const target = targets[0];
  const content = "GPM binding correction copy";
  await service.createPost({ campaignId: campaign.id, targetId: target.id, content, audience: "public" }, "producer");
  const auth = await authorization([content]);
  const before = await service.snapshot();
  const account = before.executionAccounts[0];
  const nextProfileId = "gpm-profile-rotated";
  await service.registerExecutionAccount({ ...account, profileId: nextProfileId, provider: "gpm", providerProfileId: nextProfileId }, "operator");
  await service.updateTarget(target.id, {
    profileId: nextProfileId, provider: "gpm", providerProfileId: nextProfileId,
    identityReference: account.identityReference
  }, "operator");
  await assert.rejects(
    service.updateCampaignAuthorizationProfileBinding(campaign.id, auth.id, target.id, nextProfileId, "operator"),
    /Provider-aware authorization rebinding requires/
  );
  const updated = await service.updateCampaignAuthorizationProfileBinding(campaign.id, auth.id, target.id, {
    profileId: nextProfileId, provider: "gpm", providerProfileId: nextProfileId, identityReference: account.identityReference
  }, "operator");
  assert.equal(updated.destinations[0].provider, "gpm");
  assert.equal(updated.destinations[0].providerProfileId, nextProfileId);
  assert.equal(updated.destinations[0].identityReference, account.identityReference);
});

test("concurrency limit carries across campaign authorization renewal", async () => {
  const copyOne = "First in-flight approved copy.";
  const copyTwo = "Second approved copy.";
  const { service, campaign, targets, authorization } = await campaignFixture({ rateLimits: { maxConcurrency: 1 } });
  const firstDraft = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copyOne, audience: "public" }, "producer");
  await authorization([copyOne]);
  await service.transitionPost(firstDraft.id, { status: "publishing" }, "worker");

  await authorization([copyOne, copyTwo]);
  const second = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copyTwo, audience: "public" }, "producer");
  assert.equal(second.status, "blocked");
  assert.ok(second.authorizationDecision.reasons.includes("campaign_concurrency_limit_reached"));
});

test("unknown quarantine releases inactive concurrency, preserves a same-identity hold, and still counts a live lease or worker", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture({ channels: ["threads", "linkedin"], rateLimits: { maxConcurrency: 1, minIntervalMinutes: 0 } });
  const copy = "Same authorized cross-platform campaign copy.";
  const posts = [];
  for (const target of targets) posts.push(await service.createPost({ campaignId: campaign.id, targetId: target.id, content: copy, audience: "public" }, "producer"));
  await authorization([copy], { rateLimits: { maxJobsPerAccountPerDay: 5, maxJobsPerCampaignPerDay: 10, maxConcurrency: 1, minIntervalMinutes: 0 } });
  await service.store.mutate("test", "legacy_publishing_with_active_worker", (state) => {
    const post = state.posts.find((item) => item.id === posts[0].id);
    post.status = "publishing";
    state.executionRequests = state.executionRequests.filter((item) => item.jobId !== post.id);
    state.executionRequests.push({ executionId: "legacy-worker", jobId: post.id, state: "EXECUTING" });
  });
  let state = await service.snapshot();
  let decision = evaluateCampaignAuthorization(state.posts.find((item) => item.id === posts[1].id), state);
  assert.ok(decision.reasons.includes("campaign_concurrency_limit_reached"));

  await service.store.mutate("test", "legacy_publishing_with_active_lease", (current) => {
    current.executionRequests = current.executionRequests.filter((item) => item.jobId !== posts[0].id);
    current.executionLeases.push({ id: "legacy-active-lease", jobId: posts[0].id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });
  state = await service.snapshot();
  decision = evaluateCampaignAuthorization(state.posts.find((item) => item.id === posts[1].id), state);
  assert.ok(decision.reasons.includes("campaign_concurrency_limit_reached"));

  await service.store.mutate("test", "quarantine_old_execution", (current) => {
    const post = current.posts.find((item) => item.id === posts[0].id);
    post.status = "submit_result_unknown";
    post.submissionUncertaintyId = "unknown-1";
    current.submissionUncertainties.push({ id: "unknown-1", status: "UNKNOWN", jobId: post.id, idempotencyKeys: [post.idempotencyKey], platform: targets[0].channel });
    current.executionLeases = current.executionLeases.filter((item) => item.jobId !== post.id);
  });
  state = await service.snapshot();
  decision = evaluateCampaignAuthorization(state.posts.find((item) => item.id === posts[1].id), state);
  assert.equal(decision.reasons.includes("campaign_concurrency_limit_reached"), false);
  const duplicate = { ...state.posts.find((item) => item.id === posts[1].id), id: "same-identity-copy", idempotencyKey: posts[0].idempotencyKey };
  assert.ok(evaluateQueue(duplicate, state).reasons.includes("submission_uncertain"));

  await service.store.mutate("test", "mark_quarantine_worker_active", (current) => {
    current.executionRequests.push({ executionId: "unknown-worker", jobId: posts[0].id, state: "EXECUTING" });
  });
  state = await service.snapshot();
  decision = evaluateCampaignAuthorization(state.posts.find((item) => item.id === posts[1].id), state);
  assert.ok(decision.reasons.includes("campaign_concurrency_limit_reached"));
  await service.store.mutate("test", "expire_worker_mark_active_lease", (current) => {
    current.executionRequests = current.executionRequests.filter((item) => item.executionId !== "unknown-worker");
    current.executionLeases.push({ id: "unknown-lease", jobId: posts[0].id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });
  state = await service.snapshot();
  decision = evaluateCampaignAuthorization(state.posts.find((item) => item.id === posts[1].id), state);
  assert.ok(decision.reasons.includes("campaign_concurrency_limit_reached"));
});

test("legacy approvedAt cannot substitute for missing campaign authorization once campaign scope exists", async () => {
  const { service, campaign, targets, authorization } = await campaignFixture();
  const copy = "Bound campaign authorization copy.";
  await authorization([copy]);
  const post = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  await service.store.mutate("fixture", "remove_campaign_binding", (state) => {
    const job = state.posts.find((item) => item.id === post.id);
    job.status = "draft";
    delete job.campaignAuthorizationId;
    delete job.campaignAuthorizationBinding;
    job.approvedAt = new Date().toISOString();
    job.approvalBinding = approvalFingerprint(job, state.targets.find((item) => item.id === job.targetId));
  });
  const state = await service.snapshot();
  const job = state.posts.find((item) => item.id === post.id);
  const decision = evaluateQueue(job, state);
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("campaign_authorization_missing"));
});

test("campaign daily and cadence limits remain enforced across authorized child jobs", async () => {
  {
    const { service, campaign, targets, authorization } = await campaignFixture({ rateLimits: { maxJobsPerAccountPerDay: 1 } });
    const firstCopy = "First daily-limited message.";
    const secondCopy = "Second daily-limited message.";
    await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: firstCopy, audience: "public" }, "producer");
    await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: secondCopy, audience: "public" }, "producer");
    await authorization([firstCopy, secondCopy]);
    const state = await service.snapshot();
    const second = state.posts.find((item) => item.content === secondCopy);
    assert.equal(second.status, "blocked");
    assert.ok(second.authorizationDecision.reasons.includes("account_daily_limit_reached"));
  }
  {
    const { service, campaign, targets, authorization } = await campaignFixture({ rateLimits: { minIntervalMinutes: 60 } });
    const firstCopy = "First cadence-limited message.";
    const secondCopy = "Second cadence-limited message.";
    await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: firstCopy, audience: "public" }, "producer");
    await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: secondCopy, audience: "public" }, "producer");
    await authorization([firstCopy, secondCopy]);
    const state = await service.snapshot();
    const second = state.posts.find((item) => item.content === secondCopy);
    assert.equal(second.status, "blocked");
    assert.ok(second.authorizationDecision.reasons.includes("campaign_minimum_interval_not_met"));
  }
});

async function crossCampaignQuotaFixture({ accountLimit = 5, campaignLimit = 5, minIntervalMinutes = 0, timezone = "Asia/Ho_Chi_Minh", priorStatus = "submit_result_unknown", priorAt = "2026-10-14T14:15:57.197Z" } = {}) {
  const { service, campaign, targets, authorization } = await campaignFixture({ rateLimits: { maxJobsPerAccountPerDay: accountLimit, maxJobsPerCampaignPerDay: campaignLimit, minIntervalMinutes } });
  const oldCopy = "Earlier campaign activity for account quota tests.";
  const nextCopy = "New campaign content for account quota tests.";
  const prior = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: oldCopy, audience: "public" }, "producer");
  await authorization([oldCopy]);
  const state = await service.snapshot();
  const priorPost = state.posts.find((item) => item.id === prior.id);
  priorPost.status = priorStatus;
  priorPost.publishedAt = priorStatus === "published" ? priorAt : undefined;
  const campaignB = { ...state.campaigns.find((item) => item.id === campaign.id), id: "campaign-quota-b", name: "Campaign B" };
  state.campaigns.push(campaignB);
  const authorizationB = structuredClone(state.campaignAuthorizations.find((item) => item.campaignId === campaign.id));
  authorizationB.id = "authorization-quota-b";
  authorizationB.campaignId = campaignB.id;
  authorizationB.campaignBinding = campaignScopeFingerprint(campaignB);
  authorizationB.schedule.timezone = timezone;
  authorizationB.schedule.weekdays = [0, 1, 2, 3, 4, 5, 6];
  authorizationB.schedule.startLocal = "00:00";
  authorizationB.schedule.endLocal = "23:59";
  authorizationB.validFrom = "2026-10-13T00:00:00.000Z";
  authorizationB.validUntil = "2026-10-16T00:00:00.000Z";
  authorizationB.contentBoundary.contentHashes = [campaignContentHash(nextCopy)];
  authorizationB.destinations = [{ ...authorizationB.destinations[0], targetId: targets[0].id }];
  authorizationB.binding = campaignAuthorizationFingerprint(authorizationB);
  state.campaignAuthorizations.push(authorizationB);
  const nextPost = {
    id: "job-quota-b", campaignId: campaignB.id, targetId: targets[0].id,
    campaignAuthorizationId: authorizationB.id, campaignAuthorizationBinding: authorizationB.binding,
    content: nextCopy, audience: "public", status: "draft", scheduledAt: "2026-10-14T14:30:00.000Z",
    idempotencyKey: "new-campaign-distinct-idempotency"
  };
  state.posts.push(nextPost);
  state.executionRequests = [{ jobId: priorPost.id, state: "SUBMIT_RESULT_UNKNOWN", submitIntentAt: priorAt, dispatchedAt: priorAt, attempt: 1 }];
  return { state, priorPost, nextPost, authorizationB, targets };
}

test("account daily quota and cadence carry across campaigns, while campaign quota stays scoped", async () => {
  const { state, nextPost } = await crossCampaignQuotaFixture({ accountLimit: 1, minIntervalMinutes: 60 });
  const decision = evaluateCampaignAuthorization(nextPost, state, new Date("2026-10-14T14:30:00.000Z"));
  assert.ok(decision.reasons.includes("account_daily_limit_reached"));
  assert.ok(decision.reasons.includes("campaign_minimum_interval_not_met"));
  assert.equal(decision.reasons.includes("campaign_daily_limit_reached"), false);
});

test("a different account is independent and a dry-run does not consume live account quota", async () => {
  const { state, nextPost, authorizationB, targets } = await crossCampaignQuotaFixture({ accountLimit: 1, minIntervalMinutes: 60 });
  const otherTarget = { ...targets[0], id: "target-other-account", accountId: "other-account", profileId: "other-profile" };
  state.targets.push(otherTarget);
  state.executionAccounts.push({ id: `${otherTarget.channel}:${otherTarget.accountId}`, platform: otherTarget.channel, accountId: otherTarget.accountId, profileId: otherTarget.profileId, status: "enabled" });
  authorizationB.destinations = [{ ...authorizationB.destinations[0], accountId: otherTarget.accountId, profileId: otherTarget.profileId, targetId: otherTarget.id }];
  authorizationB.binding = campaignAuthorizationFingerprint(authorizationB);
  nextPost.targetId = otherTarget.id;
  nextPost.campaignAuthorizationBinding = authorizationB.binding;
  const otherAccount = evaluateCampaignAuthorization(nextPost, state, new Date("2026-10-14T14:30:00.000Z"));
  assert.equal(otherAccount.reasons.includes("account_daily_limit_reached"), false);
  assert.equal(otherAccount.reasons.includes("campaign_minimum_interval_not_met"), false);
  const dryRun = evaluateCampaignAuthorization({ ...nextPost, targetId: targets[0].id, campaignAuthorizationBinding: authorizationB.binding }, state, new Date("2026-10-14T14:30:00.000Z"), { mode: "dry_run" });
  assert.equal(dryRun.reasons.includes("account_daily_limit_reached"), false);
  assert.equal(dryRun.reasons.includes("campaign_minimum_interval_not_met"), false);
});

test("unknown submit-boundary activity uses its actual local submit day across campaign boundaries", async () => {
  const { state, nextPost } = await crossCampaignQuotaFixture({ accountLimit: 1, minIntervalMinutes: 0, priorAt: "2026-10-14T16:55:57.197Z" });
  nextPost.scheduledAt = "2026-10-14T17:05:00.000Z";
  const nextDay = evaluateCampaignAuthorization(nextPost, state, new Date("2026-10-14T17:05:00.000Z"));
  assert.equal(nextDay.reasons.includes("account_daily_limit_reached"), false, "00:05 Asia/Ho_Chi_Minh is a new policy day");
  state.executionRequests[0].dispatchedAt = "2026-10-14T17:05:57.197Z";
  state.executionRequests[0].submitIntentAt = state.executionRequests[0].dispatchedAt;
  nextPost.scheduledAt = "2026-10-14T17:20:00.000Z";
  const sameDay = evaluateCampaignAuthorization(nextPost, state, new Date("2026-10-14T17:20:00.000Z"));
  assert.ok(sameDay.reasons.includes("account_daily_limit_reached"));
});

test("dry-run NOT_STARTED history does not consume account quota or cadence", async () => {
  const { state, nextPost } = await crossCampaignQuotaFixture({ accountLimit: 1, minIntervalMinutes: 60, priorStatus: "queued" });
  state.executionRequests[0].state = "DRY_RUN_COMPLETE";
  state.executionRequests[0].dryRun = true;
  const decision = evaluateCampaignAuthorization(nextPost, state, new Date("2026-10-14T14:30:00.000Z"));
  assert.equal(decision.reasons.includes("account_daily_limit_reached"), false);
  assert.equal(decision.reasons.includes("campaign_minimum_interval_not_met"), false);
});

test("standing autonomous authorization derives one bounded window and grant without per-post approval", async () => {
  const { service, campaign, targets } = await campaignFixture({ channels: ["threads"] });
  const copy = "Standing autonomous bounded copy.";
  const authorization = await service.authorizeCampaign(campaign.id, {
    id: "standing-autonomous-auth",
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    destinations: [{ platform: "threads", accountId: targets[0].accountId, profileId: targets[0].profileId, targetId: targets[0].id }],
    approvedAssets: [],
    contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash(copy)] },
    audienceRules: { allowedAudiences: ["public"] },
    schedule: { timezone: "UTC", weekdays: [new Date().getUTCDay()], startLocal: "00:00", endLocal: "23:59" },
    rateLimits: { maxJobsPerAccountPerDay: 3, maxJobsPerCampaignPerDay: 3, maxConcurrency: 1, minIntervalMinutes: 0 },
    allowLiveExecution: true,
    executionMode: "standing_autonomous",
    standingAuthorizationReference: "fixture-standing-campaign-authority"
  }, "operator");
  const post = await service.createPost({ campaignId: campaign.id, targetId: targets[0].id, content: copy, audience: "public" }, "producer");
  const state = await service.snapshot();
  const latest = state.posts.find((item) => item.id === post.id);
  const window = state.oneTimeExecutionWindows.find((item) => item.jobId === post.id);
  const grant = state.liveExecutionGrants.find((item) => item.jobId === post.id);
  const request = state.executionRequests.find((item) => item.jobId === post.id);
  assert.equal(authorization.executionMode, "standing_autonomous");
  assert.equal(latest.status, "queued");
  assert.equal(request.state, "REQUEST_READY");
  assert.equal(window.status, "RESERVED");
  assert.equal(grant.status, "ACTIVE");
  assert.equal(grant.boundExecutionId, request.executionId);
  assert.equal(grant.operatorAuthorizationReference, "fixture-standing-campaign-authority");
  const beforeWindows = state.oneTimeExecutionWindows.length;
  const beforeGrants = state.liveExecutionGrants.length;
  await service.queueAuthorizedCampaignJobs(campaign.id, "scheduler");
  const after = await service.snapshot();
  assert.equal(after.oneTimeExecutionWindows.length, beforeWindows);
  assert.equal(after.liveExecutionGrants.length, beforeGrants);
});

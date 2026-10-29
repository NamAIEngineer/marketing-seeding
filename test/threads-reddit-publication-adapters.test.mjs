import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PlatformAdapterRegistry } from "../src/platform-registries.mjs";
import {
  REDDIT_ADAPTER,
  THREADS_ADAPTER,
  ThreadsPublicationAdapter,
  RedditPublicationAdapter,
  getThreadsRedditAdapter,
  verifyThreadsRedditPublicationEvidence
} from "../src/threads-reddit-publication-adapters.mjs";
import { readinessBinding } from "../src/readiness.mjs";

const NOW = "2026-10-30T04:00:00.000Z";
const later = "2026-10-30T04:00:04.000Z";
const base = Object.freeze({
  threads: {
    identity: "https://threads.net/@fixture-owner",
    target: "https://threads.net/@fixture-topic"
  },
  reddit: {
    identity: "https://reddit.com/user/fixture_owner",
    target: "https://reddit.com/r/fixture"
  }
});

function request(platform, overrides = {}) {
  const content = overrides.content || "Fixture publication content";
  const digest = createHash("sha256").update(content).digest("hex");
  const target = overrides.target && typeof overrides.target === "object" ? overrides.target : { targetId: `${platform}-target`, url: overrides.target || base[platform].target };
  const readiness = overrides.readiness || { state: "READY", checkedAt: NOW, expiresAt: "2026-10-30T05:00:00.000Z" };
  readiness.binding ||= readinessBinding({ platform, accountId: "account-fixture", profileId: "profile-fixture", targetId: target.targetId, provider: "camoufox", providerProfileId: "profile-fixture", identityReference: base[platform].identity, targetUrl: target.url });
  return {
    schemaVersion: 1, executionId: `${platform}-exec`, jobId: `${platform}-job`, campaignId: "campaign-fixture",
    platform, provider: "camoufox", accountId: "account-fixture", profileId: "profile-fixture", providerProfileId: "profile-fixture",
    identityReference: base[platform].identity,
    target,
    audience: "community", publicationVisibility: "PUBLIC", content: { contentId: `${platform}-content`, sha256: digest, payload: content },
    media: [], authorization: { authorizationId: "authority-fixture", binding: "authority-binding" }, liveGrant: { grantId: "grant-fixture" },
    idempotencyKey: `${platform}-idempotency`, readiness, createdAt: NOW,
    ...overrides
  };
}

function fixtureBrowser(adapter, { rights = {}, composer = {}, verification = null, clicks = null } = {}) {
  const calls = [];
  const browser = {
    calls,
    async listTabs() { calls.push("listTabs"); return [{ id: "page-1", pageId: "page-1", profileId: "profile-fixture", url: base[adapter.platform].target }]; },
    async showTab(pageId) { calls.push(["showTab", pageId]); return { id: pageId, pageId, profileId: "profile-fixture", url: base[adapter.platform].target }; },
    async navigate(_pageId, target) { calls.push(["navigate", target]); },
    async snapshot() { calls.push("snapshot"); return "fixture"; },
    async resolve(_pageId, query) { calls.push(["resolve", String(query)]); return /file|media|upload|attach/i.test(String(query)) ? null : "submit-ref"; },
    async fill(_pageId, ref, value) { calls.push(["fill", ref, value]); },
    async evaluate(_pageId, expression) {
      calls.push(["evaluate", expression.slice(0, 35)]);
      if (expression.includes("owner_identity")) return { authenticated: true, authenticatedSurface: true, ownerSurface: true, identityReference: base[adapter.platform].identity, source: adapter.rule.identitySource, candidateCount: 1, ambiguous: false };
      if (expression.includes("posting_rights")) return { targetMatched: true, canPost: true, authenticatedSurface: true, submitControlEnabled: true, source: adapter.rule.rightsSource, ...rights };
      if (expression.includes("composer_state")) return { composerCount: 1, editorCount: 1, editorText: composer.editorText || "Fixture publication content", submitCount: 1, submitControls: [{ enabled: true, name: "Post" }], fileInputCount: 0, mediaPreviewReady: false, ...composer };
      if (expression.includes("publication_candidates")) return verification || [];
      throw new Error("unexpected expression");
    }
  };
  const transport = {
    runtimeIdentity: () => ({ transport: "fixture-camoufox", provider: "camoufox", providerVersion: "fixture" }),
    async click(target) { calls.push(["click", target.targetRef]); if (clicks) clicks.push(target); return { status: "COMMAND_COMPLETED" }; }
  };
  return { browser, transport, calls };
}

function account(platform) { return { platform, accountId: "account-fixture", profileId: "profile-fixture", identityReference: base[platform].identity, status: "enabled", health: "healthy" }; }

for (const [platform, Adapter] of [["threads", ThreadsPublicationAdapter], ["reddit", RedditPublicationAdapter]]) {
  test(`${platform} adapter satisfies registry contract and resolves from shared registry`, () => {
    const adapter = getThreadsRedditAdapter(platform);
    assert.equal(adapter.platform, platform);
    assert.equal(adapter.contractVersion, 1);
    const registry = new PlatformAdapterRegistry({ [platform]: adapter });
    assert.equal(registry.resolve(platform), adapter);
    assert.equal(new Adapter().platform, platform);
  });

  test(`${platform} fixture verifies publication only with independent exact evidence`, async () => {
    const adapter = new Adapter({ now: () => new Date(NOW) });
    const candidate = {
      postId: "post-fixture", permalink: platform === "threads" ? "https://threads.net/@fixture-topic/post/post-fixture" : "https://reddit.com/r/fixture/comments/post-fixture/title",
      authorMatched: true, authorPath: new URL(base[platform].identity).pathname, targetMatched: true, contentMatched: true,
      timestamp: "2026-10-30T04:00:02.000Z", timestampMatched: true
    };
    const observed = verifyThreadsRedditPublicationEvidence({ platform, identityReference: base[platform].identity, targetUrl: base[platform].target, contentHash: createHash("sha256").update("Fixture publication content").digest("hex"), submittedAt: NOW }, { candidate, contentHash: createHash("sha256").update("Fixture publication content").digest("hex"), observedAt: later });
    assert.equal(observed.state, "CONFIRMED");
    assert.equal(observed.publicationUrl, candidate.permalink);
    assert.equal(observed.publicationReference, candidate.postId);
  });

  test(`${platform} verifier rejects a wrong-target permalink even when targetMatched is supplied`, () => {
    const target = base[platform].target;
    const wrongPermalink = platform === "threads"
      ? "https://threads.net/@other-topic/post/post-fixture"
      : "https://reddit.com/r/other/comments/post-fixture/title";
    const contentHash = createHash("sha256").update("Fixture publication content").digest("hex");
    const result = verifyThreadsRedditPublicationEvidence({
      platform,
      identityReference: base[platform].identity,
      targetUrl: target,
      contentHash,
      submittedAt: NOW
    }, {
      observedAt: later,
      contentHash,
      candidate: {
        postId: "post-fixture",
        permalink: wrongPermalink,
        authorMatched: true,
        authorPath: new URL(base[platform].identity).pathname,
        targetMatched: true,
        contentMatched: true,
        timestamp: "2026-10-30T04:00:02.000Z",
        timestampMatched: true
      }
    });
    assert.equal(result.state, "UNKNOWN");
    assert.equal(result.verificationEvidence?.targetMatched, false);
  });

  test(`${platform} live submit records intent before click and returns UNKNOWN when verification is missing`, async () => {
    const clicks = [];
    const adapter = new Adapter({ now: () => new Date(NOW), verifier: { async verify() { return { state: "UNKNOWN", reasonCode: "publication_not_observed" }; } } });
    const fixture = fixtureBrowser(adapter, { clicks });
    const order = [];
    const result = await adapter.execute(request(platform), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: fixture.browser, transport: fixture.transport, beforeSubmitIntent: async () => { order.push("intent"); }, onSubmitSent: async () => { order.push("sent"); } });
    assert.equal(result.submitState, "UNKNOWN");
    assert.deepEqual(order, ["intent", "sent"]);
    assert.equal(clicks.length, 1);
    const retry = await adapter.execute(request(platform), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: fixture.browser, transport: fixture.transport, beforeSubmitIntent: async () => { throw new Error("must not retry"); }, onSubmitSent: async () => {} });
    assert.equal(retry.duplicate, true);
    assert.equal(clicks.length, 1);
  });

  test(`${platform} wrong account, wrong target and missing authority stop before click`, async () => {
    const adapter = new Adapter({ now: () => new Date(NOW) });
    const fixture = fixtureBrowser(adapter);
    const wrongAccount = await adapter.execute(request(platform, { idempotencyKey: `${platform}-wrong-account` }), { dryRun: false, liveEnabled: true, account: { ...account(platform), accountId: "other-account" }, browserSurface: fixture.browser, transport: fixture.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(wrongAccount.submitState, "FAILED");
    assert.equal(wrongAccount.reasonCode, "ACCOUNT_PROFILE_MISMATCH");
    const wrongTargetFixture = fixtureBrowser(adapter, { rights: { targetMatched: false } });
    const wrongTarget = await adapter.execute(request(platform, { idempotencyKey: `${platform}-wrong-target`, target: { targetId: `${platform}-target`, url: platform === "threads" ? "https://threads.net/@other-topic" : "https://reddit.com/r/other" } }), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: wrongTargetFixture.browser, transport: wrongTargetFixture.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(wrongTarget.submitState, "FAILED");
    assert.equal(wrongTarget.reasonCode, "TARGET_MISMATCH");
    const missingAuthority = await adapter.execute(request(platform, { idempotencyKey: `${platform}-missing-authority`, authorization: { authorizationId: "", binding: "" } }), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: fixture.browser, transport: fixture.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(missingAuthority.submitState, "FAILED");
    assert.equal(missingAuthority.reasonCode, "EXECUTION_REQUEST_INVALID");
  });

  test(`${platform} challenge and blocked posting rights never become READY`, async () => {
    const adapter = new Adapter({ now: () => new Date(NOW) });
    const challenge = fixtureBrowser(adapter);
    challenge.browser.evaluate = async (_page, expression) => expression.includes("owner_identity") ? { challengeDetected: true } : {};
    const challenged = await adapter.execute(request(platform), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: challenge.browser, transport: challenge.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(challenged.submitState, "FAILED");
    assert.equal(challenged.reasonCode, "SECURITY_CHALLENGE");
    const blocked = fixtureBrowser(adapter, { rights: { canPost: false, submitControlEnabled: false, membershipRequired: true, postingStatus: "blocked" } });
    const blockedResult = await adapter.execute(request(platform, { idempotencyKey: `${platform}-blocked` }), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: blocked.browser, transport: blocked.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(blockedResult.submitState, "FAILED");
    assert.equal(blockedResult.reasonCode, "TARGET_POSTING_BLOCKED");
  });
}

test("independent verifier rejects home-only or incomplete evidence without permalink fabrication", () => {
  const expected = { platform: "reddit", identityReference: base.reddit.identity, targetUrl: base.reddit.target, contentHash: "a".repeat(64), submittedAt: NOW };
  const result = verifyThreadsRedditPublicationEvidence(expected, { observedAt: later, contentHash: expected.contentHash, candidate: { authorMatched: true, authorPath: "/user/fixture_owner", contentMatched: true, targetMatched: true, timestampMatched: true } });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.publicationUrl, null);
  assert.equal(result.publicationReference, null);
});

test("adapter rejects secret-like request fields and never returns their values", async () => {
  const adapter = new ThreadsPublicationAdapter({ now: () => new Date(NOW) });
  const result = await adapter.execute({ ...request("threads"), password: "fixture-secret" }, { dryRun: false, liveEnabled: true, account: account("threads") });
  assert.equal(result.submitState, "FAILED");
  assert.equal(result.reasonCode, "SECRET_FIELD_REJECTED");
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PlatformAdapterRegistry } from "../src/platform-registries.mjs";
import {
  FACEBOOK_GROUP_ADAPTER,
  PRODUCT_HUNT_ADAPTER,
  INDIE_HACKERS_ADAPTER,
  FACEBOOK_PRODUCTHUNT_INDEPENDENT_ADAPTERS,
  getFacebookProductHuntIndieHackersAdapter,
  createFacebookProductHuntIndieHackersAdapter,
  verifyCamoufoxPublicationEvidence
} from "../src/facebook-producthunt-indiehackers-publication-adapters.mjs";
import { readinessBinding } from "../src/readiness.mjs";

const NOW = "2026-10-30T04:00:00.000Z";
const LATER = "2026-10-30T04:00:04.000Z";
const FIXTURES = Object.freeze({
  facebook_group: { identity: "https://facebook.com/fixture-owner", target: "https://facebook.com/groups/fixture-group", publication: "https://facebook.com/groups/fixture-group/posts/post-fixture" },
  product_hunt: { identity: "https://producthunt.com/@fixture-owner", target: "https://producthunt.com/posts/fixture-product", publication: "https://producthunt.com/posts/fixture-product/comments/comment-fixture" },
  indie_hackers: { identity: "https://indiehackers.com/u/fixture-owner", target: "https://indiehackers.com/groups/fixture-group", publication: "https://indiehackers.com/groups/fixture-group/posts/post-fixture" }
});
const CONTENT = "Fixture community publication";
const CONTENT_HASH = createHash("sha256").update(CONTENT).digest("hex");

function request(platform, overrides = {}) {
  const fixture = FIXTURES[platform];
  const target = overrides.target || { targetId: `${platform}-target`, url: fixture.target };
  const readiness = overrides.readiness || {
    state: "READY", checkedAt: NOW, expiresAt: "2026-10-30T05:00:00.000Z",
    binding: readinessBinding({ platform, accountId: "account-fixture", profileId: "profile-fixture", targetId: target.targetId, provider: "camoufox", providerProfileId: "profile-fixture", identityReference: fixture.identity, targetUrl: target.url })
  };
  return {
    schemaVersion: 1, executionId: `${platform}-exec`, jobId: `${platform}-job`, campaignId: "campaign-fixture",
    platform, provider: "camoufox", accountId: "account-fixture", profileId: "profile-fixture", providerProfileId: "profile-fixture",
    identityReference: fixture.identity, target, audience: "community", publicationVisibility: "PUBLIC",
    content: { contentId: `${platform}-content`, sha256: CONTENT_HASH, payload: CONTENT }, media: [],
    authorization: { authorizationId: "authority-fixture", binding: "authority-binding" }, liveGrant: { grantId: "grant-fixture" },
    idempotencyKey: `${platform}-idempotency`, readiness, createdAt: NOW, ...overrides
  };
}
function account(platform) {
  return { platform, accountId: "account-fixture", profileId: "profile-fixture", identityReference: FIXTURES[platform].identity, status: "enabled", health: "healthy" };
}
function fixture(adapter, { rights = {}, verification = null, clicks = [] } = {}) {
  const calls = [];
  const browser = {
    calls,
    async listTabs() { return [{ id: "page-1", pageId: "page-1", profileId: "profile-fixture", url: FIXTURES[adapter.platform].target }]; },
    async showTab(pageId) { return { id: pageId, pageId, profileId: "profile-fixture", url: FIXTURES[adapter.platform].target }; },
    async navigate(_pageId, target) { calls.push(["navigate", target]); },
    async snapshot() { return "fixture"; },
    async resolve(_pageId, query) { return /file|media|upload|attach/i.test(String(query)) ? null : "submit-ref"; },
    async fill(_pageId, ref, value) { calls.push(["fill", ref, value]); },
    async evaluate(_pageId, expression) {
      if (expression.includes("owner_identity")) return { authenticated: true, authenticatedSurface: true, ownerSurface: true, identityReference: FIXTURES[adapter.platform].identity, source: adapter.rule.identitySource, candidateCount: 1, ambiguous: false };
      if (expression.includes("posting_rights")) return { targetMatched: true, canPost: true, authenticatedSurface: true, submitControlEnabled: true, source: adapter.rule.rightsSource, rulesEvidencePresent: true, rulesEvidenceAccepted: true, rulesStatus: "reviewed", ...rights };
      if (expression.includes("composer_state")) return { composerCount: 1, editorCount: 1, editorText: CONTENT, submitCount: 1, submitControls: [{ enabled: true, name: "Post" }], fileInputCount: 0, mediaPreviewReady: false };
      if (expression.includes("publication_candidates")) return verification || [];
      throw new Error("unexpected expression");
    }
  };
  const transport = { runtimeIdentity: () => ({ transport: "fixture-camoufox", provider: "camoufox", providerVersion: "fixture" }), async click(target) { clicks.push(target); calls.push(["click", target.targetRef]); return { status: "COMMAND_COMPLETED" }; } };
  return { browser, transport, calls };
}

for (const [platform, adapter] of Object.entries(FACEBOOK_PRODUCTHUNT_INDEPENDENT_ADAPTERS)) {
  test(`${platform} exposes strict registry adapter and descriptor`, () => {
    assert.equal(adapter.platform, platform);
    assert.equal(adapter.contractVersion, 1);
    assert.equal(getFacebookProductHuntIndieHackersAdapter(platform), adapter);
    assert.equal(createFacebookProductHuntIndieHackersAdapter(platform).platform, platform);
    assert.equal(new PlatformAdapterRegistry({ [platform]: adapter }).resolve(platform), adapter);
  });
  test(`${platform} verifies exact independent permalink, author, target and content`, () => {
    const f = FIXTURES[platform];
    const result = verifyCamoufoxPublicationEvidence({ platform, identityReference: f.identity, targetUrl: f.target, contentHash: CONTENT_HASH, submittedAt: NOW }, { observedAt: LATER, contentHash: CONTENT_HASH, candidate: { postId: "post-fixture", permalink: f.publication, authorMatched: true, authorPath: new URL(f.identity).pathname, targetMatched: true, contentMatched: true, timestamp: LATER, timestampMatched: true } });
    assert.equal(result.state, "CONFIRMED");
    assert.equal(result.publicationUrl, f.publication);
  });
  test(`${platform} blocks missing rights/rules and challenges before click`, async () => {
    const underTest = createFacebookProductHuntIndieHackersAdapter(platform, { now: () => new Date(NOW) });
    const denied = fixture(underTest, { rights: { canPost: false, submitControlEnabled: false, rulesEvidencePresent: false, membershipRequired: true, postingStatus: "blocked" } });
    const result = await underTest.execute(request(platform), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: denied.browser, transport: denied.transport, beforeSubmitIntent: async () => assert.fail("intent must not run"), onSubmitSent: async () => assert.fail("sent must not run") });
    assert.equal(result.submitState, "FAILED");
    assert.equal(result.reasonCode, "TARGET_POSTING_BLOCKED");
    const challenge = fixture(underTest);
    challenge.browser.evaluate = async (_page, expression) => expression.includes("owner_identity") ? { challengeDetected: true } : {};
    const blocked = await underTest.execute(request(platform, { idempotencyKey: `${platform}-challenge` }), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: challenge.browser, transport: challenge.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(blocked.reasonCode, "SECURITY_CHALLENGE");
  });
  test(`${platform} orders durable intent before one click and suppresses duplicate retry`, async () => {
    const underTest = createFacebookProductHuntIndieHackersAdapter(platform, { now: () => new Date(NOW), verifier: { async verify() { return { state: "UNKNOWN", reasonCode: "publication_not_observed" }; } } });
    const clicks = [];
    const current = fixture(underTest, { clicks });
    const order = [];
    const result = await underTest.execute(request(platform), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: current.browser, transport: current.transport, beforeSubmitIntent: async () => order.push("intent"), beforeProviderSend: async () => order.push("provider"), onSubmitSent: async () => order.push("sent") });
    assert.equal(result.submitState, "UNKNOWN");
    assert.deepEqual(order, ["intent", "provider", "sent"]);
    assert.equal(clicks.length, 1);
    const retry = await underTest.execute(request(platform), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: current.browser, transport: current.transport, beforeSubmitIntent: async () => assert.fail("duplicate retry must not call intent"), onSubmitSent: async () => {} });
    assert.equal(retry.duplicate, true);
    assert.equal(clicks.length, 1);
  });
  test(`${platform} rejects wrong account/target and missing authority without clicking`, async () => {
    const underTest = createFacebookProductHuntIndieHackersAdapter(platform, { now: () => new Date(NOW) });
    const current = fixture(underTest);
    const wrongAccount = await underTest.execute(request(platform, { idempotencyKey: `${platform}-wrong-account` }), { dryRun: false, liveEnabled: true, account: { ...account(platform), accountId: "other-account" }, browserSurface: current.browser, transport: current.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(wrongAccount.reasonCode, "ACCOUNT_PROFILE_MISMATCH");
    const wrongTarget = fixture(underTest, { rights: { targetMatched: false } });
    const target = { targetId: `${platform}-other-target`, url: platform === "facebook_group" ? "https://facebook.com/groups/other-group" : platform === "product_hunt" ? "https://producthunt.com/posts/other-product" : "https://indiehackers.com/groups/other-group" };
    const wrong = await underTest.execute(request(platform, { idempotencyKey: `${platform}-wrong-target`, target }), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: wrongTarget.browser, transport: wrongTarget.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(wrong.reasonCode, "TARGET_MISMATCH");
    const noAuthority = await underTest.execute(request(platform, { idempotencyKey: `${platform}-no-authority`, authorization: { authorizationId: "", binding: "" } }), { dryRun: false, liveEnabled: true, account: account(platform), browserSurface: current.browser, transport: current.transport, beforeSubmitIntent: async () => {}, onSubmitSent: async () => {} });
    assert.equal(noAuthority.reasonCode, "EXECUTION_REQUEST_INVALID");
  });
}

test("community verifier leaves home-only evidence UNKNOWN without fabricated URL", () => {
  const f = FIXTURES.facebook_group;
  const result = verifyCamoufoxPublicationEvidence({ platform: "facebook_group", identityReference: f.identity, targetUrl: f.target, contentHash: CONTENT_HASH, submittedAt: NOW }, { observedAt: LATER, contentHash: CONTENT_HASH, candidate: { authorMatched: true, authorPath: "/fixture-owner", targetMatched: true, contentMatched: true, timestampMatched: true } });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.publicationUrl, null);
  assert.equal(result.publicationReference, null);
});

test("unsupported platform cannot silently fall back", () => assert.throws(() => createFacebookProductHuntIndieHackersAdapter("mastodon"), /not registered/));

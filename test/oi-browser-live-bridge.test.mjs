import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { createBrowserExecutionIntent, createLiveBrowserSnapshot, normalizeBrowserSnapshot } from "../src/oi-browser-integration.mjs";
import { createCamoufoxOiBrowserBridge } from "../src/oi-browser-camoufox-bridge.mjs";
import { evaluateQueue } from "../src/guards.mjs";

function fakeRuntime({ snapshot = '- button "Inspect rules" [ref=cf-0]\n- textbox "Search" [ref=cf-1]', url = "https://fixture.test/community", profileId = "profile-a" } = {}) {
  const transport = {
    runtimeIdentity: () => ({ transport: "camoufox-execution", provider: "camoufox", providerVersion: "156.0.1" })
  };
  const browserSurface = {
    async listTabs() { return [{ pageId: "page-1", browserPageId: "page-1", id: "page-1", profileId, url }]; },
    async showTab(pageId) { return { pageId, browserPageId: pageId, id: pageId, profileId, url }; },
    async snapshot() { return snapshot; }
  };
  return { transport, browserSurface };
}

test("LIVE_DOM accessibility snapshots keep semantic IDs, runtime refs, and reject duplicates", () => {
  const snapshot = createLiveBrowserSnapshot({
    url: "https://fixture.test/community",
    accessibilitySnapshot: '- button "Inspect rules" [ref=cf-0]\n- button "Inspect rules" [ref=cf-1]\n- textbox "Search" [ref=cf-2]',
    runtimeEvidence: { verified: true, provider: "camoufox", providerVersion: "156.0.1", evidenceRef: "dom:1" }
  });
  assert.equal(snapshot.source, "LIVE_DOM");
  assert.equal(snapshot.evidenceStatus, "RUNTIME_VERIFIED");
  assert.equal(snapshot.buttons.length, 0);
  assert.equal(snapshot.forms[0].runtimeRef, "cf-2");
  const normalized = normalizeBrowserSnapshot(snapshot);
  assert.equal(normalized.forms[0].runtimeRef, "cf-2");
  assert.throws(() => normalizeBrowserSnapshot({ ...snapshot, elements: [{ ...snapshot.elements[0], runtimeRef: null }] }), { code: "LIVE_DOM_RUNTIME_REF_REQUIRED" });
  assert.throws(() => createLiveBrowserSnapshot({
    url: "https://fixture.test/community",
    accessibilitySnapshot: '- button "Inspect" [ref=cf-0]',
    runtimeEvidence: { verified: false, provider: "camoufox", providerVersion: "156.0.1" }
  }), /LIVE_DOM/);
});

test("Camoufox bridge selects exact profile/page and persists LIVE_DOM through JsonStore", async () => {
  const runtime = fakeRuntime();
  const bridge = createCamoufoxOiBrowserBridge(runtime);
  const captured = await bridge.capture({ pageId: "page-1", profileId: "profile-a", evidenceContext: { executionId: "exec-1" } });
  assert.equal(captured.pageId, "page-1");
  assert.equal(captured.snapshot.source, "LIVE_DOM");
  assert.equal(captured.snapshot.executionId, "exec-1");
  assert.equal(captured.snapshot.forms[0].runtimeRef, "cf-1");
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-live-bridge-"));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const persisted = await service.recordBrowserSnapshot({
    snapshot: captured.snapshot,
    executionId: "exec-1",
    runtimeBinding: { ...runtime, pageId: captured.pageId, profileId: "profile-a" }
  });
  assert.equal(persisted.snapshot.source, "LIVE_DOM");
  const restarted = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await restarted.init();
  const dashboard = await restarted.dashboard();
  assert.equal(dashboard.oiBrowser.browser.liveVerified, 1);
  assert.equal(dashboard.oiBrowser.browser.recent[0].executionId, "exec-1");
  assert.equal(dashboard.oiBrowser.browser.recent[0].runtimeEvidence.provider, "camoufox");
});

test("service rejects an attached LIVE_DOM snapshot with no interactive evidence", async () => {
  const runtime = fakeRuntime({ snapshot: "- document \"Empty\"" });
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-live-empty-"));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const captured = await createCamoufoxOiBrowserBridge(runtime).capture({ pageId: "page-1", profileId: "profile-a" });
  await assert.rejects(() => service.recordBrowserSnapshot({
    snapshot: captured.snapshot,
    runtimeBinding: { ...runtime, pageId: "page-1", profileId: "profile-a" }
  }), { code: "LIVE_DOM_RUNTIME_UNVERIFIED" });
});

test("Camoufox bridge fails closed for ambiguous profile/page selection", async () => {
  const runtime = fakeRuntime();
  runtime.browserSurface.listTabs = async () => [
    { pageId: "page-1", profileId: "profile-a", url: "https://fixture.test/community" },
    { pageId: "page-2", profileId: "profile-a", url: "https://fixture.test/community" }
  ];
  const bridge = createCamoufoxOiBrowserBridge(runtime);
  await assert.rejects(() => bridge.capture({ profileId: "profile-a", url: "https://fixture.test/community" }), { code: "OI_BROWSER_PAGE_AMBIGUOUS" });
});

test("Camoufox bridge rebinds a changed transient runtime reference only when semantic identity is stable", async () => {
  const runtime = fakeRuntime({ snapshot: '- button "Inspect rules" [ref=cf-old]' });
  const bridge = createCamoufoxOiBrowserBridge(runtime);
  const captured = await bridge.capture({ pageId: "page-1", profileId: "profile-a" });
  const element = captured.snapshot.buttons[0];
  const intent = createBrowserExecutionIntent(captured.snapshot, { action: "CLICK", elementId: element.elementId });
  runtime.browserSurface.snapshot = async () => '- button "Inspect rules" [ref=cf-new]';
  const rebound = await bridge.resolveTarget({
    snapshot: captured.snapshot,
    intent,
    element,
    pageId: "page-1",
    profileId: "profile-a"
  });
  assert.equal(rebound.targetRef, "cf-new");
  assert.equal(rebound.targetIdentity, intent.targetIdentity);
  assert.ok(intent.semanticTargetIdentity);
  runtime.browserSurface.snapshot = async () => '- button "Different control" [ref=cf-newer]';
  await assert.rejects(() => bridge.resolveTarget({ snapshot: captured.snapshot, intent, element, pageId: "page-1", profileId: "profile-a" }), { code: "DOM_TARGET_IDENTITY_CHANGED" });
  runtime.browserSurface.snapshot = async () => '- button "Inspect rules" [ref=cf-newest]';
  const legacyIntent = { ...intent };
  delete legacyIntent.semanticTargetIdentity;
  await assert.rejects(() => bridge.resolveTarget({ snapshot: captured.snapshot, intent: legacyIntent, element, pageId: "page-1", profileId: "profile-a" }), { code: "DOM_TARGET_IDENTITY_CHANGED" });
});

test("Camoufox bridge accepts only the bounded LinkedIn feed redirect", async () => {
  const runtime = fakeRuntime({ url: "https://www.linkedin.com/feed/foryou/" });
  const bridge = createCamoufoxOiBrowserBridge(runtime);
  const captured = await bridge.capture({ profileId: "profile-a", url: "https://www.linkedin.com/feed/" });
  assert.equal(captured.tab.url, "https://www.linkedin.com/feed/foryou/");
  runtime.browserSurface.showTab = async (pageId) => ({ pageId, profileId: "other-profile", url: "https://www.linkedin.com/feed/foryou/" });
  await assert.rejects(() => bridge.capture({ pageId: "page-1", profileId: "profile-a", url: "https://www.linkedin.com/feed/" }), { code: "OI_BROWSER_PROFILE_MISMATCH" });
  runtime.browserSurface.showTab = async (pageId) => ({ pageId, profileId: "profile-a", url: "https://www.linkedin.com/messaging/" });
  await assert.rejects(() => bridge.capture({ pageId: "page-1", profileId: "profile-a", url: "https://www.linkedin.com/feed/" }), { code: "OI_BROWSER_PAGE_URL_MISMATCH" });
});

test("community membership policy blocks unknown and prohibited scoped targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-community-policy-"));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Community policy", objective: "Developer awareness", productRepo: root });
  const target = await service.createTarget({ channel: "threads", name: "Community B", url: "https://www.threads.net/@community-b", accountId: "account-b", status: "active" });
  const post = await service.createPost({ campaignId: campaign.id, targetId: target.id, content: "Technical education", contentId: "content-b" });
  await service.store.mutate("fixture", "community_policy_setup", (state) => {
    const current = state.posts.find((item) => item.id === post.id);
    current.approvedAt = new Date().toISOString();
    current.approvalBinding = "fixture";
    state.communityMemberships.push({ id: "membership-b", productRepo: state.campaigns.find((item) => item.id === post.campaignId).productRepo, platform: "threads", communityName: "Community B", communityUrl: target.url, membershipStatus: "joined", postStatus: "blocked", checkedAt: new Date().toISOString() });
  });
  const state = await service.snapshot();
  const blocked = evaluateQueue(state.posts.find((item) => item.id === post.id), state, new Date(), { mode: "dry_run" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reasons.includes("community_post_blocked") || blocked.reasons.includes("human_approval_required"), true);
});

test("community evidence expires and foreign product evidence cannot authorize a target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-community-scope-"));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Community freshness", objective: "Developer awareness", productRepo: root });
  const target = await service.createTarget({ channel: "threads", name: "Community A", url: "https://www.threads.net/@community-a", accountId: "account-a", status: "active" });
  const post = await service.createPost({ campaignId: campaign.id, targetId: target.id, content: "Technical education", contentId: "content-a" });
  await service.store.mutate("fixture", "community_scope_setup", (state) => {
    const current = state.posts.find((item) => item.id === post.id);
    current.approvedAt = "2026-10-28T00:00:00.000Z";
    current.approvalBinding = "fixture";
    state.communityMemberships.push({ id: "foreign", productRepo: "/foreign/product", platform: "threads", communityName: "Community A", communityUrl: target.url, membershipStatus: "joined", postStatus: "allowed", checkedAt: "2026-10-28T00:00:00.000Z", expiresAt: "2026-10-29T00:00:00.000Z" });
    state.communityMemberships.push({ id: "stale", productRepo: root, platform: "threads", communityName: "Community A", communityUrl: target.url, membershipStatus: "joined", postStatus: "allowed", checkedAt: "2026-10-26T00:00:00.000Z", expiresAt: "2026-10-27T00:00:00.000Z" });
  });
  const state = await service.snapshot();
  const decision = evaluateQueue(state.posts.find((item) => item.id === post.id), state, new Date("2026-10-28T12:00:00.000Z"), { mode: "dry_run" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasons.includes("community_membership_evidence_stale"), true);
  assert.equal(decision.reasons.includes("community_post_evidence_stale"), true);
});

test("community membership and post states fail closed for every non-allowed state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-community-states-"));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Community states", objective: "Developer awareness", productRepo: root });
  const cases = [
    ["unknown", "allowed"], ["pending", "allowed"], ["rejected", "allowed"], ["blocked", "allowed"],
    ["joined", "unknown"], ["joined", "manual_review"], ["joined", "blocked"]
  ];
  for (const [membershipStatus, postStatus] of cases) {
    const suffix = membershipStatus + "-" + postStatus;
    const target = await service.createTarget({ channel: "threads", name: "Community " + suffix, url: "https://www.threads.net/@" + suffix, accountId: "account-" + suffix, status: "active" });
    const post = await service.createPost({ campaignId: campaign.id, targetId: target.id, content: "Technical education " + suffix, contentId: "content-" + suffix });
    await service.store.mutate("fixture", "community_state_setup", (next) => {
      next.communityMemberships.push({ id: "membership-" + suffix, productRepo: root, platform: "threads", communityName: target.name, communityUrl: target.url, membershipStatus, postStatus, checkedAt: "2026-10-28T00:00:00.000Z", expiresAt: "2026-10-29T00:00:00.000Z" });
      const current = next.posts.find((item) => item.id === post.id);
      current.approvedAt = "2026-10-28T00:00:00.000Z";
      current.approvalBinding = "fixture";
    });
    const latest = await service.snapshot();
    const decision = evaluateQueue(latest.posts.find((item) => item.id === post.id), latest, new Date("2026-10-28T12:00:00.000Z"), { mode: "dry_run" });
    assert.equal(decision.allowed, false, suffix + " must fail closed");
    assert.equal(decision.reasons.some((reason) => reason.startsWith("community_membership_") || reason.startsWith("community_post_")), true);
  }
});

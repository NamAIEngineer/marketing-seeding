import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { deriveStrategyDecision } from "../src/strategy.mjs";
import { approvalFingerprint } from "../src/guards.mjs";
import {
  createBrowserExecutionIntent,
  normalizeBrowserSnapshot,
  createBrowserSnapshot,
  normalizeMemoryItem,
  recordMemoryObservation,
  retrieveBoundedMemory,
  consolidateMemory,
  routeAgentTask,
  executeBrowserIntent
} from "../src/oi-browser-integration.mjs";
import { BrowserInteractionFixture } from "./fixtures/browser-interaction-fixture.mjs";

function fixtureIntentTransport(fixture) {
  return {
    transportContractVersion: 1,
    requiresPreClickValidation: true,
    runtimeIdentity: () => ({ transport: "fixture-oi-intent", provider: "local-fixture", providerVersion: "1" }),
    assertPreClickValidation({ validate }) { if (typeof validate !== "function") throw new Error("validation required"); return true; },
    async click({ targetRef, targetIdentity }, { validate, onProviderCallStarted } = {}) {
      const preflight = await validate();
      onProviderCallStarted?.();
      return { ...fixture.click({ targetRef }), commandStatus: "COMMAND_COMPLETED", targetIdentity, preflight };
    }
  };
}

test("static BrowserSnapshot uses stable semantic element identity and fail-closed stale intents", () => {
  const snapshot = createBrowserSnapshot({
    url: "https://fixture.test/community",
    html: '<title>Fixture</title><h1>Community</h1><button aria-label="Inspect rules" id="rules">Rules</button><input aria-label="Search" name="q">'
  });
  assert.equal(snapshot.source, "STATIC_HTTP");
  assert.equal(snapshot.evidenceStatus, "FIXTURE_VERIFIED");
  assert.equal(snapshot.buttons.length, 1);
  assert.equal(snapshot.forms.length, 1);
  const button = snapshot.buttons[0];
  const intent = createBrowserExecutionIntent(snapshot, { action: "CLICK", elementId: button.elementId });
  assert.equal(intent.executionAllowed, false);
  assert.equal(intent.authorityRequired, true);
  assert.throws(() => createBrowserExecutionIntent(snapshot, { action: "CLICK", elementId: button.elementId, snapshotFingerprint: "stale" }), { code: "DOM_SNAPSHOT_STALE" });
  assert.deepEqual(createBrowserSnapshot({ url: "https://fixture.test/community", html: '<a href="javascript:alert(1)">unsafe</a><a href="data:text/html,x">data</a><a href="/safe">safe</a>' }).links.map((link) => link.href), [null, null, "https://fixture.test/safe"]);
  assert.throws(() => createBrowserSnapshot({ url: "https://fixture.test/community", source: "LIVE_DOM", html: "<button>Live</button>" }), { code: "LIVE_DOM_EVIDENCE_REQUIRED" });
  assert.throws(() => createBrowserSnapshot({ url: "https://fixture.test/community", source: "UNTRUSTED", html: "<button>Unknown</button>" }), { code: "DOM_SNAPSHOT_INVALID" });
});
test("persisted snapshots are normalized, fingerprint-bound, and redacted", () => {
  const raw = createBrowserSnapshot({ url: "https://fixture.test/community", html: '<title>Safe</title><button aria-label="Token token=secret">Go</button>' });
  const normalized = normalizeBrowserSnapshot(raw);
  assert.equal(normalized.fingerprint, raw.fingerprint);
  assert.match(normalized.buttons[0].label, /\[redacted\]/);
  assert.throws(() => normalizeBrowserSnapshot({ ...raw, fingerprint: "f".repeat(64) }), { code: "DOM_SNAPSHOT_FINGERPRINT_MISMATCH" });
  assert.throws(() => normalizeBrowserSnapshot({ ...raw, elements: [{ ...raw.elements[0], elementId: "forged-element" }] }), { code: "DOM_SNAPSHOT_IDENTITY_MISMATCH" });
});

test("browser intent crosses the validated fixture transport and verifies activation", async () => {
  const fixture = new BrowserInteractionFixture();
  const snapshot = createBrowserSnapshot({
    url: "https://fixture.test/community",
    html: '<title>Fixture</title><button aria-label="Inspect rules" id="rules">Rules</button>'
  });
  const element = snapshot.buttons[0];
  const intent = createBrowserExecutionIntent(snapshot, { action: "CLICK", elementId: element.elementId });
  const result = await executeBrowserIntent(snapshot, intent, {
    transport: fixtureIntentTransport(fixture),
    authority: { allowed: true, action: "CLICK", snapshotFingerprint: snapshot.fingerprint, targetIdentity: intent.targetIdentity, allowStaticFixture: true, externalSideEffects: false },
    resolveTarget: () => ({ targetRef: "safe-menu", targetIdentity: intent.targetIdentity }),
    validate: () => fixture.preflight(),
    observe: () => fixture.state(),
    verify: ({ before, after }) => ({ status: before.popoverOpen !== after.popoverOpen ? "CONTROL_ACTIVATED" : "CONTROL_NOT_OBSERVED", evidenceRefs: ["fixture:before", "fixture:after"] })
  });
  assert.equal(result.executionStatus, "COMMAND_COMPLETED");
  assert.equal(result.verification.status, "CONTROL_ACTIVATED");
  assert.equal(result.evidenceStatus, "FIXTURE_VERIFIED");
  assert.equal(result.externalSideEffects, false);
  assert.equal(fixture.clicks, 1);
  await assert.rejects(() => executeBrowserIntent(snapshot, intent, {
    transport: fixtureIntentTransport(fixture), authority: { allowed: true, action: "CLICK", allowStaticFixture: false, externalSideEffects: false }, validate: () => fixture.preflight(), verify: () => ({ status: "CONTROL_ACTIVATED" })
  }), { code: "STATIC_SNAPSHOT_EXECUTION_BLOCKED" });
});

test("TYPE intent rejects a transient value that does not match its durable binding", async () => {
  const snapshot = createBrowserSnapshot({
    url: "https://fixture.test/community",
    html: '<input aria-label="Search" name="q">'
  });
  const intent = createBrowserExecutionIntent(snapshot, { action: "TYPE", elementId: snapshot.forms[0].elementId, value: "approved query" });
  await assert.rejects(() => executeBrowserIntent(snapshot, { ...intent, value: "different query" }, {
    authority: { allowed: true, action: "TYPE", snapshotFingerprint: snapshot.fingerprint, targetIdentity: intent.targetIdentity, allowStaticFixture: true, externalSideEffects: false },
    transport: { type: async () => ({ status: "COMMAND_COMPLETED" }) },
    validate: () => true,
    verify: () => ({ status: "CONTROL_ACTIVATED" })
  }), { code: "BROWSER_TRANSIENT_VALUE_MISMATCH" });
});

test("memory observation deduplicates duplicate polls, consolidates distinct publications, and scopes retrieval", () => {
  const state = { memoryItems: [] };
  const input = normalizeMemoryItem({ kind: "OBSERVATION", scope: { campaignId: "campaign-x", communityId: "community-a" }, content: "technical educational content accepted", source: "fixture-community", evidenceRefs: ["snapshot-1"], publicationId: "fixture-publication-1", pollId: "poll-1", confidence: 0.8, evidenceStatus: "VERIFIED", decisionHint: "educational" });
  const first = recordMemoryObservation(state, input, { now: "2026-10-27T00:00:00.000Z" });
  const second = recordMemoryObservation(state, { ...input, pollId: "poll-2", evidenceRefs: ["snapshot-2"] }, { now: "2026-10-27T00:01:00.000Z" });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(state.memoryItems.length, 1);
  assert.equal(state.memoryItems[0].supportCount, 1);
  const third = recordMemoryObservation(state, { ...input, publicationId: "fixture-publication-2", evidenceRefs: ["snapshot-3"] }, { now: "2026-10-27T00:02:00.000Z" });
  assert.equal(third.deduplicated, true);
  assert.equal(state.memoryItems[0].supportCount, 2);
  const learnings = consolidateMemory(state, { scope: { campaignId: "campaign-x", communityId: "community-a" }, now: new Date("2026-10-27T00:02:00.000Z") });
  assert.equal(learnings.length, 1);
  assert.equal(learnings[0].kind, "LEARNING");
  assert.equal(learnings[0].support.sampleSupport, 2);
  assert.equal(retrieveBoundedMemory(state, { scope: { campaignId: "campaign-x", communityId: "community-b" } }).length, 0);
});

test("provider router distinguishes unavailable, timeout, invalid result, and success without leaking output", async () => {
  const timeout = await routeAgentTask({ capability: "research", privacyClass: "local" }, {
    timeoutMs: 5,
    providers: [{ id: "slow", capabilities: ["research"], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: ({ signal }) => new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "AbortError" }))); }) } }]
  });
  assert.equal(timeout.status, "FAILED");
  assert.equal(timeout.failure, "timeout");
  const fallback = await routeAgentTask({ capability: "research", privacyClass: "local" }, {
    providers: [
      { id: "bad", capabilities: ["research"], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: true, output: "" }) } },
      { id: "good", capabilities: ["research"], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: true, output: "community rules" }) } }
    ]
  });
  assert.equal(fallback.status, "SUCCEEDED");
  assert.equal(fallback.providerId, "good");
  assert.equal(fallback.output, "community rules");
  assert.equal(fallback.attempted[0].status, "invalid_result");
  const nonzero = await routeAgentTask({ capability: "research", privacyClass: "local" }, {
    providers: [{ id: "nonzero", capabilities: ["research"], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: false, exitCode: 7, output: "provider secret" }) } }]
  });
  assert.equal(nonzero.status, "FAILED");
  assert.equal(nonzero.failure, "nonzero");
  assert.equal(nonzero.attempted[0].reason, "exit_code_7");
  const preferred = await routeAgentTask({ capability: "research", privacyClass: "local", tools: ["dom"] }, {
    providers: [
      { id: "expensive", capabilities: ["research"], tools: ["dom"], costClass: "high", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: true, output: "expensive" }) } },
      { id: "cheap", capabilities: ["research"], tools: ["dom"], costClass: "low", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: true, output: "cheap" }) } }
    ]
  });
  assert.equal(preferred.providerId, "cheap");
  const missingTool = await routeAgentTask({ capability: "research", privacyClass: "local", tools: ["dom"] }, {
    providers: [{ id: "no-dom", capabilities: ["research"], tools: [], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: true, output: "should-not-run" }) } }]
  });
  assert.equal(missingTool.failure, "unavailable");
  const reasoning = await routeAgentTask({ capability: "research", privacyClass: "local", reasoningClass: "deep" }, {
    providers: [
      { id: "shallow", capabilities: ["research"], reasoningClasses: ["shallow"], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: true, output: "wrong" }) } },
      { id: "deep", capabilities: ["research"], reasoningClasses: ["deep"], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async ({ task }) => ({ ok: task.reasoningClass === "deep", output: "deep result" }) } }
    ]
  });
  assert.equal(reasoning.providerId, "deep");
});

test("service persists memory and snapshots in canonical JsonStore and survives restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-native-"));
  const file = path.join(root, "state.json");
  const service = new SeedingService(new JsonStore(file));
  await service.init();
  const observed = await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "c1" }, content: "Community A accepts technical education", source: "fixture", evidenceRefs: ["e1"], publicationId: "fixture-publication-1", evidenceStatus: "VERIFIED" });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "c1" }, content: "Community A accepts technical education", source: "fixture", evidenceRefs: ["e2"], publicationId: "fixture-publication-2", evidenceStatus: "VERIFIED" });
  const consolidated = await service.consolidateOiMemory({ scope: { campaignId: "c1" } });
  assert.equal(consolidated.learnings.length, 1);
  const recorded = await service.recordBrowserSnapshot({ url: "https://fixture.test/a", html: '<title>A</title><button aria-label="Inspect">Inspect</button>' });
  const intent = await service.createBrowserIntent({ action: "CLICK", snapshotFingerprint: recorded.snapshot.fingerprint, elementId: recorded.snapshot.buttons[0].elementId });
  assert.equal(intent.executionAllowed, false);
  const restarted = new SeedingService(new JsonStore(file));
  await restarted.init();
  const memory = await restarted.retrieveOiMemory({ scope: { campaignId: "c1" } });
  assert.equal(memory.items.length, 2);
  const dashboard = await restarted.dashboard();
  assert.equal(dashboard.oiBrowser.memory.learnings, 1);
  assert.equal(dashboard.oiBrowser.browser.totalSnapshots, 1);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.memoryItems.length, 2);
  assert.equal(persisted.browserSnapshots.length, 1);
  assert.ok(observed.item.id);
});

test("service rejects caller-claimed live DOM evidence without runtime hooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-live-boundary-"));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const live = createBrowserSnapshot({
    url: "https://fixture.test/community",
    source: "LIVE_DOM",
    runtimeEvidence: { verified: true, provider: "claimed", providerVersion: "claimed" },
    html: '<button aria-label="Inspect">Inspect</button>'
  });
  await assert.rejects(() => service.recordBrowserSnapshot({ snapshot: live }), { code: "LIVE_DOM_RUNTIME_UNVERIFIED" });
});

test("service persists and idempotently replays a verified fixture browser intent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-execution-"));
  const file = path.join(root, "state.json");
  const service = new SeedingService(new JsonStore(file));
  await service.init();
  const recorded = await service.recordBrowserSnapshot({ url: "https://fixture.test/community", html: '<button aria-label="Inspect">Inspect</button>' });
  const intent = await service.createBrowserIntent({ action: "CLICK", snapshotFingerprint: recorded.snapshot.fingerprint, elementId: recorded.snapshot.buttons[0].elementId });
  const fixture = new BrowserInteractionFixture();
  const input = {
    intent, snapshotFingerprint: recorded.snapshot.fingerprint,
    authority: { allowed: true, action: "CLICK", snapshotFingerprint: recorded.snapshot.fingerprint, targetIdentity: intent.targetIdentity, allowStaticFixture: true, externalSideEffects: false },
    transport: fixtureIntentTransport(fixture), resolveTarget: () => ({ targetRef: "safe-menu", targetIdentity: intent.targetIdentity }),
    validate: () => fixture.preflight(), observe: () => fixture.state(),
    verify: ({ before, after }) => ({ status: before.popoverOpen !== after.popoverOpen ? "CONTROL_ACTIVATED" : "CONTROL_NOT_OBSERVED", evidenceRefs: ["fixture:execution-before", "fixture:execution-after"] })
  };
  const first = await service.executeBrowserIntent(input);
  const second = await service.executeBrowserIntent(input);
  assert.equal(first.execution.executionStatus, "COMMAND_COMPLETED");
  assert.equal(second.replayed, true);
  assert.equal(fixture.clicks, 1);
  const restarted = new SeedingService(new JsonStore(file));
  await restarted.init();
  const dashboard = await restarted.dashboard();
  assert.equal(dashboard.oiBrowser.executions.total, 1);
});

test("verified learning changes the next production strategy candidate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-strategy-"));
  const productRepo = path.join(root, "repo");
  await (await import("node:fs/promises")).mkdir(productRepo);
  await (await import("node:fs/promises")).writeFile(path.join(productRepo, "README.md"), "grounded product", "utf8");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Memory strategy", objective: "Developer awareness", productRepo });
  const targetA = await service.createTarget({ channel: "threads", name: "Community A", url: "https://www.threads.net/@a", accountId: "account-a", status: "active" });
  const targetB = await service.createTarget({ channel: "threads", name: "Community B", url: "https://www.threads.net/@b", accountId: "account-b", status: "active" });
  const postA = await service.createPost({ campaignId: campaign.id, targetId: targetA.id, content: "Technical education A", contentId: "content-a" });
  const postB = await service.createPost({ campaignId: campaign.id, targetId: targetB.id, content: "Technical education B", contentId: "content-b" });
  await service.store.mutate("fixture", "strategy_memory_setup", (state) => {
    const current = state.campaigns.find((item) => item.id === campaign.id);
    current.productIntelligence = {
      handoff: { readinessStatus: "READY" },
      document: Object.fromEntries(["WHAT_IS_IT", "WHAT_PROBLEM_DOES_IT_SOLVE", "WHY_IS_IT_BETTER", "WHO_NEEDS_IT"].map((field) => [field, { text: field, evidenceRefs: ["fixture:product"] }]))
    };
    for (const post of state.posts.filter((item) => [postA.id, postB.id].includes(item.id))) {
      post.approvedAt = new Date().toISOString();
      post.approvalBinding = approvalFingerprint(post, state.targets.find((target) => target.id === post.targetId));
    }
  });
  const before = deriveStrategyDecision(await service.snapshot(), campaign.id, { now: new Date("2026-10-27T01:00:00Z") });
  assert.equal(before.action, "publish");
  const preferredTargetId = before.candidateId === postA.id ? targetB.id : targetA.id;
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: campaign.id }, content: "verified community fit", source: "fixture-community", evidenceRefs: ["publication:fixture-1"], publicationId: "fixture-publication-1", evidenceStatus: "VERIFIED", decisionHint: `prefer_target:${preferredTargetId}` });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: campaign.id }, content: "verified community fit", source: "fixture-community", evidenceRefs: ["publication:fixture-2"], publicationId: "fixture-publication-2", evidenceStatus: "VERIFIED", decisionHint: `prefer_target:${preferredTargetId}` });
  const consolidated = await service.consolidateOiMemory({ scope: { campaignId: campaign.id }, now: "2026-10-27T01:01:00Z" });
  assert.equal(consolidated.learnings.length, 1);
  const after = deriveStrategyDecision(await service.snapshot(), campaign.id, { now: new Date("2026-10-27T01:02:00Z") });
  assert.equal(after.action, "publish");
  assert.notEqual(after.candidateId, before.candidateId);
  assert.equal(after.memoryContext.some((item) => item.kind === "LEARNING" && item.decisionHint === `prefer_target:${preferredTargetId}`), true);
  assert.equal(after.evidence.some((ref) => ref.startsWith("memory:learning-")), true);
  const restarted = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await restarted.init();
  const afterRestart = await restarted.deriveStrategy(campaign.id, { now: "2026-10-27T01:03:00Z" }, "fixture-restarted-strategy");
  assert.equal(afterRestart.candidateId, after.candidateId);
  assert.equal(afterRestart.evidence.some((ref) => ref.startsWith("memory:learning-")), true);
});

test("strategy entrypoint records provider routing context without changing authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-provider-strategy-"));
  const productRepo = path.join(root, "repo");
  await (await import("node:fs/promises")).mkdir(productRepo);
  await (await import("node:fs/promises")).writeFile(path.join(productRepo, "README.md"), "grounded product", "utf8");
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), {
    oiBrowserProviders: [{ id: "strategy-local", capabilities: ["strategy-context"], installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => ({ ok: true, output: "bounded context" }) } }]
  });
  await service.init();
  const campaign = await service.createCampaign({ name: "Provider strategy", objective: "Awareness", productRepo });
  const target = await service.createTarget({ channel: "threads", name: "Fixture audience", url: "https://www.threads.net/@fixture", accountId: "account", status: "active" });
  const post = await service.createPost({ campaignId: campaign.id, targetId: target.id, content: "Grounded post", contentId: "provider-content" });
  await service.store.mutate("fixture", "provider_strategy_ready", (state) => {
    state.campaigns.find((item) => item.id === campaign.id).productIntelligence = { handoff: { readinessStatus: "READY" }, document: Object.fromEntries(["WHAT_IS_IT", "WHAT_PROBLEM_DOES_IT_SOLVE", "WHY_IS_IT_BETTER", "WHO_NEEDS_IT"].map((field) => [field, { text: field, evidenceRefs: ["fixture:product"] }])) };
    const saved = state.posts.find((item) => item.id === post.id);
    saved.approvedAt = new Date().toISOString();
    saved.approvalBinding = approvalFingerprint(saved, state.targets.find((item) => item.id === saved.targetId));
  });
  const decision = await service.deriveStrategy(campaign.id, { now: "2026-10-27T03:00:00Z", providerTask: { capability: "strategy-context", privacyClass: "local" } });
  assert.equal(decision.providerContext.status, "SUCCEEDED");
  assert.equal(decision.providerContext.providerId, "strategy-local");
  assert.equal(decision.reasons.includes("provider_route_observed"), true);
  const state = await service.snapshot();
  assert.equal(state.liveExecutionGrants.length, 0);
  assert.equal(state.executionRequests.length, 0);
});

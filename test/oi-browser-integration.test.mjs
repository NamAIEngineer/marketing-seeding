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
  memoryItemIsFresh,
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

test("browser executor rejects forged action, frame, and semantic identity bindings", async () => {
  const snapshot = createBrowserSnapshot({
    url: "https://fixture.test/community",
    html: '<button aria-label="Inspect rules" id="rules">Rules</button>'
  });
  const intent = createBrowserExecutionIntent(snapshot, { action: "CLICK", elementId: snapshot.buttons[0].elementId });
  const authority = { allowed: true, action: "CLICK", snapshotFingerprint: snapshot.fingerprint, targetIdentity: intent.targetIdentity, allowStaticFixture: true, externalSideEffects: false };
  const transport = fixtureIntentTransport(new BrowserInteractionFixture());
  await assert.rejects(() => executeBrowserIntent(snapshot, { ...intent, action: "TYPE" }, { transport, authority }), { code: "BROWSER_INTENT_IDENTITY_CHANGED" });
  await assert.rejects(() => executeBrowserIntent(snapshot, { ...intent, frame: "nested-frame" }, { transport, authority }), { code: "DOM_TARGET_FRAME_CHANGED" });
  await assert.rejects(() => executeBrowserIntent(snapshot, { ...intent, semanticTargetIdentity: "forged-semantic-id" }, { transport, authority }), { code: "DOM_TARGET_IDENTITY_CHANGED" });
  await assert.rejects(() => executeBrowserIntent(snapshot, { ...intent, intentId: "intent-forged" }, { transport, authority }), { code: "BROWSER_INTENT_IDENTITY_CHANGED" });
});

test("memory observation deduplicates duplicate polls, consolidates distinct publications, and scopes retrieval", () => {
  const state = { memoryItems: [], fixtureAutomationRuns: [
    { id: "fixture-1", campaignId: "campaign-x", communityId: "community-a", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/1", externalSideEffects: false },
    { id: "fixture-2", campaignId: "campaign-x", communityId: "community-a", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/2", externalSideEffects: false }
  ] };
  const input = normalizeMemoryItem({ kind: "OBSERVATION", scope: { campaignId: "campaign-x", communityId: "community-a" }, content: "technical educational content accepted", source: "fixture-community", evidenceRefs: ["fixture:fixture-1"], publicationId: "fixture-publication-1", pollId: "poll-1", confidence: 0.8, evidenceStatus: "VERIFIED", decisionHint: "educational" });
  const first = recordMemoryObservation(state, input, { now: "2026-10-27T00:00:00.000Z" });
  const second = recordMemoryObservation(state, { ...input, pollId: "poll-2", evidenceRefs: ["snapshot-2"] }, { now: "2026-10-27T00:01:00.000Z" });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(state.memoryItems.length, 1);
  assert.equal(state.memoryItems[0].supportCount, 1);
  const third = recordMemoryObservation(state, { ...input, publicationId: "fixture-publication-2", evidenceRefs: ["fixture:fixture-2"] }, { now: "2026-10-27T00:02:00.000Z" });
  assert.equal(third.deduplicated, true);
  assert.equal(state.memoryItems[0].supportCount, 2);
  const learnings = consolidateMemory(state, { scope: { campaignId: "campaign-x", communityId: "community-a" }, now: new Date("2026-10-27T00:02:00.000Z") });
  assert.equal(learnings.length, 1);
  assert.equal(learnings[0].kind, "LEARNING");
  assert.equal(learnings[0].support.sampleSupport, 2);
  assert.equal(retrieveBoundedMemory(state, { scope: { campaignId: "campaign-x", communityId: "community-b" } }).length, 0);
});

test("memory evidence does not count caller ID changes as independent samples", () => {
  const state = { memoryItems: [], fixtureAutomationRuns: [
    { id: "fixture-canonical", campaignId: "campaign-independent", communityId: "community-a", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/canonical", externalSideEffects: false }
  ] };
  const base = {
    kind: "OBSERVATION",
    scope: { campaignId: "campaign-independent", communityId: "community-a" },
    content: "technical educational content accepted",
    source: "fixture-community",
    evidenceRefs: ["fixture:fixture-canonical"],
    evidenceStatus: "VERIFIED",
    decisionHint: "educational"
  };
  const first = recordMemoryObservation(state, { ...base, publicationId: "caller-publication-a" }, { now: "2026-10-27T00:00:00.000Z" });
  const second = recordMemoryObservation(state, { ...base, publicationId: "caller-publication-b" }, { now: "2026-10-27T00:01:00.000Z" });
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.deepEqual(state.memoryItems[0].sampleIds, ["fixture:fixture-canonical"]);
  assert.equal(state.memoryItems[0].supportCount, 1);
  assert.equal(consolidateMemory(state, { scope: base.scope, now: new Date("2026-10-27T00:01:00.000Z") }).length, 0);
});

test("caller supplied VERIFIED status cannot create learning without canonical evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-memory-boundary-"));
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "c1" }, content: "unsupported claim", source: "caller", evidenceRefs: ["publication:does-not-exist-1"], publicationId: "does-not-exist-1", evidenceStatus: "VERIFIED", decisionHint: "prefer_target:target" });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "c1" }, content: "unsupported claim", source: "caller", evidenceRefs: ["publication:does-not-exist-2"], publicationId: "does-not-exist-2", evidenceStatus: "VERIFIED", decisionHint: "prefer_target:target" });
  const state = await service.snapshot();
  assert.equal(state.memoryItems.every((item) => item.evidenceStatus === "OBSERVED"), true);
  assert.equal((await service.consolidateOiMemory({ scope: { campaignId: "c1" } })).learnings.length, 0);
});

test("memory expiry rejects invalid explicit timestamps and fails closed for legacy rows", () => {
  assert.throws(() => normalizeMemoryItem({ kind: "OBSERVATION", content: "bad expiry", source: "fixture", expiresAt: "not-a-date" }), /expiresAt must be a valid timestamp/);
  assert.equal(memoryItemIsFresh({ kind: "OBSERVATION", content: "legacy bad expiry", createdAt: "2026-10-27T00:00:00Z", expiresAt: "not-a-date" }, new Date("2026-10-27T00:01:00Z")), false);
});

test("memory evidence is scoped, expires, and retracts learning support", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-memory-scope-"));
  const file = path.join(root, "state.json");
  const service = new SeedingService(new JsonStore(file));
  await service.init();
  await service.store.mutate("fixture", "fixture_evidence_seed", (state) => {
    state.fixtureAutomationRuns.push(
      { id: "fixture-a", campaignId: "campaign-a", communityId: "community-a", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/a", externalSideEffects: false },
      { id: "fixture-a2", campaignId: "campaign-a", communityId: "community-a", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/a2", externalSideEffects: false },
      { id: "fixture-b", campaignId: "campaign-b", communityId: "community-a", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/b", externalSideEffects: false }
    );
  });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "campaign-a", communityId: "community-a" }, content: "scoped fit", source: "fixture", evidenceRefs: ["fixture:fixture-a"], publicationId: "fixture-a", evidenceStatus: "VERIFIED", expiresAt: "2026-10-27T00:30:00Z" });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "campaign-a", communityId: "community-a" }, content: "scoped fit", source: "fixture", evidenceRefs: ["fixture:fixture-a2"], publicationId: "fixture-a2", evidenceStatus: "VERIFIED", expiresAt: "2026-10-27T00:30:00Z" });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "campaign-b", communityId: "community-a" }, content: "foreign fit", source: "fixture", evidenceRefs: ["fixture:fixture-b"], publicationId: "fixture-b", evidenceStatus: "VERIFIED" });
  const state = await service.snapshot();
  assert.equal(state.memoryItems.filter((item) => item.content === "scoped fit").every((item) => item.evidenceStatus === "FIXTURE_VERIFIED"), true);
  assert.equal(state.memoryItems.find((item) => item.content === "foreign fit").evidenceStatus, "FIXTURE_VERIFIED");
  assert.equal((await service.retrieveOiMemory({ scope: { campaignId: "campaign-a" }, now: "2026-10-27T01:00:00Z" })).items.length, 0);
  const valid = await service.retrieveOiMemory({ scope: { campaignId: "campaign-a" }, now: "2026-10-27T00:10:00Z" });
  assert.equal(valid.items.length, 1);
  await service.retractOiMemoryEvidence("fixture:fixture-a");
  assert.equal((await service.consolidateOiMemory({ scope: { campaignId: "campaign-a" }, now: "2026-10-27T00:10:00Z" })).learnings.length, 0);
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

test("provider router cancellation aborts the active provider and does not fall back", async () => {
  const controller = new AbortController();
  let firstCalls = 0;
  let secondCalls = 0;
  const resultPromise = routeAgentTask({ capability: "research", privacyClass: "local" }, {
    signal: controller.signal,
    providers: [
      { id: "slow", capabilities: ["research"], costClass: "low", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: ({ signal }) => { firstCalls += 1; return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))); } } },
      { id: "fallback", capabilities: ["research"], costClass: "medium", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => { secondCalls += 1; return { ok: true, output: "must-not-run" }; } } }
    ]
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  const result = await resultPromise;
  assert.equal(result.status, "FAILED");
  assert.equal(result.failure, "cancelled");
  assert.equal(result.telemetry.cancelled, true);
  assert.equal(result.attempted[0].status, "cancelled");
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
});

test("provider router suppresses fallback when cancellation races an invalid result", async () => {
  const controller = new AbortController();
  let secondCalls = 0;
  const result = await routeAgentTask({ capability: "research", privacyClass: "local" }, {
    signal: controller.signal,
    providers: [
      { id: "racing", capabilities: ["research"], costClass: "low", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => { controller.abort(); return { ok: false }; } } },
      { id: "fallback", capabilities: ["research"], costClass: "medium", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => { secondCalls += 1; return { ok: true, output: "must-not-run" }; } } }
    ]
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.failure, "cancelled");
  assert.equal(result.attempted[0].status, "cancelled");
  assert.equal(secondCalls, 0);
});

test("service provider route forwards caller cancellation and persists the failed decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-provider-cancel-service-"));
  const controller = new AbortController();
  let fallbackCalls = 0;
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")), {
    oiBrowserProviders: [
      { id: "slow", capabilities: ["research"], costClass: "low", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) } },
      { id: "fallback", capabilities: ["research"], costClass: "medium", installed: true, authReady: true, healthy: true, privacyClasses: ["local"], adapter: { infer: async () => { fallbackCalls += 1; return { ok: true, output: "must-not-run" }; } } }
    ]
  });
  await service.init();
  const resultPromise = service.routeOiAgentTask({ capability: "research", privacyClass: "local", signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  const result = await resultPromise;
  assert.equal(result.status, "FAILED");
  assert.equal(result.failure, "cancelled");
  assert.equal(result.persisted.failure, "cancelled");
  assert.equal(fallbackCalls, 0);
  const state = await service.snapshot();
  assert.equal(state.providerDecisions.at(-1).failure, "cancelled");
});

test("service persists memory and snapshots in canonical JsonStore and survives restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-native-"));
  const file = path.join(root, "state.json");
  const service = new SeedingService(new JsonStore(file));
  await service.init();
  await service.store.mutate("fixture", "fixture_evidence_seed", (state) => {
    state.fixtureAutomationRuns.push(
      { id: "fixture-1", campaignId: "c1", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/1", externalSideEffects: false },
      { id: "fixture-2", campaignId: "c1", e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/2", externalSideEffects: false }
    );
  });
  const observed = await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "c1" }, content: "Community A accepts technical education", source: "fixture", evidenceRefs: ["fixture:fixture-1"], publicationId: "fixture-publication-1", evidenceStatus: "VERIFIED" });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: "c1" }, content: "Community A accepts technical education", source: "fixture", evidenceRefs: ["fixture:fixture-2"], publicationId: "fixture-publication-2", evidenceStatus: "VERIFIED" });
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

test("identical DOM captures retain bounded execution trace bindings after deduplication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oi-browser-snapshot-traces-"));
  const file = path.join(root, "state.json");
  const service = new SeedingService(new JsonStore(file));
  await service.init();
  const input = { url: "https://fixture.test/repeated", html: '<title>Repeated</title><button aria-label="Inspect">Inspect</button>' };
  const first = await service.recordBrowserSnapshot({ ...input, executionId: "execution-1", campaignId: "campaign-a", communityId: "community-a" });
  await service.recordBrowserSnapshot({ ...input, executionId: "execution-1", campaignId: "campaign-a", communityId: "community-a" });
  const second = await service.recordBrowserSnapshot({ ...input, executionId: "execution-2", campaignId: "campaign-b", communityId: "community-b" });
  assert.equal(first.snapshot.fingerprint, second.snapshot.fingerprint);
  assert.equal((await service.snapshot()).browserSnapshots.length, 1);
  const persisted = (await service.snapshot()).browserSnapshots[0];
  assert.deepEqual(persisted.executionIds, ["execution-1", "execution-2"]);
  assert.deepEqual(persisted.executionBindings.map((item) => item.executionId), ["execution-1", "execution-2"]);
  assert.equal(persisted.executionBindings[1].campaignId, "campaign-b");
  const restarted = new SeedingService(new JsonStore(file));
  await restarted.init();
  const afterRestart = (await restarted.dashboard()).oiBrowser.browser.recent[0];
  assert.deepEqual(afterRestart.executionIds, ["execution-1", "execution-2"]);
  assert.equal(afterRestart.executionBindings.length, 2);
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
  const campaign = await service.createCampaign({ name: "Memory strategy", objective: "Developer awareness", productRepo, testJob: true });
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
    state.fixtureAutomationRuns.push(
      { id: "fixture-1", campaignId: campaign.id, e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/1", externalSideEffects: false },
      { id: "fixture-2", campaignId: campaign.id, e2eStatus: "e2e_verified_readonly", fixturePublicationUrl: "https://fixture.local/posts/2", externalSideEffects: false }
    );
  });
  const before = deriveStrategyDecision(await service.snapshot(), campaign.id, { now: new Date("2026-10-27T01:00:00Z") });
  assert.equal(before.action, "publish");
  const preferredTargetId = before.candidateId === postA.id ? targetB.id : targetA.id;
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: campaign.id }, content: "verified community fit", source: "fixture-community", evidenceRefs: ["fixture:fixture-1"], publicationId: "fixture-publication-1", evidenceStatus: "VERIFIED", decisionHint: `prefer_target:${preferredTargetId}` });
  await service.recordOiMemory({ kind: "OBSERVATION", scope: { campaignId: campaign.id }, content: "verified community fit", source: "fixture-community", evidenceRefs: ["fixture:fixture-2"], publicationId: "fixture-publication-2", evidenceStatus: "VERIFIED", decisionHint: `prefer_target:${preferredTargetId}` });
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

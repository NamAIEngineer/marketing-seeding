import test from "node:test";
import assert from "node:assert/strict";
import { GpmExecutionSession } from "../src/gpm-execution-session.mjs";
import { GpmExecutionTransport } from "../src/gpm-execution-transport.mjs";
import { JevExecutionWorker } from "../src/jev-execution-worker.mjs";
import { LinkedInAdapter } from "../src/linkedin-adapter.mjs";
import { PlatformAdapterRegistry, PLATFORM_CAPABILITIES } from "../src/platform-registries.mjs";

const now = new Date().toISOString();
const future = new Date(Date.now() + 120_000).toISOString();

function requestFixture() {
  const request = {
    schemaVersion: 1,
    executionId: "wave13-e2e-execution",
    jobId: "wave13-e2e-job",
    campaignId: "wave13-e2e-campaign",
    platform: "linkedin",
    accountId: "wave13-account",
    profileId: "wave13-profile",
    target: { targetId: "wave13-target", url: "https://www.linkedin.com/feed/" },
    audience: "public",
    content: { contentId: "wave13-content", sha256: "a".repeat(64), payload: "Wave 13 bounded fixture" },
    media: [],
    authorization: { authorizationId: "wave13-auth", binding: "wave13-binding" },
    idempotencyKey: "wave13-idempotency",
    readiness: { state: "READY", checkedAt: now, expiresAt: future, evidenceReference: "fixture-readiness" },
    createdAt: now
  };
  const grant = {
    schemaVersion: 1, grantId: "wave13-grant", campaignAuthorizationId: request.authorization.authorizationId,
    campaignAuthorizationBinding: request.authorization.binding, campaignId: request.campaignId,
    jobId: request.jobId, boundExecutionId: request.executionId, platform: request.platform,
    accountId: request.accountId, profileId: request.profileId, targetId: request.target.targetId,
    content: { contentId: request.content.contentId, canonicalSha256: "b".repeat(64), rawSha256: request.content.sha256 },
    media: [], audience: request.audience, idempotencyKey: request.idempotencyKey,
    validFrom: new Date(Date.now() - 1_000).toISOString(), validUntil: future,
    maxExecutions: 1, createdAt: now, createdBy: "wave13-fixture", operatorAuthorizationReference: "wave13-approval", status: "ACTIVE"
  };
  request.liveGrant = { grantId: grant.grantId };
  const context = {
    request,
    requestRow: { executionId: request.executionId, jobId: request.jobId, attempt: 1, state: "REQUEST_READY", submitState: "NOT_STARTED" },
    post: { id: request.jobId, status: "queued" },
    target: { id: request.target.targetId, channel: "linkedin", accountId: request.accountId, profileId: request.profileId, readiness: request.readiness },
    account: { status: "enabled", health: "healthy", accountId: request.accountId, profileId: request.profileId, expectedIdentityUrl: "https://www.linkedin.com/in/wave13-owner" },
    authorization: { id: request.authorization.authorizationId, binding: request.authorization.binding, allowLiveExecution: true },
    liveGrant: grant,
    state: { executionReceipts: [] }
  };
  return { request, context };
}

function registry(adapter) {
  const result = new PlatformAdapterRegistry();
  result.register("linkedin", {
    contractVersion: 1,
    capabilities: Object.fromEntries(PLATFORM_CAPABILITIES.map((name) => [name, false])),
    async execute(...args) { return adapter.execute(...args); },
    async reconcile() { return { submitState: "UNKNOWN", startedAt: now, finishedAt: now }; },
    ...adapter
  });
  return result;
}

function gpmResolverRig() {
  const calls = [];
  const client = {
    async observeIdentity() { calls.push("observeIdentity"); return { state: "READY", platform: "linkedin", accountId: "wave13-account" }; },
    async navigate() {}, async snapshot() {}, async resolve() {}, async type() {}, async click() {},
    async observeTransition() {}, async verifyActivation() {}, async detach() { calls.push("transportDetach"); },
    async listTabs() { return []; }, async showTab() {}, async waitForUrl() {}, async waitForFeed() {},
    async waitForExpression() {}, async evaluate() {}, async fill() {}, async upload() {}, async uploadSelector() {},
    async browserCommandCount() { return 0; }
  };
  const transport = new GpmExecutionTransport({
    profileReference: "wave13-profile", sessionHandle: "opaque-wave13-session", protocolFactory: async () => client,
    hostAttestation: { host: "fixture", runtime: "gpm", version: "5.1.2", evidence: "wave13-fixture", observedAt: now, expiresAt: future }
  });
  const coordinator = {
    async acquire() { calls.push("profileAcquire"); return { ready: true, handle: { profileFingerprint: "wave13-fingerprint" } }; },
    async release() { calls.push("profileRelease"); return { released: true, status: "RELEASED" }; }
  };
  const composed = new GpmExecutionSession({
    coordinator,
    accountRegistry: [{ platform: "linkedin", accountId: "wave13-account", profileRef: "wave13-profile", profileFingerprint: "wave13-fingerprint" }],
    selectAccountRuntimeCandidate: () => ({ status: "SELECTED", selected: { platform: "linkedin", accountId: "wave13-account", profileRef: "wave13-profile", profileFingerprint: "wave13-fingerprint" } }),
    attach: async () => ({
      state: "READY",
      identity: { platform: "linkedin", accountId: "wave13-account", profileReference: "wave13-profile" },
      transport,
      browserSurface: transport.browserSurface
    }),
    clock: () => new Date(now)
  });
  return { calls, transport, composed };
}

test("Wave 13 worker consumes GPM session through LinkedIn adapter and detaches before profile release", async () => {
  const { request, context } = requestFixture();
  const { calls, transport, composed } = gpmResolverRig();
  let adapterTransport;
  let adapterSurface;
  const adapter = new LinkedInAdapter({ runtimeIdentity: () => ({ transport: "orca-fixture", provider: "orca", providerVersion: "fixture" }) }, { verifier: {} });
  adapter.prepareExecution = async (value) => ({ request: value, pageId: "fixture-page", expectedIdentityUrl: context.account.expectedIdentityUrl });
  adapter.navigate = async (value) => value;
  adapter.verifyTarget = async (value) => {
    adapterTransport = adapter.transport;
    adapterSurface = adapter.browser;
    throw Object.assign(new Error("fixture target gate"), { code: "TARGET_MISMATCH" });
  };
  const execution = { ...context, request: { ...request } };
  const serviceCalls = [];
  let readinessSurface;
  const service = {
    async executionContext() { return execution; },
    async acquireExecutionLease() { serviceCalls.push("lease"); return { acquired: true, lease: { id: "wave13-lease", token: "fixture" } }; },
    async renewExecutionLease() { return true; },
    async releaseExecutionLease() { serviceCalls.push("leaseRelease"); },
    async refreshCampaignJobReadiness(_postId, _actor, options) { readinessSurface = options?.browserSurface; return { status: "queued", readinessState: "READY" }; },
    async prepareExecutionRequest() { return execution.requestRow; },
    async markExecutionStarted() { serviceCalls.push("started"); },
    async recordExecutionReceipt(_id, receipt) { serviceCalls.push(["receipt", receipt]); return receipt; }
  };
  const worker = new JevExecutionWorker({
    service,
    adapterRegistry: registry(adapter),
    executionSessionResolver: { provider: "gpm", async resolve() { return composed.acquire({ platform: "linkedin", accountId: "wave13-account" }); } },
    env: { SEEDING_JEV_LIVE_ENABLED: "true", SEEDING_JEV_LIVE_EXECUTION_ID: request.executionId }
  });
  const result = await worker.run(request.executionId, { dryRun: false });
  assert.equal(result.status, "FAILED");
  assert.equal(result.receipt.submitState, "FAILED");
  assert.equal(adapterTransport, transport);
  assert.equal(adapterTransport.runtimeIdentity().provider, "gpm");
  assert.equal(typeof adapterSurface.listTabs, "function");
  assert.equal(typeof adapterSurface.waitForFeed, "function");
  assert.equal(readinessSurface, transport.browserSurface);
  assert.deepEqual(calls, ["profileAcquire", "observeIdentity", "transportDetach", "profileRelease"]);
  assert.deepEqual(serviceCalls.filter((value) => typeof value === "string"), ["lease", "started", "leaseRelease"]);
  assert.equal(serviceCalls.some((value) => Array.isArray(value) && value[0] === "receipt"), true);
});

test("Wave 13 GPM transport provider mismatch fails closed before profile lease is retained", async () => {
  const calls = [];
  const composed = new GpmExecutionSession({
    coordinator: {
      async acquire() { calls.push("acquire"); return { ready: true, handle: { profileFingerprint: "fp" } }; },
      async release() { calls.push("release"); return { released: true }; }
    },
    accountRegistry: [{ platform: "linkedin", accountId: "wave13-account", profileRef: "wave13-profile" }],
    selectAccountRuntimeCandidate: () => ({ selected: { platform: "linkedin", accountId: "wave13-account", profileRef: "wave13-profile" } }),
    attach: async () => ({
      state: "READY", identity: { platform: "linkedin", accountId: "wave13-account", profileReference: "wave13-profile" },
      transport: { runtimeIdentity: () => ({ transport: "orca", provider: "orca", providerVersion: "1" }), browserSurface: {} }
    })
  });
  const result = await composed.acquire();
  assert.equal(result.ready, false);
  assert.equal(result.code, "GPM_PROVIDER_MISMATCH");
  assert.deepEqual(calls, ["acquire", "release"]);
});

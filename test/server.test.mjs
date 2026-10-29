import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInitialState } from "../src/store.mjs";
import { campaignAuthorizationFingerprint, campaignContentHash, campaignScopeFingerprint, publicationIdentityKey } from "../src/campaign-authorization.mjs";
import { contentCandidateIdentity } from "../src/content-foundation.mjs";
import { createSystemAgenticHandoffEnvelope } from "../src/system-agentic-handoff-bridge.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("HTTP mutations require the local operator bearer token", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "seeding-server-test-"));
  await writeFile(path.join(dataDir, "daily-automation.json"), JSON.stringify({
    id: "automation-fixture",
    enabled: true,
    timezone: "Etc/GMT-7",
    rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    nextRunAt: "2026-10-07T02:00:00.000Z",
    workspaceId: "fixture-workspace"
  }));
  await writeFile(path.join(dataDir, "daily-product-seeding-automations.json"), JSON.stringify({
    production: {
      id: "full-receipt-fixture",
      name: "Daily Blender artifact and seeding drafts",
      enabled: true,
      timezone: "Etc/GMT-7",
      rrule: "FREQ=DAILY;BYHOUR=6;BYMINUTE=0",
      nextRunAt: "2026-10-07T00:00:00.000Z",
      workspaceId: "full-fixture-workspace"
    }
  }));
  await writeFile(path.join(dataDir, "browser-automation.json"), JSON.stringify({
    id: "browser-automation-fixture", enabled: true, timezone: "Asia/Saigon",
    rrule: "30 23 * * *", nextRunAt: "2026-10-07T12:00:00.000Z", workspaceId: "fixture-workspace"
  }));
  const autoGtmFeed = path.join(dataDir, "auto-gtm-feed.json");
  await writeFile(autoGtmFeed, JSON.stringify({
    schemaVersion: 1, source: "auto-gtm", status: "ready",
    generatedAt: new Date().toISOString(), campaignId: "campaign_r19_gt_course_validation",
    portfolioProduct: "course.example", leads: [{ leadId: "lead-fixture", segment: "artists",
      fit: 0.8, whyNow: 0.7, reach: null, privateEmail: "must-not-leak", evidence: [{
        signalId: "signal-fixture", source: "github", kind: "issue_pain",
        occurredAt: "2026-10-10T12:00:00Z", url: "https://github.com/org/repo/issues/1",
        snippet: "Public source evidence", secret: "must-not-leak"
      }] }]
  }));
  const initialState = createInitialState();
  const fixtureCampaign = { id: "live-grant-campaign", status: "active", productRepo: appRoot, objective: "fixture", audience: [], landingUrl: null };
  const fixtureTarget = { id: "live-grant-target", channel: "linkedin", accountId: "fixture-account", profileId: "11111111-2222-4333-8444-555555555555", url: "https://www.linkedin.com/feed/", status: "active" };
  const fixturePost = { id: "live-grant-job", campaignId: fixtureCampaign.id, targetId: fixtureTarget.id, contentId: "fixture-content", content: "Fixture approved content", audience: "public", status: "blocked", campaignAuthorizationId: "live-grant-auth",
    idempotencyKey: publicationIdentityKey({ campaignId: fixtureCampaign.id, contentId: "fixture-content", platform: "linkedin", accountId: fixtureTarget.accountId, targetId: fixtureTarget.id }) };
  const fixtureAuthorization = {
    id: "live-grant-auth", campaignId: fixtureCampaign.id, status: "active", campaignBinding: campaignScopeFingerprint(fixtureCampaign),
    validFrom: new Date(Date.now() - 60_000).toISOString(), validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    destinations: [{ platform: "linkedin", accountId: fixtureTarget.accountId, profileId: fixtureTarget.profileId, targetId: fixtureTarget.id, targetUrl: fixtureTarget.url }],
    approvedAssets: [], contentBoundary: { mode: "approved_copy_set", contentHashes: [campaignContentHash(fixturePost.content)] },
    audienceRules: { allowedAudiences: ["public"] }, allowLiveExecution: true
  };
  fixtureAuthorization.binding = campaignAuthorizationFingerprint(fixtureAuthorization);
  fixturePost.campaignAuthorizationBinding = fixtureAuthorization.binding;
  initialState.campaigns.push(fixtureCampaign);
  const candidateContent = "Fixture candidate content";
  const candidateIdentity = contentCandidateIdentity({ storyId: "fixture-story", targetId: fixtureTarget.id, channel: fixtureTarget.channel, content: candidateContent, claimIds: [], evidenceRefs: [] });
  const candidateContentId = `content-${candidateIdentity.slice(0, 24)}`;
  const fixtureGroundingSha256 = createHash("sha256").update(await readFile(path.join(appRoot, "README.md"))).digest("hex");
  fixtureCampaign.productFactoryRuns = [{
    id: "fixture-product-factory-run", status: "SUCCEEDED", externalSideEffects: false, repositoryPath: appRoot,
    execution: { status: "SUCCEEDED", externalSideEffects: false },
    artifacts: { repositoryPath: appRoot, externalSideEffects: false, artifacts: [{ path: "README.md", sha256: fixtureGroundingSha256, commandRef: ["fixture"] }] }
  }];
  initialState.stories.push({ id: "fixture-story", campaignId: fixtureCampaign.id, audience: "public", language: "en", groundingSources: [{ relativePath: "README.md", sha256: fixtureGroundingSha256 }], status: "draft" });
  fixtureCampaign.contentCandidates = [{ contentId: candidateContentId, contentIdentity: candidateIdentity, storyId: "fixture-story", targetId: fixtureTarget.id, channel: fixtureTarget.channel, content: candidateContent, claimIds: [], evidenceRefs: [], status: "draft" }];
  initialState.targets.push(fixtureTarget);
  initialState.posts.push(fixturePost);
  initialState.executionAccounts.push({ id: "linkedin:fixture-account", platform: "linkedin", accountId: "fixture-account", profileId: fixtureTarget.profileId, status: "enabled", health: "healthy" });
  initialState.campaignAuthorizations.push(fixtureAuthorization);
  initialState.collectorRuns.push({ id: "prior-cycle", postId: "fixture", channel: "threads", status: "unknown", at: new Date(Date.now() - 60 * 60_000).toISOString() });
  await writeFile(path.join(dataDir, "state.json"), JSON.stringify(initialState));
  const token = randomBytes(32).toString("hex");
  const automationToken = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, OPENSSL_CONF: "", SEEDING_DATA_DIR: dataDir, SEEDING_AUTO_GTM_FEED_FILE: autoGtmFeed, SEEDING_PORT: "0", SEEDING_OPERATOR_TOKEN: token, SEEDING_AUTOMATION_TOKEN: automationToken, SEEDING_TRAFFIC_POLL_MINUTES: "240", SEEDING_JEV_WORKER_ENABLED: "false", SEEDING_JEV_LIVE_ENABLED: "false", SEEDING_JEV_EXACT_LIVE_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => child.kill());
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture server did not start")), 10_000);
    child.once("error", reject);
    child.stderr.on("data", (chunk) => reject(new Error(chunk.toString())));
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  const beforeReadOnlyGets = await readFile(path.join(dataDir, "state.json"), "utf8");
  await fetch(`${baseUrl}/health`);
  await fetch(`${baseUrl}/api/dashboard`);
  const afterReadOnlyGets = await readFile(path.join(dataDir, "state.json"), "utf8");
  assert.equal(afterReadOnlyGets, beforeReadOnlyGets);
  assert.equal((await fetch(`${baseUrl}/api/dashboard`)).status, 200);
  const bridgePayload = {
    mode: "DRY_RUN", campaignId: fixtureCampaign.id, handoffVersion: 1,
    productRun: { productId: fixtureCampaign.id, objective: fixtureCampaign.objective, status: "COMPLETED", pipelineIds: ["server-bridge"], artifactRefs: [], mediaRefs: [], contentVariantRefs: [candidateContentId], campaignRefs: [fixtureCampaign.id], distributionIntentRefs: ["server-bridge-intent"], metadata: {}, createdAt: "2026-10-18T00:00:00Z" },
    productArtifacts: [], mediaArtifacts: [],
    contentVariants: [{ contentVariantId: candidateContentId, productId: fixtureCampaign.id, pipelineId: "server-bridge", sourceArtifactRefs: [], sourceMediaRefs: [], format: "text", angle: "evidence", audience: "public", platformHints: ["linkedin"], text: candidateContent, mediaRefs: [], metadata: { contentIdentity: candidateIdentity }, provenance: {}, producerModuleId: "server-fixture", producerStepId: "bridge-step", createdAt: "2026-10-18T00:00:00Z" }],
    contentPackage: { contentPackageId: "server-bridge-package", productId: fixtureCampaign.id, contentVariantRefs: [candidateContentId], mediaVariantRefs: [], sourceArtifactRefs: [], metadata: {}, createdAt: "2026-10-18T00:00:00Z", pipelineId: "server-bridge", producerModuleId: "server-fixture", producerStepId: "bridge-step" },
    distributionIntent: { distributionIntentId: "server-bridge-intent", productId: fixtureCampaign.id, contentVariantRefs: [candidateContentId], mediaRefs: [], objective: fixtureCampaign.objective, audienceHints: ["public"], platformHints: ["linkedin"], metadata: {}, createdAt: "2026-10-18T00:00:00Z", pipelineId: "server-bridge", producerModuleId: "server-fixture", producerStepId: "bridge-step", contentPackageRef: "server-bridge-package" },
    platform: { targetId: fixtureTarget.id }
  };
  const bridgeResponse = await fetch(`${baseUrl}/api/campaigns/${fixtureCampaign.id}/distribution-handoff`, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: JSON.stringify(createSystemAgenticHandoffEnvelope(bridgePayload, { emittedAt: "2026-10-18T00:00:00Z" })) });
  assert.equal(bridgeResponse.status, 200);
  const bridgeResult = await bridgeResponse.json();
  assert.equal(bridgeResult.bridge.source.system, "SYSTEM_AGENTIC_AI");
  assert.equal(bridgeResult.result.liveDispatch, false);
  assert.equal(bridgeResult.result.publicationAttempts, 0);
  const rawCompatibilityResponse = await fetch(`${baseUrl}/api/campaigns/${fixtureCampaign.id}/distribution-handoff`, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: JSON.stringify(bridgePayload) });
  assert.equal(rawCompatibilityResponse.status, 200);
  assert.equal((await rawCompatibilityResponse.json()).result.liveDispatch, false);
  const leadFeedResponse = await fetch(`${baseUrl}/api/leads`);
  assert.equal(leadFeedResponse.status, 200);
  const leadFeed = await leadFeedResponse.json();
  assert.equal(leadFeed.status, "ready");
  assert.equal(leadFeed.leads[0].leadId, "lead-fixture");
  assert.equal("privateEmail" in leadFeed.leads[0], false);
  assert.equal("secret" in leadFeed.leads[0].evidence[0], false);
  const dashboardWithLeads = await (await fetch(`${baseUrl}/api/dashboard`)).json();
  assert.equal(dashboardWithLeads.autoGtm.leadCount, 1);
  assert.equal(dashboardWithLeads.marketIntelligence.readOnly, true);
  assert.equal(dashboardWithLeads.marketIntelligence.opportunityCount, 0);
  assert.equal((await fetch(`${baseUrl}/api/flow-graph`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/operator/session`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/state`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/automation/collect-now`, { method: "POST" })).status, 401);
  const candidateMaterializePath = `${baseUrl}/api/campaigns/live-grant-campaign/content-candidates/materialize`;
  const templateCandidatePath = `${baseUrl}/api/campaigns/live-grant-campaign/template-content-candidates`;
  assert.equal((await fetch(templateCandidatePath, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: JSON.stringify({}) })).status, 401);
  assert.equal((await fetch(templateCandidatePath, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({}) })).status, 400);
  assert.equal((await fetch(candidateMaterializePath, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: JSON.stringify({}) })).status, 400);
  assert.equal((await fetch(candidateMaterializePath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).status, 401);
  const materializedResponse = await fetch(candidateMaterializePath, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: JSON.stringify({ contentId: candidateContentId, contentIdentity: candidateIdentity }) });
  assert.equal(materializedResponse.status, 201);
  const materialized = await materializedResponse.json();
  assert.equal(materialized.status, "draft");
  assert.equal(materialized.contentId, candidateContentId);
  assert.equal("campaignAuthorizationId" in materialized, false);
  assert.equal("executionState" in materialized, false);
  const promotePath = `${baseUrl}/api/campaigns/live-grant-campaign/product-factory/artifacts/promote`;
  const promotionPayload = JSON.stringify({ factoryRunId: "fixture-product-factory-run", path: "README.md", sha256: fixtureGroundingSha256, name: "Fixture README", mediaType: "text/plain", evidence: "Factory evidence fixture" });
  assert.equal((await fetch(promotePath, { method: "POST", headers: { "content-type": "application/json" }, body: promotionPayload })).status, 401);
  assert.equal((await fetch(promotePath, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: promotionPayload })).status, 401);
  const promotedResponse = await fetch(promotePath, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: promotionPayload });
  assert.equal(promotedResponse.status, 201);
  const promotedArtifact = await promotedResponse.json();
  assert.equal(promotedArtifact.status, "verified");
  const repeatedPromotion = await fetch(promotePath, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: promotionPayload });
  assert.equal(repeatedPromotion.status, 201);
  assert.equal((await repeatedPromotion.json()).id, promotedArtifact.id);
  const operatorSession = await fetch(`${baseUrl}/api/operator/session`, {
    headers: { authorization: `Bearer ${token}`, "x-agentic-actor": "test-operator" }
  });
  assert.equal(operatorSession.status, 200);
  assert.deepEqual(await operatorSession.json(), { ok: true, actor: "local-human-operator" });
  assert.equal((await fetch(`${baseUrl}/api/operator/session`, { headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/state`, { headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/posts/fixture-job/execution-request/dry-run`, { method: "POST", headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/posts/fixture-job/quarantine-unknown`, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: JSON.stringify({}) })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/submission-uncertainties/unknown-fixture`, { headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/submission-uncertainties/unknown-fixture/reconcile`, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: JSON.stringify({ outcome: "PROVEN_FAILED" }) })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/execution-requests/fixture-execution/run-dry-run`, { method: "POST", headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/execution-requests/fixture-execution/dispatch`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/execution-requests/fixture-execution/dispatch`, { method: "POST", headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/execution-requests/fixture-execution/dispatch`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ platform: "linkedin" }) })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/execution-requests/fixture-execution/dispatch`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "null" })).status, 400);
  const exactDispatchResponse = await fetch(`${baseUrl}/api/execution-requests/missing-execution/dispatch`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(exactDispatchResponse.status, 200);
  assert.equal((await exactDispatchResponse.json()).status, "NOT_DISPATCHABLE");
  const cancellationPayload = JSON.stringify({ reason: "operator-only API authorization regression", operatorAuthorizationReference: "fixture-operator-review" });
  assert.equal((await fetch(`${baseUrl}/api/execution-requests/fixture-execution/cancel`, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: cancellationPayload })).status, 401);
  const operatorCancelResponse = await fetch(`${baseUrl}/api/execution-requests/fixture-execution/cancel`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: cancellationPayload });
  assert.notEqual(operatorCancelResponse.status, 401);
  assert.equal((await fetch(`${baseUrl}/api/state`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  const grantPayload = JSON.stringify({ jobId: fixturePost.id,
    validFrom: new Date(Date.now() - 30_000).toISOString(), validUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
    operatorAuthorizationReference: "server-fixture-approval" });
  const grantHeaders = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  assert.equal((await fetch(`${baseUrl}/api/live-execution-grants`, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: grantPayload })).status, 401);
  const grantResponse = await fetch(`${baseUrl}/api/live-execution-grants`, { method: "POST", headers: grantHeaders, body: grantPayload });
  assert.equal(grantResponse.status, 201);
  const liveGrant = await grantResponse.json();
  assert.equal(liveGrant.jobId, fixturePost.id);
  assert.equal((await fetch(`${baseUrl}/api/live-execution-grants/${liveGrant.grantId}`, { headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await (await fetch(`${baseUrl}/api/live-execution-grants/${liveGrant.grantId}`, { headers: { authorization: `Bearer ${token}` } })).json()).status, "ACTIVE");
  assert.equal((await fetch(`${baseUrl}/api/live-execution-grants/${liveGrant.grantId}/revoke`, { method: "POST", headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/live-execution-grants/${liveGrant.grantId}/revoke`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await (await fetch(`${baseUrl}/api/live-execution-grants/${liveGrant.grantId}`, { headers: { authorization: `Bearer ${token}` } })).json()).status, "REVOKED");
  const executionWindowPayload = JSON.stringify({
    windowId: "fixture-one-time-window", campaignId: fixtureCampaign.id, campaignAuthorizationId: fixtureAuthorization.id, jobId: fixturePost.id,
    validFrom: new Date(Date.now() - 1_000).toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString(),
    timezone: "UTC", reason: "operator API auth regression"
  });
  const executionWindowHeaders = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  assert.equal((await fetch(`${baseUrl}/api/one-time-execution-windows`, { method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: executionWindowPayload })).status, 401);
  const windowResponse = await fetch(`${baseUrl}/api/one-time-execution-windows`, { method: "POST", headers: executionWindowHeaders, body: executionWindowPayload });
  assert.equal(windowResponse.status, 201);
  const executionWindow = await windowResponse.json();
  assert.equal(executionWindow.jobId, fixturePost.id);
  assert.equal(executionWindow.status, "ACTIVE");
  assert.equal((await fetch(`${baseUrl}/api/one-time-execution-windows/${executionWindow.windowId}`, { headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await (await fetch(`${baseUrl}/api/one-time-execution-windows/${executionWindow.windowId}`, { headers: executionWindowHeaders })).json()).effectiveStatus, "ACTIVE");
  assert.equal((await fetch(`${baseUrl}/api/one-time-execution-windows/${executionWindow.windowId}/revoke`, { method: "POST", headers: { authorization: `Bearer ${automationToken}` } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/one-time-execution-windows/${executionWindow.windowId}/revoke`, { method: "POST", headers: executionWindowHeaders })).status, 200);
  const body = JSON.stringify({ name: "Fixture", objective: "Auth test", productRepo: appRoot });
  assert.equal((await fetch(`${baseUrl}/api/campaigns`, {
    method: "POST", headers: { "content-type": "application/json" }, body
  })).status, 401);
  const authorized = await fetch(`${baseUrl}/api/campaigns`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-agentic-actor": "test-operator" },
    body
  });
  assert.equal(authorized.status, 201);
  assert.equal((await authorized.json()).name, "Fixture");
  const automationDraftCampaign = await fetch(`${baseUrl}/api/campaigns`, {
    method: "POST",
    headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Automation fixture", objective: "Draft only", productRepo: appRoot })
  });
  assert.equal(automationDraftCampaign.status, 201);
  assert.equal((await fetch(`${baseUrl}/api/bootstrap/r19`, {
    method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: "{}"
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/posts/missing/browser-observations`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}"
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/posts/missing/browser-observations`, {
    method: "POST", headers: { authorization: `Bearer ${automationToken}`, "content-type": "application/json" }, body: "{}"
  })).status, 400);
  const health = await (await fetch(`${baseUrl}/health`)).json();
  assert.equal(health.controlCycle.enabled, false);
  assert.equal(health.controlCycle.intervalMinutes, null);
  assert.equal(health.campaignQueue.enabled, true);
  assert.equal(health.campaignQueue.intervalSeconds, 30);
  assert.equal(health.campaignQueue.running, false);
  assert.ok(health.campaignQueue.nextRunAt);
  assert.equal("stateFile" in health.campaignQueue, false);
  assert.equal(health.trafficCollector.enabled, true);
  assert.equal(health.trafficCollector.intervalMinutes, 240);
  assert.ok(health.trafficCollector.nextRunAt);
  const resumedDelayMinutes = (Date.parse(health.trafficCollector.nextRunAt) - Date.now()) / 60_000;
  assert.ok(resumedDelayMinutes > 178 && resumedDelayMinutes < 181, `expected persisted cadence, got ${resumedDelayMinutes} minutes`);
  assert.equal(health.dailyProduction.id, "full-receipt-fixture");
  assert.equal(health.dailyProduction.rrule, "FREQ=DAILY;BYHOUR=6;BYMINUTE=0");
  assert.equal(health.dailyProduction.enabled, true);
  assert.equal(health.browserTracking.id, "browser-automation-fixture");
  assert.equal(health.browserTracking.mode, "browser_verified");
  assert.equal(health.executionRuntime.readOnly, true);
  assert.equal(health.executionRuntime.publicationRule.includes("COMMAND_COMPLETED"), true);
  assert.ok(health.executionRuntime.counts);
  assert.equal(health.productFactorySandbox.status, "UNSUPPORTED");
  assert.equal(health.productFactorySandbox.executionEligible, false);
  assert.equal(health.productFactorySandbox.unsafeCommandDisposition, "NOT_EXECUTED_UNSAFE");
  assert.equal(health.productFactorySandbox.checks.resourceLimits, "UNSUPPORTED");
  const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
  assert.equal(dashboard.automation.controlCycle.enabled, false);
  assert.equal(dashboard.automation.campaignQueue.enabled, true);
  assert.equal(dashboard.automation.campaignQueue.intervalSeconds, 30);
  assert.equal(dashboard.automation.campaignQueue.running, false);
  assert.ok(dashboard.automation.campaignQueue.nextRunAt);
  assert.equal(dashboard.automation.dailyProduction.rrule, "FREQ=DAILY;BYHOUR=6;BYMINUTE=0");
  assert.equal(dashboard.automation.browserTracking.rrule, "30 23 * * *");
  assert.deepEqual(dashboard.executionRuntime, health.executionRuntime);
  assert.deepEqual(dashboard.productFactorySandbox, health.productFactorySandbox);
});

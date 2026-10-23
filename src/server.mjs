import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { JsonStore } from "./store.mjs";
import { SeedingService, pollConfiguredDiscoveries, projectExecutionRuntime } from "./service.mjs";
import { appRoot, autoGtmFeedFile, browserAutomationFile, dailyAutomationFile, dailyAutomationReceiptFile, publicRoot, stateFile } from "./paths.mjs";
import { FixtureWorkerBridge } from "./fixture-worker-bridge.mjs";
import { readAutoGtmFeed } from "./auto-gtm-feed.mjs";
import { OrcaCliClient } from "./orca-browser-client.mjs";
import { LinkedInReadinessProvider } from "./linkedin-readiness.mjs";
import { configuredReadinessTtlMs } from "./readiness.mjs";
import { LinkedInAdapter } from "./linkedin-adapter.mjs";
import { OrcaAccessibilityTransport, OrcaPointerTransport } from "./browser-interaction-transport.mjs";
import { JevExecutionWorker } from "./jev-execution-worker.mjs";
import { PlatformAdapterRegistry, ReadinessProviderRegistry } from "./platform-registries.mjs";
import { isAuthorizedLocalShutdown, runtimeMetadata } from "./service-lifecycle.mjs";
import { consumeSystemAgenticHandoff } from "./system-agentic-handoff-bridge.mjs";
import { createDefaultBrowserRuntimeRouter } from "./browser-runtime-router.mjs";
import { discoverGpmProcessEndpoints, probeGpmRuntime } from "./gpm-runtime-probe.mjs";

async function loadLocalEnv() {
  try {
    const text = await readFile(path.join(appRoot, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith("#") || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function loadTransportCertifications() {
  const file = String(process.env.SEEDING_TRANSPORT_CERTIFICATIONS_FILE || "").trim();
  if (!file) return [];
  try {
    const parsed = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    if (!Array.isArray(parsed)) throw new Error("Transport certification file must contain an array");
    return parsed.filter((item) => item && typeof item === "object");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

await loadLocalEnv();
const configuredTransportCertifications = await loadTransportCertifications();

// Keep loopback as the safe local default; VPS deployments can set SEEDING_HOST
// explicitly (usually 127.0.0.1 behind nginx, or 0.0.0.0 with a firewall).
const host = String(process.env.SEEDING_HOST || "127.0.0.1").trim() || "127.0.0.1";
const port = Number(process.env.SEEDING_PORT || 4318);
const operatorToken = String(process.env.SEEDING_OPERATOR_TOKEN || "").trim();
const automationToken = String(process.env.SEEDING_AUTOMATION_TOKEN || "").trim();
const controlToken = String(process.env.SEEDING_CONTROL_TOKEN || "").trim();
const sourceCommit = String(process.env.SEEDING_BUILD_COMMIT || "");
const sourceDirty = process.env.SEEDING_BUILD_DIRTY === "true";
const trafficPollMinutes = Number(process.env.SEEDING_TRAFFIC_POLL_MINUTES || 0);
const controlCycleEnabled = process.env.SEEDING_CONTROL_CYCLE_ENABLED === "true";
const controlCycleMinutes = Number(process.env.SEEDING_CONTROL_CYCLE_MINUTES || 0);
const discoveryPollMinutes = Number(process.env.SEEDING_DISCOVERY_POLL_MINUTES || 0);
if (operatorToken.length < 32) {
  throw new Error("SEEDING_OPERATOR_TOKEN must contain at least 32 characters");
}
if (automationToken.length < 32) {
  throw new Error("SEEDING_AUTOMATION_TOKEN must contain at least 32 characters");
}
if (automationToken === operatorToken) throw new Error("Operator and automation tokens must be different");
if (!Number.isFinite(trafficPollMinutes) || trafficPollMinutes < 0 || (trafficPollMinutes > 0 && trafficPollMinutes < 15)) {
  throw new Error("SEEDING_TRAFFIC_POLL_MINUTES must be 0 (disabled) or at least 15");
}
if (!Number.isFinite(discoveryPollMinutes) || discoveryPollMinutes < 0 || (discoveryPollMinutes > 0 && discoveryPollMinutes < 15)) {
  throw new Error("SEEDING_DISCOVERY_POLL_MINUTES must be 0 (disabled) or at least 15");
}
if (controlCycleEnabled && (!Number.isFinite(controlCycleMinutes) || controlCycleMinutes < 15)) {
  throw new Error("SEEDING_CONTROL_CYCLE_MINUTES must be at least 15 when enabled");
}
const store = new JsonStore(stateFile, { requireLease: true });
await store.acquireWriterLease();
const readinessTtlMs = configuredReadinessTtlMs();
const orcaBrowser = new OrcaCliClient();
// Metadata-only discovery of an already-running GPM listener. It never starts
// a profile and does not make authenticated work eligible without a binding.
const gpmProcessDiscovery = await discoverGpmProcessEndpoints();
const readinessProviderRegistry = new ReadinessProviderRegistry();
readinessProviderRegistry.register("linkedin", new LinkedInReadinessProvider(orcaBrowser, { ttlMs: readinessTtlMs }));
const service = new SeedingService(store, {
  readinessTtlMs,
  readinessProviderRegistry,
  browserRuntimeRouter: createDefaultBrowserRuntimeRouter({
    orcaBrowser,
    gpm: {
      endpointCandidates: gpmProcessDiscovery.endpoints,
      probe: ({ runtime }) => probeGpmRuntime({ endpointCandidates: runtime.endpointCandidates, profileCatalogPath: "/api/v1/profiles" })
    }
  }),
  // Dashboard catalog observation is a bounded, read-only GET. It never
  // starts/stops a profile and returns UNKNOWN when no listener is available.
  gpmAccountCatalogObservation: async () => {
    const observation = await probeGpmRuntime({
      endpointCandidates: gpmProcessDiscovery.endpoints,
      profileCatalogPath: "/api/v1/profiles"
    });
    return observation?.profileCatalog || { state: observation?.state === "UNAVAILABLE" ? "UNAVAILABLE" : "UNKNOWN", code: observation?.code || "GPM_CATALOG_UNKNOWN", profiles: [] };
  }
});
const platformAdapterRegistry = new PlatformAdapterRegistry();
// The production lane is fail-closed until an explicit, platform/runtime
// scoped irreversible-submit certification record is supplied. Reversible
// fixture/Cancel calibration never authorizes LinkedIn Post.
const linkedinAccessibilityTransport = new OrcaAccessibilityTransport(orcaBrowser);
const linkedinPointerTransport = new OrcaPointerTransport(orcaBrowser);
platformAdapterRegistry.register("linkedin", new LinkedInAdapter(orcaBrowser, {
  transport: linkedinAccessibilityTransport,
  transportCandidates: [linkedinAccessibilityTransport, linkedinPointerTransport],
  transportCertifications: configuredTransportCertifications,
  transportRuntime: { provider: "orca", providerVersion: orcaBrowser.runtimeVersion },
  requireCertifiedTransport: true
}));
const jevWorker = new JevExecutionWorker({ service, adapterRegistry: platformAdapterRegistry, workerId: `jev-server-${process.pid}` });
let initializedState;
try {
  initializedState = await service.init();
} catch (error) {
  await store.releaseWriterLease();
  throw error;
}
const trafficIntervalMs = trafficPollMinutes * 60_000;
const lastCollectorAt = [...(initializedState.collectorRuns || [])]
  .map((run) => Date.parse(run.at || ""))
  .filter(Number.isFinite)
  .sort((left, right) => right - left)[0] || null;
const trafficRuntime = {
  enabled: trafficPollMinutes > 0,
  intervalMinutes: trafficPollMinutes || null,
  running: false,
  lastStartedAt: null,
  lastCompletedAt: lastCollectorAt ? new Date(lastCollectorAt).toISOString() : null,
  nextRunAt: null,
  lastSummary: null
};
const controlCycleRuntime = { enabled: controlCycleEnabled, intervalMinutes: controlCycleEnabled ? controlCycleMinutes : null, running: false, lastStartedAt: null, lastCompletedAt: null, nextRunAt: null, lastSummary: null };
const discoveryRuntime = { enabled: discoveryPollMinutes > 0, intervalMinutes: discoveryPollMinutes || null, running: false, lastStartedAt: null, lastCompletedAt: null, nextRunAt: null, lastSummary: null };
const fixtureWorker = new FixtureWorkerBridge({ service });
let trafficTimer = null;
let controlCycleTimer = null;
let discoveryTimer = null;
let campaignQueueTimer = null;
let jevExecutionTimer = null;
let jevExecutionRunning = false;
const jevExecutionStarted = new Set();
let campaignQueueRunning = false;
const campaignQueueRuntime = {
  enabled: true,
  intervalSeconds: 30,
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  nextRunAt: null,
  lastSummary: null
};
const jevDryRunRuntime = {
  enabled: process.env.SEEDING_JEV_DRY_RUN_AUTONOMOUS_ENABLED === "true",
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  nextRunAt: null,
  lastSummary: null
};
let shuttingDown = false;

function scheduleTrafficCollection(delayMs = trafficIntervalMs) {
  if (!trafficRuntime.enabled || shuttingDown) return;
  if (trafficTimer) clearTimeout(trafficTimer);
  const boundedDelay = Math.max(1_000, delayMs);
  trafficRuntime.nextRunAt = new Date(Date.now() + boundedDelay).toISOString();
  trafficTimer = setTimeout(() => {
    runTrafficCollection("scheduled-official-collector").catch(() => undefined);
  }, boundedDelay);
  trafficTimer.unref();
}

function scheduleControlCycle(delayMs = controlCycleMinutes * 60_000) {
  if (!controlCycleRuntime.enabled || shuttingDown) return;
  if (controlCycleTimer) clearTimeout(controlCycleTimer);
  const boundedDelay = Math.max(1_000, delayMs);
  controlCycleRuntime.nextRunAt = new Date(Date.now() + boundedDelay).toISOString();
  controlCycleTimer = setTimeout(async () => {
    if (controlCycleRuntime.running || shuttingDown) return scheduleControlCycle();
    controlCycleRuntime.running = true;
    controlCycleRuntime.lastStartedAt = new Date().toISOString();
    try {
      const state = await service.snapshot();
      const results = [];
      for (const campaign of state.campaigns || []) {
        if (shuttingDown) break;
        try { results.push(await service.runCampaignControlCycle(campaign.id, {}, "scheduled-control-cycle")); }
        catch (error) { results.push({ campaignId: campaign.id, ok: false, reason: error.code || error.message }); }
      }
      controlCycleRuntime.lastSummary = { campaigns: results.length, succeeded: results.filter((item) => item?.advisory === true).length, failed: results.filter((item) => item?.ok === false).length };
    } catch (error) {
      controlCycleRuntime.lastSummary = { campaigns: 0, succeeded: 0, failed: 1, reason: error.code || "control_cycle_error" };
    } finally {
      controlCycleRuntime.running = false;
      controlCycleRuntime.lastCompletedAt = new Date().toISOString();
      scheduleControlCycle();
    }
  }, boundedDelay);
  controlCycleTimer.unref();
}

async function runDiscoveryCollection(actor = "scheduled-discovery-observer") {
  discoveryRuntime.running = true;
  discoveryRuntime.lastStartedAt = new Date().toISOString();
  try {
    const summary = await pollConfiguredDiscoveries(service, { actor, shuttingDown });
    discoveryRuntime.lastSummary = { campaigns: summary.campaigns, succeeded: summary.succeeded, failed: summary.failed };
    return summary.results;
  } finally {
    discoveryRuntime.running = false;
    discoveryRuntime.lastCompletedAt = new Date().toISOString();
  }
}

function scheduleDiscoveryCollection(delayMs = discoveryPollMinutes * 60_000) {
  if (!discoveryRuntime.enabled || shuttingDown) return;
  if (discoveryTimer) clearTimeout(discoveryTimer);
  const boundedDelay = Math.max(1_000, delayMs);
  discoveryRuntime.nextRunAt = new Date(Date.now() + boundedDelay).toISOString();
  discoveryTimer = setTimeout(async () => {
    if (!discoveryRuntime.running && !shuttingDown) {
      try { await runDiscoveryCollection(); } catch (error) { discoveryRuntime.lastSummary = { campaigns: 0, succeeded: 0, failed: 1, reason: String(error?.code || "discovery_error") }; }
    }
    scheduleDiscoveryCollection();
  }, boundedDelay);
  discoveryTimer.unref();
}

function scheduleCampaignQueueEvaluation(delayMs = 30_000) {
  if (shuttingDown) return;
  if (campaignQueueTimer) clearTimeout(campaignQueueTimer);
  campaignQueueTimer = setTimeout(async () => {
    if (campaignQueueRunning || shuttingDown) return scheduleCampaignQueueEvaluation();
    campaignQueueRunning = true;
    campaignQueueRuntime.running = true;
    campaignQueueRuntime.lastStartedAt = new Date().toISOString();
    try {
      const results = await service.queueDueCampaignJobs("campaign-queue-scheduler");
      const failed = results.filter((item) => item?.failed === true);
      const failureReasons = [...new Set(failed.map((item) => String(item?.reason || "campaign_queue_failed")).filter(Boolean))].slice(0, 8);
      campaignQueueRuntime.lastSummary = {
        campaigns: results.length,
        decisions: results.reduce((count, item) => count + (Array.isArray(item?.decisions) ? item.decisions.length : 0), 0),
        failed: failed.length,
        failureReasons
      };
    } catch (error) {
      campaignQueueRuntime.lastSummary = {
        campaigns: 0,
        decisions: 0,
        failed: 1,
        failureReasons: ["queue_evaluation_failed"]
      };
      process.stderr.write(`Campaign queue evaluation failed: ${campaignQueueRuntime.lastSummary.failureReasons[0]}\n`);
    } finally {
      campaignQueueRunning = false;
      campaignQueueRuntime.running = false;
      campaignQueueRuntime.lastCompletedAt = new Date().toISOString();
      scheduleCampaignQueueEvaluation();
    }
  }, Math.max(1_000, delayMs));
  campaignQueueRuntime.nextRunAt = new Date(Date.now() + Math.max(1_000, delayMs)).toISOString();
  campaignQueueTimer.unref();
}

function scheduleJevExecution(delayMs = 5_000) {
  if (shuttingDown || process.env.SEEDING_JEV_WORKER_ENABLED !== "true") return;
  if (jevExecutionTimer) clearTimeout(jevExecutionTimer);
  jevExecutionTimer = setTimeout(async () => {
    const liveExecutionId = String(process.env.SEEDING_JEV_LIVE_EXECUTION_ID || "").trim();
    const dryRunExecutionId = String(process.env.SEEDING_JEV_DRY_RUN_EXECUTION_ID || "").trim();
    const autonomousLive = process.env.SEEDING_JEV_LIVE_ENABLED === "true" && process.env.SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED === "true";
    const executionId = liveExecutionId || dryRunExecutionId;
    const autonomousDryRun = jevDryRunRuntime.enabled && !liveExecutionId && !dryRunExecutionId;
    const dryRunOnly = autonomousDryRun && !autonomousLive;
    if (jevExecutionRunning || shuttingDown) return scheduleJevExecution();
    const shouldExecute = autonomousLive || Boolean(executionId && !jevExecutionStarted.has(executionId));
    jevExecutionRunning = true;
    if (shouldExecute && executionId) jevExecutionStarted.add(executionId);
    try {
      // A dry-run-only rehearsal is intentionally isolated from the automatic
      // reconciliation lane: it must not mutate historical UNKNOWN records.
      const reconciliations = dryRunOnly ? [] : await jevWorker.reconcilePendingOnce();
      if (shouldExecute) {
        if (autonomousLive && !liveExecutionId) {
          const results = await jevWorker.runReadyOnce({ dryRun: false });
          process.stdout.write(`JEV autonomous cycle ${JSON.stringify({ jobs: results.length, confirmed: results.filter((item) => item.status === "CONFIRMED").length, unknown: results.filter((item) => item.status === "UNKNOWN").length, unsupported: results.filter((item) => item.status === "PLATFORM_UNSUPPORTED").length, reconciliations: reconciliations.length })}\n`);
        } else {
          const result = await jevWorker.run(executionId, { dryRun: !liveExecutionId });
          process.stdout.write(`JEV execution ${JSON.stringify({ executionId, status: result.status, submitState: result.receipt?.submitState || null, reconciliations: reconciliations.length })}\n`);
        }
      } else if (dryRunOnly) {
        jevDryRunRuntime.running = true;
        jevDryRunRuntime.lastStartedAt = new Date().toISOString();
        // The autonomous rehearsal lane owns its explicit candidate handoff.
        // Keep this before the worker query so a newly marked candidate can
        // reach the existing dry-run request/lease/receipt path in the same
        // tick. This branch is entered only when no live or explicit
        // execution id is configured, so it cannot create live authority or
        // reconcile historical UNKNOWN executions.
        const handoff = await service.handoffRehearsalCandidates("dry-run-handoff-scheduler");
        const results = await jevWorker.runReadyDryRunOnce();
        const handoffResults = Array.isArray(handoff?.results) ? handoff.results : [];
        jevDryRunRuntime.lastSummary = {
          jobs: results.length,
          completed: results.filter((item) => item.status === "DRY_RUN_COMPLETE").length,
          failed: results.filter((item) => item.status === "DRY_RUN_FAILED" || item.status === "WORKER_ERROR").length,
          handoff: {
            scanned: Number(handoff?.scanned || 0),
            requestReady: handoffResults.filter((item) => item.status === "REQUEST_READY").length,
            completed: handoffResults.filter((item) => item.status === "DRY_RUN_COMPLETE").length,
            skipped: handoffResults.filter((item) => item.status === "SKIPPED").length
          }
        };
      } else if (reconciliations.length > 0) {
        process.stdout.write(`JEV reconciliation ${JSON.stringify({ executions: reconciliations.length, confirmed: reconciliations.filter((item) => item.status === "CONFIRMED").length, unsupported: reconciliations.filter((item) => item.status === "PLATFORM_UNSUPPORTED").length })}\n`);
      }
    } catch (error) {
      process.stderr.write(`JEV cycle stopped ${JSON.stringify({ executionId: executionId || null, reason: error.code || "worker_error" })}\n`);
    } finally {
      if (jevDryRunRuntime.running) {
        jevDryRunRuntime.running = false;
        jevDryRunRuntime.lastCompletedAt = new Date().toISOString();
      }
      jevExecutionRunning = false;
      scheduleJevExecution();
    }
  }, Math.max(1_000, delayMs));
  jevExecutionTimer.unref();
  jevDryRunRuntime.nextRunAt = new Date(Date.now() + Math.max(1_000, delayMs)).toISOString();
}

async function readDailyProductionAutomation() {
  for (const receiptPath of [dailyAutomationReceiptFile, dailyAutomationFile]) {
    try {
      const payload = JSON.parse((await readFile(receiptPath, "utf8")).replace(/^\uFEFF/, ""));
      const receipt = payload.production || payload;
      return {
        configured: true,
        id: String(receipt.id || receipt.automationId || ""),
        name: String(receipt.name || "Daily Blender artifact and seeding drafts"),
        enabled: receipt.enabled !== false,
        timezone: String(receipt.timezone || "Asia/Saigon"),
        rrule: String(receipt.rrule || ""),
        nextRunAt: receipt.nextRunAt || null,
        workspaceId: String(receipt.workspaceId || "")
      };
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return { configured: false, enabled: false, nextRunAt: null };
}

async function readBrowserTrafficAutomation() {
  try {
    const receipt = JSON.parse((await readFile(browserAutomationFile, "utf8")).replace(/^\uFEFF/, ""));
    return {
      configured: true,
      id: String(receipt.id || ""),
      name: String(receipt.name || "Browser verified traffic tracking"),
      enabled: receipt.enabled !== false,
      timezone: String(receipt.timezone || "Asia/Saigon"),
      rrule: String(receipt.rrule || ""),
      nextRunAt: receipt.nextRunAt || null,
      workspaceId: String(receipt.workspaceId || ""),
      mode: "browser_verified"
    };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return { configured: false, enabled: false, nextRunAt: null, mode: "browser_verified" };
    }
    throw error;
  }
}

async function runTrafficCollection(actor = "scheduled-official-collector") {
  if (!trafficRuntime.enabled) throw new Error("Traffic collector is disabled");
  if (trafficRuntime.running) return { skipped: true, reason: "collector_already_running" };
  trafficRuntime.running = true;
  trafficRuntime.lastStartedAt = new Date().toISOString();
  try {
    const results = await service.collectAllMetrics(actor, { dueOnly: true });
    trafficRuntime.lastSummary = {
      total: results.length,
      succeeded: results.filter((item) => item.ok === true).length,
      failed: results.filter((item) => item.ok === false).length,
      unknown: results.filter((item) => item.ok === null).length
    };
    return results;
  } finally {
    trafficRuntime.running = false;
    trafficRuntime.lastCompletedAt = new Date().toISOString();
    scheduleTrafficCollection();
  }
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(payload);
}

function tokenMatches(request, expectedToken) {
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7).trim());
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function requestRole(request) {
  if (tokenMatches(request, operatorToken)) return "operator";
  if (tokenMatches(request, automationToken)) return "automation";
  return null;
}

function automationCanMutate(method, pathname) {
  if (method === "PATCH" && /^\/api\/campaigns\/[^/]+$/.test(pathname)) return true;
  if (method !== "POST") return false;
  if (/^\/api\/campaigns\/[^/]+\/queue-ready-jobs$/.test(pathname)) return true;
  if (/^\/api\/campaigns\/[^/]+\/readiness-check$/.test(pathname)) return true;
  if (/^\/api\/campaigns\/[^/]+\/product-factory$/.test(pathname)) return true;
  if (/^\/api\/campaigns\/[^/]+\/product-factory\/artifacts\/promote$/.test(pathname)) return false;
  if (/^\/api\/campaigns\/[^/]+\/product-intelligence\/inspect$/.test(pathname)) return true;
  if (pathname === "/api/campaigns/bootstrap") return true;
  if (/^\/api\/campaigns\/[^/]+\/distribution-handoff$/.test(pathname)) return true;
  if (/^\/api\/campaigns\/[^/]+\/content-candidates\/materialize$/.test(pathname)) return true;
  if (/^\/api\/campaigns\/[^/]+\/discoveries\/observe$/.test(pathname)) return true;
  if (/^\/api\/campaigns\/[^/]+\/control-cycle$/.test(pathname)) return true;
  if (/^\/api\/posts\/[^/]+\/execution-request$/.test(pathname)) return true;
  if (/^\/api\/execution-requests\/[^/]+\/receipt$/.test(pathname)) return true;
  return [
    /^\/api\/campaigns$/,
    /^\/api\/posts$/,
    /^\/api\/automation\/collect-now$/,
    /^\/api\/campaigns\/[^/]+\/artifacts$/,
    /^\/api\/campaigns\/[^/]+\/stories$/,
    /^\/api\/campaigns\/[^/]+\/product-intelligence$/,
    /^\/api\/campaigns\/[^/]+\/discoveries$/,
    /^\/api\/campaigns\/[^/]+\/outcome$/,
    /^\/api\/campaigns\/[^/]+\/learning$/,
    /^\/api\/stories\/[^/]+\/channel-drafts$/,
    /^\/api\/schedules\/[^/]+\/runs$/,
    /^\/api\/posts\/[^/]+\/collect-metrics$/,
    /^\/api\/posts\/[^/]+\/browser-observations$/,
    /^\/api\/posts\/[^/]+\/interactions$/,
    /^\/api\/interactions\/[^/]+\/reply-draft$/
  ].some((pattern) => pattern.test(pathname));
}

async function readJson(request) {
  let payload = "";
  for await (const chunk of request) {
    payload += chunk;
    if (payload.length > 1_000_000) throw new Error("Request body too large");
  }
  return payload ? JSON.parse(payload) : {};
}

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolvedPublicRoot = path.resolve(publicRoot);
  const filePath = path.resolve(resolvedPublicRoot, relative);
  const relativeToPublic = path.relative(resolvedPublicRoot, filePath);
  if (relativeToPublic.startsWith("..") || path.isAbsolute(relativeToPublic)) return false;
  try {
    const payload = await readFile(filePath);
    response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(payload);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      if (!path.extname(pathname)) {
        const indexPath = path.join(resolvedPublicRoot, "index.html");
        try {
          const indexPayload = await readFile(indexPath);
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(indexPayload);
          return true;
        } catch (indexError) {
          if (indexError.code !== "ENOENT") throw indexError;
        }
      }
      return false;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  const role = requestRole(request);
  const actor = role === "operator" ? "local-human-operator" : role === "automation" ? "local-draft-automation" : "read-only-client";
  let match;
  try {
    if (request.method === "POST" && url.pathname === "/internal/shutdown") {
      if (!isAuthorizedLocalShutdown({
        remoteAddress: request.socket.remoteAddress,
        authorization: request.headers.authorization,
        expectedToken: controlToken
      })) return sendJson(response, 404, { ok: false, error: "not_found" });
      sendJson(response, 202, { ok: true, shutdown: "accepted" });
      setImmediate(shutdown);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method) && (!role || (role === "automation" && !automationCanMutate(request.method, url.pathname)))) {
      return sendJson(response, 401, { ok: false, error: "operator_token_required" }, {
        "www-authenticate": "Bearer realm=\"global-seeding\""
      });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const state = await service.snapshot();
      return sendJson(response, 200, {
        ok: true, service: "global-seeding", stateFile,
        runtime: runtimeMetadata({ pid: process.pid, sourceCommit, sourceDirty, state }),
        executionRuntime: projectExecutionRuntime(state),
        productFactorySandbox: await service.productFactorySandboxCapability(),
        trafficCollector: trafficRuntime,
        campaignQueue: campaignQueueRuntime,
        controlCycle: controlCycleRuntime,
        discovery: discoveryRuntime,
        jevDryRun: jevDryRunRuntime,
        dailyProduction: await readDailyProductionAutomation(),
        browserTracking: await readBrowserTrafficAutomation(),
        fixtureWorker: fixtureWorker.runtime()
      });
    }
    if (request.method === "GET" && url.pathname === "/api/operator/session") {
      if (role !== "operator") {
        return sendJson(response, 401, { ok: false, error: "operator_token_required" }, {
          "www-authenticate": "Bearer realm=\"global-seeding\""
        });
      }
      return sendJson(response, 200, { ok: true, actor });
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      if (role !== "operator") {
        return sendJson(response, 401, { ok: false, error: "operator_token_required" }, {
          "www-authenticate": "Bearer realm=\"global-seeding\""
        });
      }
      return sendJson(response, 200, await service.snapshot());
    }
    if (request.method === "POST" && url.pathname === "/api/control/kill-switch/activate") {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      const input = await readJson(request);
      return sendJson(response, 200, await service.activateKillSwitch(input.reason, actor));
    }
    if (request.method === "POST" && url.pathname === "/api/control/kill-switch/deactivate") {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.deactivateKillSwitch(actor));
    }
    let killRebaseMatch = url.pathname.match(/^\/api\/control\/kill-switch\/posts\/([^/]+)\/rebase$/);
    if (request.method === "POST" && killRebaseMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.rebasePostKillEpoch(killRebaseMatch[1], actor));
    }
    if (request.method === "POST" && url.pathname === "/api/live-execution-grants") {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 201, await service.createLiveExecutionGrant(await readJson(request), actor));
    }
    if (request.method === "POST" && url.pathname === "/api/one-time-execution-windows") {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 201, await service.createOneTimeExecutionWindow(await readJson(request), actor));
    }
    let executionWindowMatch = url.pathname.match(/^\/api\/one-time-execution-windows\/([^/]+)$/);
    if (request.method === "GET" && executionWindowMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.getOneTimeExecutionWindow(executionWindowMatch[1]));
    }
    executionWindowMatch = url.pathname.match(/^\/api\/one-time-execution-windows\/([^/]+)\/revoke$/);
    if (request.method === "POST" && executionWindowMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.revokeOneTimeExecutionWindow(executionWindowMatch[1], actor));
    }
    let uncertaintyMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/quarantine-unknown$/);
    if (request.method === "POST" && uncertaintyMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 201, await service.quarantineLegacySubmission(uncertaintyMatch[1], await readJson(request), actor));
    }
    uncertaintyMatch = url.pathname.match(/^\/api\/submission-uncertainties\/([^/]+)$/);
    if (request.method === "GET" && uncertaintyMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.getSubmissionUncertainty(uncertaintyMatch[1]));
    }
    uncertaintyMatch = url.pathname.match(/^\/api\/submission-uncertainties\/([^/]+)\/reconcile$/);
    if (request.method === "POST" && uncertaintyMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.reconcileSubmissionUncertainty(uncertaintyMatch[1], await readJson(request), actor));
    }
    let liveGrantMatch = url.pathname.match(/^\/api\/live-execution-grants\/([^/]+)$/);
    if (request.method === "GET" && liveGrantMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.getLiveExecutionGrant(liveGrantMatch[1]));
    }
    liveGrantMatch = url.pathname.match(/^\/api\/live-execution-grants\/([^/]+)\/revoke$/);
    if (request.method === "POST" && liveGrantMatch) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.revokeLiveExecutionGrant(liveGrantMatch[1], actor));
    }
    if (request.method === "GET" && url.pathname === "/api/execution-requests/ready") {
      if (!new Set(["operator", "automation"]).has(role)) return sendJson(response, 401, { ok: false, error: "execution_read_token_required" });
      return sendJson(response, 200, await service.readyExecutionRequests());
    }
    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      return sendJson(response, 200, {
        ...(await service.dashboard()),
        autoGtm: await readAutoGtmFeed(autoGtmFeedFile),
        automation: {
          trafficCollector: trafficRuntime,
          campaignQueue: campaignQueueRuntime,
          controlCycle: controlCycleRuntime,
          discovery: discoveryRuntime,
          jevDryRun: jevDryRunRuntime,
          dailyProduction: await readDailyProductionAutomation(),
          browserTracking: await readBrowserTrafficAutomation(),
          fixtureWorker: fixtureWorker.runtime()
        }
      });
    }
    let handoffMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/distribution-handoffs$/);
    if (request.method === "GET" && handoffMatch) {
      const dashboard = await service.dashboard();
      return sendJson(response, 200, { campaignId: handoffMatch[1], handoffs: dashboard.distributionHandoffs.filter((item) => item.campaignId === handoffMatch[1]) });
    }
    if (request.method === "GET" && url.pathname === "/api/leads") {
      return sendJson(response, 200, await readAutoGtmFeed(autoGtmFeedFile));
    }
    if (request.method === "GET" && url.pathname === "/api/flow-graph") {
      return sendJson(response, 200, await service.flowGraph());
    }
    if (request.method === "POST" && url.pathname === "/api/bootstrap/r19") {
      return sendJson(response, 200, await service.bootstrapR19(actor));
    }
    if (request.method === "POST" && url.pathname === "/api/automation/collect-now") {
      return sendJson(response, 200, await runTrafficCollection(actor));
    }
    if (request.method === "POST" && url.pathname === "/api/campaigns") {
      return sendJson(response, 201, await service.createCampaign(await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/product-factory$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.runProductFactory(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/strategy$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.deriveStrategy(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/outcome$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.deriveOutcomeSummary(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/learning$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.deriveLearningFeedback(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/control-cycle$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.runCampaignControlCycle(match[1], await readJson(request), actor));
    }
    if (request.method === "POST" && url.pathname === "/api/targets") {
      return sendJson(response, 201, await service.createTarget(await readJson(request), actor));
    }
    if (request.method === "POST" && url.pathname === "/api/campaigns/bootstrap") {
      return sendJson(response, 201, await service.bootstrapAutonomousCampaign(await readJson(request), actor));
    }
    if (request.method === "POST" && url.pathname === "/api/execution-accounts") {
      return sendJson(response, 201, await service.registerExecutionAccount(await readJson(request), actor));
    }
    if (request.method === "POST" && url.pathname === "/api/community-memberships") {
      return sendJson(response, 201, await service.createCommunityMembership(await readJson(request), actor));
    }
    if (request.method === "POST" && url.pathname === "/api/posts") {
      return sendJson(response, 201, await service.createPost(await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/readiness-check$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.refreshCampaignJobReadiness(match[1], actor, { force: true }));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)$/);
    if (request.method === "PATCH" && match) {
      return sendJson(response, 200, await service.updateCampaign(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/authorization$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.authorizeCampaign(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/authorization\/([^/]+)\/destinations\/([^/]+)\/profile$/);
    if (request.method === "PATCH" && match) {
      const input = await readJson(request);
      return sendJson(response, 200, await service.updateCampaignAuthorizationProfileBinding(
        match[1], match[2], match[3], input.profileId, actor
      ));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/authorization\/(pause|resume)$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.setCampaignAuthorizationStatus(match[1], match[2] === "pause" ? "paused" : "active", actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/queue-ready-jobs$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.queueAuthorizedCampaignJobs(match[1], actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/readiness-check$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.queueAuthorizedCampaignJobs(match[1], actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/artifacts$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.registerArtifact(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/product-factory\/artifacts\/promote$/);
    if (request.method === "POST" && match) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 201, await service.promoteProductFactoryArtifact(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/stories$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.createStory(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/product-intelligence$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.attachProductIntelligence(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/distribution-handoff$/);
    if (request.method === "POST" && match) {
      const input = await readJson(request);
      return sendJson(response, 200, input?.bridgeVersion !== undefined
        ? await consumeSystemAgenticHandoff(service, input, actor, { expectedCampaignId: match[1] })
        : await service.attachDistributionHandoff(match[1], input, actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/content-candidates$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.deriveContentCandidates(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/template-content-candidates$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.deriveTemplateContentCandidates(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/content-candidates\/materialize$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.materializeContentCandidate(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/product-intelligence\/inspect$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.inspectProductIntelligence(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/discoveries$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.recordDiscoveries(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/discoveries\/observe$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.observeDiscoveries(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/stories\/([^/]+)\/channel-drafts$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.createChannelDrafts(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/schedules$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.createSchedule(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/schedules\/([^/]+)$/);
    if (request.method === "PATCH" && match) {
      return sendJson(response, 200, await service.updateSchedule(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/schedules\/([^/]+)\/runs$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.recordScheduleRun(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/keywords\/metrics$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.recordKeywordMetrics(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/targets\/([^/]+)$/);
    if (request.method === "PATCH" && match) {
      return sendJson(response, 200, await service.updateTarget(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/community-memberships\/([^/]+)$/);
    if (request.method === "PATCH" && match) {
      return sendJson(response, 200, await service.updateCommunityMembership(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (request.method === "PATCH" && match) {
      return sendJson(response, 200, await service.updatePost(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/approve$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.approvePost(match[1], actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/transition$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.transitionPost(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/execution-request$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.prepareExecutionRequest(match[1], actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/execution-request\/dry-run$/);
    if (request.method === "POST" && match) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.prepareExecutionRequest(match[1], actor, { dryRun: true }));
    }
    match = url.pathname.match(/^\/api\/execution-requests\/([^/]+)\/cancel$/);
    if (request.method === "POST" && match) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      return sendJson(response, 200, await service.cancelExecutionRequest(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/execution-requests\/([^/]+)\/run-dry-run$/);
    if (request.method === "POST" && match) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      const context = await service.executionContext(match[1]);
      if (context.request?.dryRun !== true) return sendJson(response, 409, { ok: false, error: "dry_run_request_required" });
      return sendJson(response, 200, await jevWorker.run(match[1], { dryRun: true }));
    }
    match = url.pathname.match(/^\/api\/execution-requests\/([^/]+)\/dispatch$/);
    if (request.method === "POST" && match) {
      if (role !== "operator") return sendJson(response, 401, { ok: false, error: "operator_token_required" });
      const input = await readJson(request);
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 0) {
        return sendJson(response, 400, { ok: false, error: "exact_dispatch_does_not_accept_request_body" });
      }
      return sendJson(response, 200, await jevWorker.dispatchExactExecution(match[1]));
    }
    match = url.pathname.match(/^\/api\/execution-requests\/([^/]+)\/receipt$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.recordExecutionReceipt(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/metrics$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.recordMetrics(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/collect-metrics$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.collectMetrics(match[1], actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/browser-observations$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.recordBrowserObservation(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/posts\/([^/]+)\/interactions$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.addInteraction(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/interactions\/([^/]+)\/reply-draft$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.draftReply(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/replies\/([^/]+)\/approve$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.approveReply(match[1], actor));
    }
    match = url.pathname.match(/^\/api\/replies\/([^/]+)\/sent$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 200, await service.markReplySent(match[1], await readJson(request), actor));
    }
    match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/conversions$/);
    if (request.method === "POST" && match) {
      return sendJson(response, 201, await service.recordConversion(match[1], await readJson(request), actor));
    }
    if (request.method === "GET" && await serveStatic(response, url.pathname)) return;
    sendJson(response, 404, { ok: false, error: "not_found" });
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  process.stdout.write(`Jang Global Seeding dashboard: http://${host}:${address.port}\n`);
  fixtureWorker.start();
  scheduleCampaignQueueEvaluation();
  scheduleJevExecution();
  scheduleControlCycle();
  scheduleDiscoveryCollection();
});

if (trafficPollMinutes > 0) {
  const initialDelay = lastCollectorAt
    ? Math.max(1_000, lastCollectorAt + trafficIntervalMs - Date.now())
    : trafficIntervalMs;
  scheduleTrafficCollection(initialDelay);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (trafficTimer) clearTimeout(trafficTimer);
  if (controlCycleTimer) clearTimeout(controlCycleTimer);
  if (discoveryTimer) clearTimeout(discoveryTimer);
  if (campaignQueueTimer) clearTimeout(campaignQueueTimer);
  if (jevExecutionTimer) clearTimeout(jevExecutionTimer);
  fixtureWorker.stop();
  server.close(() => {
    void (async () => {
      while (trafficRuntime.running || controlCycleRuntime.running || discoveryRuntime.running || campaignQueueRunning || jevExecutionRunning || fixtureWorker.running) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await store.releaseWriterLease();
    })().then(() => process.exit(0)).catch((error) => {
      process.stderr.write(`Service shutdown failed ${JSON.stringify({ reason: error.code || "writer_lock_release_failed" })}\n`);
      process.exit(1);
    });
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { server, service };

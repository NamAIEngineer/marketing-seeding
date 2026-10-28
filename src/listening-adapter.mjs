import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePublicUrl, pinnedFetch } from "./discovery-observer.mjs";
import {
  CRAWL4AI_SOURCE_REVISION, EXTRACTOR_REVISION, FETCHER_REVISIONS, LISTENING_CONTRACT_VERSION,
  createListeningJobId, normalizeAnalysisInput, normalizeBackend, normalizeExtractedRecord,
  normalizeFetchResult, normalizePublicUrl, normalizeScope, publicRunSummary, sha256, stableHash
} from "./listening-contract.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(MODULE_DIR, "..");
const DEFAULT_MAX_HTML_BYTES = 2_000_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2_500_000;
const DEFAULT_PYTHON = existsSync(path.join(APP_ROOT, ".venv-crawl4ai", "bin", "python"))
  ? path.join(APP_ROOT, ".venv-crawl4ai", "bin", "python") : "python3";

function boundedText(value, limit = 8000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function processTreeMetrics(pid) {
  if (!pid) return { pids: [], count: 0, rssKb: 0 };
  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8", timeout: 1_000 });
    const rows = output.split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number)).filter((row) => row.length === 3 && row.every(Number.isInteger));
    const children = new Map(); const rss = new Map();
    for (const [child, parent, resident] of rows) {
      (children.get(parent) || children.set(parent, []).get(parent)).push(child);
      rss.set(child, resident);
    }
    const pids = []; const queue = [pid]; while (queue.length) { const current = queue.shift(); if (pids.includes(current)) continue; pids.push(current); queue.push(...(children.get(current) || [])); }
    return { pids, count: pids.length, rssKb: pids.reduce((total, item) => total + (rss.get(item) || 0), 0) };
  } catch { return { pids: [pid], count: 1, rssKb: null }; }
}

function nowIso() { return new Date().toISOString(); }

function childTreePids(pid) {
  return pid ? [pid] : [];
}

async function collectStream(stream, maxBytes, chunks, label) {
  let total = 0;
  for await (const chunk of stream) {
    total += Buffer.byteLength(chunk);
    if (total > maxBytes) throw new Error(`${label} exceeds byte bound`);
    chunks.push(Buffer.from(chunk));
  }
}

async function runPythonWorker(script, input, { timeoutMs = 45_000, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, python = process.env.SEEDING_LISTENING_PYTHON || process.env.PYTHON || DEFAULT_PYTHON } = {}) {
  const child = spawn(python, [script], { cwd: APP_ROOT, stdio: ["pipe", "pipe", "pipe"], detached: true, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
  const stdout = [], stderr = [];
  const startedAt = Date.now();
  let timedOut = false;
  let streamError = null;
  let killTimer;
  let firstMetrics = processTreeMetrics(child.pid);
  let peakMetrics = firstMetrics;
  const sampleMetrics = () => {
    const current = processTreeMetrics(child.pid);
    if (!firstMetrics.count && current.count) firstMetrics = current;
    if (current.count > peakMetrics.count || (Number.isFinite(current.rssKb) && current.rssKb > (peakMetrics.rssKb || 0))) {
      peakMetrics = { count: Math.max(peakMetrics.count, current.count), rssKb: Math.max(peakMetrics.rssKb || 0, current.rssKb || 0) };
    }
  };
  const metricsTimer = setInterval(sampleMetrics, 100);
  const closePromise = once(child, "close");
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    killTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 1_500);
  }, Math.max(100, timeoutMs));
  try {
    const encoded = Buffer.from(JSON.stringify(input));
    if (encoded.byteLength > DEFAULT_MAX_HTML_BYTES + 100_000) throw new Error("worker input exceeds byte bound");
    child.stdin.end(encoded);
    await Promise.all([
      collectStream(child.stdout, maxOutputBytes, stdout, "worker stdout"),
      collectStream(child.stderr, 200_000, stderr, "worker stderr"),
      closePromise
    ]).catch((error) => { streamError = error; try { process.kill(-child.pid, "SIGTERM"); } catch {} });
    const outputText = Buffer.concat(stdout).toString("utf8").trim();
    sampleMetrics();
    const finalMetrics = processTreeMetrics(child.pid);
    const processExited = child.exitCode !== null;
    const evidence = (base = {}) => ({ workerPid: child.pid, ...base,
      processCountBefore: firstMetrics.count || null, processCountAfter: processExited ? 0 : (finalMetrics.count || 0),
      peakRssKb: Number.isFinite(peakMetrics.rssKb) ? peakMetrics.rssKb : null,
      rssKbAfter: processExited ? 0 : (Number.isFinite(finalMetrics.rssKb) ? finalMetrics.rssKb : null) });
    if (timedOut) return { status: "UNKNOWN", reason: "worker timeout", stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), childPid: child.pid, processEvidence: evidence({ cleanup: "worker_group_terminated" }), elapsedMs: Date.now() - startedAt };
    if (streamError) return { status: "FAILED", reason: boundedText(streamError.message || "worker stream failed", 240), stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), childPid: child.pid, processEvidence: evidence({ cleanup: "worker_group_terminated" }), elapsedMs: Date.now() - startedAt };
    if (!outputText) return { status: "FAILED", reason: `worker produced no JSON (exit ${child.exitCode})`, stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), childPid: child.pid, processEvidence: evidence({ cleanup: "worker_exited" }), elapsedMs: Date.now() - startedAt };
    let parsed;
    try { parsed = JSON.parse(outputText); } catch { return { status: "FAILED", reason: "worker stdout was not JSON", stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), childPid: child.pid, processEvidence: evidence({ cleanup: "worker_exited" }), elapsedMs: Date.now() - startedAt }; }
    return { ...parsed, childPid: child.pid, stderr: Buffer.concat(stderr).toString("utf8").slice(-2000), processEvidence: evidence({ ...(parsed.processEvidence || {}), cleanup: parsed.processEvidence?.cleanup || "worker_exited" }), elapsedMs: Date.now() - startedAt };
  } finally {
    clearInterval(metricsTimer);
    clearTimeout(timer); clearTimeout(killTimer);
    if (!child.killed && child.exitCode === null) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  }
}

async function boundedFetchHtml(rawUrl, { timeoutMs = 20_000, maxBytes = DEFAULT_MAX_HTML_BYTES, fetchImpl = null } = {}) {
  const resolved = await resolvePublicUrl(rawUrl, { timeoutMs: Math.min(timeoutMs, 8_000) });
  const url = resolved.url;
  if (fetchImpl !== null && typeof fetchImpl !== "function") throw new Error("fetch implementation unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  try {
    const response = typeof fetchImpl === "function"
      ? await fetchImpl(url, { redirect: "error", signal: controller.signal, headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9", "user-agent": "marketing-seeding-listening/1.0" } })
      : await pinnedFetch(url, resolved.address, { signal: controller.signal, timeoutMs });
    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!response.ok) return normalizeFetchResult({ contractVersion: LISTENING_CONTRACT_VERSION, sourceUrl: url.toString(), finalUrl: url.toString(), status: "FAILED", reason: `HTTP_${response.status}`, observedHttpStatus: response.status, contentType, html: "", coverage: {} }, { sourceUrl: url, backend: "http" });
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) throw new Error("HTML response exceeds byte bound");
    const reader = response.body?.getReader();
    const chunks = []; let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new Error("HTML response exceeds byte bound"); }
        chunks.push(Buffer.from(value));
      }
    } else chunks.push(Buffer.from(await response.arrayBuffer()));
    const html = Buffer.concat(chunks).toString("utf8");
    return normalizeFetchResult({ contractVersion: LISTENING_CONTRACT_VERSION, sourceUrl: url.toString(), finalUrl: url.toString(), capturedAt: nowIso(), status: "SUCCEEDED", observedHttpStatus: response.status, contentType, html, contentHash: sha256(html), coverage: { html: true, jsRendered: false, notes: ["bounded public HTTP baseline", "preflight DNS validation"] } }, { sourceUrl: url, backend: "http" });
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : boundedText(error?.message || "public HTTP read failed", 240);
    return normalizeFetchResult({ contractVersion: LISTENING_CONTRACT_VERSION, sourceUrl: url.toString(), finalUrl: url.toString(), capturedAt: nowIso(), status: error?.name === "AbortError" ? "UNKNOWN" : "FAILED", reason, observedHttpStatus: "UNKNOWN", html: "", coverage: {} }, { sourceUrl: url, backend: "http" });
  } finally { clearTimeout(timer); }
}

async function fetchWithBackend({ jobId, url, backend, options = {} }) {
  if (backend === "http") return boundedFetchHtml(url, options);
  const script = path.join(APP_ROOT, "scripts", "nodriver_fetcher.py");
  const workerOptions = { ...options, python: options.python || DEFAULT_PYTHON };
  const result = await runPythonWorker(script, { contractVersion: LISTENING_CONTRACT_VERSION, jobId, sourceUrl: normalizePublicUrl(url), timeoutSeconds: Math.max(1, Math.min(120, Number(options.timeoutMs || 30_000) / 1000)), waitSeconds: Math.max(0.1, Math.min(5, Number(options.waitSeconds || 1))) }, workerOptions);
  return normalizeFetchResult(result, { sourceUrl: url, backend });
}

async function extractHtml(fetchResult, { timeoutMs = 30_000, python, extractorScript } = {}) {
  if (fetchResult.status !== "SUCCEEDED" || !fetchResult.html) {
    return { ...fetchResult, extracted: { status: fetchResult.status, reason: fetchResult.reason, records: [], markdown: "", extractedHash: sha256("") } };
  }
  const result = await runPythonWorker(extractorScript || path.join(APP_ROOT, "scripts", "crawl4ai_extract.py"), {
    contractVersion: LISTENING_CONTRACT_VERSION, jobId: fetchResult.jobId, sourceUrl: fetchResult.sourceUrl,
    finalUrl: fetchResult.finalUrl, capturedAt: fetchResult.capturedAt, contentHash: fetchResult.contentHash, html: fetchResult.html
  }, { timeoutMs, python, maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES });
  return { ...fetchResult, extracted: result };
}

export async function runListeningExtraction({ urls = [], backend = process.env.SEEDING_LISTENING_BACKEND || "http", campaignId = null, scope = {}, policies = {}, keywords = [], blockedKeywords = [], jobId = null, options = {} } = {}) {
  const normalizedBackend = normalizeBackend(backend);
  const sourceUrls = [...new Set((Array.isArray(urls) ? urls : []).slice(0, 20).map(normalizePublicUrl))];
  if (!sourceUrls.length) throw new Error("at least one public listening URL is required");
  const normalizedScope = normalizeScope({ ...scope, campaignId: scope.campaignId || campaignId });
  const resolvedJobId = jobId || createListeningJobId({ campaignId, urls: sourceUrls, backend: normalizedBackend, sourceRevision: FETCHER_REVISIONS[normalizedBackend] });
  const startedAt = nowIso();
  const results = [];
  for (const url of sourceUrls) {
    const fetched = await fetchWithBackend({ jobId: resolvedJobId, url, backend: normalizedBackend, options });
    const extracted = await extractHtml(fetched, options);
    results.push(extracted);
  }
  const records = [];
  for (const item of results) {
    for (const [index, record] of (item.extracted?.records || []).entries()) {
      try { records.push(normalizeExtractedRecord(record, { ...item, jobId: resolvedJobId }, index)); } catch {}
    }
  }
  const uniqueRecords = [...new Map(records.map((record) => [`${record.sourceUrl}\u0000${record.recordId}\u0000${record.contentHash}`, record])).values()];
  return {
    contractVersion: LISTENING_CONTRACT_VERSION, jobId: resolvedJobId, campaignId, backend: normalizedBackend,
    sourceRevision: FETCHER_REVISIONS[normalizedBackend], extractorRevision: EXTRACTOR_REVISION,
    sourceUrls, scope: normalizedScope, policies, keywords, blockedKeywords, startedAt, completedAt: nowIso(),
    fetches: results.map((item) => ({ ...item, html: undefined, extracted: item.extracted ? { ...item.extracted, markdown: undefined } : null })),
    records: uniqueRecords, analysisInput: normalizeAnalysisInput(uniqueRecords, normalizedScope),
    statuses: results.map((item) => item.extracted?.status || item.status),
    sourceHashes: results.map((item) => item.contentHash).filter(Boolean),
    extractedHashes: results.map((item) => item.extracted?.extractedHash).filter(Boolean)
  };
}

export async function persistListeningRun(service, run, { actor = "listening-public-observer", providerTask = null } = {}) {
  if (!service || typeof service.recordDiscoveries !== "function" || typeof service.recordOiMemory !== "function") throw new Error("canonical SeedingService is required");
  const memoryIds = []; const observations = []; let deduplicatedRecords = 0; let newRecords = 0;
  const now = nowIso();
  for (const record of run.records || []) {
    const discovery = {
      url: record.url, title: record.title, text: record.text, author: record.author || "",
      source: `crawl4ai:${run.backend}`, sourceId: record.sourceId || record.recordId, observedAt: record.capturedAt,
      contentHash: record.contentHash, extractorRevision: run.extractorRevision, sourceRefs: record.sourceRefs,
      publishedAt: record.publishedAt || undefined, channel: run.scope.channel || "public-listening",
      provenance: { source: `crawl4ai:${run.backend}`, observedAt: record.capturedAt, sourceId: record.sourceId || record.recordId },
      fetch: { backend: run.backend, jobId: run.jobId, contentHash: record.contentHash, extractorRevision: run.extractorRevision, coverage: record.coverage },
      recordType: record.recordType, parentRecordId: record.parentRecordId || undefined, untrusted: true
    };
    observations.push(discovery);
  }
  const recorded = observations.length ? await service.recordDiscoveries(run.campaignId, { observations, policies: run.policies, keywords: run.keywords, blockedKeywords: run.blockedKeywords }, actor) : { accepted: 0, observations: [] };
  for (const record of run.records || []) {
    const fingerprint = stableHash({ sourceId: record.sourceId || record.recordId, contentHash: record.contentHash, scope: run.scope });
    const memory = await service.recordOiMemory({
      id: `listening-memory-${fingerprint.slice(0, 24)}`, kind: "OBSERVATION", scope: run.scope,
      entityRef: record.recordId, content: `${record.title ? `${record.title}: ` : ""}${record.text}`,
      source: `crawl4ai:${run.backend}`, sourceRevision: run.extractorRevision, observedAt: record.capturedAt,
      fingerprint, observationRefs: [`listening:${run.jobId}:${record.recordId}`], evidenceStatus: "OBSERVED",
      freshness: "public-read", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      decisionHint: "market/community listening observation"
    }, actor);
    const memoryItem = memory?.item || memory;
    memoryIds.push(memoryItem.id); if (memory?.deduplicated) deduplicatedRecords += 1; else newRecords += 1;
  }
  let providerReceipt = null;
  if (providerTask) {
    providerReceipt = await service.routeOiAgentTask({
      ...providerTask, capability: providerTask.capability || "strategy-context", privacyClass: providerTask.privacyClass || "local",
      analysisInput: run.analysisInput, analysisInputDigest: run.analysisInput.digest,
      evidenceRefs: run.records.flatMap((item) => item.sourceRefs).slice(0, 64), providers: providerTask.providers
    }, `${actor}:provider-analysis`);
  }
  const statuses = run.statuses || [];
  const status = statuses.some((item) => item === "SUCCEEDED") ? (statuses.some((item) => ["BLOCKED", "PARTIAL", "FAILED", "UNKNOWN"].includes(item)) ? "PARTIAL" : "SUCCEEDED") : (statuses[0] || "UNKNOWN");
  return publicRunSummary({ ...run, status, requested: run.sourceUrls.length, succeeded: statuses.filter((item) => item === "SUCCEEDED").length,
    partial: statuses.filter((item) => item === "PARTIAL").length, blocked: statuses.filter((item) => item === "BLOCKED").length,
    failed: statuses.filter((item) => item === "FAILED").length, unknown: statuses.filter((item) => item === "UNKNOWN").length,
    records: run.records.length, newRecords, deduplicatedRecords, memoryIds, providerReceipt });
}

export { boundedFetchHtml, extractHtml, runPythonWorker };

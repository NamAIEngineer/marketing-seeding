import { createHash, randomUUID } from "node:crypto";

export const LISTENING_CONTRACT_VERSION = 1;
export const CRAWL4AI_SOURCE_REVISION = "v0.9.5@838869bdda93f25e6d50b3f50ae9577d9b19a586";
export const NODRIVER_SOURCE_REVISION = "0233da5bfbe98dc58341f0863526b6315a97e646";
export const EXTRACTOR_REVISION = `crawl4ai-${CRAWL4AI_SOURCE_REVISION}`;
export const FETCHER_REVISIONS = Object.freeze({
  http: "http-public-read-v1",
  nodriver: `nodriver-${NODRIVER_SOURCE_REVISION}`
});

export const LISTENING_STATUSES = Object.freeze(["RUNNING", "SUCCEEDED", "PARTIAL", "BLOCKED", "FAILED", "UNKNOWN"]);
export const RECORD_TYPES = Object.freeze(["post", "comment", "page", "item", "unknown"]);

function boundedText(value, max = 8000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedArray(value, max = 32) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => boundedText(item, 600)).filter(Boolean))].slice(0, max);
}

export function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function stableHash(value) {
  const stable = (item) => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(stable).join(",")}]`;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(",")}}`;
  };
  return sha256(stable(value));
}

export function normalizePublicUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { throw new Error("listening source URL is invalid"); }
  if (!/^https?:$/i.test(url.protocol) || url.username || url.password) throw new Error("listening source URL must be credential-free HTTP(S)");
  url.hash = "";
  return url.toString();
}

export function normalizeBackend(value, fallback = "http") {
  const backend = boundedText(value || fallback, 20).toLowerCase();
  if (!Object.hasOwn(FETCHER_REVISIONS, backend)) throw new Error(`unsupported listening backend: ${backend}`);
  return backend;
}

export function normalizeScope(scope = {}) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new Error("listening scope must be an object");
  return Object.fromEntries(["campaignId", "communityId", "platform", "channel", "purpose", "locale"].map((key) => [key, boundedText(scope[key], 160) || null]));
}

export function createListeningJobId({ campaignId, urls, backend, sourceRevision = FETCHER_REVISIONS[backend] } = {}) {
  return `listening-${stableHash({ campaignId: boundedText(campaignId, 160), urls: (urls || []).map(normalizePublicUrl).sort(), backend, sourceRevision }).slice(0, 24)}-${randomUUID().slice(0, 8)}`;
}

export function normalizeCoverage(value = {}) {
  const coverage = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    html: coverage.html === true,
    jsRendered: coverage.jsRendered === true,
    markdown: coverage.markdown === true,
    structured: coverage.structured === true,
    post: coverage.post === true,
    comment: coverage.comment === true,
    iframe: coverage.iframe === true,
    shadowDom: coverage.shadowDom === true ? true : coverage.shadowDom === false ? false : "UNKNOWN",
    requestedScrollSteps: Math.max(0, Number(coverage.requestedScrollSteps) || 0),
    completedScrollSteps: Math.max(0, Number(coverage.completedScrollSteps) || 0),
    network: coverage.network === true,
    notes: boundedArray(coverage.notes, 12)
  };
}

export function normalizeFetchResult(value = {}, { sourceUrl, backend } = {}) {
  if (!value || typeof value !== "object") throw new Error("listening fetch result must be an object");
  const url = normalizePublicUrl(value.sourceUrl || sourceUrl);
  let finalUrl = url;
  try { finalUrl = normalizePublicUrl(value.finalUrl || url); } catch { finalUrl = url; }
  const normalizedBackend = normalizeBackend(value.backend || backend);
  let status = LISTENING_STATUSES.includes(String(value.status || "").toUpperCase()) ? String(value.status).toUpperCase() : "UNKNOWN";
  const html = typeof value.html === "string" ? value.html : "";
  if (html.length > 2_000_000) throw new Error("listening HTML exceeds 2MB bound");
  const actualHash = sha256(html);
  const suppliedHash = boundedText(value.contentHash, 128);
  const hashMismatch = Boolean(html && suppliedHash && suppliedHash !== actualHash);
  if (hashMismatch) status = "FAILED";
  const contentHash = actualHash;
  return {
    contractVersion: LISTENING_CONTRACT_VERSION,
    jobId: boundedText(value.jobId, 160) || null,
    backend: normalizedBackend,
    sourceUrl: url,
    finalUrl,
    capturedAt: new Date(value.capturedAt || Date.now()).toISOString(),
    contentHash,
    fetcherRevision: boundedText(value.fetcherRevision, 180) || FETCHER_REVISIONS[normalizedBackend],
    browserVersion: boundedText(value.browserVersion, 180) || null,
    runtimeVersion: boundedText(value.runtimeVersion, 80) || null,
    observedHttpStatus: Number.isInteger(value.observedHttpStatus) ? value.observedHttpStatus : "UNKNOWN",
    status,
    reason: hashMismatch ? "HTML contentHash mismatch" : boundedText(value.reason, 300) || null,
    contentType: boundedText(value.contentType, 120).toLowerCase() || "text/html",
    coverage: normalizeCoverage(value.coverage),
    html,
    processEvidence: value.processEvidence && typeof value.processEvidence === "object" ? {
      workerPid: Number.isInteger(value.processEvidence.workerPid) ? value.processEvidence.workerPid : null,
      browserPid: Number.isInteger(value.processEvidence.browserPid) ? value.processEvidence.browserPid : null,
      beforeCount: Number.isFinite(Number(value.processEvidence.beforeCount)) ? Number(value.processEvidence.beforeCount) : null,
      afterCount: Number.isFinite(Number(value.processEvidence.afterCount)) ? Number(value.processEvidence.afterCount) : null,
      cleanup: boundedText(value.processEvidence.cleanup, 120) || null,
      processCountBefore: Number.isFinite(Number(value.processEvidence.processCountBefore)) ? Number(value.processEvidence.processCountBefore) : null,
      processCountAfter: Number.isFinite(Number(value.processEvidence.processCountAfter)) ? Number(value.processEvidence.processCountAfter) : null,
      peakRssKb: Number.isFinite(Number(value.processEvidence.peakRssKb)) ? Number(value.processEvidence.peakRssKb) : null,
      rssKbAfter: Number.isFinite(Number(value.processEvidence.rssKbAfter)) ? Number(value.processEvidence.rssKbAfter) : null,
      browserPids: Array.isArray(value.processEvidence.browserPids) ? value.processEvidence.browserPids.filter(Number.isInteger).slice(0, 32) : []
    } : null
  };
}

function inferRecordType(record = {}) {
  const raw = boundedText(record.recordType || record.type, 40).toLowerCase();
  if (RECORD_TYPES.includes(raw)) return raw;
  const marker = `${record.sourceId || ""} ${record.className || ""} ${record.url || ""}`.toLowerCase();
  if (/comment|reply/.test(marker)) return "comment";
  return "item";
}

export function normalizeExtractedRecord(record = {}, fetchResult, index = 0) {
  const sourceUrl = normalizePublicUrl(record.sourceUrl || fetchResult.finalUrl || fetchResult.sourceUrl);
  let url = sourceUrl;
  try { url = normalizePublicUrl(new URL(String(record.url || sourceUrl), sourceUrl).toString()); } catch { url = sourceUrl; }
  const title = boundedText(record.title, 800);
  const text = boundedText(record.text || record.content || record.body, 8_000);
  const author = boundedText(record.author, 240) || null;
  if (!title && !text) throw new Error("listening record has no content");
  const recordType = inferRecordType(record);
  const sourceId = boundedText(record.sourceId || record.id, 240) || null;
  const contentHash = boundedText(record.contentHash, 128) || sha256(`${title}\n${text}`);
  const recordId = sourceId || `record-${sha256(`${sourceUrl}\n${contentHash}`).slice(0, 32)}`;
  return {
    schemaVersion: LISTENING_CONTRACT_VERSION,
    recordId,
    sourceId,
    index,
    recordType,
    sourceUrl,
    url,
    title,
    text,
    author,
    contentHash,
    capturedAt: fetchResult.capturedAt,
    publishedAt: boundedText(record.publishedAt, 80) || null,
    parentRecordId: boundedText(record.parentRecordId, 240) || null,
    extractorRevision: EXTRACTOR_REVISION,
    sourceRefs: [sourceUrl, `listening-job:${fetchResult.jobId || "unknown"}`, `listening-record:${recordId}`],
    coverage: normalizeCoverage({ ...fetchResult.coverage, ...(record.coverage || {}), structured: true, markdown: true }),
    untrusted: true
  };
}

export function normalizeAnalysisInput(records = [], scope = {}) {
  const normalizedScope = normalizeScope(scope);
  const selected = records.slice(0, 12).map((record) => ({
    recordId: record.recordId,
    recordType: record.recordType,
    sourceUrl: record.sourceUrl,
    title: boundedText(record.title, 500),
    text: boundedText(record.text, 2_500),
    contentHash: record.contentHash,
    sourceRefs: boundedArray(record.sourceRefs, 8)
  }));
  const digest = stableHash({ scope: normalizedScope, records: selected });
  return { schemaVersion: LISTENING_CONTRACT_VERSION, scope: normalizedScope, records: selected, digest, untrusted: true };
}

export function publicRunSummary(run = {}) {
  return {
    contractVersion: LISTENING_CONTRACT_VERSION,
    jobId: boundedText(run.jobId, 160), campaignId: boundedText(run.campaignId, 160), backend: boundedText(run.backend, 20),
    status: LISTENING_STATUSES.includes(run.status) ? run.status : "UNKNOWN",
    sourceUrls: boundedArray(run.sourceUrls, 20), requested: Number(run.requested) || 0, succeeded: Number(run.succeeded) || 0,
    partial: Number(run.partial) || 0, blocked: Number(run.blocked) || 0, failed: Number(run.failed) || 0, unknown: Number(run.unknown) || 0,
    records: Number(run.records) || 0, newRecords: Number(run.newRecords) || 0, deduplicatedRecords: Number(run.deduplicatedRecords) || 0,
    memoryIds: boundedArray(run.memoryIds, 64), memoryIdCount: Array.isArray(run.memoryIds) ? run.memoryIds.length : 0,
    sourceHashes: boundedArray(run.sourceHashes, 64), extractedHashes: boundedArray(run.extractedHashes, 64),
    providerReceipt: run.providerReceipt || null, externalSideEffects: false,
    startedAt: run.startedAt || null, completedAt: run.completedAt || null
  };
}

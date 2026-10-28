import { createHash } from "node:crypto";

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
export const LISTENING_JOB_SCHEMA_VERSION = 1;
export const LISTENING_TERMINAL_STATUSES = Object.freeze(["SUCCEEDED", "PARTIAL", "BLOCKED", "FAILED", "UNKNOWN"]);

function boundedText(value, max = 8000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedArray(value, max = 32) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => boundedText(item, 600)).filter(Boolean))].slice(0, max);
}

function stripMarkup(value, max = 8_000) {
  return boundedText(String(value ?? "").replace(/<[^>]*>/g, " "), max);
}

function safePolicyMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 32).map(([host, policy]) => {
    const row = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {};
    return [boundedText(host, 160), {
      enabled: row.enabled !== false,
      channel: boundedText(row.channel, 80) || null,
      actions: boundedArray(row.actions, 16),
      allowedHosts: boundedArray(row.allowedHosts, 16),
      reason: stripMarkup(row.reason, 240) || null
    }];
  }).filter(([host]) => Boolean(host)));
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

export function listeningInputHash({ campaignId = null, urls = [], backend = "http", sourceRevision = null, extractorRevision = EXTRACTOR_REVISION, scope = {}, policies = {}, keywords = [], blockedKeywords = [] } = {}) {
  return stableHash({
    campaignId: boundedText(campaignId, 160) || null,
    urls: [...new Set((Array.isArray(urls) ? urls : []).map(normalizePublicUrl))].sort(),
    backend: normalizeBackend(backend),
    sourceRevision: boundedText(sourceRevision, 180) || null,
    extractorRevision: boundedText(extractorRevision, 180) || null,
    scope: normalizeScope(scope),
    policies: policies && typeof policies === "object" && !Array.isArray(policies) ? policies : {},
    keywords: boundedArray(keywords, 64),
    blockedKeywords: boundedArray(blockedKeywords, 64)
  });
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

export function createListeningJobId({ campaignId, urls, backend, sourceRevision = FETCHER_REVISIONS[backend], extractorRevision = EXTRACTOR_REVISION, scope = {}, policies = {}, keywords = [], blockedKeywords = [] } = {}) {
  return `listening-${listeningInputHash({ campaignId, urls, backend, sourceRevision, extractorRevision, scope, policies, keywords, blockedKeywords }).slice(0, 32)}`;
}

function safeProcessEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    workerPid: Number.isInteger(value.workerPid) ? value.workerPid : null,
    browserPid: Number.isInteger(value.browserPid) ? value.browserPid : null,
    processCountBefore: Number.isFinite(Number(value.processCountBefore)) ? Number(value.processCountBefore) : null,
    processCountAfter: Number.isFinite(Number(value.processCountAfter)) ? Number(value.processCountAfter) : null,
    peakRssKb: Number.isFinite(Number(value.peakRssKb)) ? Number(value.peakRssKb) : null,
    rssKbAfter: Number.isFinite(Number(value.rssKbAfter)) ? Number(value.rssKbAfter) : null,
    cleanup: boundedText(value.cleanup, 120) || null,
    browserPids: Array.isArray(value.browserPids) ? value.browserPids.filter(Number.isInteger).slice(0, 32) : []
  };
}

function safeFetchCheckpoint(value = {}) {
  const extracted = value.extracted && typeof value.extracted === "object" ? value.extracted : null;
  return {
    sourceUrl: normalizePublicUrl(value.sourceUrl),
    finalUrl: (() => { try { return normalizePublicUrl(value.finalUrl || value.sourceUrl); } catch { return normalizePublicUrl(value.sourceUrl); } })(),
    backend: normalizeBackend(value.backend),
    status: LISTENING_STATUSES.includes(String(value.status || "").toUpperCase()) ? String(value.status).toUpperCase() : "UNKNOWN",
    reason: boundedText(value.reason, 300) || null,
    observedHttpStatus: Number.isInteger(value.observedHttpStatus) ? value.observedHttpStatus : "UNKNOWN",
    contentType: boundedText(value.contentType, 120).toLowerCase() || null,
    capturedAt: boundedText(value.capturedAt, 80) || null,
    contentHash: boundedText(value.contentHash, 128) || null,
    extracted: extracted ? {
      status: LISTENING_STATUSES.includes(String(extracted.status || "").toUpperCase()) ? String(extracted.status).toUpperCase() : "UNKNOWN",
      reason: boundedText(extracted.reason, 300) || null,
      extractedHash: boundedText(extracted.extractedHash, 128) || null,
      recordCount: Math.max(0, Math.min(500, Number(extracted.recordCount) || 0)),
      recordTypes: boundedArray(extracted.recordTypes, 16),
      coverage: normalizeCoverage(extracted.coverage),
      elapsedMs: Number.isFinite(Number(extracted.elapsedMs)) ? Math.max(0, Number(extracted.elapsedMs)) : null,
      processEvidence: safeProcessEvidence(extracted.processEvidence)
    } : null,
    fetcherRevision: boundedText(value.fetcherRevision, 180) || null,
    browserVersion: boundedText(value.browserVersion, 180) || null,
    runtimeVersion: boundedText(value.runtimeVersion, 80) || null,
    coverage: normalizeCoverage(value.coverage),
    processEvidence: safeProcessEvidence(value.processEvidence)
  };
}

function safeListeningRecord(value = {}) {
  return {
    schemaVersion: LISTENING_CONTRACT_VERSION,
    recordId: boundedText(value.recordId, 240),
    sourceId: boundedText(value.sourceId, 240) || null,
    recordType: RECORD_TYPES.includes(String(value.recordType || "")) ? value.recordType : "item",
    sourceUrl: normalizePublicUrl(value.sourceUrl),
    url: (() => { try { return normalizePublicUrl(value.url || value.sourceUrl); } catch { return normalizePublicUrl(value.sourceUrl); } })(),
    title: stripMarkup(value.title, 800),
    text: stripMarkup(value.text, 8_000),
    author: boundedText(value.author, 240) || null,
    contentHash: boundedText(value.contentHash, 128) || null,
    capturedAt: boundedText(value.capturedAt, 80) || null,
    publishedAt: boundedText(value.publishedAt, 80) || null,
    parentRecordId: boundedText(value.parentRecordId, 240) || null,
    sourceRefs: boundedArray(value.sourceRefs, 16),
    coverage: normalizeCoverage(value.coverage),
    untrusted: value.untrusted === true
  };
}

function safeProviderReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schemaVersion: Number.isInteger(value.schemaVersion) ? value.schemaVersion : 1,
    decisionId: boundedText(value.decisionId, 160) || null,
    providerId: boundedText(value.providerId, 120) || null,
    status: boundedText(value.status, 40).toUpperCase() || "UNKNOWN",
    failure: boundedText(value.failure, 160) || null,
    analysisInputDigest: boundedText(value.analysisInputDigest, 128) || null,
    evidenceRefs: boundedArray(value.evidenceRefs, 64),
    attempted: Array.isArray(value.attempted) ? value.attempted.slice(0, 16).map((item) => ({ providerId: boundedText(item?.providerId, 120) || null, status: boundedText(item?.status, 80) || null, reason: boundedText(item?.reason, 160) || null })) : [],
    telemetry: value.telemetry && typeof value.telemetry === "object" && !Array.isArray(value.telemetry) ? {
      capability: boundedText(value.telemetry.capability, 120) || null,
      privacyClass: boundedText(value.telemetry.privacyClass, 40) || null,
      reasoningClass: boundedText(value.telemetry.reasoningClass, 40) || null,
      analysisInputDigest: boundedText(value.telemetry.analysisInputDigest, 128) || null,
      evidenceRefs: boundedArray(value.telemetry.evidenceRefs, 64),
      providerId: boundedText(value.telemetry.providerId, 120) || null
    } : null,
    persisted: value.persisted === true
  };
}

export function normalizeListeningJob(input = {}, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("listening job must be an object");
  const sourceUrls = [...new Set((Array.isArray(input.sourceUrls) ? input.sourceUrls : []).slice(0, 20).map(normalizePublicUrl))];
  if (!sourceUrls.length) throw new Error("listening job requires source URLs");
  const backend = normalizeBackend(input.backend);
  const sourceRevision = boundedText(input.sourceRevision, 180) || FETCHER_REVISIONS[backend];
  const extractorRevision = boundedText(input.extractorRevision, 180) || EXTRACTOR_REVISION;
  const sources = sourceUrls.map((url, index) => {
    const value = Array.isArray(input.sources) ? input.sources[index] || {} : {};
    const status = ["PENDING", ...LISTENING_STATUSES].includes(String(value.status || "").toUpperCase()) ? String(value.status).toUpperCase() : "PENDING";
    return {
      url,
      status: status === "RUNNING" ? "RUNNING" : status,
      reason: boundedText(value.reason, 300) || null,
      fetch: value.fetch ? safeFetchCheckpoint(value.fetch) : null,
      records: Array.isArray(value.records) ? value.records.slice(0, 500).map(safeListeningRecord) : []
    };
  });
  const records = (Array.isArray(input.records) ? input.records : sources.flatMap((source) => source.records || []))
    .slice(0, 500).map(safeListeningRecord);
  const statuses = sources.map((source) => source.status === "PENDING" ? "RUNNING" : source.status);
  const status = LISTENING_STATUSES.includes(String(input.status || "").toUpperCase()) ? String(input.status).toUpperCase() : "RUNNING";
  return {
    schemaVersion: LISTENING_JOB_SCHEMA_VERSION,
    jobId: boundedText(input.jobId, 160),
    inputHash: boundedText(input.inputHash, 128) || listeningInputHash({ campaignId: input.campaignId, urls: sourceUrls, backend, sourceRevision, extractorRevision, scope: input.scope, policies: input.policies, keywords: input.keywords, blockedKeywords: input.blockedKeywords }),
    campaignId: boundedText(input.campaignId, 160) || null,
    backend, sourceRevision, extractorRevision, sourceUrls,
    scope: normalizeScope(input.scope),
    policies: safePolicyMap(input.policies),
    keywords: boundedArray(input.keywords, 64), blockedKeywords: boundedArray(input.blockedKeywords, 64),
    sources, records, statuses, status,
    analysisInput: input.analysisInput && typeof input.analysisInput === "object" ? {
      schemaVersion: LISTENING_CONTRACT_VERSION,
      scope: normalizeScope(input.analysisInput.scope || input.scope),
      digest: boundedText(input.analysisInput.digest, 128) || null,
      recordIds: boundedArray(input.analysisInput.records?.map?.((item) => item?.recordId), 500),
      untrusted: input.analysisInput.untrusted === true
    } : null,
    providerReceipt: safeProviderReceipt(input.providerReceipt),
    persistenceStatus: boundedText(input.persistenceStatus, 40).toUpperCase() || "PENDING",
    persistedSummary: (() => {
      if (!input.persistedSummary) return null;
      const summary = publicRunSummary(input.persistedSummary);
      summary.providerReceipt = safeProviderReceipt(summary.providerReceipt);
      return summary;
    })(),
    startedAt: boundedText(input.startedAt, 80) || now.toISOString(),
    updatedAt: boundedText(input.updatedAt, 80) || now.toISOString(),
    completedAt: boundedText(input.completedAt, 80) || null
  };
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

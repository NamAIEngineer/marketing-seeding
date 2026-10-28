import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { stateFile } from "../src/paths.mjs";
import { runListeningExtraction, persistListeningRun } from "../src/listening-adapter.mjs";
import { loadConfiguredLocalProvider } from "../src/oi-browser-provider-adapters.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function arg(name, fallback = null) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
function has(name) { return args.includes(name); }
function usage() { console.error("Usage: node scripts/listening-run.mjs --urls <url,url,...> [--backend http|nodriver] [--campaign-id ID] [--scope-json FILE] [--provider-analysis] [--evidence FILE]"); }
const urls = String(arg("--urls", "")).split(",").map((item) => item.trim()).filter(Boolean);
if (!urls.length) { usage(); process.exit(2); }
const backend = arg("--backend", process.env.SEEDING_LISTENING_BACKEND || "http");
const campaignId = arg("--campaign-id", null);
const scope = arg("--scope-json") ? JSON.parse(await readFile(path.resolve(arg("--scope-json")), "utf8")) : {};
const providerTask = has("--provider-analysis") ? { capability: "strategy-context", privacyClass: "local", reasoningClass: "general" } : null;
const run = await runListeningExtraction({ urls, backend, campaignId, scope, providerTask, options: { python: process.env.SEEDING_LISTENING_PYTHON } });
let summary = { run, persisted: null };
if (campaignId) {
  const store = new JsonStore(stateFile, { requireLease: true });
  await store.acquireWriterLease();
  try {
    const provider = await loadConfiguredLocalProvider(process.env, { timeoutMs: 5_000, inferTimeoutMs: 120_000 });
    const service = new SeedingService(store, provider ? { oiBrowserProviders: [provider] } : {});
    await service.init();
    summary.persisted = await persistListeningRun(service, run, { providerTask: providerTask ? { ...providerTask, timeoutMs: 120_000 } : null });
  } finally { await store.releaseWriterLease(); }
}
const evidence = arg("--evidence");
if (evidence) {
  await mkdir(path.dirname(path.resolve(evidence)), { recursive: true });
  const evidenceSummary = structuredClone(summary);
  // Evidence is review metadata. Keep public record IDs, hashes, coverage and
  // receipts; do not commit page bodies or provider prompt payloads.
  evidenceSummary.run.fetches = (summary.run.fetches || []).map((item) => ({
    ...item,
    html: undefined,
    extracted: item.extracted ? {
      contractVersion: item.extracted.contractVersion,
      jobId: item.extracted.jobId,
      status: item.extracted.status,
      reason: item.extracted.reason,
      sourceUrl: item.extracted.sourceUrl,
      finalUrl: item.extracted.finalUrl,
      capturedAt: item.extracted.capturedAt,
      contentHash: item.extracted.contentHash,
      extractorRevision: item.extracted.extractorRevision,
      extractedHash: item.extracted.extractedHash,
      recordCount: Array.isArray(item.extracted.records) ? item.extracted.records.length : 0,
      recordTypes: [...new Set((item.extracted.records || []).map((record) => record.recordType))],
      coverage: item.extracted.coverage,
      elapsedMs: item.extracted.elapsedMs,
      processEvidence: item.extracted.processEvidence
    } : null
  }));
  evidenceSummary.run.records = (summary.run.records || []).map((record) => ({
    recordId: record.recordId, sourceId: record.sourceId, recordType: record.recordType,
    sourceUrl: record.sourceUrl, url: record.url, contentHash: record.contentHash,
    capturedAt: record.capturedAt, extractorRevision: record.extractorRevision,
    parentRecordId: record.parentRecordId, sourceRefs: record.sourceRefs, coverage: record.coverage,
    untrusted: record.untrusted
  }));
  evidenceSummary.run.analysisInput = summary.run.analysisInput ? {
    schemaVersion: summary.run.analysisInput.schemaVersion,
    scope: summary.run.analysisInput.scope,
    digest: summary.run.analysisInput.digest,
    recordIds: (summary.run.analysisInput.records || []).map((record) => record.recordId),
    untrusted: summary.run.analysisInput.untrusted
  } : null;
  evidenceSummary.persisted = evidenceSummary.persisted && typeof evidenceSummary.persisted === "object"
    ? evidenceSummary.persisted : null;
  if (evidenceSummary.persisted) {
    evidenceSummary.persisted.memoryIds = (summary.persisted?.memoryIds || []).slice(0, 64);
    evidenceSummary.persisted.memoryIdCount = summary.persisted?.memoryIdCount || summary.persisted?.memoryIds?.length || 0;
  }
  await writeFile(path.resolve(evidence), `${JSON.stringify(evidenceSummary, null, 2)}\n`, "utf8");
}
const safe = structuredClone(summary);
for (const item of safe.run?.fetches || []) { delete item.html; }
console.log(JSON.stringify(safe, null, 2));

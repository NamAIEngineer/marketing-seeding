import test from "node:test";
import assert from "node:assert/strict";
import { persistListeningRun } from "../src/listening-adapter.mjs";
import { normalizeDiscovery } from "../src/discovery.mjs";

test("listening persistence uses canonical seams and reports dedupe", async () => {
  const calls = { discoveries: [], memory: [], provider: [] };
  const seen = new Set();
  const service = {
    async recordDiscoveries(campaignId, input) { calls.discoveries.push({ campaignId, input }); return { accepted: input.observations.length, observations: input.observations }; },
    async recordOiMemory(input) { calls.memory.push(input); const deduplicated = seen.has(input.fingerprint); seen.add(input.fingerprint); return { item: { id: input.id }, deduplicated }; },
    async routeOiAgentTask(input) { calls.provider.push(input); return { status: "SUCCEEDED", providerId: "local-qwen", telemetry: { analysisInputDigest: input.analysisInputDigest } }; }
  };
  const run = { contractVersion: 1, jobId: "job-1", campaignId: "campaign-1", backend: "nodriver", extractorRevision: "crawl4ai-pin", sourceUrls: ["https://example.com"], scope: { campaignId: "campaign-1" }, policies: {}, keywords: [], blockedKeywords: [], statuses: ["SUCCEEDED"], sourceHashes: ["a"], extractedHashes: ["b"], records: [{ recordId: "r1", sourceId: "r1", recordType: "comment", sourceUrl: "https://example.com", url: "https://example.com/r1", title: "Title", text: "Body", contentHash: "h1", capturedAt: "2026-10-29T00:00:00Z", sourceRefs: ["https://example.com", "listening-job:job-1", "listening-record:r1"], coverage: { html: true, structured: true } }], analysisInput: { schemaVersion: 1, scope: { campaignId: "campaign-1" }, records: [{ recordId: "r1", text: "Body", sourceRefs: ["https://example.com"] }], digest: "d", untrusted: true } };
  const first = await persistListeningRun(service, run, { providerTask: { capability: "community-research", privacyClass: "local" } });
  const second = await persistListeningRun(service, run, { providerTask: null });
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(first.newRecords, 1);
  assert.equal(second.deduplicatedRecords, 1);
  assert.equal(calls.discoveries.length, 2);
  const normalized = normalizeDiscovery(calls.discoveries[0].input.observations[0]);
  assert.equal(normalized.provenance.contentHash, "h1");
  assert.equal(normalized.provenance.extractorRevision, "crawl4ai-pin");
  assert.deepEqual(normalized.provenance.sourceRefs, ["https://example.com", "listening-job:job-1", "listening-record:r1"]);
  assert.equal(calls.provider[0].analysisInputDigest, "d");
  assert.equal(calls.provider[0].analysisInput.untrusted, true);
  assert.equal(calls.memory[0].observationRefs[0], "listening:job-1:r1");
});

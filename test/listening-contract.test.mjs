import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExtractedRecord, normalizeFetchResult, normalizeAnalysisInput } from "../src/listening-contract.mjs";

test("listening contract preserves relative source links and fails hash mismatch closed", () => {
  const fetch = normalizeFetchResult({ backend: "http", sourceUrl: "https://example.com/page", finalUrl: "https://example.com/page", status: "SUCCEEDED", html: "<p>x</p>", contentHash: "bad" }, { sourceUrl: "https://example.com/page", backend: "http" });
  assert.equal(fetch.status, "FAILED");
  const record = normalizeExtractedRecord({ recordId: "c1", recordType: "comment", sourceUrl: fetch.sourceUrl, url: "reply?id=1", text: "untrusted page text", contentHash: "abc" }, { ...fetch, jobId: "job-1", capturedAt: "2026-10-29T00:00:00Z" });
  assert.equal(record.url, "https://example.com/reply?id=1");
  assert.equal(record.untrusted, true);
  assert.equal(record.sourceRefs[0], "https://example.com/page");
  assert.equal(record.sourceRefs[1], "listening-job:job-1");
  assert.match(record.sourceRefs[2], /^listening-record:record-/);
});

test("analysis input is bounded and carries a digest", () => {
  const records = Array.from({ length: 20 }, (_, index) => ({ recordId: `r-${index}`, recordType: "comment", sourceUrl: "https://example.com", title: "t", text: "x".repeat(4000), contentHash: String(index), sourceRefs: ["https://example.com"] }));
  const input = normalizeAnalysisInput(records, { campaignId: "campaign-1" });
  assert.equal(input.records.length, 12);
  assert.ok(input.records.every((row) => row.text.length <= 2500));
  assert.match(input.digest, /^[a-f0-9]{64}$/);
  assert.equal(input.untrusted, true);
});

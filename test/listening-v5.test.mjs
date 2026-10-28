import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";
import { createListeningJobId } from "../src/listening-contract.mjs";
import { runListeningExtraction } from "../src/listening-adapter.mjs";

function fixtureResponse(url) {
  return new Response(`<html><title>${url.hostname}</title><p>public ${url.pathname}</p></html>`, {
    status: 200,
    headers: { "content-type": "text/html" }
  });
}

function extractionFixture(fetchCalls) {
  return {
    fetchImpl: async (url) => {
      fetchCalls.push(url.toString());
      return fixtureResponse(url);
    },
    resolvePublicUrlImpl: async (raw) => ({ url: new URL(raw), address: "fixture" }),
    extractorImpl: async (fetchResult) => ({
      status: "SUCCEEDED",
      extractedHash: `extract-${fetchResult.contentHash}`,
      records: [{
        recordType: "page",
        sourceUrl: fetchResult.sourceUrl,
        url: fetchResult.finalUrl,
        title: "Public fixture",
        text: fetchResult.html,
        contentHash: fetchResult.contentHash,
        sourceId: new URL(fetchResult.sourceUrl).hostname
      }],
      coverage: { html: true, structured: true, markdown: true }
    })
  };
}

async function makeService() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "listening-v5-"));
  const store = new JsonStore(path.join(directory, "state.json"));
  const service = new SeedingService(store);
  await service.init();
  return { directory, store, service };
}

test("Listening V5 resumes pending sources from a canonical JsonStore checkpoint", async (t) => {
  const first = await makeService();
  t.after(() => rm(first.directory, { recursive: true, force: true }));
  const urls = ["https://one.fixture.test/one", "https://two.fixture.test/two"];
  const campaignId = "campaign-v5";
  const jobId = createListeningJobId({ campaignId, urls, backend: "http" });
  const firstCalls = [];
  let checkpoints = 0;
  await assert.rejects(() => runListeningExtraction({
    urls, backend: "http", campaignId, jobId,
    options: extractionFixture(firstCalls),
    checkpoint: async (job) => {
      await first.service.checkpointListeningJob(job);
      checkpoints += 1;
      if (checkpoints === 2) throw new Error("controlled component interruption");
    }
  }), /controlled component interruption/);
  assert.deepEqual(firstCalls, ["https://one.fixture.test/one"]);
  const saved = await first.service.getListeningJob(jobId);
  assert.equal(saved.status, "RUNNING");
  assert.equal(saved.sources[0].status, "SUCCEEDED");
  assert.equal(saved.sources[1].status, "PENDING");
  assert.equal(saved.sources[0].fetch.html, undefined);
  assert.equal(saved.sources[0].fetch.extracted.records, undefined);

  const restarted = new SeedingService(new JsonStore(path.join(first.directory, "state.json")));
  await restarted.init();
  const resumedCalls = [];
  const resumed = await runListeningExtraction({
    urls, backend: "http", campaignId, jobId, resumeJob: await restarted.getListeningJob(jobId),
    options: extractionFixture(resumedCalls),
    checkpoint: (job) => restarted.checkpointListeningJob(job)
  });
  assert.deepEqual(resumedCalls, ["https://two.fixture.test/two"]);
  assert.equal(resumed.status, "SUCCEEDED");
  assert.equal(resumed.records.length, 2);
  assert.equal((await restarted.getListeningJob(jobId)).sources.every((source) => source.status === "SUCCEEDED"), true);
});

test("completed Listening job replays durably without fetching again", async (t) => {
  const f = await makeService();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const urls = ["https://replay.fixture.test/page"];
  const calls = [];
  const run = await runListeningExtraction({ urls, campaignId: "campaign-replay", options: extractionFixture(calls), checkpoint: (job) => f.service.checkpointListeningJob(job) });
  assert.equal(run.status, "SUCCEEDED");
  const replay = await runListeningExtraction({ urls, campaignId: "campaign-replay", jobId: run.jobId, resumeJob: await f.service.getListeningJob(run.jobId), options: { fetchImpl: async () => { throw new Error("must not fetch"); } } });
  assert.equal(replay.status, "SUCCEEDED");
  assert.deepEqual(calls, ["https://replay.fixture.test/page"]);
  assert.equal(replay.records[0].recordId, run.records[0].recordId);
});

test("UNKNOWN Listening source remains quarantined and is not retried", async (t) => {
  const f = await makeService();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const urls = ["https://unknown.fixture.test/page"];
  let calls = 0;
  const options = {
    resolvePublicUrlImpl: async (raw) => ({ url: new URL(raw), address: "fixture" }),
    fetchImpl: async () => { calls += 1; throw Object.assign(new Error("deadline"), { name: "AbortError" }); }
  };
  const first = await runListeningExtraction({ urls, campaignId: "campaign-unknown", options, checkpoint: (job) => f.service.checkpointListeningJob(job) });
  assert.equal(first.status, "UNKNOWN");
  const replay = await runListeningExtraction({ urls, campaignId: "campaign-unknown", jobId: first.jobId, resumeJob: await f.service.getListeningJob(first.jobId), options: { fetchImpl: async () => { calls += 1; throw new Error("retry forbidden"); } } });
  assert.equal(replay.status, "UNKNOWN");
  assert.equal(calls, 1);
});

test("Listening checkpoints project bounded dashboard state", async (t) => {
  const f = await makeService();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const run = await runListeningExtraction({
    urls: ["https://dashboard.fixture.test/page"], campaignId: "campaign-dashboard",
    options: extractionFixture([]), checkpoint: (job) => f.service.checkpointListeningJob(job)
  });
  const dashboard = await f.service.dashboard();
  assert.equal(dashboard.listening.jobs.length, 1);
  assert.equal(dashboard.listening.jobs[0].jobId, run.jobId);
  assert.equal(dashboard.listening.jobs[0].records, 1);
  assert.equal(Object.hasOwn(dashboard.listening.jobs[0], "html"), false);
});

test("UNKNOWN Listening checkpoints cannot be promoted by a later stale result", async (t) => {
  const f = await makeService();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const base = {
    jobId: "listening-unknown-immutable",
    campaignId: "campaign-unknown-immutable",
    backend: "http",
    sourceUrls: ["https://immutable.fixture.test/page"],
    sources: [{ url: "https://immutable.fixture.test/page", status: "UNKNOWN", reason: "deadline", fetch: { sourceUrl: "https://immutable.fixture.test/page", backend: "http", status: "UNKNOWN", reason: "deadline" }, records: [] }],
    status: "UNKNOWN"
  };
  await f.service.checkpointListeningJob(base);
  const stale = await f.service.checkpointListeningJob({ ...base, status: "SUCCEEDED", sources: [{ ...base.sources[0], status: "SUCCEEDED", reason: null }] });
  assert.equal(stale.status, "UNKNOWN");
  assert.equal(stale.sources[0].status, "UNKNOWN");
  assert.equal((await f.service.getListeningJob(base.jobId)).status, "UNKNOWN");
});

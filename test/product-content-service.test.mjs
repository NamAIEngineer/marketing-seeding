import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.mjs";
import { SeedingService } from "../src/service.mjs";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "content-service-"));
  await fs.mkdir(path.join(root, "research"));
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "research", "product.html"), "<html><title>Fixture</title><article>The product is grounded in local evidence. It emits a playable media artifact.</article></html>\n");
  await fs.writeFile(path.join(root, "assets", "tile.ppm"), "P3\n2 2\n255\n255 0 0 0 255 0 0 0 255 255 255 0\n");
  return root;
}

test("service content pipeline persists grounded report and real MP4 lineage", async () => {
  const root = await fixture();
  const store = new JsonStore(path.join(root, "state.json"));
  const service = new SeedingService(store);
  await service.init();
  const campaign = await service.createCampaign({ name: "Content fixture", objective: "Grounded media", productRepo: root });
  const result = await service.runProductContentPipeline(campaign.id, {
    mode: "FIXTURE",
    runId: "fixture-content-run",
    sources: [{ path: "research/product.html", label: "Fixture source" }],
    assets: [{ path: "assets/tile.ppm", name: "Fixture tile" }],
    targets: [{ id: "linkedin-target", channel: "linkedin" }, { id: "x-target", channel: "x" }]
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.persisted, true);
  assert.equal(result.externalSideEffects, false);
  assert.ok(result.reportPath);
  assert.ok(result.mp4Path);
  const snapshot = await service.snapshot();
  const saved = snapshot.campaigns.find((item) => item.id === campaign.id);
  assert.equal(saved.contentPipelineRuns.length, 1);
  assert.equal(saved.contentPipelineRuns[0].status, "SUCCEEDED");
  assert.equal(saved.contentPipelineRuns[0].materialization.status, "BLOCKED");
  assert.equal(saved.contentPipelineRuns[0].materialization.reason, "campaign_targets_required");
  assert.equal(snapshot.posts.length, 0);
  assert.equal(saved.contentPipelineRuns[0].evidence.length, 1);
  assert.equal(saved.contentPipelineRuns[0].media.sha256.length, 64);
});

test("service content pipeline persists typed unavailable failures without claiming output", async () => {
  const root = await fixture();
  const service = new SeedingService(new JsonStore(path.join(root, "state.json")));
  await service.init();
  const campaign = await service.createCampaign({ name: "Content failure", objective: "Bounded failure", productRepo: root });
  const result = await service.runProductContentPipeline(campaign.id, {
    mode: "FIXTURE",
    runId: "fixture-content-failure",
    sources: [{ path: "research/product.html" }],
    assets: [{ path: "assets/tile.ppm" }],
    targets: [{ id: "linkedin-target", channel: "linkedin" }],
    ffmpegPath: path.join(root, "missing-ffmpeg")
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.failure.code, "MEDIA_BACKEND_UNAVAILABLE");
  assert.equal(result.mp4Path, null);
  assert.equal((await service.snapshot()).campaigns[0].contentPipelineRuns[0].failure.code, "MEDIA_BACKEND_UNAVAILABLE");
});

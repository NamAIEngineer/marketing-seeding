import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProductContentPipeline } from '../src/product-content-pipeline.mjs';
import { bridgeProductContentPipelineResult, ProductContentCampaignBridgeError } from '../src/product-content-campaign-bridge.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'product-content-campaign-bridge-'));
  await fs.mkdir(path.join(root, 'research'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'research', 'product.html'), `<!doctype html>
    <html><head><title>Bridge Product</title></head><body><article>
    <p>Bridge output is grounded in verified local source evidence.</p>
    <p>One checked product asset renders into one playable MP4.</p>
    </article></body></html>`);
  await fs.writeFile(path.join(root, 'assets', 'product.ppm'), 'P3\n2 2\n255\n255 40 40 40 255 40 40 40 255 255 255 40\n');
  const outputDir = path.join(root, 'output');
  const pipeline = await runProductContentPipeline({
    mode: 'FIXTURE', runId: 'bridge-fixture-run', outputDir,
    product: { id: 'bridge-product', name: 'Bridge Product', repositoryPath: root },
    campaign: { id: 'bridge-campaign', name: 'Bridge Campaign', callToAction: 'Inspect the evidence.' },
    sources: [{ path: 'research/product.html', label: 'Bridge source' }],
    assets: [{ path: 'assets/product.ppm', name: 'Bridge tile' }],
    targets: [
      { id: 'target-linkedin', channel: 'linkedin' },
      { id: 'target-threads', channel: 'threads' }
    ]
  });
  assert.equal(pipeline.status, 'SUCCEEDED');
  return { root, pipeline };
}

test('bridge verifies successful output and maps one artifact to distinct grounded target candidates', async () => {
  const { root, pipeline } = await fixture();
  const first = await bridgeProductContentPipelineResult({
    result: pipeline,
    campaignId: 'bridge-campaign',
    productRepo: root,
    artifactRelativePath: 'artifacts/content/bridge-fixture-run.mp4',
    audience: 'builders'
  });
  const second = await bridgeProductContentPipelineResult({
    result: pipeline,
    campaignId: 'bridge-campaign',
    productRepo: root,
    artifactRelativePath: 'artifacts/content/bridge-fixture-run.mp4',
    audience: 'builders'
  });
  assert.equal(first.status, 'READY');
  assert.equal(first.externalSideEffects, false);
  assert.equal(first.authoritySideEffects, false);
  assert.equal(first.artifact.sha256, pipeline.media.sha256);
  assert.equal(first.artifact.registerInput.path, 'artifacts/content/bridge-fixture-run.mp4');
  assert.equal(first.candidates.length, 2);
  assert.equal(new Set(first.candidates.map((candidate) => candidate.targetId)).size, 2);
  assert.equal(new Set(first.candidates.map((candidate) => candidate.channel)).size, 2);
  assert.equal(new Set(first.candidates.map((candidate) => candidate.contentId)).size, 2);
  assert.equal(new Set(first.candidates.map((candidate) => candidate.contentIdentity)).size, 2);
  assert.ok(first.candidates.every((candidate) => candidate.status === 'draft'));
  assert.ok(first.candidates.every((candidate) => candidate.publicationUrl === null && candidate.metrics === null));
  assert.equal(first.actions.stageArtifact.expectedSha256, first.artifact.sha256);
  assert.equal(first.actions.registerArtifact.requires[0], 'stageArtifact');
  assert.equal(first.actions.createChannelDrafts.input.variants.length, 2);
  assert.equal(first.serviceCalls.length, 3);
  // Re-running the pure bridge is deterministic and emits the same idempotent
  // action keys; the bridge itself performs no duplicate side effect.
  assert.equal(second.bridgeIdentity, first.bridgeIdentity);
  assert.equal(second.actions.stageArtifact.idempotencyKey, first.actions.stageArtifact.idempotencyKey);
  assert.deepEqual(second.candidates.map((candidate) => candidate.contentId), first.candidates.map((candidate) => candidate.contentId));
});

test('bridge rejects stale source, failed pipeline, and ambiguous output before emitting actions', async () => {
  const { root, pipeline } = await fixture();
  await fs.appendFile(path.join(root, 'research', 'product.html'), '\nChanged after run.');
  await assert.rejects(
    bridgeProductContentPipelineResult({ result: pipeline, campaignId: 'bridge-campaign', productRepo: root }),
    (error) => error instanceof ProductContentCampaignBridgeError && error.code === 'STALE_SOURCE'
  );
  await assert.rejects(
    bridgeProductContentPipelineResult({
      result: { ...pipeline, status: 'FAILED', externalSideEffects: false },
      campaignId: 'bridge-campaign', productRepo: root
    }),
    (error) => error instanceof ProductContentCampaignBridgeError && error.code === 'PIPELINE_NOT_SUCCEEDED'
  );
  const duplicateCopies = { ...pipeline, copies: [pipeline.copies[0], pipeline.copies[0]], copyPaths: [pipeline.copyPaths[0], pipeline.copyPaths[0]] };
  // Restore source before exercising ambiguity so the failure is about output
  // shape rather than a preceding stale source fence.
  await fs.writeFile(path.join(root, 'research', 'product.html'), `<!doctype html>
    <html><head><title>Bridge Product</title></head><body><article>
    <p>Bridge output is grounded in verified local source evidence.</p>
    <p>One checked product asset renders into one playable MP4.</p>
    </article></body></html>`);
  await assert.rejects(
    bridgeProductContentPipelineResult({ result: duplicateCopies, campaignId: 'bridge-campaign', productRepo: root }),
    (error) => error instanceof ProductContentCampaignBridgeError && error.code === 'AMBIGUOUS_OUTPUT'
  );
});


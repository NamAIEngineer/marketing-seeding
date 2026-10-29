import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProductContentPipeline } from '../src/product-content-pipeline.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'product-content-pipeline-'));
  await fs.mkdir(path.join(root, 'research'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'research', 'product.html'), `<!doctype html>
    <html><head><title>Fixture Product</title></head>
    <body><article><h1>Bounded local product pipeline</h1>
    <p>The pipeline grounds copy in verified local source evidence.</p>
    <p>It renders a playable MP4 from a checked product asset.</p></article></body></html>`);
  // 2x2 PPM is intentionally tiny, deterministic, and accepted by ffmpeg.
  await fs.writeFile(path.join(root, 'assets', 'product.ppm'), 'P3\n2 2\n255\n255 40 40 40 255 40 40 40 255 255 255 40\n');
  return root;
}

function input(root, outputDir, overrides = {}) {
  return {
    mode: 'FIXTURE',
    runId: 'fixture-run-01',
    outputDir,
    product: { id: 'fixture-product', name: 'Fixture Product', repositoryPath: root },
    campaign: { id: 'fixture-campaign', name: 'Fixture Campaign', callToAction: 'Read the evidence.' },
    sources: [{ path: 'research/product.html', label: 'Product fixture' }],
    assets: [{ path: 'assets/product.ppm', name: 'Product tile' }],
    targets: [{ id: 'linkedin-fixture', channel: 'linkedin' }, { id: 'x-fixture', channel: 'x' }],
    ...overrides,
  };
}

test('fixture pipeline produces grounded report, channel copy, and playable MP4', async () => {
  const root = await fixture();
  const outputDir = path.join(root, 'out');
  const result = await runProductContentPipeline(input(root, outputDir));
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.externalSideEffects, false);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].sourceType, 'local_fixture');
  assert.match(result.evidence[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.report.status, 'grounded');
  assert.ok(result.report.claims.length >= 2);
  assert.ok(result.report.claims.every((claim) => claim.evidenceRefs.length > 0));
  assert.deepEqual(result.copies.map((copy) => copy.channel), ['linkedin', 'x']);
  assert.ok(result.copies.every((copy) => copy.status === 'draft' && copy.content.length > 0));
  const report = JSON.parse(await fs.readFile(result.reportPath, 'utf8'));
  assert.equal(report.runId, 'fixture-run-01');
  const mp4 = await fs.readFile(result.mp4Path);
  assert.ok(mp4.length > 128);
  assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
  assert.notEqual(mp4.indexOf(Buffer.from('moov')), -1);
});

test('pipeline reports truthful typed failures for missing evidence and media backend', async () => {
  const root = await fixture();
  const missing = await runProductContentPipeline(input(root, path.join(root, 'missing-out'), {
    sources: [{ path: 'research/nope.html' }],
  }));
  assert.equal(missing.status, 'FAILED');
  assert.equal(missing.failure.code, 'RESEARCH_FAILED');
  const unavailable = await runProductContentPipeline(input(root, path.join(root, 'unavailable-out'), {
    ffmpegPath: path.join(root, 'no-ffmpeg'),
  }));
  assert.equal(unavailable.status, 'FAILED');
  assert.equal(unavailable.failure.code, 'MEDIA_BACKEND_UNAVAILABLE');
  assert.equal(unavailable.mp4Path, null);
});

test('fixture mode does not fabricate remote research', async () => {
  const root = await fixture();
  const result = await runProductContentPipeline(input(root, path.join(root, 'remote-out'), {
    sources: [{ url: 'https://example.com/product' }],
  }));
  assert.equal(result.status, 'FAILED');
  assert.equal(result.failure.code, 'INVALID_INPUT');
});
